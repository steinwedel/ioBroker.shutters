import type { ShutterController } from './shutter-controller';
import type { IGroupConfig } from './types';

/**
 * Owns the ioBroker objects/states for a group of coverings and forwards
 * combined commands to each member's `ShutterController`. Members may use
 * different driver types (plan section 3/M7) - this class only ever talks
 * to `ShutterController`, never to a driver directly.
 */
export class GroupController {
    private readonly basePath: string;

    /**
     * @param adapter - Adapter instance, used for state/object access.
     * @param config - Configuration of the group to control.
     * @param members - Controllers of the coverings belonging to this group, resolved from `config.memberIds`.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly config: IGroupConfig,
        private readonly members: ShutterController[],
    ) {
        this.basePath = `groups.${config.id}`;
    }

    /** Creates/updates all objects for this group. Safe to call repeatedly (uses setObjectNotExists). */
    public async createObjects(): Promise<void> {
        const { adapter, basePath, config } = this;

        await adapter.setObjectNotExistsAsync(basePath, {
            type: 'channel',
            common: { name: config.name },
            native: {},
        });

        // Diagnostic mirrors of this group's own config (plan section 3) - static per config, so
        // written once here rather than kept up to date on every tick like the coverings' own
        // per-tick diagnostic states.
        await adapter.setObjectNotExistsAsync(`${basePath}.name`, {
            type: 'state',
            common: {
                name: `${config.name} - name`,
                type: 'string',
                role: 'text',
                read: true,
                write: false,
            },
            native: {},
        });
        await adapter.setStateAsync(`${basePath}.name`, { val: config.name, ack: true });

        await adapter.setObjectNotExistsAsync(`${basePath}.members`, {
            type: 'state',
            common: {
                name: `${config.name} - member covering IDs (JSON array)`,
                type: 'string',
                role: 'json',
                read: true,
                write: false,
            },
            native: {},
        });
        await adapter.setStateAsync(`${basePath}.members`, { val: JSON.stringify(config.memberIds), ack: true });

        await adapter.setObjectNotExistsAsync(`${basePath}.position`, {
            type: 'state',
            common: {
                name: `${config.name} - target position for all members`,
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

        await adapter.setObjectNotExistsAsync(`${basePath}.openAll`, {
            type: 'state',
            common: {
                name: `${config.name} - open all members`,
                type: 'boolean',
                role: 'button.open.blind',
                read: true,
                write: true,
            },
            native: {},
        });

        await adapter.setObjectNotExistsAsync(`${basePath}.closeAll`, {
            type: 'state',
            common: {
                name: `${config.name} - close all members`,
                type: 'boolean',
                role: 'button.close.blind',
                read: true,
                write: true,
            },
            native: {},
        });
    }

    /** IDs of the own states this controller reacts to; use with `adapter.subscribeStates`. */
    public getOwnStateIds(): string[] {
        return [`${this.basePath}.position`, `${this.basePath}.openAll`, `${this.basePath}.closeAll`];
    }

    /**
     * Handles a state change for one of this group's own states, if it
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
                const percent = Number(state.val);
                await Promise.all(this.members.map(member => member.commandPosition(percent)));
                await this.adapter.setStateAsync(`${this.basePath}.position`, { val: percent, ack: true });
                return true;
            }
            case `${this.basePath}.openAll`:
                await Promise.all(this.members.map(member => member.commandOpen()));
                await this.adapter.setStateAsync(`${this.basePath}.openAll`, { val: false, ack: true });
                return true;
            case `${this.basePath}.closeAll`:
                await Promise.all(this.members.map(member => member.commandClose()));
                await this.adapter.setStateAsync(`${this.basePath}.closeAll`, { val: false, ack: true });
                return true;
            default:
                return false;
        }
    }
}
