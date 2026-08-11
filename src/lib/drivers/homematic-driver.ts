import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * Homematic (CCU via `hm-rpc`/`hm-rega`) driver: `LEVEL` for position,
 * `STOP` to stop movement. See plan section 2a.2.
 */
export class HomematicDriver extends PositionStopDriverBase {
    public readonly type = 'homematic';
}
