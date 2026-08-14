import { createDriver } from './drivers/driver-factory';
import type { IShutterDriver } from './drivers/types';
import { coveringToRuntime, type ICalibrationPoint, normalizeCurve, runtimeToCovering } from './position-mapping';
import type { IShutterConfig } from './types';

/** Tolerance (percentage points) used to decide whether a covering has "reached" its target runtime, see the watchdog in `refreshPosition()`. */
const WATCHDOG_TOLERANCE_PERCENT = 3;
/** Extra time allowed on top of `maxRuntimeSecs` before the watchdog reports a stuck covering. */
const WATCHDOG_GRACE_MS = 30_000;

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

    /** Called whenever a manual (user-issued) command is processed; used by `automation.ts` to apply the sun-protection override (plan section 6.4). */
    public onManualCommand: (() => void) | undefined;

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

    /** Creates/updates all objects for this covering. Safe to call repeatedly (uses setObjectNotExists). */
    public async createObjects(): Promise<void> {
        const { adapter, basePath, config } = this;

        await adapter.setObjectNotExistsAsync(basePath, {
            type: 'device',
            common: { name: config.name },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.position`, {
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

        await adapter.setObjectNotExistsAsync(`${basePath}.positionActual`, {
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

        await adapter.setObjectNotExistsAsync(`${basePath}.positionRaw`, {
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

        await adapter.setObjectNotExistsAsync(`${basePath}.open`, {
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

        await adapter.setObjectNotExistsAsync(`${basePath}.close`, {
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

        await adapter.setObjectNotExistsAsync(`${basePath}.stop`, {
            type: 'state',
            common: { name: `${config.name} - stop`, type: 'boolean', role: 'button.stop', read: true, write: true },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.calibrate`, {
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

        await adapter.setObjectNotExistsAsync(`${basePath}.automationEnabled`, {
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

        await adapter.setObjectNotExistsAsync(`${basePath}.statusText`, {
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

        await adapter.setObjectNotExistsAsync(`${basePath}.watchdogLastIssue`, {
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

        await adapter.setObjectNotExistsAsync(`${basePath}.watchdogIssueCount`, {
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

        await adapter.setStateAsync(`${basePath}.automationEnabled`, config.automationEnabled, true);
        await adapter.setStateAsync(`${basePath}.statusText`, 'Idle', true);

        await this.refreshPosition();
    }

    /** IDs of the own states this controller reacts to; use with `adapter.subscribeStates`. */
    public getOwnStateIds(): string[] {
        return [
            `${this.basePath}.position`,
            `${this.basePath}.open`,
            `${this.basePath}.close`,
            `${this.basePath}.stop`,
            `${this.basePath}.calibrate`,
            `${this.basePath}.automationEnabled`,
        ];
    }

    /** @returns The full configuration of this covering, for use by automation modules. */
    public getConfig(): IShutterConfig {
        return this.config;
    }

    public getAreaId(): string | undefined {
        return this.config.areaId;
    }

    public getLegacyAreaName(): string | undefined {
        return this.config.area;
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
            case `${this.basePath}.position`:
                await this.commandPosition(Number(state.val));
                return true;
            case `${this.basePath}.open`:
                await this.commandOpen();
                return true;
            case `${this.basePath}.close`:
                await this.commandClose();
                return true;
            case `${this.basePath}.stop`:
                await this.commandStop();
                return true;
            case `${this.basePath}.calibrate`:
                await this.acknowledge('calibrate', false);
                this.adapter.log.warn(
                    `Covering "${this.config.id}": guided calibration run is not implemented yet - configure calibrationCurve manually for now.`,
                );
                return true;
            case `${this.basePath}.automationEnabled`:
                this.automationEnabled = Boolean(state.val);
                await this.acknowledge('automationEnabled', this.automationEnabled);
                return true;
            default:
                return false;
        }
    }

    /**
     * Drives to a target covering position as a direct user command (from
     * `handleStateChange()`, a group, or a scene). Notifies
     * `onManualCommand` so automation can apply the sun-protection override.
     *
     * @param coveringPercent - Target covering height/extension, 0-100.
     */
    public async commandPosition(coveringPercent: number): Promise<void> {
        this.pendingMove = { targetPercent: coveringPercent, issuedAt: Date.now() };
        this.watchdogReported = false;
        await this.driver.setPosition(coveringToRuntime(coveringPercent, this.curve));
        await this.acknowledge('position', coveringPercent);
        await this.refreshPosition();
        this.onManualCommand?.();
    }

    /** Fully opens/retracts the covering as a direct user command. */
    public async commandOpen(): Promise<void> {
        this.pendingMove = { targetPercent: 0, issuedAt: Date.now() };
        this.watchdogReported = false;
        await this.driver.open();
        await this.acknowledge('open', false);
        await this.refreshPosition();
        this.onManualCommand?.();
    }

    /** Fully closes/extends the covering as a direct user command. */
    public async commandClose(): Promise<void> {
        this.pendingMove = { targetPercent: 100, issuedAt: Date.now() };
        this.watchdogReported = false;
        await this.driver.close();
        await this.acknowledge('close', false);
        await this.refreshPosition();
        this.onManualCommand?.();
    }

    /** Stops the current movement as a direct user command. */
    public async commandStop(): Promise<void> {
        this.pendingMove = undefined;
        await this.driver.stop();
        await this.acknowledge('stop', false);
        this.onManualCommand?.();
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
     */
    public async applyAutomatedPosition(coveringPercent: number, reason: string): Promise<void> {
        this.pendingMove = { targetPercent: coveringPercent, issuedAt: Date.now() };
        this.watchdogReported = false;
        await this.driver.setPosition(coveringToRuntime(coveringPercent, this.curve));
        await this.adapter.setStateAsync(`${this.basePath}.position`, { val: coveringPercent, ack: true });
        await this.adapter.setStateAsync(`${this.basePath}.statusText`, { val: reason, ack: true });
        await this.refreshPosition();
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
        const runtimePercent = this.driver.getCurrentPosition();
        if (runtimePercent === undefined) {
            return;
        }
        await this.adapter.setStateChangedAsync(`${this.basePath}.positionRaw`, runtimePercent, true);
        await this.adapter.setStateChangedAsync(
            `${this.basePath}.positionActual`,
            runtimeToCovering(runtimePercent, this.curve),
            true,
        );
        await this.checkWatchdog(runtimePercent);
    }

    /** Releases the driver's subscriptions. Call on adapter unload. */
    public destroy(): void {
        this.driver.destroy();
    }

    /**
     * Sets one of this covering's own states to the given value with `ack: true`.
     *
     * @param stateName - Name of the state relative to this covering, e.g. "position".
     * @param value - Value to acknowledge.
     */
    private async acknowledge(stateName: string, value: ioBroker.StateValue): Promise<void> {
        await this.adapter.setStateAsync(`${this.basePath}.${stateName}`, { val: value, ack: true });
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
            return;
        }

        const maxMs = (this.config.maxRuntimeSecs ?? 60) * 1000 + WATCHDOG_GRACE_MS;
        if (Date.now() - this.pendingMove.issuedAt <= maxMs || this.watchdogReported) {
            return;
        }

        this.watchdogReported = true;
        const message = `Covering "${this.config.id}" did not reach target position ${this.pendingMove.targetPercent}% within the expected time.`;
        this.adapter.log.warn(message);
        await this.adapter.setStateAsync(`${this.basePath}.watchdogLastIssue`, { val: message, ack: true });

        const countState = await this.adapter.getStateAsync(`${this.basePath}.watchdogIssueCount`);
        const nextCount = (typeof countState?.val === 'number' ? countState.val : 0) + 1;
        await this.adapter.setStateAsync(`${this.basePath}.watchdogIssueCount`, { val: nextCount, ack: true });
    }
}
