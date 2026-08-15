import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * EnOcean (via `ioBroker.enocean`) driver: a percentage position state (0-100) for actuators that
 * report one (e.g. EEP D2-05 shutter profiles), with an optional stop command. Purely up/down-telegram
 * actuators without any position feedback should use the `generic-relay` driver instead - EnOcean's
 * battery-less "rocker" style controls have no absolute position concept for this driver to use. See
 * plan section 2a.2.
 */
export class EnoceanDriver extends PositionStopDriverBase {
    public readonly type = 'enocean';
}
