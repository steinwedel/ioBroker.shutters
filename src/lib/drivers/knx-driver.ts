import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * KNX (via `ioBroker.knx`) driver: percentage position datapoint (DPT
 * 5.001) as command, an optional separate status datapoint, and an
 * optional stop group address. See plan section 2a.2.
 */
export class KnxDriver extends PositionStopDriverBase {
    public readonly type = 'knx';
}
