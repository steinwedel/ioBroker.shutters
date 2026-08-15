import { ForeignNumberTracker } from './foreign-state-tracker';
import type { IShutterDriver } from './types';

/**
 * Generic MQTT cover (e.g. Tasmota, ESPHome, or Home Assistant-style covers, typically mirrored into
 * ioBroker via `ioBroker.mqtt`/`ioBroker.mqtt-client`) driver: a single command topic that accepts
 * either a numeric target position (0-100, same 0=open/100=closed direction as this adapter - invert
 * via your MQTT bridge/template if yours uses the opposite convention) or the literal strings
 * `"OPEN"`/`"CLOSE"`/`"STOP"`, plus an optional separate status topic for numeric position feedback.
 *
 * Required `config.states` keys: `position` (the shared command topic). Optional: `positionActual`
 * (the status topic, defaults to `position` if not separately configured - only numeric status values
 * are used for feedback; string-only status topics, e.g. reporting `"open"`/`"closed"`, are not parsed).
 */
export class MqttDriver implements IShutterDriver {
    public readonly type = 'mqtt';

    private readonly positionTracker: ForeignNumberTracker;

    /**
     * @param adapter - Adapter instance, used for foreign state access.
     * @param commandStateId - Foreign state mirroring the MQTT command topic.
     * @param positionActualStateId - Foreign state mirroring the MQTT status topic; defaults to `commandStateId` if the system reports both on the same topic.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly commandStateId: string,
        positionActualStateId: string,
    ) {
        this.positionTracker = new ForeignNumberTracker(adapter, positionActualStateId, 'MqttDriver');
    }

    /** @param targetPercent - Target position 0-100, published as-is to the command topic. */
    public async setPosition(targetPercent: number): Promise<void> {
        await this.adapter.setForeignStateAsync(this.commandStateId, targetPercent, false);
    }

    /** Publishes the literal `"OPEN"` command. */
    public async open(): Promise<void> {
        await this.adapter.setForeignStateAsync(this.commandStateId, 'OPEN', false);
    }

    /** Publishes the literal `"CLOSE"` command. */
    public async close(): Promise<void> {
        await this.adapter.setForeignStateAsync(this.commandStateId, 'CLOSE', false);
    }

    /** Publishes the literal `"STOP"` command. */
    public async stop(): Promise<void> {
        await this.adapter.setForeignStateAsync(this.commandStateId, 'STOP', false);
    }

    /** @returns The last known numeric position from the status topic, or undefined if not yet received/not numeric. */
    public getCurrentPosition(): number | undefined {
        return this.positionTracker.getValue();
    }

    /** @returns Always undefined; this driver has no dedicated movement-in-progress feedback. */
    public isMoving(): boolean | undefined {
        return undefined;
    }

    /** Unsubscribes the state-change listener registered in the constructor. */
    public destroy(): void {
        this.positionTracker.destroy();
    }
}
