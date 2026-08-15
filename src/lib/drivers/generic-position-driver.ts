import { ForeignNumberTracker } from './foreign-state-tracker';
import type { IShutterDriver } from './types';

/**
 * Driver for coverings that already expose a single 0-100 position state to
 * both write a target and read back the actual position (e.g. Shelly Cover,
 * KNX percentage GA, Zigbee `position`). Also usable as the generic fallback
 * for any system that already speaks in 0-100.
 *
 * Required `config.states` keys:
 * - `position`: foreign state written with the target 0-100 value.
 * - `positionActual` (optional): foreign state read for the current position.
 *   Falls back to `position` if not configured (assume the same state reports
 *   both, which is common for simple cover integrations).
 */
export class GenericPositionDriver implements IShutterDriver {
    public readonly type = 'generic-position';

    private readonly positionTracker: ForeignNumberTracker;

    /**
     * @param adapter - Adapter instance, used for foreign state access.
     * @param positionStateId - Foreign state to write the target position to.
     * @param positionActualStateId - Foreign state to read the actual position from.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly positionStateId: string,
        positionActualStateId: string,
    ) {
        this.positionTracker = new ForeignNumberTracker(adapter, positionActualStateId, 'GenericPositionDriver');
    }

    /** @param targetPercent - Target position 0-100. */
    public async setPosition(targetPercent: number): Promise<void> {
        await this.adapter.setForeignStateAsync(this.positionStateId, targetPercent, false);
    }

    /** Drives to position 0 (fully open/retracted). */
    public async open(): Promise<void> {
        await this.setPosition(0);
    }

    /** Drives to position 100 (fully closed/extended). */
    public async close(): Promise<void> {
        await this.setPosition(100);
    }

    /** No-op for this driver; see class doc. */
    public async stop(): Promise<void> {
        // Most position-based systems have no dedicated stop state; a stop is
        // achieved by re-issuing the current position. Systems that do need a
        // real stop command should use a dedicated driver instead.
    }

    /** @returns The last known actual position, or undefined if not yet received. */
    public getCurrentPosition(): number | undefined {
        return this.positionTracker.getValue();
    }

    /** @returns Always undefined; this driver has no movement feedback. */
    public isMoving(): boolean | undefined {
        return undefined;
    }

    /** Unsubscribes the state-change listener registered in the constructor. */
    public destroy(): void {
        this.positionTracker.destroy();
    }
}
