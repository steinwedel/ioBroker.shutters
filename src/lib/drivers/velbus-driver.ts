import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * Velbus (via `ioBroker.velbus`) driver: a percentage position state (0-100) for blind modules that
 * support absolute positioning (e.g. VMB1BLE/VMB2BLE), read back from a separate status state, plus a
 * dedicated stop command. Older/simpler Velbus blind modules that only support up/down/stop pulses
 * without absolute positioning should use the `generic-relay` driver instead. See plan section 2a.2.
 */
export class VelbusDriver extends PositionStopDriverBase {
    public readonly type = 'velbus';
}
