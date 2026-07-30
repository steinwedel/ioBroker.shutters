/*
 * ioBroker Shutters Adapter
 * See plans/shutters-adapter-plan.md for the full design.
 */

import * as utils from '@iobroker/adapter-core';
import { AutomationEngine } from './lib/automation';
import { GroupController } from './lib/group-controller';
import { HolidayChecker } from './lib/holiday';
import { Scheduler } from './lib/scheduler';
import { SceneController } from './lib/scene-manager';
import { ShutterController } from './lib/shutter-controller';
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

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'shutters',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
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

        this.automationEngine = new AutomationEngine(this, this.controllers, this.weatherSource, {
            sunCloseThreshold: this.config.sunCloseThreshold ?? 200,
            sunOpenThreshold: this.config.sunOpenThreshold ?? 150,
            sunOpenMinDurationMs: this.config.sunOpenMinDurationMs ?? 600_000,
            windOpenThreshold: this.config.windOpenThreshold ?? 40,
            windCloseAllowedThreshold: this.config.windCloseAllowedThreshold ?? 25,
            windCalmMinDurationMs: this.config.windCalmMinDurationMs ?? 600_000,
            frostThreshold: this.config.frostThreshold ?? 2,
            tickMs: this.config.automationTickMs ?? 30_000,
        });
        await this.automationEngine.start();

        const location = await this.resolveLocation();
        const holidayChecker = new HolidayChecker(this.config.publicHolidayFederalState);
        this.scheduler = new Scheduler(this, this.config.areas ?? [], holidayChecker, location, (areaName, action) => {
            this.onScheduleTrigger(areaName, action);
        });
        this.scheduler.start();
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
     * Reads latitude/longitude for dusk-coupled areas: prefers `native.latitude`/`native.longitude` if set, otherwise falls back to the global ioBroker location in `system.config`.
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
            'No location configured (neither adapter settings nor system.config) - dusk-coupled areas will not be scheduled.',
        );
        return undefined;
    }

    /**
     * Feeds a schedule-triggered open/close action into the automation
     * engine for every covering in the given area that has automation
     * enabled; the engine applies it at its next tick, arbitrated against
     * wind/rain/sun/frost protection (plan section 8).
     *
     * @param areaName - Area/zone name as configured on the triggered coverings.
     * @param action - Whether to open (0%) or close (100%) the affected coverings.
     */
    private onScheduleTrigger(areaName: string, action: 'open' | 'close'): void {
        const targetPercent = action === 'open' ? 0 : 100;
        for (const [id, controller] of this.controllers) {
            if (controller.getArea() !== areaName || !controller.isAutomationEnabled()) {
                continue;
            }
            this.automationEngine?.setScheduleTarget(id, targetPercent);
        }
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
