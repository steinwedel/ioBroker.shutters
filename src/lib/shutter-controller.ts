import { createDriver } from './drivers/driver-factory';
import type { IShutterDriver } from './drivers/types';
import type { IShutterConfig } from './types';

/**
 * Owns the ioBroker objects/states for a single covering and forwards
 * manual commands to its driver. Automation (schedule, sun/rain/wind/frost
 * protection, priority resolution) is added on top of this in later
 * milestones (plan sections 5-8) and is not part of this class.
 */
export class ShutterController {
    private readonly driver: IShutterDriver;
    private readonly basePath: string;

    /**
     * @param adapter - Adapter instance, used for state/object access.
     * @param config - Configuration of the covering to control.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly config: IShutterConfig,
    ) {
        this.basePath = `shutters.${config.id}`;
        this.driver = createDriver(adapter, config);
    }

    /** Creates/updates all objects for this covering. Safe to call repeatedly (uses setObjectNotExists). */
    public async createObjects(): Promise<void> {
        const { adapter, basePath, config } = this;

        await adapter.setObjectNotExistsAsync(basePath, {
            type: 'device',
            common: { name: config.name },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.position`, {
            type: 'state',
            common: {
                name: `${config.name} - target position`,
                type: 'number',
                role: 'level.blind',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.positionActual`, {
            type: 'state',
            common: {
                name: `${config.name} - actual position`,
                type: 'number',
                role: 'value.blind',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: false,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.open`, {
            type: 'state',
            common: {
                name: `${config.name} - open`,
                type: 'boolean',
                role: 'button.open.blind',
                read: true,
                write: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.close`, {
            type: 'state',
            common: {
                name: `${config.name} - close`,
                type: 'boolean',
                role: 'button.close.blind',
                read: true,
                write: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.stop`, {
            type: 'state',
            common: { name: `${config.name} - stop`, type: 'boolean', role: 'button.stop', read: true, write: true },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.automationEnabled`, {
            type: 'state',
            common: {
                name: `${config.name} - automation enabled`,
                type: 'boolean',
                role: 'switch.enable',
                read: true,
                write: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.statusText`, {
            type: 'state',
            common: {
                name: `${config.name} - status`,
                type: 'string',
                role: 'text',
                read: true,
                write: false,
            },
            native: {},
        });

        await adapter.setStateAsync(`${basePath}.automationEnabled`, config.automationEnabled, true);
        await adapter.setStateAsync(`${basePath}.statusText`, 'Idle', true);

        const currentPosition = this.driver.getCurrentPosition();
        if (currentPosition !== undefined) {
            await adapter.setStateAsync(`${basePath}.positionActual`, currentPosition, true);
        }
    }

    /** IDs of the own states this controller reacts to; use with `adapter.subscribeStates`. */
    public getOwnStateIds(): string[] {
        return [
            `${this.basePath}.position`,
            `${this.basePath}.open`,
            `${this.basePath}.close`,
            `${this.basePath}.stop`,
        ];
    }

    /**
     * Handles a state change for one of this covering's own states, if it
     * matches. Returns true if the change was handled.
     *
     * @param id - Full state ID that changed.
     * @param state - The new state value.
     */
    public async handleStateChange(id: string, state: ioBroker.State): Promise<boolean> {
        if (state.ack) {
            return false;
        }

        switch (id) {
            case `${this.basePath}.position`:
                await this.driver.setPosition(Number(state.val));
                await this.acknowledge('position', state.val);
                return true;
            case `${this.basePath}.open`:
                await this.driver.open();
                await this.acknowledge('open', false);
                return true;
            case `${this.basePath}.close`:
                await this.driver.close();
                await this.acknowledge('close', false);
                return true;
            case `${this.basePath}.stop`:
                await this.driver.stop();
                await this.acknowledge('stop', false);
                return true;
            default:
                return false;
        }
    }

    /** Releases the driver's subscriptions. Call on adapter unload. */
    public destroy(): void {
        this.driver.destroy();
    }

    /**
     * Sets one of this covering's own states to the given value with `ack: true`.
     *
     * @param stateName - Name of the state relative to this covering, e.g. "position".
     * @param value - Value to acknowledge.
     */
    private async acknowledge(stateName: string, value: ioBroker.StateValue): Promise<void> {
        await this.adapter.setStateAsync(`${this.basePath}.${stateName}`, { val: value, ack: true });
    }
}
