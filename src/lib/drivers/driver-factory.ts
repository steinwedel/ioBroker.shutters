import type { IShutterConfig } from '../types';
import { GenericPositionDriver } from './generic-position-driver';
import { GenericRelayDriver } from './generic-relay-driver';
import type { IShutterDriver } from './types';

/**
 * Creates the driver instance matching `config.driverType`, injecting the
 * foreign state IDs configured for this covering. Only the generic drivers
 * are implemented so far (M1b baseline); system-specific drivers are added
 * incrementally without changing this factory's contract, see plan section
 * 2a.4.
 *
 * @param adapter - Adapter instance, used for state access.
 * @param config - Configuration of the covering to create a driver for.
 */
export function createDriver(adapter: ioBroker.Adapter, config: IShutterConfig): IShutterDriver {
    switch (config.driverType) {
        case 'generic-position': {
            const positionStateId = config.states.position;
            if (!positionStateId) {
                throw new Error(`Covering "${config.id}": driverType "generic-position" requires states.position`);
            }
            return new GenericPositionDriver(adapter, positionStateId, config.states.positionActual ?? positionStateId);
        }
        case 'generic-relay': {
            const openStateId = config.states.open;
            const closeStateId = config.states.close;
            if (!openStateId || !closeStateId) {
                throw new Error(
                    `Covering "${config.id}": driverType "generic-relay" requires states.open and states.close`,
                );
            }
            return new GenericRelayDriver(adapter, openStateId, closeStateId, config.states.stop);
        }
        default:
            throw new Error(
                `Covering "${config.id}": driverType "${config.driverType}" is not implemented yet - only "generic-position" and "generic-relay" are available so far.`,
            );
    }
}
