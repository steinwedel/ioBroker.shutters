import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * Homematic IP Cloud/Access Point (via `ioBroker.hmip`, not the classic CCU `hm-rpc`) driver:
 * `shutterLevel` on a 0-1 scale for position, `stop` to stop movement. Like classic Homematic, HmIP's
 * own convention is 1=open/0=closed - the opposite direction and a different scale (0-1, not 0-100)
 * from this adapter's covering percentage - so both are converted here. See plan section 2a.2.
 */
export class HmipDriver extends PositionStopDriverBase {
    public readonly type = 'hmip';

    protected toExternalPosition(targetPercent: number): number {
        return (100 - targetPercent) / 100;
    }

    protected fromExternalPosition(position: number): number {
        return 100 - position * 100;
    }
}
