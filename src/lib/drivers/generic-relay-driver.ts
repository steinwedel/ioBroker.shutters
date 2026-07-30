import type { IShutterDriver } from './types';

/**
 * Driver for coverings driven by simple open/close/stop relay outputs, with
 * no position feedback at all (e.g. a basic Somfy/EnOcean relay actuator).
 *
 * Position is only tracked as a best-effort in-memory estimate (0 or 100
 * after a full open/close command); precise intermediate positions require
 * runtime-based tracking, which is added together with the calibration
 * curve (position-mapping.ts, plan section 4) and is not yet implemented
 * here.
 *
 * Required `config.states` keys: `open`, `close`, `stop` (all boolean, ack=false).
 */
export class GenericRelayDriver implements IShutterDriver {
    public readonly type = 'generic-relay';

    private currentPosition: number | undefined;

    /**
     * @param adapter - Adapter instance, used for foreign state access.
     * @param openStateId - Foreign state pulsed to open/retract.
     * @param closeStateId - Foreign state pulsed to close/extend.
     * @param stopStateId - Foreign state pulsed to stop, if supported by the actuator.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly openStateId: string,
        private readonly closeStateId: string,
        private readonly stopStateId: string | undefined,
    ) {}

    /** @param targetPercent - Target position 0-100; only 0 and 100 are actually reachable, see class doc. */
    public async setPosition(targetPercent: number): Promise<void> {
        // Without runtime-based intermediate tracking (see class doc), only
        // the fully open/closed ends are meaningfully reachable for now.
        if (targetPercent <= 0) {
            await this.open();
        } else if (targetPercent >= 100) {
            await this.close();
        } else {
            this.adapter.log.warn(
                `GenericRelayDriver: intermediate position ${targetPercent}% requested but not supported without runtime calibration - ignoring.`,
            );
        }
    }

    /** Pulses the open/retract relay. */
    public async open(): Promise<void> {
        await this.adapter.setForeignStateAsync(this.openStateId, true, false);
        this.currentPosition = 0;
    }

    /** Pulses the close/extend relay. */
    public async close(): Promise<void> {
        await this.adapter.setForeignStateAsync(this.closeStateId, true, false);
        this.currentPosition = 100;
    }

    /** Pulses the stop relay, if configured. */
    public async stop(): Promise<void> {
        if (this.stopStateId) {
            await this.adapter.setForeignStateAsync(this.stopStateId, true, false);
        }
    }

    /** @returns The last commanded position (0 or 100), or undefined if none was commanded yet. */
    public getCurrentPosition(): number | undefined {
        return this.currentPosition;
    }

    /** @returns Always undefined; this driver has no movement feedback. */
    public isMoving(): boolean | undefined {
        return undefined;
    }

    /** No-op; this driver holds no subscriptions. */
    public destroy(): void {
        // No subscriptions held.
    }
}
