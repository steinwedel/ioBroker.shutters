import type { ShutterController } from './shutter-controller';
import type { ISceneConfig } from './types';

/**
 * Owns the ioBroker objects/states for a named position preset ("scene")
 * and drives each of its targets to the configured position when
 * activated. Scenes have no automation logic of their own - activating one
 * is treated exactly like a manual command on each affected covering (plan
 * section 9b), including the sun-protection override (plan section 6.4).
 */
export class SceneController {
    private readonly basePath: string;

    /**
     * @param adapter - Adapter instance, used for state/object access.
     * @param config - Configuration of the scene to control.
     * @param targets - Resolved `{ controller, percent }` pairs for `config.targets`.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly config: ISceneConfig,
        private readonly targets: { controller: ShutterController; percent: number }[],
    ) {
        this.basePath = `scenes.${config.id}`;
    }

    /** Creates/updates all objects for this scene. Safe to call repeatedly (uses setObjectNotExists). */
    public async createObjects(): Promise<void> {
        await this.adapter.setObjectNotExistsAsync(this.basePath, {
            type: 'channel',
            common: { name: this.config.name },
            native: {},
        });

        await this.adapter.setObjectNotExistsAsync(`${this.basePath}.activate`, {
            type: 'state',
            common: {
                name: `${this.config.name} - activate`,
                type: 'boolean',
                role: 'button',
                read: true,
                write: true,
            },
            native: {},
        });
    }

    /** IDs of the own states this controller reacts to; use with `adapter.subscribeStates`. */
    public getOwnStateIds(): string[] {
        return [`${this.basePath}.activate`];
    }

    /**
     * Handles a state change for this scene's own state, if it matches.
     * Returns true if the change was handled.
     *
     * @param id - Full state ID that changed.
     * @param state - The new state value.
     */
    public async handleStateChange(id: string, state: ioBroker.State): Promise<boolean> {
        if (state.ack || id !== `${this.basePath}.activate`) {
            return false;
        }

        await Promise.all(this.targets.map(target => target.controller.commandPosition(target.percent)));
        await this.adapter.setStateAsync(`${this.basePath}.activate`, { val: false, ack: true });
        return true;
    }
}
