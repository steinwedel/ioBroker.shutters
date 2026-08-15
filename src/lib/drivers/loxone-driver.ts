import { BestEffortPositionEstimate } from './best-effort-position';
import { ForeignNumberTracker } from './foreign-state-tracker';
import type { IShutterDriver } from './types';

/**
 * Loxone (via `ioBroker.loxone`, mapping a Loxone "Jalousie" building block) driver. Loxone exposes
 * blind control primarily as `up`/`down` impulse states plus an actual-position read-back, rather than
 * a single absolute-position command state; newer configurations may additionally expose a direct
 * percentage command state.
 *
 * Stop is not a separate command in the Loxone Jalousie block: sending `up` and `down` together while
 * the blind is moving is how the block itself recognizes a stop request, so `stop()` pulses both -
 * regardless of whether direct percentage control is configured, since the block's own stop semantics
 * always work this way.
 *
 * Required `config.states` keys: `up`, `down` (both boolean, ack=false). Optional: `position` (target
 * 0-100, for configurations that do expose direct percentage control) and `positionActual` (0-100
 * read-back, defaults to `position` if that is configured and no separate read-back state is given).
 */
export class LoxoneDriver implements IShutterDriver {
    public readonly type = 'loxone';

    /** Only set when a position read-back state is configured; see class doc. */
    private readonly positionTracker: ForeignNumberTracker | undefined;
    /** Only meaningfully used when no direct percentage control is configured at all; see class doc. */
    private readonly positionEstimate = new BestEffortPositionEstimate();

    /**
     * @param adapter - Adapter instance, used for foreign state access.
     * @param upStateId - Foreign state pulsed to move up/open.
     * @param downStateId - Foreign state pulsed to move down/close.
     * @param positionStateId - Foreign state written with the target 0-100 value, if this Loxone configuration exposes direct percentage control.
     * @param positionActualStateId - Foreign state read for the current position, if available; defaults to `positionStateId` if that is configured.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly upStateId: string,
        private readonly downStateId: string,
        private readonly positionStateId: string | undefined,
        positionActualStateId: string | undefined,
    ) {
        const readBackStateId = positionActualStateId ?? positionStateId;
        if (readBackStateId) {
            this.positionTracker = new ForeignNumberTracker(adapter, readBackStateId, 'LoxoneDriver');
        }
    }

    /**
     * @param targetPercent - Target position 0-100. Without direct percentage control configured, only
     *   0 and 100 are actually reachable (see class doc); other values are ignored with a warning, like
     *   `GenericRelayDriver`.
     */
    public async setPosition(targetPercent: number): Promise<void> {
        if (this.positionStateId) {
            await this.adapter.setForeignStateAsync(this.positionStateId, targetPercent, false);
            return;
        }
        if (targetPercent <= 0) {
            await this.open();
        } else if (targetPercent >= 100) {
            await this.close();
        } else {
            this.adapter.log.warn(
                `LoxoneDriver: intermediate position ${targetPercent}% requested but no direct percentage control is configured - ignoring.`,
            );
        }
    }

    /** Pulses the "up" impulse. */
    public async open(): Promise<void> {
        await this.adapter.setForeignStateAsync(this.upStateId, true, false);
        if (!this.positionStateId) {
            this.positionEstimate.markOpened();
        }
    }

    /** Pulses the "down" impulse. */
    public async close(): Promise<void> {
        await this.adapter.setForeignStateAsync(this.downStateId, true, false);
        if (!this.positionStateId) {
            this.positionEstimate.markClosed();
        }
    }

    /**
     * Pulses "up" and "down" together, which the Loxone Jalousie block itself interprets as a stop
     * request (see class doc), and invalidates the best-effort position estimate, if in use.
     */
    public async stop(): Promise<void> {
        await Promise.all([
            this.adapter.setForeignStateAsync(this.upStateId, true, false),
            this.adapter.setForeignStateAsync(this.downStateId, true, false),
        ]);
        this.positionEstimate.invalidate();
    }

    /** @returns The tracked position read-back if configured, otherwise the best-effort estimate, or undefined if neither is known yet. */
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
