import type { IShutterDriver } from './types';

/**
 * Shared implementation for drivers that control a covering via a single
 * 0-100 position state (write target, optionally a separate read-back
 * state) plus an optional stop command - the shape used by Homematic, KNX,
 * Shelly and Zigbee/Zigbee2MQTT in the plan's driver table (section 2a.2).
 * System-specific drivers extend this and only override `type` unless they
 * need genuinely different behavior (e.g. value scaling).
 *
 * Known limitation: assumes the position state already reports 0-100 per
 * the ioBroker `level.blind` convention. Some Homematic (`hm-rpc`) setups
 * expose the raw HomeMatic protocol value (0-1) instead - that scaling is
 * not handled here and would need a dedicated `HomematicDriver` override if
 * encountered in practice.
 */
export abstract class PositionStopDriverBase implements IShutterDriver {
    public abstract readonly type: string;

    private currentPosition: number | undefined;
    private readonly unsubscribe: () => void;

    /**
     * @param adapter - Adapter instance, used for foreign state access.
     * @param positionStateId - Foreign state written with the target 0-100 value.
     * @param positionActualStateId - Foreign state read for the current position; defaults to `positionStateId` if the system reports both on the same state.
     * @param stopStateId - Foreign state pulsed to stop movement, if the system supports a dedicated stop command.
     */
    public constructor(
        protected readonly adapter: ioBroker.Adapter,
        private readonly positionStateId: string,
        private readonly positionActualStateId: string,
        private readonly stopStateId: string | undefined,
    ) {
        void this.adapter
            .subscribeForeignStatesAsync(this.positionActualStateId)
            .catch(err => this.adapter.log.warn(`${this.constructor.name}: subscribe failed: ${err}`));

        const handler = (id: string, state: ioBroker.State | null | undefined): void => {
            if (id === this.positionActualStateId && state && typeof state.val === 'number') {
                this.currentPosition = state.val;
            }
        };
        this.adapter.on('stateChange', handler);
        this.unsubscribe = () => this.adapter.removeListener('stateChange', handler);
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

    /** Pulses the stop command, if a stop state is configured; otherwise a no-op. */
    public async stop(): Promise<void> {
        if (this.stopStateId) {
            await this.adapter.setForeignStateAsync(this.stopStateId, true, false);
        }
    }

    /** @returns The last known actual position, or undefined if not yet received. */
    public getCurrentPosition(): number | undefined {
        return this.currentPosition;
    }

    /** @returns Always undefined; none of the systems using this base class report movement status yet. */
    public isMoving(): boolean | undefined {
        return undefined;
    }

    /** Unsubscribes the state-change listener registered in the constructor. */
    public destroy(): void {
        this.unsubscribe();
    }
}
