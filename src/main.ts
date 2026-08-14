/*
 * ioBroker Shutters Adapter
 * See plans/shutters-adapter-plan.md for the full design.
 */

import * as utils from '@iobroker/adapter-core';
import { normalizeAreaAssignments } from './lib/area-assignment';
import { AutomationEngine } from './lib/automation';
import { GroupController } from './lib/group-controller';
import { nextAvailableCoveringId } from './lib/id-generator';
import { Scheduler } from './lib/scheduler';
import { SceneController } from './lib/scene-manager';
import { scanForShutters, type IScannedShutter } from './lib/shutter-scanner';
import { ShutterController } from './lib/shutter-controller';
import type { IShutterConfig } from './lib/types';
import { WeatherSource } from './lib/weather-source';

/** Anything that can handle a state change for its own, relative state IDs - implemented by ShutterController, GroupController and SceneController. */
interface IStateChangeHandler {
    handleStateChange(id: string, state: ioBroker.State): Promise<boolean>;
}

class Shutters extends utils.Adapter {
    private readonly controllers = new Map<string, ShutterController>();
    private readonly groupControllers: GroupController[] = [];
    private readonly sceneControllers: SceneController[] = [];
    /** Maps a full state ID (e.g. "shutters.0.shutters.wz.position") to the handler that owns it (covering/group/scene). */
    private readonly stateIdToHandler = new Map<string, IStateChangeHandler>();
    /** Periodic driver -> positionActual/positionRaw sync, see `dataSource: poll` in io-package.json. */
    private positionRefreshTimer: ioBroker.Interval | undefined;
    private scheduler: Scheduler | undefined;
    private weatherSource: WeatherSource | undefined;
    private automationEngine: AutomationEngine | undefined;
    /**
     * Current value of `native.holidayStateId` (an existing boolean state, own or foreign, e.g. from a
     * calendar/iCal adapter), kept up to date via `subscribeForeignStates` and consulted by the
     * `Scheduler` to decide whether "today" counts as a public holiday. False if unconfigured/unset.
     */
    private isPublicHoliday = false;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'shutters',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        await this.setObjectNotExistsAsync('info', { type: 'channel', common: { name: 'Information' }, native: {} });
        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name: 'Connected to all configured systems',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('info.lastScanResult', {
            type: 'state',
            common: {
                name: 'Result of the last covering auto-discovery scan (JSON)',
                type: 'string',
                role: 'json',
                read: true,
                write: false,
                expert: true,
            },
            native: {},
        });

        if (await this.migrateLegacyCoveringIds()) {
            return;
        }
        if (await this.migrateAreaAssignments()) {
            return;
        }

        await this.createShutterControllers();
        await this.createGroupControllers();
        await this.createSceneControllers();

        for (const stateId of this.stateIdToHandler.keys()) {
            this.subscribeStates(stateId.slice(this.namespace.length + 1));
        }

        await this.setStateAsync('info.connection', this.controllers.size > 0, true);

        this.positionRefreshTimer = this.setInterval(() => {
            for (const controller of this.controllers.values()) {
                controller.refreshPosition().catch(err => {
                    this.log.warn(`Position refresh failed: ${(err as Error).message}`);
                });
            }
        }, 5000);

        this.weatherSource = new WeatherSource(this, this.config.weather ?? {});
        await this.weatherSource.start();

        const location = await this.resolveLocation();

        this.automationEngine = new AutomationEngine(this, this.controllers, this.weatherSource, {
            sunCloseThreshold: this.config.sunCloseThreshold ?? 200,
            sunProtectionGlobalEnabled: this.config.sunProtectionGlobalEnabled ?? true,
            sunOpenThreshold: this.config.sunOpenThreshold ?? 150,
            sunOpenMinDurationMs: this.config.sunOpenMinDurationMs ?? 600_000,
            windOpenThreshold: this.config.windOpenThreshold ?? 40,
            windCloseAllowedThreshold: this.config.windCloseAllowedThreshold ?? 25,
            windCalmMinDurationMs: this.config.windCalmMinDurationMs ?? 600_000,
            frostThreshold: this.config.frostThreshold ?? 2,
            tickMs: this.config.automationTickMs ?? 30_000,
            location,
        });
        await this.automationEngine.start();

        await this.initHolidayState();

        this.scheduler = new Scheduler(
            this,
            this.config.areas ?? [],
            () => this.isPublicHoliday,
            location,
            (area, action) => {
                this.onScheduleTrigger(area.id!, area.name, action);
            },
        );
        this.scheduler.start();
    }

    /**
     * Reads the current value of `native.holidayStateId` (if configured) into `this.isPublicHoliday`,
     * and subscribes to it so later changes keep it up to date - see `IShutterAdapterConfig.holidayStateId`.
     * The state may be foreign (e.g. an iCal/calendar adapter's "is public holiday" indicator), so this
     * uses `subscribeForeignStates`/`getForeignStateAsync` rather than the own-namespace helpers.
     */
    private async initHolidayState(): Promise<void> {
        const stateId = this.config.holidayStateId;
        if (!stateId) {
            return;
        }

        const state = await this.getForeignStateAsync(stateId);
        this.isPublicHoliday = !!state?.val;
        this.subscribeForeignStates(stateId);
    }

    /** Creates a `ShutterController` for every configured covering and indexes its own state IDs for dispatch. */
    private async createShutterControllers(): Promise<void> {
        for (const shutterConfig of this.config.shutters ?? []) {
            try {
                const controller = new ShutterController(this, shutterConfig);
                await controller.createObjects();
                this.controllers.set(shutterConfig.id, controller);
                this.indexHandler(controller, controller.getOwnStateIds());
            } catch (err) {
                // A single misconfigured covering must not prevent the rest of
                // the adapter from starting up (plan section: startup validation).
                this.log.error(`Skipping covering "${shutterConfig.id}": ${(err as Error).message}`);
            }
        }
    }

    /** Creates a `GroupController` for every configured group, resolving its member coverings. */
    private async createGroupControllers(): Promise<void> {
        for (const groupConfig of this.config.groups ?? []) {
            const members = groupConfig.memberIds
                .map(memberId => this.controllers.get(memberId))
                .filter((c): c is ShutterController => {
                    if (!c) {
                        this.log.warn(`Group "${groupConfig.id}": unknown member covering ID - skipped.`);
                    }
                    return Boolean(c);
                });
            if (members.length === 0) {
                this.log.warn(`Group "${groupConfig.id}": no valid members - skipped.`);
                continue;
            }
            const group = new GroupController(this, groupConfig, members);
            await group.createObjects();
            this.groupControllers.push(group);
            this.indexHandler(group, group.getOwnStateIds());
        }
    }

    /** Creates a `SceneController` for every configured scene, resolving its target coverings. */
    private async createSceneControllers(): Promise<void> {
        for (const sceneConfig of this.config.scenes ?? []) {
            const targets = sceneConfig.targets
                .map(t => {
                    const controller = this.controllers.get(t.coveringId);
                    if (!controller) {
                        this.log.warn(
                            `Scene "${sceneConfig.id}": unknown target covering ID "${t.coveringId}" - skipped.`,
                        );
                        return undefined;
                    }
                    return { controller, percent: t.percent };
                })
                .filter((t): t is { controller: ShutterController; percent: number } => Boolean(t));
            if (targets.length === 0) {
                this.log.warn(`Scene "${sceneConfig.id}": no valid targets - skipped.`);
                continue;
            }
            const scene = new SceneController(this, sceneConfig, targets);
            await scene.createObjects();
            this.sceneControllers.push(scene);
            this.indexHandler(scene, scene.getOwnStateIds());
        }
    }

    /**
     * @param handler - Controller to dispatch matching state changes to.
     * @param relativeStateIds - This handler's own state IDs, relative to the adapter namespace.
     */
    private indexHandler(handler: IStateChangeHandler, relativeStateIds: string[]): void {
        for (const relativeId of relativeStateIds) {
            this.stateIdToHandler.set(`${this.namespace}.${relativeId}`, handler);
        }
    }

    /**
     * Reads latitude/longitude for areas using a sunrise/sunset offset: prefers `native.latitude`/`native.longitude` if set, otherwise falls back to the global ioBroker location in `system.config`.
     */
    private async resolveLocation(): Promise<{ latitude: number; longitude: number } | undefined> {
        if (this.config.latitude !== undefined && this.config.longitude !== undefined) {
            return { latitude: this.config.latitude, longitude: this.config.longitude };
        }
        const systemConfig = await this.getForeignObjectAsync('system.config');
        const common = systemConfig?.common as { latitude?: number; longitude?: number } | undefined;
        if (common?.latitude !== undefined && common?.longitude !== undefined) {
            return { latitude: common.latitude, longitude: common.longitude };
        }
        this.log.warn(
            'No location configured (neither adapter settings nor system.config) - areas using a sunrise/sunset offset will not be scheduled, and orientation-based sun protection will fall back to sunWindowStart/sunWindowEnd.',
        );
        return undefined;
    }

    private onScheduleTrigger(areaId: string, areaName: string, action: 'open' | 'close'): void {
        const targetPercent = action === 'open' ? 0 : 100;
        for (const [id, controller] of this.controllers) {
            const matchesArea =
                controller.getAreaId() === areaId ||
                (!controller.getAreaId() && controller.getLegacyAreaName() === areaName);
            if (!matchesArea || !controller.isAutomationEnabled()) {
                continue;
            }
            this.automationEngine?.setScheduleTarget(id, targetPercent);
        }
    }

    /**
     * Handles `sendTo` messages from the admin UI:
     * - `scanForShutters` (plan section 2b): runs the auto-discovery scan, automatically adds every
     *   found candidate to `native.shutters[]` (which restarts the adapter instance, like any other
     *   config change made in the admin UI), and replies with a short summary the admin UI can display.
     *
     * @param obj - Message object as delivered by `js-controller`.
     */
    private onMessage(obj: ioBroker.Message): void {
        if (obj.command !== 'scanForShutters') {
            return;
        }

        void this.runShutterScan()
            .then(async result => {
                const addedCount = await this.addScannedShuttersToConfig(result.shutters);
                if (obj.callback) {
                    const summary =
                        addedCount > 0
                            ? `Added ${addedCount} covering(s) to the configuration. The adapter instance will restart to apply the change.`
                            : 'No new coverings found.';
                    this.sendTo(obj.from, obj.command, { result: summary, errors: result.errors }, obj.callback);
                }
            })
            .catch(err => {
                this.log.error(`Covering scan failed: ${(err as Error).message}`);
                if (obj.callback) {
                    this.sendTo(obj.from, obj.command, { error: (err as Error).message }, obj.callback);
                }
            });
    }

    /** Runs the auto-discovery scan and persists/logs its result; see `onMessage()`. */
    private async runShutterScan(): Promise<{ shutters: IScannedShutter[]; errors: string[] }> {
        const alreadyConfigured = new Set<string>();
        for (const shutterConfig of this.config.shutters ?? []) {
            for (const stateId of Object.values(shutterConfig.states)) {
                if (stateId) {
                    alreadyConfigured.add(stateId);
                }
            }
        }

        const result = await scanForShutters(this, alreadyConfigured);
        await this.setStateAsync('info.lastScanResult', JSON.stringify(result), true);

        this.log.info(`Covering scan found ${result.shutters.length} candidate(s).`);
        for (const shutter of result.shutters) {
            this.log.info(`  - ${JSON.stringify(shutter)}`);
        }
        for (const error of result.errors) {
            this.log.warn(`Covering scan error: ${error}`);
        }

        return result;
    }

    /**
     * One-time startup migration: renames every covering whose `id` does not already match the
     * sequential "shutter<N>" scheme (e.g. a legacy ID derived from the source system's state ID,
     * before `nextAvailableCoveringId` was introduced) to a fresh sequential ID. The old covering's
     * entire state tree is deleted (a clean one is created under the new ID once this method returns
     * and the pending config change restarts the instance); every `groups[].memberIds` and
     * `scenes[].targets[].coveringId` reference to a renamed covering is rewritten to match, so
     * existing groups/scenes keep working. Coverings already using the new scheme are left completely
     * untouched (their states/history are not affected).
     *
     * @returns True if any covering was renamed (and the config was persisted, which triggers the usual
     *   adapter restart for a config change - callers should stop the rest of `onReady()` in that case).
     */
    private async migrateLegacyCoveringIds(): Promise<boolean> {
        const shutters = this.config.shutters ?? [];
        const legacyIdPattern = /^shutter\d+$/;
        const legacyShutters = shutters.filter(s => !legacyIdPattern.test(s.id));
        if (legacyShutters.length === 0) {
            return false;
        }

        const existingIds = new Set(shutters.map(s => s.id));
        const idMap = new Map<string, string>();
        for (const covering of legacyShutters) {
            const newId = nextAvailableCoveringId(existingIds);
            existingIds.add(newId);
            idMap.set(covering.id, newId);
        }

        this.log.info(
            `Migrating ${idMap.size} covering(s) to the new sequential ID scheme: ${Array.from(idMap.entries())
                .map(([oldId, newId]) => `"${oldId}" -> "${newId}"`)
                .join(', ')}`,
        );

        for (const oldId of idMap.keys()) {
            try {
                await this.delObjectAsync(`shutters.${oldId}`, { recursive: true });
            } catch (err) {
                this.log.warn(`Could not delete the old state tree for covering "${oldId}": ${(err as Error).message}`);
            }
        }

        const updatedShutters = shutters.map(s => ({ ...s, id: idMap.get(s.id) ?? s.id }));
        const updatedGroups = (this.config.groups ?? []).map(group => ({
            ...group,
            memberIds: group.memberIds.map(id => idMap.get(id) ?? id),
        }));
        const updatedScenes = (this.config.scenes ?? []).map(scene => ({
            ...scene,
            targets: scene.targets.map(target => ({
                ...target,
                coveringId: idMap.get(target.coveringId) ?? target.coveringId,
            })),
        }));

        await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
            native: { shutters: updatedShutters, groups: updatedGroups, scenes: updatedScenes },
        });
        return true;
    }

    private async migrateAreaAssignments(): Promise<boolean> {
        const result = normalizeAreaAssignments(this.config.areas ?? [], this.config.shutters ?? []);
        if (!result.changed) {
            return false;
        }

        for (const name of result.ambiguousAreaNames) {
            this.log.warn(`Could not migrate covering assignment for duplicate area name "${name}".`);
        }
        await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
            native: { areas: result.areas, shutters: result.shutters },
        });
        return true;
    }

    /**
     * Adds every scanned candidate to `native.shutters[]` and persists it
     * via `extendForeignObjectAsync`, which merges only the `shutters` key
     * within `native` (leaving areas/weather/groups/scenes untouched) and
     * triggers the usual adapter restart for a config change. Each added
     * covering gets a fresh, simple sequential ID (`nextAvailableCoveringId`)
     * rather than the scanner's proposed ID (which was only ever derived
     * from the discovered source state ID for internal dedup purposes, not
     * meant to be user-facing). Candidates whose proposed `id` already
     * matches an existing covering (e.g. a duplicate within the same scan
     * result) are skipped defensively, even though `scanForShutters()`
     * already excludes states already referenced by an existing covering.
     *
     * @param scanned - Candidates returned by `scanForShutters()`.
     * @returns The number of coverings actually added.
     */
    private async addScannedShuttersToConfig(scanned: IScannedShutter[]): Promise<number> {
        if (scanned.length === 0) {
            return 0;
        }

        const existing = this.config.shutters ?? [];
        const existingIds = new Set(existing.map(s => s.id));
        const candidates = scanned.filter(s => !existingIds.has(s.id));

        // Assign a fresh, simple sequential ID (see nextAvailableCoveringId doc) instead of the
        // scanner's proposed ID (which was derived from the often cryptic source state ID, e.g. a
        // Homematic channel address) - threading `existingIds` through the loop so multiple new
        // coverings found in the same scan never get the same generated ID.
        const newConfigs: IShutterConfig[] = candidates.map(s => {
            const id = nextAvailableCoveringId(existingIds);
            existingIds.add(id);
            return {
                id,
                name: s.name,
                driverType: s.driverType,
                coveringType: s.coveringType,
                automationEnabled: s.automationEnabled,
                states: s.states,
            };
        });

        if (newConfigs.length === 0) {
            return 0;
        }

        await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
            native: { shutters: [...existing, ...newConfigs] },
        });

        return newConfigs.length;
    }

    /**
     * Is called if a subscribed state changes.
     *
     * @param id - State ID
     * @param state - State object
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state) {
            return;
        }

        if (id === this.config.holidayStateId) {
            this.isPublicHoliday = !!state.val;
            return;
        }

        const handler = this.stateIdToHandler.get(id);
        if (!handler) {
            return;
        }

        // Handlers compare against the relative state IDs they created
        // themselves, so strip the "<namespace>." prefix here.
        const relativeId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
        handler.handleStateChange(relativeId, state).catch(err => {
            this.log.error(`Error handling state change for "${id}": ${(err as Error).message}`);
        });
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            this.scheduler?.stop();
            this.automationEngine?.stop();
            this.weatherSource?.stop();
            if (this.positionRefreshTimer) {
                this.clearInterval(this.positionRefreshTimer);
            }
            for (const controller of this.controllers.values()) {
                controller.destroy();
            }
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Shutters(options);
} else {
    // otherwise start the instance directly
    (() => new Shutters())();
}
