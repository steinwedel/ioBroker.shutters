import { createDriver } from './drivers/driver-factory';
import type { IShutterDriver } from './drivers/types';
import { coveringToRuntime, type ICalibrationPoint, normalizeCurve, runtimeToCovering } from './position-mapping';
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
    private readonly curve: ICalibrationPoint[];

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
        this.curve = normalizeCurve(config.calibrationCurve);
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

        await adapter.setObjectNotExistsAsync(`${basePath}.positionRaw`, {
            type: 'state',
            common: {
                name: `${config.name} - raw motor runtime`,
                type: 'number',
                role: 'value',
                unit: '%',
                min: 0,
                max: 100,
                read: true,
                write: false,
                expert: true,
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

        await adapter.setObjectNotExistsAsync(`${basePath}.calibrate`, {
            type: 'state',
            common: {
                name: `${config.name} - start guided calibration run`,
                type: 'boolean',
                role: 'button',
                read: true,
                write: true,
                expert: true,
            },
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

        await this.refreshPosition();
    }

    /** IDs of the own states this controller reacts to; use with `adapter.subscribeStates`. */
    public getOwnStateIds(): string[] {
        return [
            `${this.basePath}.position`,
            `${this.basePath}.open`,
            `${this.basePath}.close`,
            `${this.basePath}.stop`,
            `${this.basePath}.calibrate`,
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
            case `${this.basePath}.position`: {
                const coveringPercent = Number(state.val);
                await this.driver.setPosition(coveringToRuntime(coveringPercent, this.curve));
                await this.acknowledge('position', coveringPercent);
                await this.refreshPosition();
                return true;
            }
            case `${this.basePath}.open`:
                await this.driver.open();
                await this.acknowledge('open', false);
                await this.refreshPosition();
                return true;
            case `${this.basePath}.close`:
                await this.driver.close();
                await this.acknowledge('close', false);
                await this.refreshPosition();
                return true;
            case `${this.basePath}.stop`:
                await this.driver.stop();
                await this.acknowledge('stop', false);
                return true;
            case `${this.basePath}.calibrate`:
                await this.acknowledge('calibrate', false);
                this.adapter.log.warn(
                    `Covering "${this.config.id}": guided calibration run is not implemented yet - configure calibrationCurve manually for now.`,
                );
                return true;
            default:
                return false;
        }
    }

    /**
     * Re-reads the driver's actual position (if it reports one) and updates
     * `positionRaw`/`positionActual` accordingly. Drivers without position
     * feedback (e.g. generic-relay) leave these states at their last known
     * value.
     */
    public async refreshPosition(): Promise<void> {
        const runtimePercent = this.driver.getCurrentPosition();
        if (runtimePercent === undefined) {
            return;
        }
        await this.adapter.setStateChangedAsync(`${this.basePath}.positionRaw`, runtimePercent, true);
        await this.adapter.setStateChangedAsync(
            `${this.basePath}.positionActual`,
            runtimeToCovering(runtimePercent, this.curve),
            true,
        );
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
