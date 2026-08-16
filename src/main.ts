/*
 * ioBroker Shutters Adapter
 * See plans/shutters-adapter-plan.md for the full design.
 */

import * as utils from '@iobroker/adapter-core';
import { AutomationEngine } from './lib/automation';
import { GroupController } from './lib/group-controller';
import { type IIcalTableEvent, resolveIcalOverridesForDay } from './lib/ical';
import { nextAvailableCoveringId } from './lib/id-generator';
import { sendNotification } from './lib/notify';
import { Scheduler } from './lib/scheduler';
import { SceneController } from './lib/scene-manager';
import { scanForShutters, type IScannedShutter } from './lib/shutter-scanner';
import { ShutterController } from './lib/shutter-controller';
import type { IShutterConfig } from './lib/types';
import { createWeatherDiagnosticObjects, updateWeatherDiagnosticStates } from './lib/weather-diagnostics';
import { WeatherSource } from './lib/weather-source';

/** Anything that can handle a state change for its own, relative state IDs - implemented by ShutterController, GroupController and SceneController. */
interface IStateChangeHandler {
    handleStateChange(id: string, state: ioBroker.State): Promise<boolean>;
}

/** Default `native.icalTitlePrefix` when unset, see `initIcalIntegration()`. */
const DEFAULT_ICAL_TITLE_PREFIX = 'Rolläden';

class Shutters extends utils.Adapter {
    private readonly controllers = new Map<string, ShutterController>();
    private readonly groupControllers: GroupController[] = [];
    private readonly sceneControllers: SceneController[] = [];
    /** Maps a full state ID (e.g. "shutters.0.shutters.wz.control.position") to the handler that owns it (covering/group/scene). */
    private readonly stateIdToHandler = new Map<string, IStateChangeHandler>();
    /** Periodic driver -> positionActual/positionRaw sync, see `dataSource: poll` in io-package.json. */
    private positionRefreshTimer: ioBroker.Interval | undefined;
    /** Periodic writer for `astro.*`/`weather.*` diagnostic states (plan section 3), see `weather-diagnostics.ts`. */
    private weatherDiagnosticsTimer: ioBroker.Interval | undefined;
    private scheduler: Scheduler | undefined;
    private weatherSource: WeatherSource | undefined;
    private automationEngine: AutomationEngine | undefined;
    /**
     * Current value of `native.holidayStateId` (an existing boolean state, own or foreign, e.g. from a
     * calendar/iCal adapter), kept up to date via `subscribeForeignStates` and consulted by the
     * `Scheduler` to decide whether "today" counts as a public holiday. False if unconfigured/unset.
     */
    private isPublicHoliday = false;
    /**
     * Full state ID of the configured `ioBroker.ical` instance's `data.table` state (plan section
     * 5.1), derived from `native.icalAdapterInstance`, or undefined if iCal overrides are disabled.
     */
    private icalTableStateId: string | undefined;
    /** Effective `native.icalTitlePrefix`, falling back to `DEFAULT_ICAL_TITLE_PREFIX`. Only meaningful while `icalTableStateId` is set. */
    private icalTitlePrefix = DEFAULT_ICAL_TITLE_PREFIX;
    /** Most recently parsed contents of `icalTableStateId`, kept up to date via `subscribeForeignStates` and consulted by the `Scheduler` for day-level open/close overrides (plan section 5.1). */
    private icalEvents: IIcalTableEvent[] = [];

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

        await this.setObjectNotExistsAsync('info.scanProgress', {
            type: 'state',
            common: {
                name: 'Progress message of a covering auto-discovery scan currently running, empty when idle (plan section 2b.3)',
                type: 'string',
                role: 'text',
                read: true,
                write: false,
                expert: true,
            },
            native: {},
        });

        await this.setObjectNotExistsAsync('info.lastSeasonalReminderYear', {
            type: 'state',
            common: {
                name: 'Calendar year the seasonal sun-protection reminder was last sent in (plan section 10a.14)',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                expert: true,
            },
            native: {},
        });

        await this.createShutterControllers();
        await this.createGroupControllers();
        await this.createSceneControllers();
        await this.createQuickActions();

        for (const stateId of this.stateIdToHandler.keys()) {
            this.subscribeStates(stateId.slice(this.namespace.length + 1));
        }

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
        await this.initHolidayState();
        await this.initIcalIntegration();

        // Astro/weather diagnostic states (plan section 3) - previously computed only internally,
        // never surfaced as visible states. Written once immediately, then kept up to date on the
        // same cadence as the automation tick (weather values change with the underlying foreign
        // states anyway; the astro-derived ones only meaningfully change over minutes, not seconds).
        await createWeatherDiagnosticObjects(this);
        const weatherSourceForDiagnostics = this.weatherSource;
        const updateDiagnostics = (): void => {
            updateWeatherDiagnosticStates(this, weatherSourceForDiagnostics, location).catch(err => {
                this.log.warn(`Updating weather/astro diagnostic states failed: ${(err as Error).message}`);
            });
        };
        updateDiagnostics();
        this.weatherDiagnosticsTimer = this.setInterval(updateDiagnostics, this.config.automationTickMs ?? 30_000);

        this.scheduler = new Scheduler(
            this,
            this.config.areas ?? [],
            () => this.isPublicHoliday,
            location,
            (area, action) => {
                this.onScheduleTrigger(area.id!, area.name, action);
            },
            this.icalTableStateId
                ? () => resolveIcalOverridesForDay(this.icalEvents, this.icalTitlePrefix, new Date())
                : undefined,
        );

        this.automationEngine = new AutomationEngine(this, this.controllers, this.weatherSource, {
            sunCloseThreshold: this.config.sunCloseThreshold ?? 200,
            sunProtectionGlobalEnabled: this.config.sunProtectionGlobalEnabled ?? true,
            sunOpenThreshold: this.config.sunOpenThreshold ?? 150,
            sunOpenMinDurationMs: this.config.sunOpenMinDurationMs ?? 600_000,
            sunProtectionCloudCoverTriggerEnabled: this.config.sunProtectionCloudCoverTriggerEnabled ?? false,
            sunProtectionClearSkyCloudCoverMaxPercent: this.config.sunProtectionClearSkyCloudCoverMaxPercent ?? 40,
            windOpenThreshold: this.config.windOpenThreshold ?? 40,
            windCloseAllowedThreshold: this.config.windCloseAllowedThreshold ?? 25,
            windCalmMinDurationMs: this.config.windCalmMinDurationMs ?? 600_000,
            frostThreshold: this.config.frostThreshold ?? 2,
            nightCoolingIndoorMinTemp: this.config.nightCoolingIndoorMinTemp ?? 24,
            nightCoolingMinDelta: this.config.nightCoolingMinDelta ?? 3,
            tickMs: this.config.automationTickMs ?? 30_000,
            location,
        });
        // Storm/frost notifications (plan section 9a.3) are aggregated across every covering rather
        // than sent per covering - see `AutomationEngine`'s field docs.
        this.automationEngine.onWindProtectionChange = active => {
            this.sendNotification(
                'Rolläden Sturmwarnung',
                active
                    ? 'Windschutz ist für mindestens einen Rolladen aktiv - betroffene Rolläden wurden in die Sicherheitsposition gefahren.'
                    : 'Windschutz ist für keinen Rolladen mehr aktiv.',
            );
        };
        this.automationEngine.onFrostProtectionChange = active => {
            this.sendNotification(
                'Rolläden Frostschutz',
                active
                    ? 'Frostschutz ist für mindestens einen Rolladen aktiv - automatische Fahrbefehle werden dort ausgesetzt.'
                    : 'Frostschutz ist für keinen Rolladen mehr aktiv.',
            );
        };
        // Seasonal reminder (plan section 10a.14): unlike wind/frost, sun protection engaging is
        // routine, expected behavior - only notify once per calendar year, the first time it happens.
        this.automationEngine.onSunProtectionChange = active => {
            if (active) {
                this.sendSeasonalReminderIfNewYear().catch(err => {
                    this.log.error(`Seasonal reminder failed: ${(err as Error).message}`);
                });
            }
        };

        this.reconcileScheduleTargetsOnStartup();

        await this.automationEngine.start();
        this.scheduler.start();
        await this.setStateAsync('info.connection', this.controllers.size > 0, true);
    }

    /**
     * Seeds every covering's schedule target from today's already-past open/close time before the
     * automation engine's first tick, so a restart mid-day (or after the day's opening time has
     * already passed) immediately commands the covering to its currently intended position - schedule
     * target, further refined by sun/wind/rain/frost protection - instead of leaving it in whatever
     * position it happened to be in until the next future schedule trigger (potentially tomorrow's).
     */
    private reconcileScheduleTargetsOnStartup(): void {
        if (!this.scheduler || !this.automationEngine) {
            return;
        }
        const now = new Date();
        for (const area of this.config.areas ?? []) {
            if (!area.id) {
                continue;
            }
            const action = this.scheduler.resolveCurrentAction(area, now);
            if (!action) {
                continue;
            }
            const targetPercent = action === 'open' ? 0 : 100;
            for (const [id] of this.matchingControllers(area.id)) {
                this.automationEngine.setScheduleTarget(id, targetPercent);
            }
        }
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

    /**
     * Reads the current contents of the configured `ioBroker.ical` instance's `data.table` state
     * (if `native.icalAdapterInstance` is set) into `this.icalEvents`, and subscribes to it so later
     * changes keep it up to date (plan section 5.1) - see `IShuttersNativeConfig.icalAdapterInstance`.
     * The actual `.ics` parsing/fetching is entirely the `ioBroker.ical` instance's responsibility;
     * this adapter only ever reads that one foreign state.
     */
    private async initIcalIntegration(): Promise<void> {
        const instance = this.config.icalAdapterInstance?.trim();
        if (!instance) {
            return;
        }

        this.icalTitlePrefix = this.config.icalTitlePrefix?.trim() || DEFAULT_ICAL_TITLE_PREFIX;
        this.icalTableStateId = `${instance}.data.table`;

        const state = await this.getForeignStateAsync(this.icalTableStateId);
        this.icalEvents = this.parseIcalTable(state?.val);
        this.subscribeForeignStates(this.icalTableStateId);
    }

    /**
     * Parses the raw value of an `ioBroker.ical` instance's `data.table` state into
     * `IIcalTableEvent[]`. Tolerates both a JSON-encoded string (the normal case for a foreign
     * state read through `getForeignStateAsync`/`onStateChange`) and an already-parsed array
     * (defensive, in case a differently configured instance ever sets it as a native array/object
     * value instead); any other shape or a parse failure is logged and treated as "no events",
     * rather than letting a malformed calendar break the whole schedule.
     *
     * @param val - Raw `ioBroker.State.val` of the `data.table` state.
     */
    private parseIcalTable(val: ioBroker.StateValue | undefined): IIcalTableEvent[] {
        if (val === undefined || val === null || val === '') {
            return [];
        }
        try {
            const parsed: unknown = typeof val === 'string' ? JSON.parse(val) : val;
            return Array.isArray(parsed) ? (parsed as IIcalTableEvent[]) : [];
        } catch (err) {
            this.log.warn(`Failed to parse iCal data from "${this.icalTableStateId}": ${(err as Error).message}`);
            return [];
        }
    }

    /** Creates a `ShutterController` for every configured covering and indexes its own state IDs for dispatch. */
    private async createShutterControllers(): Promise<void> {
        for (const shutterConfig of this.config.shutters ?? []) {
            try {
                const controller = new ShutterController(this, shutterConfig);
                controller.onWatchdogIssue = message => this.sendNotification('Rolladen-Watchdog', message);
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

    /**
     * Sends a notification via the configured Pushover/Telegram instances (plan section 9a.3), if
     * any; a thin wrapper around `notify.ts`'s `sendNotification()` so callers do not need to
     * import/pass `this.config` themselves. Never throws - see `sendNotification()`.
     *
     * @param title - Short notification title/subject.
     * @param message - Notification body.
     */
    private sendNotification(title: string, message: string): void {
        sendNotification(this, this.config, title, message).catch(err => {
            this.log.warn(`Sending notification "${title}" failed unexpectedly: ${(err as Error).message}`);
        });
    }

    /**
     * Sends the once-per-year seasonal reminder (plan section 10a.14) the first time sun protection
     * actually engages for at least one covering, comparing the current calendar year against
     * `info.lastSeasonalReminderYear` (persisted, so a restart within the same year does not re-send
     * it) rather than tracking it purely in memory.
     */
    private async sendSeasonalReminderIfNewYear(): Promise<void> {
        const currentYear = new Date().getFullYear();
        const state = await this.getStateAsync('info.lastSeasonalReminderYear');
        if (typeof state?.val === 'number' && state.val === currentYear) {
            return;
        }

        await this.setStateAsync('info.lastSeasonalReminderYear', { val: currentYear, ack: true });
        this.sendNotification(
            'Rolläden Sonnenschutz',
            'Der Sonnenschutz ist jetzt wieder aktiv - Zeitfenster und Zielposition weiterhin passend?',
        );
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
     * Creates the two global quick-action buttons (plan section 10a.4): unlike a group's
     * `openAll`/`closeAll` (which only affect that group's members), these affect **every**
     * configured covering at once, regardless of group membership - the single most common
     * "I'm leaving/coming home" action for a whole home, without needing a group that happens to
     * contain everything.
     */
    private async createQuickActions(): Promise<void> {
        await this.setObjectNotExistsAsync('quickActions', {
            type: 'channel',
            common: { name: 'Quick actions' },
            native: {},
        });

        await this.setObjectNotExistsAsync('quickActions.allOpen', {
            type: 'state',
            common: {
                name: 'Open every covering',
                type: 'boolean',
                role: 'button.open.blind',
                read: true,
                write: true,
            },
            native: {},
        });
        await this.setObjectNotExistsAsync('quickActions.allClose', {
            type: 'state',
            common: {
                name: 'Close every covering',
                type: 'boolean',
                role: 'button.close.blind',
                read: true,
                write: true,
            },
            native: {},
        });

        const handler: IStateChangeHandler = {
            handleStateChange: async (relativeId, state) => {
                if (state.ack) {
                    return false;
                }
                if (relativeId === 'quickActions.allOpen') {
                    await Promise.all([...this.controllers.values()].map(c => c.commandOpen()));
                    await this.setStateAsync('quickActions.allOpen', { val: false, ack: true });
                    return true;
                }
                if (relativeId === 'quickActions.allClose') {
                    await Promise.all([...this.controllers.values()].map(c => c.commandClose()));
                    await this.setStateAsync('quickActions.allClose', { val: false, ack: true });
                    return true;
                }
                return false;
            },
        };
        this.indexHandler(handler, ['quickActions.allOpen', 'quickActions.allClose']);
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

    private onScheduleTrigger(areaId: string, _areaName: string, action: 'open' | 'close'): void {
        const targetPercent = action === 'open' ? 0 : 100;
        for (const [id] of this.matchingControllers(areaId)) {
            this.automationEngine?.setScheduleTarget(id, targetPercent);
        }
        // Re-evaluate immediately rather than waiting for the next periodic tick, so a covering that
        // is already eligible for e.g. sun protection is never briefly commanded to the plain schedule
        // target first.
        this.automationEngine?.evaluateNow();
    }

    /**
     * @param areaId - Stable area ID to match against `ShutterController.getAreaId()`.
     * @returns Every automation-enabled covering assigned to the given area, as `[id, controller]` pairs.
     */
    private matchingControllers(areaId: string): [string, ShutterController][] {
        const matches: [string, ShutterController][] = [];
        for (const [id, controller] of this.controllers) {
            if (controller.getAreaId() === areaId && controller.isAutomationEnabled()) {
                matches.push([id, controller]);
            }
        }
        return matches;
    }

    /**
     * Handles `sendTo` messages from the admin UI:
     * - `scanForShutters` (plan section 2b): runs the auto-discovery scan and replies with every
     *   found candidate for the admin UI to present as a preview list (plan section 2b.3) - it does
     *   **not** add anything to the configuration by itself. Progress messages (`ScanProgressCallback`)
     *   are written to `info.scanProgress` as the scan runs, for a live status display; see
     *   `admin/shutters.js`'s `onScanClicked()`.
     * - `applyScannedShutters` (plan section 2b.3): adds exactly the (possibly user-edited/deselected)
     *   candidates sent in `obj.message.candidates` to `native.shutters[]`, which restarts the adapter
     *   instance like any other config change made in the admin UI.
     *
     * @param obj - Message object as delivered by `js-controller`.
     */
    private onMessage(obj: ioBroker.Message): void {
        if (obj.command === 'scanForShutters') {
            void this.runShutterScan()
                .then(result => {
                    if (obj.callback) {
                        this.sendTo(
                            obj.from,
                            obj.command,
                            { candidates: result.shutters, errors: result.errors },
                            obj.callback,
                        );
                    }
                })
                .catch(err => {
                    this.log.error(`Covering scan failed: ${(err as Error).message}`);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: (err as Error).message }, obj.callback);
                    }
                });
            return;
        }

        if (obj.command === 'applyScannedShutters') {
            const candidates = Array.isArray((obj.message as { candidates?: unknown })?.candidates)
                ? ((obj.message as { candidates: IScannedShutter[] }).candidates ?? [])
                : [];
            void this.addScannedShuttersToConfig(candidates)
                .then(addedCount => {
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { added: addedCount }, obj.callback);
                    }
                })
                .catch(err => {
                    this.log.error(`Applying scanned coverings failed: ${(err as Error).message}`);
                    if (obj.callback) {
                        this.sendTo(obj.from, obj.command, { error: (err as Error).message }, obj.callback);
                    }
                });
        }
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

        const result = await scanForShutters(this, alreadyConfigured, message => {
            this.setState('info.scanProgress', message, true).catch(err => {
                this.log.debug(`Failed to update scan progress: ${(err as Error).message}`);
            });
        });
        await this.setStateAsync('info.lastScanResult', JSON.stringify(result), true);
        await this.setStateAsync('info.scanProgress', '', true);

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
            this.scheduler?.stop();
            this.reconcileScheduleTargetsOnStartup();
            this.scheduler?.start();
            this.automationEngine?.evaluateNow();
            return;
        }

        if (id === this.icalTableStateId) {
            this.icalEvents = this.parseIcalTable(state.val);
            this.scheduler?.stop();
            this.reconcileScheduleTargetsOnStartup();
            this.scheduler?.start();
            this.automationEngine?.evaluateNow();
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
            void this.setState('info.connection', false, true);
            this.scheduler?.stop();
            this.automationEngine?.stop();
            this.weatherSource?.stop();
            if (this.positionRefreshTimer) {
                this.clearInterval(this.positionRefreshTimer);
            }
            if (this.weatherDiagnosticsTimer) {
                this.clearInterval(this.weatherDiagnosticsTimer);
            }
            for (const controller of this.controllers.values()) {
                controller.destroy();
            }
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
        }
        callback();
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Shutters(options);
} else {
    // otherwise start the instance directly
    (() => new Shutters())();
}
