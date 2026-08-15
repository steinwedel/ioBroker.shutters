import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * Somfy io-Homecontrol via a TaHoma/Connexoon gateway (`ioBroker.tahoma`) driver: a percentage
 * position state (`core:ClosureState` or similar, 0-100, same 0=open/100=closed direction Somfy itself
 * uses) as command/status, plus an optional stop command. See plan section 2a.2.
 */
export class SomfyDriver extends PositionStopDriverBase {
    public readonly type = 'somfy';
}
