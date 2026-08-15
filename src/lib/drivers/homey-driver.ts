import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * Homey (via an `ioBroker.homey`-style bridge exposing Homey's capability model as foreign states)
 * driver: the `windowcoverings_set` capability (0-1 scale, 1=open/0=closed per Homey's own convention -
 * the opposite direction and a different scale from this adapter's covering percentage, so both are
 * converted here) as command. Homey's real `windowcoverings_state` capability is a string status enum
 * (`"up"`/`"down"`/`"idle"`), not a numeric position, so it is not usable as a `positionActual`
 * read-back here; if your bridge mirrors the last-written value back onto `windowcoverings_set` itself,
 * point both `states.position` and `states.positionActual` at the same state instead. Optional stop
 * command for bridges that expose one (Homey's own capability model has no standard stop for window
 * coverings). See plan section 2a.2.
 */
export class HomeyDriver extends PositionStopDriverBase {
    public readonly type = 'homey';

    protected toExternalPosition(targetPercent: number): number {
        return (100 - targetPercent) / 100;
    }

    protected fromExternalPosition(position: number): number {
        return 100 - position * 100;
    }
}
