import { createDriver } from './drivers/driver-factory';
import type { IShutterDriver } from './drivers/types';
import { coveringToRuntime, type ICalibrationPoint, normalizeCurve, runtimeToCovering } from './position-mapping';
import type { IShutterConfig } from './types';

/** Tolerance (percentage points) used to decide whether a covering has "reached" its target runtime, see the watchdog in `refreshPosition()`. */
const WATCHDOG_TOLERANCE_PERCENT = 3;
/** Extra time allowed on top of `maxRuntimeSecs` before the watchdog reports a stuck covering. */
const WATCHDOG_GRACE_MS = 30_000;
/** Default for `IShutterConfig.minCommandIntervalMs` (motor protection, plan section 7d) if unset. */
const DEFAULT_MIN_COMMAND_INTERVAL_MS = 8_000;

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

        await adapter.setObjectNotExistsAsync(`${basePath}.sunProtectionOverrideUntil`, {
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

    /** @returns The covering's stable area ID (`IShutterConfig.areaId`), or undefined if never assigned to an area. */
    public getAreaId(): string | undefined {
        return this.config.areaId;
    }

    /** @returns The covering's legacy, name-based area assignment (`IShutterConfig.area`), used only as a fallback for coverings that predate stable area IDs. */
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
                await this.adapter.setStateAsync(`${this.basePath}.position`, { val: coveringPercent, ack: true });
                await this.adapter.setStateAsync(`${this.basePath}.statusText`, { val: reason, ack: true });
            },
            bypassMotorProtection,
        );
    }

    /**
     * Reads the persisted sun-protection override deadline (plan section 6.4/9a.2), e.g. right after
     * startup, so a "Tagessperre" set before an adapter restart is not silently lost.
     *
     * @returns Local midnight (ms since epoch) until which sun protection is suspended, or 0 if not currently suspended/never set.
     */
    public async getPersistedSunProtectionOverrideUntil(): Promise<number> {
        const state = await this.adapter.getStateAsync(`${this.basePath}.sunProtectionOverrideUntil`);
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
        await this.adapter.setStateAsync(`${this.basePath}.sunProtectionOverrideUntil`, { val: untilMs, ack: true });
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
        this.pendingMove = { targetPercent, issuedAt: Date.now() };
        this.watchdogReported = false;
        await invokeDriver();
        await afterDrive();
        await this.refreshPosition();
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

    /** Releases the driver's subscriptions and cancels any pending motor-protection buffer timer. Call on adapter unload. */
    public destroy(): void {
        this.cancelBufferedCommand();
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
