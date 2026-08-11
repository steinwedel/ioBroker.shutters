import type { IShutterConfig } from '../types';
import { GenericPositionDriver } from './generic-position-driver';
import { GenericRelayDriver } from './generic-relay-driver';
import { HomematicDriver } from './homematic-driver';
import { KnxDriver } from './knx-driver';
import type { PositionStopDriverBase } from './position-stop-driver-base';
import { ShellyDriver } from './shelly-driver';
import type { IShutterDriver } from './types';
import { Zigbee2MqttDriver, ZigbeeDriver } from './zigbee-driver';

/** Driver classes sharing the position+stop shape (plan section 2a.2), keyed by `driverType`. */
const POSITION_STOP_DRIVERS: Partial<
    Record<
        IShutterConfig['driverType'],
        new (
            adapter: ioBroker.Adapter,
            position: string,
            positionActual: string,
            stop: string | undefined,
        ) => PositionStopDriverBase
    >
> = {
    homematic: HomematicDriver,
    knx: KnxDriver,
    shelly: ShellyDriver,
    zigbee: ZigbeeDriver,
    zigbee2mqtt: Zigbee2MqttDriver,
};

/**
 * Creates the driver instance matching `config.driverType`, injecting the
 * foreign state IDs configured for this covering. Beyond the two generic
 * drivers, only the "Kern-Set" from the plan's driver priority (homematic,
 * knx, shelly, zigbee, zigbee2mqtt - section 2a.4) is implemented so far;
 * the remaining system-specific drivers throw the same "not implemented
 * yet" error as before.
 *
 * @param adapter - Adapter instance, used for state access.
 * @param config - Configuration of the covering to create a driver for.
 */
export function createDriver(adapter: ioBroker.Adapter, config: IShutterConfig): IShutterDriver {
    const PositionStopDriver = POSITION_STOP_DRIVERS[config.driverType];
    if (PositionStopDriver) {
        const positionStateId = config.states.position;
        if (!positionStateId) {
            throw new Error(`Covering "${config.id}": driverType "${config.driverType}" requires states.position`);
        }
        return new PositionStopDriver(
            adapter,
            positionStateId,
            config.states.positionActual ?? positionStateId,
            config.states.stop,
        );
    }

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
                `Covering "${config.id}": driverType "${config.driverType}" is not implemented yet - only "generic-position", "generic-relay", "homematic", "knx", "shelly", "zigbee" and "zigbee2mqtt" are available so far.`,
            );
    }
}
