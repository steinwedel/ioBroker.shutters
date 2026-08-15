import type { IShutterConfig } from '../types';
import { EnoceanDriver } from './enocean-driver';
import { GenericPositionDriver } from './generic-position-driver';
import { GenericRelayDriver } from './generic-relay-driver';
import { HmipDriver } from './hmip-driver';
import { HomematicDriver } from './homematic-driver';
import { HomeyDriver } from './homey-driver';
import { KnxDriver } from './knx-driver';
import { LoxoneDriver } from './loxone-driver';
import { MqttDriver } from './mqtt-driver';
import type { PositionStopDriverBase } from './position-stop-driver-base';
import { ShellyDriver } from './shelly-driver';
import { SomfyDriver } from './somfy-driver';
import { TuyaDriver } from './tuya-driver';
import type { IShutterDriver } from './types';
import { VelbusDriver } from './velbus-driver';
import { VeluxDriver } from './velux-driver';
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
            tilt?: string,
            tiltActual?: string,
            invertPosition?: boolean,
        ) => PositionStopDriverBase
    >
> = {
    homematic: HomematicDriver,
    hmip: HmipDriver,
    knx: KnxDriver,
    shelly: ShellyDriver,
    zigbee: ZigbeeDriver,
    zigbee2mqtt: Zigbee2MqttDriver,
    somfy: SomfyDriver,
    velux: VeluxDriver,
    enocean: EnoceanDriver,
    velbus: VelbusDriver,
    homey: HomeyDriver,
};

/**
 * Creates the driver instance matching `config.driverType`, injecting the
 * foreign state IDs configured for this covering. Every driver from the
 * plan's driver table (section 2a.2) is implemented; `generic-position`/
 * `generic-relay` remain available as system-agnostic fallbacks. Every
 * position+stop driver (see `POSITION_STOP_DRIVERS`) additionally supports
 * optional slat-tilt control (plan section 2a.5) via `config.states.tilt`/
 * `states.tiltActual`, with no `driverType`-specific code needed.
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
            config.states.tilt,
            config.states.tiltActual,
            config.invertPosition,
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
        case 'tuya': {
            const percentControlStateId = config.states.position;
            const controlStateId = config.states.control;
            if (!percentControlStateId && !controlStateId) {
                throw new Error(
                    `Covering "${config.id}": driverType "tuya" requires states.position and/or states.control`,
                );
            }
            return new TuyaDriver(adapter, percentControlStateId, config.states.positionActual, controlStateId);
        }
        case 'mqtt': {
            const commandStateId = config.states.position;
            if (!commandStateId) {
                throw new Error(`Covering "${config.id}": driverType "mqtt" requires states.position`);
            }
            return new MqttDriver(adapter, commandStateId, config.states.positionActual ?? commandStateId);
        }
        case 'loxone': {
            const upStateId = config.states.up;
            const downStateId = config.states.down;
            if (!upStateId || !downStateId) {
                throw new Error(`Covering "${config.id}": driverType "loxone" requires states.up and states.down`);
            }
            return new LoxoneDriver(
                adapter,
                upStateId,
                downStateId,
                config.states.position,
                config.states.positionActual,
            );
        }
        default:
            throw new Error(`Covering "${config.id}": driverType "${config.driverType}" is not implemented.`);
    }
}
