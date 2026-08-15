import { ForeignNumberTracker } from './foreign-state-tracker';
import type { IShutterDriver } from './types';

/**
 * Shared base for every driver that commands position via a single writable percentage state and
 * reads position back via a (possibly the same) readable percentage state, with an optional
 * dedicated stop command and an optional dedicated slat-tilt command/readback pair (plan section 2a.5,
 * raffstore/lamellen only). Every position+stop driver in the plan's driver table (homematic, hmip,
 * knx, shelly, zigbee, zigbee2mqtt, somfy, velux, enocean, velbus, homey) extends this directly,
 * inheriting tilt support automatically - no per-driver code is needed to support it, only a
 * configured `states.tilt`/`states.tiltActual` pair (see `driver-factory.ts`).
 */
export abstract class PositionStopDriverBase implements IShutterDriver {
    public abstract readonly type: string;

    private readonly positionTracker: ForeignNumberTracker;
    private readonly tiltTracker: ForeignNumberTracker | undefined;

    /**
     * @param adapter - Adapter instance, used for foreign state access.
     * @param positionStateId - Foreign state written with the target 0-100 value.
     * @param positionActualStateId - Foreign state read for the current position; defaults to `positionStateId` if the system reports both on the same state.
     * @param stopStateId - Foreign state pulsed to stop movement, if the system supports a dedicated stop command.
     * @param tiltStateId - Foreign state written with the target slat-tilt angle 0-100/0-180° (plan section 2a.5), or undefined if this covering has no tilt control (`coveringType` other than `raffstore`/`lamellen`, or the system/device does not support it).
     * @param tiltActualStateId - Foreign state read for the current slat-tilt angle; defaults to `tiltStateId` if the system reports both on the same state. Ignored if `tiltStateId` is undefined.
     * @param invertPosition - See `IShutterConfig.invertPosition`: flips the covering-height percentage (`100 - x`) on top of this driver's own `toExternalPosition()`/`fromExternalPosition()`, to compensate for an individual actuator wired/configured with the opposite direction from its siblings. Default `false`.
     */
    public constructor(
        protected readonly adapter: ioBroker.Adapter,
        private readonly positionStateId: string,
        positionActualStateId: string,
        private readonly stopStateId: string | undefined,
        private readonly tiltStateId?: string,
        tiltActualStateId?: string,
        private readonly invertPosition: boolean = false,
    ) {
        this.positionTracker = new ForeignNumberTracker(
            adapter,
            positionActualStateId,
            this.constructor.name,
            value => {
                const decoded = this.fromExternalPosition(value);
                return this.invertPosition ? 100 - decoded : decoded;
            },
        );
        this.tiltTracker = tiltStateId
            ? new ForeignNumberTracker(adapter, tiltActualStateId ?? tiltStateId, this.constructor.name)
            : undefined;
    }

    /** Writes `targetPercent` (0-100, adapter convention) to the driver's position state, after applying `invertPosition` and this driver's own external-position convention. */
    public async setPosition(targetPercent: number): Promise<void> {
        const effectiveTarget = this.invertPosition ? 100 - targetPercent : targetPercent;
        await this.adapter.setForeignStateAsync(this.positionStateId, this.toExternalPosition(effectiveTarget), false);
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
        return this.positionTracker.getValue();
    }

    /** @returns Always undefined; none of the systems using this base class report movement status yet. */
    public isMoving(): boolean | undefined {
        return undefined;
    }

    /**
     * Drives the slat tilt to `anglePercent` (plan section 2a.5), if a tilt state is configured for
     * this covering; otherwise a no-op (a `raffstore`/`lamellen` device with no tilt state configured,
     * or any other `coveringType`, simply has no tilt control - not an error condition).
     *
     * @param anglePercent - Target tilt angle, 0-100 (or a wider range for `lamellen`'s rotation, see `IShutterConfig.states.tilt`); passed through unmapped, same convention as the foreign state itself.
     */
    public async setTilt(anglePercent: number): Promise<void> {
        if (this.tiltStateId) {
            await this.adapter.setForeignStateAsync(this.tiltStateId, anglePercent, false);
        }
    }

    /** @returns The last known actual tilt angle, or undefined if no tilt state is configured/not yet received. */
    public getCurrentTilt(): number | undefined {
        return this.tiltTracker?.getValue();
    }

    /** Unsubscribes the state-change listener(s) registered in the constructor. */
    public destroy(): void {
        this.positionTracker.destroy();
        this.tiltTracker?.destroy();
    }
}
