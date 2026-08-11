import { PositionStopDriverBase } from './position-stop-driver-base';

/**
 * Zigbee (via `ioBroker.zigbee`) driver: `position`/`current_position` for
 * position, no dedicated stop for most devices (optional if configured).
 * See plan section 2a.2.
 */
export class ZigbeeDriver extends PositionStopDriverBase {
    public readonly type = 'zigbee';
}

/**
 * Zigbee2MQTT (via `ioBroker.zigbee2mqtt`) driver: same state shape as
 * `ZigbeeDriver`, just a different adapter namespace. See plan section
 * 2a.2.
 */
export class Zigbee2MqttDriver extends PositionStopDriverBase {
    public readonly type = 'zigbee2mqtt';
}
