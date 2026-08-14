import type { IShutterDriver } from './types';

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
                this.currentPosition = this.fromExternalPosition(state.val);
            }
        };
        this.adapter.on('stateChange', handler);
        this.unsubscribe = () => this.adapter.removeListener('stateChange', handler);
    }

    public async setPosition(targetPercent: number): Promise<void> {
        await this.adapter.setForeignStateAsync(this.positionStateId, this.toExternalPosition(targetPercent), false);
    }

    protected toExternalPosition(targetPercent: number): number {
        return targetPercent;
    }

    protected fromExternalPosition(position: number): number {
        return position;
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
