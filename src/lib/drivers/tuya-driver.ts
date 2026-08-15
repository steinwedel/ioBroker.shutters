import { BestEffortPositionEstimate } from './best-effort-position';
import { ForeignNumberTracker } from './foreign-state-tracker';
import type { IShutterDriver } from './types';

/**
 * Tuya (cloud or local, via `ioBroker.tuya`) driver. Many Tuya roller-shutter DPs expose a direct
 * percentage (`percent_control`/`percent_state`); simpler devices only expose a `control` DP accepting
 * the literal strings `"open"`/`"close"`/`"stop"`. This driver supports both: `setPosition()` always
 * prefers direct percentage control when configured (needed for arbitrary intermediate positions);
 * `open()`/`close()` prefer the `control` DP's semantic command when configured, falling back to
 * `setPosition(0)`/`setPosition(100)` otherwise - so both still work with only `percent_control`
 * configured and no `control` DP at all.
 *
 * Required `config.states` keys: at least one of `position` (`percent_control`, 0-100, same
 * 0=open/100=closed direction as this adapter) or `control` (the open/close/stop DP). `positionActual`
 * (`percent_state`) is optional and defaults to `position` if not separately configured.
 */
export class TuyaDriver implements IShutterDriver {
    public readonly type = 'tuya';

    /** Only set when a percent feedback state is configured; see class doc. */
    private readonly positionTracker: ForeignNumberTracker | undefined;
    /** Only meaningfully used in control-DP-only mode (no percent feedback at all); see class doc. */
    private readonly positionEstimate = new BestEffortPositionEstimate();

    /**
     * @param adapter - Adapter instance, used for foreign state access.
     * @param percentControlStateId - Foreign state (`percent_control`) written with the target 0-100 value, if this device supports direct percentage control.
     * @param percentStateStateId - Foreign state (`percent_state`) read for the current position; defaults to `percentControlStateId` if that is configured and this is not separately given.
     * @param controlStateId - Foreign state (`control`) written with the literal `"open"`/`"close"`/`"stop"` command, if configured.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly percentControlStateId: string | undefined,
        percentStateStateId: string | undefined,
        private readonly controlStateId: string | undefined,
    ) {
        const readBackStateId = percentStateStateId ?? percentControlStateId;
        if (readBackStateId) {
            this.positionTracker = new ForeignNumberTracker(adapter, readBackStateId, 'TuyaDriver');
        }
    }

    /**
     * @param targetPercent - Target position 0-100. Without direct percentage control configured, only
     *   0 and 100 are actually reachable via the `control` DP; other values are ignored with a warning,
     *   like `GenericRelayDriver`.
     */
    public async setPosition(targetPercent: number): Promise<void> {
        if (this.percentControlStateId) {
            await this.adapter.setForeignStateAsync(this.percentControlStateId, targetPercent, false);
            return;
        }
        if (targetPercent <= 0) {
            await this.open();
        } else if (targetPercent >= 100) {
            await this.close();
        } else {
            this.adapter.log.warn(
                `TuyaDriver: intermediate position ${targetPercent}% requested but no percent_control DP is configured - ignoring.`,
            );
        }
    }

    /** Writes `"open"` to the `control` DP if configured, otherwise falls back to `setPosition(0)`. */
    public async open(): Promise<void> {
        if (this.controlStateId) {
            await this.adapter.setForeignStateAsync(this.controlStateId, 'open', false);
            if (!this.percentControlStateId) {
                this.positionEstimate.markOpened();
            }
            return;
        }
        await this.setPosition(0);
    }

    /** Writes `"close"` to the `control` DP if configured, otherwise falls back to `setPosition(100)`. */
    public async close(): Promise<void> {
        if (this.controlStateId) {
            await this.adapter.setForeignStateAsync(this.controlStateId, 'close', false);
            if (!this.percentControlStateId) {
                this.positionEstimate.markClosed();
            }
            return;
        }
        await this.setPosition(100);
    }

    /**
     * Writes `"stop"` to the `control` DP, if configured, and invalidates the best-effort position
     * estimate (see class doc) - otherwise a no-op.
     */
    public async stop(): Promise<void> {
        if (this.controlStateId) {
            await this.adapter.setForeignStateAsync(this.controlStateId, 'stop', false);
        }
        this.positionEstimate.invalidate();
    }

    /** @returns The tracked percent feedback if configured, otherwise the best-effort estimate, or undefined if neither is known yet. */
    public getCurrentPosition(): number | undefined {
        return this.positionTracker?.getValue() ?? this.positionEstimate.getValue();
    }

    /** @returns Always undefined; this driver has no dedicated movement-in-progress feedback. */
    public isMoving(): boolean | undefined {
        return undefined;
    }

    /** Unsubscribes the state-change listener registered in the constructor, if any. */
    public destroy(): void {
        this.positionTracker?.destroy();
    }
}
