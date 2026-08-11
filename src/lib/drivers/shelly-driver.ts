import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * Shelly (Cover mode, 2.5/Plus/Pro) driver: `Cover.Pos`/`Position` for
 * position, `Cover.Stop` (if configured) to stop movement. See plan
 * section 2a.2.
 */
export class ShellyDriver extends PositionStopDriverBase {
    public readonly type = 'shelly';
}
