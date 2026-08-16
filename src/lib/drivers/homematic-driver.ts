import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * Homematic (CCU via `hm-rpc`/`hm-rega`) driver: `LEVEL` for position,
 * `STOP` to stop movement. See plan section 2a.2.
 */
export class HomematicDriver extends PositionStopDriverBase {
    public readonly type = 'homematic';

    /**
     * Creates a Homematic driver with optional normalized HmIP receiver levels.
     *
     * @param adapter ioBroker adapter instance.
     * @param positionStateId Foreign state ID for position commands.
     * @param positionActualStateId Foreign state ID for actual position feedback.
     * @param stopStateId Optional foreign state ID for stopping movement.
     * @param tiltStateId Optional foreign state ID for tilt commands.
     * @param tiltActualStateId Optional foreign state ID for actual tilt feedback.
     * @param invertPosition Whether to invert the covering position mapping.
     * @param normalizedLevel Whether foreign position values use the 0-1 range.
     */
    public constructor(
        adapter: ioBroker.Adapter,
        positionStateId: string,
        positionActualStateId: string,
        stopStateId: string | undefined,
        tiltStateId?: string,
        tiltActualStateId?: string,
        invertPosition = false,
        private readonly normalizedLevel = false,
    ) {
        super(
            adapter,
            positionStateId,
            positionActualStateId,
            stopStateId,
            tiltStateId,
            tiltActualStateId,
            invertPosition,
        );
    }

    protected toExternalPosition(targetPercent: number): number {
        const level = 100 - targetPercent;
        return this.normalizedLevel ? level / 100 : level;
    }

    protected fromExternalPosition(position: number): number {
        return 100 - (this.normalizedLevel ? position * 100 : position);
    }
}
