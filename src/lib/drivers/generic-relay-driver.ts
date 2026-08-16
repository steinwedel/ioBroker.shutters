import { BestEffortPositionEstimate } from './best-effort-position';
import type { IShutterDriver } from './types';

/** Controls a covering through open, close, and optional stop relay states. */
export class GenericRelayDriver implements IShutterDriver {
    /** Driver identifier used by shutter configuration. */
    public readonly type = 'generic-relay';

    private readonly positionEstimate = new BestEffortPositionEstimate();
    private movement:
        | {
              /** Estimated position when timed movement began. */
              startPercent: number;
              /** Requested position at the end of timed movement. */
              targetPercent: number;
              /** Timestamp when timed movement began. */
              startedAt: number;
              /** Total duration of timed movement in milliseconds. */
              durationMs: number;
          }
        | undefined;
    private stopTimer: ioBroker.Timeout | undefined;

    /**
     * Creates a relay-based covering driver.
     *
     * @param adapter - Adapter used to command foreign states and manage timers.
     * @param openStateId - Foreign state ID that opens the covering.
     * @param closeStateId - Foreign state ID that closes the covering.
     * @param stopStateId - Optional foreign state ID that stops movement.
     * @param openRuntimeSecs - Calibrated full opening time in seconds.
     * @param closeRuntimeSecs - Calibrated full closing time in seconds.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly openStateId: string,
        private readonly closeStateId: string,
        private readonly stopStateId: string | undefined,
        private readonly openRuntimeSecs: number | undefined = undefined,
        private readonly closeRuntimeSecs: number | undefined = undefined,
    ) {}

    /**
     * Moves the covering to a requested position.
     *
     * @param targetPercent - Target position, 0-100.
     */
    public async setPosition(targetPercent: number): Promise<void> {
        if (targetPercent <= 0) {
            await this.open();
            return;
        }
        if (targetPercent >= 100) {
            await this.close();
            return;
        }

        const currentPercent = this.getCurrentPosition();
        const directionRuntimeSecs =
            targetPercent < (currentPercent ?? Number.NaN) ? this.openRuntimeSecs : this.closeRuntimeSecs;
        if (currentPercent === undefined || !this.stopStateId || !isValidRuntime(directionRuntimeSecs)) {
            this.adapter.log.warn(
                `GenericRelayDriver: intermediate position ${targetPercent}% requires a current position, stop state and directional runtime calibration - ignoring.`,
            );
            return;
        }

        const durationMs = (Math.abs(targetPercent - currentPercent) / 100) * directionRuntimeSecs * 1000;
        if (durationMs === 0) {
            return;
        }
        this.clearMovement();
        this.movement = { startPercent: currentPercent, targetPercent, startedAt: Date.now(), durationMs };
        await this.adapter.setForeignStateAsync(
            targetPercent < currentPercent ? this.openStateId : this.closeStateId,
            true,
            false,
        );
        this.stopTimer = this.adapter.setTimeout(() => {
            this.finishTimedMovement().catch(error => {
                this.adapter.log.error(
                    `GenericRelayDriver: stopping timed movement failed: ${(error as Error).message}`,
                );
            });
        }, durationMs);
    }

    /** Opens the covering fully. */
    public async open(): Promise<void> {
        this.clearMovement();
        await this.adapter.setForeignStateAsync(this.openStateId, true, false);
        this.positionEstimate.markOpened();
    }

    /** Closes the covering fully. */
    public async close(): Promise<void> {
        this.clearMovement();
        await this.adapter.setForeignStateAsync(this.closeStateId, true, false);
        this.positionEstimate.markClosed();
    }

    /** Stops the covering and preserves the estimated current position. */
    public async stop(): Promise<void> {
        const currentPercent = this.getCurrentPosition();
        this.clearMovement();
        if (currentPercent !== undefined) {
            this.positionEstimate.setValue(currentPercent);
        }
        await this.pulseStop();
    }

    /** @returns The estimated current position, or undefined when unknown. */
    public getCurrentPosition(): number | undefined {
        if (!this.movement) {
            return this.positionEstimate.getValue();
        }
        const elapsedMs = Date.now() - this.movement.startedAt;
        if (elapsedMs >= this.movement.durationMs) {
            return this.movement.targetPercent;
        }
        return (
            this.movement.startPercent +
            ((this.movement.targetPercent - this.movement.startPercent) * elapsedMs) / this.movement.durationMs
        );
    }

    /** @returns Whether a timed movement is currently in progress. */
    public isMoving(): boolean | undefined {
        return !!this.movement && Date.now() - this.movement.startedAt < this.movement.durationMs;
    }

    /** Clears the pending timed movement and releases its timer. */
    public destroy(): void {
        this.clearMovement();
    }

    private async finishTimedMovement(): Promise<void> {
        if (!this.movement) {
            return;
        }
        const targetPercent = this.movement.targetPercent;
        this.clearMovement();
        this.positionEstimate.setValue(targetPercent);
        await this.pulseStop();
    }

    private clearMovement(): void {
        this.movement = undefined;
        if (this.stopTimer) {
            this.adapter.clearTimeout(this.stopTimer);
            this.stopTimer = undefined;
        }
    }

    private async pulseStop(): Promise<void> {
        if (this.stopStateId) {
            await this.adapter.setForeignStateAsync(this.stopStateId, true, false);
        }
    }
}

function isValidRuntime(value: number | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
