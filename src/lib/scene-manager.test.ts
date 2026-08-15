import { expect } from 'chai';
import { SceneController } from './scene-manager';
import type { ShutterController } from './shutter-controller';
import type { ISceneConfig } from './types';

/** Minimal fake adapter exposing only what `SceneController` needs. */
function createFakeAdapter(): {
    adapter: ioBroker.Adapter;
    setStateCalls: { id: string; val: ioBroker.StateValue; ack: boolean }[];
} {
    const setStateCalls: { id: string; val: ioBroker.StateValue; ack: boolean }[] = [];
    const adapter = {
        setObjectNotExistsAsync: async () => {},
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        setStateAsync: async (id: string, state: ioBroker.State | ioBroker.StateValue) => {
            const { val, ack } = typeof state === 'object' && state !== null ? state : { val: state, ack: false };
            setStateCalls.push({ id, val: val ?? null, ack: !!ack });
        },
    } as unknown as ioBroker.Adapter;
    return { adapter, setStateCalls };
}

/** Minimal fake target controller recording every `commandPosition()` call, duck-typed as `ShutterController`. */
function createFakeTarget(): { controller: ShutterController; positionCalls: number[] } {
    const positionCalls: number[] = [];
    const controller = {
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async controller method
        commandPosition: async (percent: number) => {
            positionCalls.push(percent);
        },
    } as unknown as ShutterController;
    return { controller, positionCalls };
}

function makeSceneConfig(overrides: Partial<ISceneConfig> = {}): ISceneConfig {
    return {
        id: 'scene1',
        name: 'Test Scene',
        targets: [{ coveringId: 'shutter1', percent: 100 }],
        ...overrides,
    };
}

describe('SceneController', () => {
    describe('getOwnStateIds', () => {
        it('returns activate relative to the scene base path', () => {
            const { adapter } = createFakeAdapter();
            const scene = new SceneController(adapter, makeSceneConfig(), []);

            expect(scene.getOwnStateIds()).to.deep.equal(['scenes.scene1.activate']);
        });
    });

    describe('handleStateChange', () => {
        it('ignores an ack=true state change', async () => {
            const { adapter } = createFakeAdapter();
            const target = createFakeTarget();
            const scene = new SceneController(adapter, makeSceneConfig(), [
                { controller: target.controller, percent: 100 },
            ]);

            const handled = await scene.handleStateChange('scenes.scene1.activate', {
                val: true,
                ack: true,
            } as ioBroker.State);

            expect(handled).to.equal(false);
            expect(target.positionCalls).to.deep.equal([]);
        });

        it('ignores a state ID that does not belong to this scene', async () => {
            const { adapter } = createFakeAdapter();
            const scene = new SceneController(adapter, makeSceneConfig(), []);

            const handled = await scene.handleStateChange('scenes.other.activate', {
                val: true,
                ack: false,
            } as ioBroker.State);

            expect(handled).to.equal(false);
        });

        it('drives every target to its configured percent via commandPosition (like a manual command)', async () => {
            const { adapter, setStateCalls } = createFakeAdapter();
            const targetA = createFakeTarget();
            const targetB = createFakeTarget();
            const scene = new SceneController(
                adapter,
                makeSceneConfig({
                    targets: [
                        { coveringId: 'shutter1', percent: 100 },
                        { coveringId: 'shutter2', percent: 30 },
                    ],
                }),
                [
                    { controller: targetA.controller, percent: 100 },
                    { controller: targetB.controller, percent: 30 },
                ],
            );

            const handled = await scene.handleStateChange('scenes.scene1.activate', {
                val: true,
                ack: false,
            } as ioBroker.State);

            expect(handled).to.equal(true);
            expect(targetA.positionCalls).to.deep.equal([100]);
            expect(targetB.positionCalls).to.deep.equal([30]);
            expect(setStateCalls).to.deep.equal([{ id: 'scenes.scene1.activate', val: false, ack: true }]);
        });

        it('drives different targets to different percents in the same scene', async () => {
            const { adapter } = createFakeAdapter();
            const cinemaTarget = createFakeTarget();
            const restTarget = createFakeTarget();
            const scene = new SceneController(adapter, makeSceneConfig(), [
                { controller: cinemaTarget.controller, percent: 100 },
                { controller: restTarget.controller, percent: 30 },
            ]);

            await scene.handleStateChange('scenes.scene1.activate', { val: true, ack: false } as ioBroker.State);

            expect(cinemaTarget.positionCalls).to.deep.equal([100]);
            expect(restTarget.positionCalls).to.deep.equal([30]);
        });
    });
});
