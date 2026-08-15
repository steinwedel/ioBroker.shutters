import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * Velux (KLF200/io-Homecontrol gateway, via `ioBroker.velux`/`ioBroker.klf200`) driver: a percentage
 * position state (0-100, same 0=open/100=closed direction as this adapter) per product, an optional
 * separate status state, and an optional stop command. See plan section 2a.2.
 *
 * Some KLF200 integrations instead report position on a 0-1 scale; if yours does, invert/rescale it
 * with a small script/alias before configuring it here, since this driver assumes 0-100 like the
 * other position-based drivers.
 */
export class VeluxDriver extends PositionStopDriverBase {
    public readonly type = 'velux';
}
