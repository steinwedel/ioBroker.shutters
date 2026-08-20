import { createDriver } from './drivers/driver-factory';
import type { IShutterDriver } from './drivers/types';
import { coveringToRuntime, type ICalibrationPoint, normalizeCurve, runtimeToCovering } from './position-mapping';
import type { IShutterConfig } from './types';

/** Tolerance (percentage points) used to decide whether a covering has "reached" its target runtime, see the watchdog in `refreshPosition()`; also reused by `automation.ts` to detect a covering that has drifted away from its last-applied target while settled (e.g. an external system writing to the same foreign state). */
export const WATCHDOG_TOLERANCE_PERCENT = 3;
/** Extra time allowed on top of `maxRuntimeSecs` before the watchdog reports a stuck covering. */
const WATCHDOG_GRACE_MS = 30_000;
/** Default for `IShutterConfig.minCommandIntervalMs` (motor protection, plan section 7d) if unset. */
const DEFAULT_MIN_COMMAND_INTERVAL_MS = 8_000;
/** Sentinel `pendingMoveTargetPercent` value meaning "no move currently pending" (plan section 9a.2). */
const NO_PENDING_MOVE = -1;
/** Maximum number of entries kept in `activityLog` (plan section 10a.8) - a short, rolling history, not a full audit log. */
const MAX_ACTIVITY_LOG_ENTRIES = 10;
const PROTECTION_NAMES = [
    'sunProtection',
    'rainProtection',
    'windProtection',
    'frostProtection',
    'nightCooling',
] as const;
type IProtectionName = (typeof PROTECTION_NAMES)[number];

type ICoveringChannel = 'control' | 'configuration' | 'status' | 'protection' | 'calibration' | 'diagnostics';

const STATE_CHANNELS: Record<string, ICoveringChannel> = {
    position: 'control',
    tilt: 'control',
    open: 'control',
    close: 'control',
    stop: 'control',
    automationEnabled: 'configuration',
    orientation: 'configuration',
    area: 'configuration',
    driverType: 'configuration',
    coveringType: 'configuration',
    positionActual: 'status',
    positionRaw: 'status',
    tiltActual: 'status',
    state: 'status',
    statusText: 'status',
    reasonDetail: 'status',
    activityLog: 'status',
    doorProtectionActive: 'protection',
    sunProtectionEnabled: 'protection',
    rainProtectionEnabled: 'protection',
    windProtectionEnabled: 'protection',
    frostProtectionEnabled: 'protection',
    nightCoolingEnabled: 'protection',
    sunProtectionActive: 'protection',
    rainProtectionActive: 'protection',
    windProtectionActive: 'protection',
    frostProtectionActive: 'protection',
    nightCoolingActive: 'protection',
    sunProtectionOverrideUntil: 'protection',
    calibrate: 'calibration',
    calibrationStatus: 'calibration',
    calibrationConfirm: 'calibration',
    calibrationAbort: 'calibration',
    calibrationOpenRuntimeSecs: 'calibration',
    calibrationCloseRuntimeSecs: 'calibration',
    watchdogLastIssue: 'diagnostics',
    watchdogIssueCount: 'diagnostics',
    pendingMoveTargetPercent: 'diagnostics',
    pendingMoveIssuedAt: 'diagnostics',
};

/** One entry of `IShutterConfig`'s `activityLog` state (plan section 10a.8), most recent first. */
export interface IActivityLogEntry {
    /** ms-since-epoch timestamp the action was taken at. */
    ts: number;
    /** Same human-readable reason written to `statusText` at the time, e.g. "Sun protection". */
    reason: string;
    /** Target covering position (0-100) this action drove to. */
    percent: number;
}

/**
 * Owns the ioBroker objects/states for a single covering and forwards
 * manual and automated commands to its driver. The priority resolution
 * between manual commands, schedule, and sun/rain/wind/frost/door
 * protection lives in `automation.ts`; this class only executes whatever
 * target it is told to apply.
 */
export class ShutterController {
    private readonly driver: IShutterDriver;
    private readonly basePath: string;
    private readonly curve: ICalibrationPoint[];
    private automationEnabled: boolean;
    private pendingMove: { targetPercent: number; issuedAt: number } | undefined;
    private watchdogReported = false;
    /** Timestamp (ms) of the last movement command that actually reached the driver, see `gatedSetPosition()`. */
    private lastDriverCommandAt = 0;
    /** Most recently requested command still waiting out the motor-protection cooldown, if any, see `gatedDriverCommand()`. */
    private pendingBufferedCommand:
        { targetPercent: number; invokeDriver: () => Promise<void>; afterDrive: () => Promise<void> } | undefined;
    private bufferFlushTimer: ioBroker.Timeout | undefined;
    private calibration:
        | { phase: 'closing' | 'opening'; startedAt: number; closeRuntimeSecs?: number; timer?: ioBroker.Timeout }
        | undefined;

    /** Called whenever a manual (user-issued) command is processed; used by `automation.ts` to apply the sun-protection override (plan section 6.4). */
    public onManualCommand: (() => void) | undefined;
    /** Called whenever the watchdog (plan section 9a.1) reports a newly stuck covering, with the same human-readable message written to `watchdogLastIssue`; used by `main.ts` to forward it to `notify.ts` (plan section 9a.3). */
    public onWatchdogIssue: ((message: string) => void) | undefined;

    /**
     * @param adapter - Adapter instance, used for state/object access.
     * @param config - Configuration of the covering to control.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly config: IShutterConfig,
    ) {
        this.basePath = `shutters.${config.id}`;
        this.driver = createDriver(adapter, config);
        this.curve = normalizeCurve(config.calibrationCurve);
        this.automationEnabled = config.automationEnabled;
    }

    private stateId(name: string): string {
        return `${this.basePath}.${STATE_CHANNELS[name]}.${name}`;
    }

    /** Creates/updates all objects for this covering. Safe to call repeatedly (uses setObjectNotExists). */
    public async createObjects(): Promise<void> {
        const { adapter, basePath, config } = this;
        const stateId = (name: string): string => this.stateId(name);

        await adapter.setObjectNotExistsAsync(basePath, {
            type: 'device',
            common: { name: config.name },
            native: {},
        });

        for (const channel of new Set(Object.values(STATE_CHANNELS))) {
            await adapter.setObjectNotExistsAsync(`${basePath}.${channel}`, {
                type: 'channel',
                common: { name: channel, role: channel === 'control' ? 'blind' : undefined },
                native: {},
            });
        }

        await adapter.setObjectNotExistsAsync(stateId('position'), {
            type: 'state',
            common: {
                name: `${config.name} - target position`,
                type: 'number',
                role: 'level.blind',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('positionActual'), {
            type: 'state',
            common: {
                name: `${config.name} - actual position`,
                type: 'number',
                role: 'value.blind',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: false,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('positionRaw'), {
            type: 'state',
            common: {
                name: `${config.name} - raw motor runtime`,
                type: 'number',
                role: 'value',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: false,
                expert: true,
            },
            native: {},
        });

        // Slat tilt (plan section 2a.5, raffstore/lamellen only) - only created when a tilt state is
        // actually configured, since most coverings (rolladen/markise, or a raffstore/lamellen device
        // whose driver/system does not expose a separate tilt control) have no tilt at all. `lamellen`
        // (vertical louvres) rotate through a wider 0-180° range; `raffstore`'s horizontal slats use
        // the same 0-100 convention as position. Purely a display range (min/max) - `commandTilt()`/
        // `PositionStopDriverBase.setTilt()` pass the value through unmapped either way.
        if (config.states.tilt) {
            const tiltMax = config.coveringType === 'lamellen' ? 180 : 100;
            const tiltUnit = config.coveringType === 'lamellen' ? '°' : '%';
            await adapter.setObjectNotExistsAsync(stateId('tilt'), {
                type: 'state',
                common: {
                    name: `${config.name} - target slat tilt angle`,
                    type: 'number',
                    role: 'level',
                    unit: tiltUnit,
                    min: 0,
                    max: tiltMax,
                    read: true,
                    write: true,
                },
                native: {},
            });
            await adapter.setObjectNotExistsAsync(stateId('tiltActual'), {
                type: 'state',
                common: {
                    name: `${config.name} - actual slat tilt angle`,
                    type: 'number',
                    role: 'value',
                    unit: tiltUnit,
                    min: 0,
                    max: tiltMax,
                    read: true,
                    write: false,
                },
                native: {},
            });
        }

        await adapter.setObjectNotExistsAsync(stateId('open'), {
            type: 'state',
            common: {
                name: `${config.name} - open`,
                type: 'boolean',
                role: 'button.open.blind',
                read: true,
                write: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('close'), {
            type: 'state',
            common: {
                name: `${config.name} - close`,
                type: 'boolean',
                role: 'button.close.blind',
                read: true,
                write: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('stop'), {
            type: 'state',
            common: { name: `${config.name} - stop`, type: 'boolean', role: 'button.stop', read: true, write: true },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('calibrate'), {
            type: 'state',
            common: {
                name: `${config.name} - start guided calibration run`,
                type: 'boolean',
                role: 'button',
                read: true,
                write: true,
                expert: true,
            },
            native: {},
        });

        if (config.driverType === 'generic-relay') {
            await adapter.setObjectNotExistsAsync(stateId('calibrationStatus'), {
                type: 'state',
                common: {
                    name: `${config.name} - calibration status`,
                    type: 'string',
                    role: 'text',
                    read: true,
                    write: false,
                    expert: true,
                },
                native: {},
            });
            await adapter.setObjectNotExistsAsync(stateId('calibrationConfirm'), {
                type: 'state',
                common: {
                    name: `${config.name} - confirm calibration travel end`,
                    type: 'boolean',
                    role: 'button',
                    read: true,
                    write: true,
                    expert: true,
                },
                native: {},
            });
            await adapter.setObjectNotExistsAsync(stateId('calibrationAbort'), {
                type: 'state',
                common: {
                    name: `${config.name} - abort calibration`,
                    type: 'boolean',
                    role: 'button',
                    read: true,
                    write: true,
                    expert: true,
                },
                native: {},
            });
            await adapter.setObjectNotExistsAsync(stateId('calibrationOpenRuntimeSecs'), {
                type: 'state',
                common: {
                    name: `${config.name} - measured opening runtime`,
                    type: 'number',
                    role: 'value',
                    unit: 's',
                    read: true,
                    write: false,
                    expert: true,
                },
                native: {},
            });
            await adapter.setObjectNotExistsAsync(stateId('calibrationCloseRuntimeSecs'), {
                type: 'state',
                common: {
                    name: `${config.name} - measured closing runtime`,
                    type: 'number',
                    role: 'value',
                    unit: 's',
                    read: true,
                    write: false,
                    expert: true,
                },
                native: {},
            });
        }

        await adapter.setObjectNotExistsAsync(stateId('automationEnabled'), {
            type: 'state',
            common: {
                name: `${config.name} - automation enabled`,
                type: 'boolean',
                role: 'switch.enable',
                read: true,
                write: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('state'), {
            type: 'state',
            common: {
                name: `${config.name} - state`,
                type: 'number',
                role: 'indicator',
                states: { 0: 'open', 1: 'closed', 2: 'moving' },
                min: 0,
                max: 2,
                read: true,
                write: false,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('orientation'), {
            type: 'state',
            common: {
                name: `${config.name} - configured orientation`,
                type: 'number',
                role: 'value.direction',
                unit: '°',
                min: 0,
                max: 359,
                read: true,
                write: false,
            },
            native: {},
        });

        for (const [name] of [
            ['area', config.areaId ?? ''],
            ['driverType', config.driverType],
            ['coveringType', config.coveringType],
        ]) {
            await adapter.setObjectNotExistsAsync(stateId(name), {
                type: 'state',
                common: {
                    name: `${config.name} - configured ${name}`,
                    type: 'string',
                    role: 'text',
                    read: true,
                    write: false,
                },
                native: {},
            });
        }

        await adapter.setObjectNotExistsAsync(stateId('statusText'), {
            type: 'state',
            common: {
                name: `${config.name} - status`,
                type: 'string',
                role: 'text',
                read: true,
                write: false,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('reasonDetail'), {
            type: 'state',
            common: {
                name: `${config.name} - why the covering is currently open/closed/held (details behind statusText)`,
                type: 'string',
                role: 'text',
                read: true,
                write: false,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('doorProtectionActive'), {
            type: 'state',
            common: {
                name: `${config.name} - door protection active (plan section 7e)`,
                type: 'boolean',
                role: 'indicator',
                read: true,
                write: false,
                def: false,
            },
            native: {},
        });

        for (const name of [
            'sunProtectionEnabled',
            'rainProtectionEnabled',
            'windProtectionEnabled',
            'frostProtectionEnabled',
            'nightCoolingEnabled',
        ]) {
            await adapter.setObjectNotExistsAsync(stateId(name), {
                type: 'state',
                common: {
                    name: `${config.name} - ${name}`,
                    type: 'boolean',
                    role: 'indicator',
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
        for (const name of [
            'sunProtectionActive',
            'rainProtectionActive',
            'windProtectionActive',
            'frostProtectionActive',
            'nightCoolingActive',
        ]) {
            await adapter.setObjectNotExistsAsync(stateId(name), {
                type: 'state',
                common: {
                    name: `${config.name} - ${name}`,
                    type: 'boolean',
                    role: 'indicator',
                    read: true,
                    write: false,
                    def: false,
                },
                native: {},
            });
        }

        await adapter.setObjectNotExistsAsync(stateId('activityLog'), {
            type: 'state',
            common: {
                name: `${config.name} - recent automated actions (JSON, plan section 10a.8)`,
                type: 'string',
                role: 'json',
                read: true,
                write: false,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('watchdogLastIssue'), {
            type: 'state',
            common: {
                name: `${config.name} - last watchdog issue`,
                type: 'string',
                role: 'text',
                read: true,
                write: false,
                expert: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('watchdogIssueCount'), {
            type: 'state',
            common: {
                name: `${config.name} - watchdog issue count`,
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                expert: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('sunProtectionOverrideUntil'), {
            type: 'state',
            common: {
                name: `${config.name} - sun protection suspended until (ms timestamp, 0 = not suspended)`,
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                expert: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('pendingMoveTargetPercent'), {
            type: 'state',
            common: {
                name: `${config.name} - target position of the move currently in progress, if any (-1 = none, plan section 9a.2)`,
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                expert: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(stateId('pendingMoveIssuedAt'), {
            type: 'state',
            common: {
                name: `${config.name} - ms timestamp the currently pending move was issued at (plan section 9a.2)`,
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                expert: true,
            },
            native: {},
        });

        await this.initializeState('area', config.areaId ?? '');
        await this.initializeState('driverType', config.driverType);
        await this.initializeState('coveringType', config.coveringType);
        await this.initializeState('automationEnabled', config.automationEnabled);
        await this.initializeState('orientation', config.orientation ?? 0);
        await this.setProtectionConfigurationStates();
        await this.setProtectionActivityStates();
        await this.initializeState('state', 1);
        await this.initializeState('statusText', 'Idle');
        await this.initializeState('reasonDetail', 'Idle - no automation decision evaluated yet.');

        await this.recoverPendingMove();
        await this.refreshPosition();
    }

    private async initializeState(name: string, value: ioBroker.StateValue): Promise<void> {
        if (!(await this.adapter.getStateAsync(this.stateId(name)))) {
            await this.writeState(name, value, true);
        }
    }

    private async writeState(name: string, value: ioBroker.StateValue, ack: boolean): Promise<void> {
        await this.adapter.setStateAsync(this.stateId(name), { val: value, ack });
    }

    /** IDs of the own states this controller reacts to; use with `adapter.subscribeStates`. */
    public getOwnStateIds(): string[] {
        const ids = [
            this.stateId('position'),
            this.stateId('open'),
            this.stateId('close'),
            this.stateId('stop'),
            this.stateId('calibrate'),
            this.stateId('automationEnabled'),
        ];
        if (this.config.states.tilt) {
            ids.push(this.stateId('tilt'));
        }
        if (this.config.driverType === 'generic-relay') {
            ids.push(this.stateId('calibrationConfirm'), this.stateId('calibrationAbort'));
        }
        return ids;
    }

    /** @returns The full configuration of this covering, for use by automation modules. */
    public getConfig(): IShutterConfig {
        return this.config;
    }

    /** @returns The covering's stable area ID (`IShutterConfig.areaId`), or undefined if never assigned to an area. */
    public getAreaId(): string | undefined {
        return this.config.areaId;
    }

    /** @returns Whether automation (schedule, sun/rain/wind/frost protection) is currently enabled for this covering. */
    public isAutomationEnabled(): boolean {
        return this.automationEnabled;
    }

    /** @returns The last known covering height/extension (0-100), mapped from the driver's runtime position, or undefined if the driver has no position feedback yet. */
    public getCurrentCoveringPercent(): number | undefined {
        const runtimePercent = this.driver.getCurrentPosition();
        return runtimePercent === undefined ? undefined : runtimeToCovering(runtimePercent, this.curve);
    }

    /**
     * @returns Whether a move is currently believed to still be in flight (issued, not yet within
     *   `WATCHDOG_TOLERANCE_PERCENT` of its target, see `refreshPosition()`). Used by `automation.ts`
     *   to tell "still normally travelling towards the last-applied target" apart from "already
     *   settled, but has since drifted away from it" (e.g. an external system/script writing to the
     *   same foreign state) - only the latter should trigger a fresh command despite an unchanged
     *   target/reason.
     */
    public hasPendingMove(): boolean {
        return this.pendingMove !== undefined;
    }

    /**
     * Writes `doorProtectionActive` (plan section 3/7e) - called once per automation tick from
     * `automation.ts`, regardless of which priority branch ultimately applies, since whether the
     * covering's door contact is currently open is independent of that. Modeled as "the configured
     * door contact currently reports open" rather than "door protection clamped something just this
     * tick", so it does not flicker based on which specific target happened to be requested at any
     * given instant - see `clampForDoorProtection()` in `door-protection.ts` for the actual clamping.
     *
     * @param active - Whether this covering's door contact is currently open.
     */
    public async setDoorProtectionActive(active: boolean): Promise<void> {
        await this.writeState('doorProtectionActive', active, true);
    }

    /**
     * @param active - Protection(s) that currently win the automation decision.
     */
    public async setProtectionActivityStates(active: Partial<Record<IProtectionName, boolean>> = {}): Promise<void> {
        for (const name of PROTECTION_NAMES) {
            await this.writeState(`${name}Active`, active[name] ?? false, true);
        }
    }

    /**
     * Writes `reasonDetail` (plan-adjacent to `statusText`/`activityLog`): a fuller, human-readable
     * explanation of *why* the automation engine's current decision applies right now (the concrete
     * thresholds/measurements involved, not just the short `statusText` keyword), so a user can
     * understand an open/closed/held covering without having to inspect weather values and
     * configuration by hand. Unlike `statusText`, this is written on every tick regardless of whether
     * the winning reason actually changed, since the underlying numbers (e.g. current wind speed) are
     * meaningful even while the decision itself has not changed.
     *
     * @param detail - Human-readable explanation, see `AutomationEngine`'s per-reason detail builders.
     */
    public async setReasonDetail(detail: string): Promise<void> {
        await this.writeState('reasonDetail', detail, true);
    }

    /**
     * Handles a state change for one of this covering's own states, if it
     * matches. Returns true if the change was handled.
     *
     * @param id - Full state ID that changed.
     * @param state - The new state value.
     */
    public async handleStateChange(id: string, state: ioBroker.State): Promise<boolean> {
        if (state.ack) {
            return false;
        }

        switch (id) {
            case this.stateId('position'):
                await this.commandPosition(Number(state.val));
                return true;
            case this.stateId('open'):
                await this.commandOpen();
                return true;
            case this.stateId('close'):
                await this.commandClose();
                return true;
            case this.stateId('stop'):
                await this.commandStop();
                return true;
            case this.stateId('calibrate'):
                await this.acknowledge('calibrate', false);
                await this.startCalibration();
                return true;
            case this.stateId('calibrationConfirm'):
                await this.acknowledge('calibrationConfirm', false);
                await this.confirmCalibration();
                return true;
            case this.stateId('calibrationAbort'):
                await this.acknowledge('calibrationAbort', false);
                await this.finishCalibration('Calibration aborted.');
                return true;
            case this.stateId('automationEnabled'):
                this.automationEnabled = Boolean(state.val);
                await this.acknowledge('automationEnabled', this.automationEnabled);
                return true;
            case this.stateId('tilt'):
                await this.commandTilt(Number(state.val));
                return true;
            default:
                return false;
        }
    }

    private async startCalibration(): Promise<void> {
        if (this.config.driverType !== 'generic-relay' || !this.config.states.stop) {
            await this.setCalibrationStatus('Guided calibration requires a generic relay with a stop state.');
            return;
        }
        if (this.calibration) {
            await this.setCalibrationStatus('Calibration is already running.');
            return;
        }
        const startedAt = Date.now();
        const timer = this.adapter.setTimeout(
            () => {
                this.finishCalibration('Calibration timed out.').catch(error => {
                    this.adapter.log.error(
                        `Calibration timeout for covering "${this.config.id}" failed: ${(error as Error).message}`,
                    );
                });
            },
            (this.config.maxRuntimeSecs ?? 60) * 1000 + WATCHDOG_GRACE_MS,
        );
        this.calibration = { phase: 'closing', startedAt, timer };
        await this.driver.close();
        await this.setCalibrationStatus('Closing: confirm when the covering is fully closed.');
    }

    private async confirmCalibration(): Promise<void> {
        if (!this.calibration) {
            await this.setCalibrationStatus('No calibration is running.');
            return;
        }
        const durationSecs = (Date.now() - this.calibration.startedAt) / 1000;
        await this.driver.stop();
        if (this.calibration.phase === 'closing') {
            this.calibration.phase = 'opening';
            this.calibration.closeRuntimeSecs = durationSecs;
            this.calibration.startedAt = Date.now();
            await this.driver.open();
            await this.setCalibrationStatus('Opening: confirm when the covering is fully open.');
            return;
        }
        const closeRuntimeSecs = this.calibration.closeRuntimeSecs;
        if (this.calibration.timer) {
            this.adapter.clearTimeout(this.calibration.timer);
        }
        this.calibration = undefined;
        await this.writeState('calibrationCloseRuntimeSecs', closeRuntimeSecs ?? 0, true);
        await this.writeState('calibrationOpenRuntimeSecs', durationSecs, true);
        await this.setCalibrationStatus(
            'Calibration completed. Copy the measured runtimes into the covering configuration.',
        );
        await this.refreshPosition();
    }

    private async finishCalibration(status: string): Promise<void> {
        if (this.calibration) {
            if (this.calibration.timer) {
                this.adapter.clearTimeout(this.calibration.timer);
            }
            this.calibration = undefined;
            await this.driver.stop();
        }
        await this.setCalibrationStatus(status);
    }

    private async setCalibrationStatus(status: string): Promise<void> {
        if (this.config.driverType === 'generic-relay') {
            await this.writeState('calibrationStatus', status, true);
        }
    }

    /**
     * Drives to a target covering position as a direct user command (from
     * `handleStateChange()`, a group, or a scene). Notifies
     * `onManualCommand` immediately - even if the actual drive ends up
     * buffered by the motor-protection gate below - so automation applies
     * the sun-protection override (plan section 6.4) right away rather than
     * only once the (possibly delayed) command actually reaches the driver.
     *
     * @param coveringPercent - Target covering height/extension, 0-100.
     */
    public async commandPosition(coveringPercent: number): Promise<void> {
        this.onManualCommand?.();
        await this.gatedDriverCommand(
            coveringPercent,
            () => this.driver.setPosition(coveringToRuntime(coveringPercent, this.curve)),
            () => this.acknowledge('position', coveringPercent),
            false,
        );
    }

    /** Fully opens/retracts the covering as a direct user command. */
    public async commandOpen(): Promise<void> {
        this.onManualCommand?.();
        await this.gatedDriverCommand(
            0,
            () => this.driver.open(),
            () => this.acknowledge('open', false),
            false,
        );
    }

    /** Fully closes/extends the covering as a direct user command. */
    public async commandClose(): Promise<void> {
        this.onManualCommand?.();
        await this.gatedDriverCommand(
            100,
            () => this.driver.close(),
            () => this.acknowledge('close', false),
            false,
        );
    }

    /**
     * Stops the current movement as a direct user command. Exempt from the motor-protection gate
     * (plan section 7d): halting movement is always safe to do immediately, unlike starting one, and
     * any move still waiting out the cooldown in `pendingBufferedCommand` must not fire later once the
     * user has explicitly stopped - so this also cancels it.
     */
    public async commandStop(): Promise<void> {
        this.pendingMove = undefined;
        this.cancelBufferedCommand();
        await this.driver.stop();
        await this.acknowledge('stop', false);
        await this.clearPersistedPendingMove();
        await this.updateState();
        this.onManualCommand?.();
    }

    /**
     * Drives the slat tilt to `anglePercent` (plan section 2a.5), as a direct user command. Not
     * subject to motor protection (7d) or the watchdog (9a.1) - those are scoped to the main
     * height/extension axis and its runtime-based timing model, which does not apply to tilt.
     * A no-op at the driver level if this covering has no tilt state configured (see
     * `PositionStopDriverBase.setTilt()`); `handleStateChange()` only routes here when
     * `states.tilt` is configured in the first place, so that should not normally happen.
     *
     * @param anglePercent - Target tilt angle, 0-100 (or a wider range for `lamellen`, see `IShutterConfig.states.tilt`).
     */
    public async commandTilt(anglePercent: number): Promise<void> {
        this.onManualCommand?.();
        await this.driver.setTilt?.(anglePercent);
        await this.acknowledge('tilt', anglePercent);
    }

    /**
     * Drives to a target covering position on behalf of an automation module
     * (schedule, sun/rain/wind/frost/door protection - not a direct user
     * command). Unlike `commandPosition()`, this never notifies
     * `onManualCommand` and does not need `automationEnabled` to be checked
     * here; callers (see automation.ts) are responsible for that.
     *
     * @param coveringPercent - Target covering height/extension, 0-100.
     * @param reason - Human-readable reason shown in `statusText`, e.g. "Schedule: close".
     * @param bypassMotorProtection - Skips the motor-protection cooldown (plan section 7d) entirely;
     *   set by callers for wind protection (7a), since a storm-safety reaction must never wait on a
     *   motor-protection timer.
     */
    public async applyAutomatedPosition(
        coveringPercent: number,
        reason: string,
        bypassMotorProtection = false,
    ): Promise<void> {
        await this.gatedDriverCommand(
            coveringPercent,
            () => this.driver.setPosition(coveringToRuntime(coveringPercent, this.curve)),
            async () => {
                await this.writeState('position', coveringPercent, true);
                await this.writeState('statusText', reason, true);
                await this.pushActivityLogEntry(reason, coveringPercent);
            },
            bypassMotorProtection,
        );
    }

    /**
     * Prepends one entry to `activityLog` (plan section 10a.8), keeping only the most recent
     * `MAX_ACTIVITY_LOG_ENTRIES` - a short, rolling history of automated actions answering not just
     * "what is it doing now" (`statusText`) but also "what did it do today and why", to reduce
     * follow-up questions/ease troubleshooting unexpected behavior. Written from the same place as
     * `statusText` (`applyAutomatedPosition()`) so no separate trigger-detection logic is needed;
     * manual commands are intentionally not logged here, same as they do not update `statusText`.
     *
     * @param reason - Same human-readable reason written to `statusText`.
     * @param percent - Target covering position this action drove to.
     */
    private async pushActivityLogEntry(reason: string, percent: number): Promise<void> {
        const state = await this.adapter.getStateAsync(this.stateId('activityLog'));
        const existing = this.parseActivityLog(state?.val);
        const entries = [{ ts: Date.now(), reason, percent }, ...existing].slice(0, MAX_ACTIVITY_LOG_ENTRIES);
        await this.writeState('activityLog', JSON.stringify(entries), true);
    }

    /**
     * Parses `activityLog`'s raw value, tolerating a missing/malformed value (treated as empty)
     * rather than letting a corrupted state prevent all future logging.
     *
     * @param val - Raw `ioBroker.State.val` of the `activityLog` state.
     */
    private parseActivityLog(val: ioBroker.StateValue | undefined): IActivityLogEntry[] {
        if (typeof val !== 'string' || val === '') {
            return [];
        }
        try {
            const parsed: unknown = JSON.parse(val);
            return Array.isArray(parsed) ? (parsed as IActivityLogEntry[]) : [];
        } catch {
            return [];
        }
    }

    /**
     * Reads the persisted sun-protection override deadline (plan section 6.4/9a.2), e.g. right after
     * startup, so a "Tagessperre" set before an adapter restart is not silently lost.
     *
     * @returns Local midnight (ms since epoch) until which sun protection is suspended, or 0 if not currently suspended/never set.
     */
    public async getPersistedSunProtectionOverrideUntil(): Promise<number> {
        const state = await this.adapter.getStateAsync(this.stateId('sunProtectionOverrideUntil'));
        return typeof state?.val === 'number' ? state.val : 0;
    }

    /**
     * Persists the sun-protection override deadline so it survives an adapter restart (plan section
     * 9a.2). Called by `automation.ts` whenever it changes the in-memory deadline (on a manual command,
     * and once more to clear it back to 0 after it has passed).
     *
     * @param untilMs - Local midnight (ms since epoch) until which sun protection is suspended, or 0 to clear.
     */
    public async setSunProtectionOverrideUntil(untilMs: number): Promise<void> {
        await this.writeState('sunProtectionOverrideUntil', untilMs, true);
    }

    private async setProtectionConfigurationStates(): Promise<void> {
        const outdoorProtectionEnabled = this.config.coveringType !== 'lamellen';
        const enabled: Record<IProtectionName, boolean> = {
            sunProtection: this.config.sunProtectionEnabled ?? true,
            rainProtection: this.config.rainProtectionEnabled ?? outdoorProtectionEnabled,
            windProtection: this.config.windProtectionEnabled ?? outdoorProtectionEnabled,
            frostProtection: this.config.frostProtectionEnabled ?? outdoorProtectionEnabled,
            nightCooling: this.config.nightCoolingEnabled ?? false,
        };
        for (const name of PROTECTION_NAMES) {
            await this.writeState(`${name}Enabled`, enabled[name], true);
        }
    }

    private async updateState(): Promise<void> {
        const currentPercent = this.getCurrentCoveringPercent();
        const state = this.pendingMove
            ? 2
            : currentPercent !== undefined && currentPercent <= WATCHDOG_TOLERANCE_PERCENT
              ? 0
              : 1;
        await this.writeState('state', state, true);
    }

    /**
     * Central motor-protection gate (plan section 7d): every actual movement command - manual,
     * schedule, or protection-module driven - goes through here. If less than `minCommandIntervalMs`
     * has passed since the last command that actually reached the driver, the request is not
     * discarded: only the most recently requested command is kept in `pendingBufferedCommand` and
     * replayed exactly once, after the remaining cooldown elapses.
     *
     * @param targetPercent - Target covering height/extension, 0-100 (only used for watchdog tracking, see `executeDriverCommand()`).
     * @param invokeDriver - Performs the actual driver call for this specific command (`setPosition`/`open`/`close`), preserving each entrypoint's exact original semantics.
     * @param afterDrive - Acknowledges/updates whichever own states this specific command type needs, once `invokeDriver` has completed.
     * @param bypassMotorProtection - Whether to skip the cooldown entirely (wind protection only, see `applyAutomatedPosition()`).
     */
    private async gatedDriverCommand(
        targetPercent: number,
        invokeDriver: () => Promise<void>,
        afterDrive: () => Promise<void>,
        bypassMotorProtection: boolean,
    ): Promise<void> {
        const minIntervalMs = bypassMotorProtection
            ? 0
            : (this.config.minCommandIntervalMs ?? DEFAULT_MIN_COMMAND_INTERVAL_MS);
        const elapsedMs = Date.now() - this.lastDriverCommandAt;
        if (minIntervalMs > 0 && elapsedMs < minIntervalMs) {
            this.pendingBufferedCommand = { targetPercent, invokeDriver, afterDrive };
            if (!this.bufferFlushTimer) {
                this.bufferFlushTimer = this.adapter.setTimeout(() => {
                    this.bufferFlushTimer = undefined;
                    const buffered = this.pendingBufferedCommand;
                    this.pendingBufferedCommand = undefined;
                    if (buffered) {
                        this.executeDriverCommand(
                            buffered.targetPercent,
                            buffered.invokeDriver,
                            buffered.afterDrive,
                        ).catch(err => {
                            this.adapter.log.error(
                                `Buffered motor-protection command for covering "${this.config.id}" failed: ${(err as Error).message}`,
                            );
                        });
                    }
                }, minIntervalMs - elapsedMs);
            }
            return;
        }
        await this.executeDriverCommand(targetPercent, invokeDriver, afterDrive);
    }

    /**
     * Actually invokes the driver and updates the resulting states - the only place that does so, so
     * `lastDriverCommandAt`/the watchdog's `pendingMove` always reflect what was truly commanded, not
     * merely requested (which may still be sitting in `pendingBufferedCommand`, see `gatedDriverCommand()`).
     *
     * @param targetPercent - Target covering height/extension, 0-100.
     * @param invokeDriver - Performs the actual driver call, see `gatedDriverCommand()`.
     * @param afterDrive - Acknowledges/updates own states once `invokeDriver` has completed, see `gatedDriverCommand()`.
     */
    private async executeDriverCommand(
        targetPercent: number,
        invokeDriver: () => Promise<void>,
        afterDrive: () => Promise<void>,
    ): Promise<void> {
        this.lastDriverCommandAt = Date.now();
        const issuedAt = Date.now();
        this.pendingMove = { targetPercent, issuedAt };
        this.watchdogReported = false;
        // Persisted so a restart mid-move can still detect a genuinely stuck covering afterwards
        // (plan section 9a.2) - see `recoverPendingMove()`.
        await this.writeState('pendingMoveTargetPercent', targetPercent, true);
        await this.writeState('pendingMoveIssuedAt', issuedAt, true);
        await this.updateState();
        await invokeDriver();
        await afterDrive();
        await this.refreshPosition();
    }

    /**
     * Restores an in-progress move from `pendingMoveTargetPercent`/`pendingMoveIssuedAt` (plan
     * section 9a.2), so a restart mid-move does not silently forget about it. Called once, right
     * before the first `refreshPosition()` in `createObjects()` - that call's watchdog check then
     * immediately re-evaluates the restored move against the driver's real, freshly re-read position
     * (`getCurrentPosition()`), using the original `issuedAt` timestamp rather than restarting the
     * grace period: if the covering actually finished moving while the adapter was stopped, this
     * resolves silently with no false report; if it is genuinely still stuck, the watchdog reports it
     * right away instead of only appearing to be idle at whatever position it happens to be in.
     */
    private async recoverPendingMove(): Promise<void> {
        const targetState = await this.adapter.getStateAsync(this.stateId('pendingMoveTargetPercent'));
        const targetPercent = typeof targetState?.val === 'number' ? targetState.val : NO_PENDING_MOVE;
        if (targetPercent === NO_PENDING_MOVE) {
            return;
        }

        const issuedAtState = await this.adapter.getStateAsync(this.stateId('pendingMoveIssuedAt'));
        const issuedAt = typeof issuedAtState?.val === 'number' ? issuedAtState.val : Date.now();
        this.pendingMove = { targetPercent, issuedAt };
    }

    /** Discards any command still waiting out the motor-protection cooldown, without executing it. */
    private cancelBufferedCommand(): void {
        this.pendingBufferedCommand = undefined;
        if (this.bufferFlushTimer) {
            this.adapter.clearTimeout(this.bufferFlushTimer);
            this.bufferFlushTimer = undefined;
        }
    }

    /**
     * Re-reads the driver's actual position (if it reports one), updates
     * `positionRaw`/`positionActual` accordingly, and checks the watchdog
     * (plan section 9a.1): if a move was commanded but the target runtime
     * has not been reached within `maxRuntimeSecs` (+ a fixed grace period),
     * this is reported once via `watchdogLastIssue`/`watchdogIssueCount` and
     * a log warning. Drivers without position feedback (e.g. generic-relay)
     * are skipped entirely - the watchdog needs real feedback to work.
     */
    public async refreshPosition(): Promise<void> {
        if (this.config.states.tilt) {
            const tiltPercent = this.driver.getCurrentTilt?.();
            if (tiltPercent !== undefined) {
                await this.writeState('tiltActual', tiltPercent, true);
            }
        }

        const runtimePercent = this.driver.getCurrentPosition();
        if (runtimePercent === undefined) {
            return;
        }
        await this.writeState('positionRaw', runtimePercent, true);
        await this.writeState('positionActual', runtimeToCovering(runtimePercent, this.curve), true);
        await this.checkWatchdog(runtimePercent);
        await this.updateState();
    }

    /** Releases the driver's subscriptions and cancels any pending motor-protection buffer timer. Call on adapter unload. */
    public destroy(): void {
        this.cancelBufferedCommand();
        if (this.calibration) {
            if (this.calibration.timer) {
                this.adapter.clearTimeout(this.calibration.timer);
            }
            this.calibration = undefined;
        }
        this.driver.destroy();
    }

    /**
     * Sets one of this covering's own states to the given value with `ack: true`.
     *
     * @param stateName - Name of the state relative to this covering, e.g. "position".
     * @param value - Value to acknowledge.
     */
    private async acknowledge(stateName: string, value: ioBroker.StateValue): Promise<void> {
        await this.writeState(stateName, value, true);
    }

    /**
     * @param runtimePercent - Current actual motor runtime, 0-100, as just read from the driver.
     */
    private async checkWatchdog(runtimePercent: number): Promise<void> {
        if (!this.pendingMove) {
            return;
        }

        const targetRuntime = coveringToRuntime(this.pendingMove.targetPercent, this.curve);
        if (Math.abs(runtimePercent - targetRuntime) <= WATCHDOG_TOLERANCE_PERCENT) {
            this.pendingMove = undefined;
            this.watchdogReported = false;
            await this.clearPersistedPendingMove();
            return;
        }

        const maxMs = (this.config.maxRuntimeSecs ?? 60) * 1000 + WATCHDOG_GRACE_MS;
        if (Date.now() - this.pendingMove.issuedAt <= maxMs || this.watchdogReported) {
            return;
        }

        this.watchdogReported = true;
        const message = `Covering "${this.config.id}" did not reach target position ${this.pendingMove.targetPercent}% within the expected time.`;
        this.adapter.log.warn(message);
        await this.writeState('watchdogLastIssue', message, true);

        const countState = await this.adapter.getStateAsync(this.stateId('watchdogIssueCount'));
        const nextCount = (typeof countState?.val === 'number' ? countState.val : 0) + 1;
        await this.writeState('watchdogIssueCount', nextCount, true);
        this.onWatchdogIssue?.(message);
    }

    /** Clears the persisted pending-move tracking (plan section 9a.2), once a move has resolved (reached its target, or been superseded/stopped). */
    private async clearPersistedPendingMove(): Promise<void> {
        await this.writeState('pendingMoveTargetPercent', NO_PENDING_MOVE, true);
    }
}
