import { expect } from 'chai';
import { GroupController } from './group-controller';
import type { ShutterController } from './shutter-controller';
import type { IGroupConfig } from './types';

/** Minimal fake adapter exposing only what `GroupController` needs. */
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

/** Minimal fake member controller recording every command call, duck-typed as `ShutterController`. */
function createFakeMember(): {
    controller: ShutterController;
    positionCalls: number[];
    openCalls: number;
    closeCalls: number;
} {
    const positionCalls: number[] = [];
    let openCalls = 0;
    let closeCalls = 0;
    const controller = {
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async controller method
        commandPosition: async (percent: number) => {
            positionCalls.push(percent);
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async controller method
        commandOpen: async () => {
            openCalls++;
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async controller method
        commandClose: async () => {
            closeCalls++;
        },
    } as unknown as ShutterController;
    return {
        controller,
        positionCalls,
        get openCalls() {
            return openCalls;
        },
        get closeCalls() {
            return closeCalls;
        },
    };
}

function makeGroupConfig(overrides: Partial<IGroupConfig> = {}): IGroupConfig {
    return { id: 'group1', name: 'Test Group', memberIds: ['shutter1', 'shutter2'], ...overrides };
}

describe('GroupController', () => {
    describe('getOwnStateIds', () => {
        it('returns position/openAll/closeAll relative to the group base path', () => {
            const { adapter } = createFakeAdapter();
            const group = new GroupController(adapter, makeGroupConfig(), []);

            expect(group.getOwnStateIds()).to.deep.equal([
                'groups.group1.position',
                'groups.group1.openAll',
                'groups.group1.closeAll',
            ]);
        });
    });

    describe('handleStateChange', () => {
        it('ignores an ack=true state change', async () => {
            const { adapter } = createFakeAdapter();
            const memberA = createFakeMember();
            const group = new GroupController(adapter, makeGroupConfig(), [memberA.controller]);

            const handled = await group.handleStateChange('groups.group1.position', {
                val: 50,
                ack: true,
            } as ioBroker.State);

            expect(handled).to.equal(false);
            expect(memberA.positionCalls).to.deep.equal([]);
        });

        it('ignores a state ID that does not belong to this group', async () => {
            const { adapter } = createFakeAdapter();
            const group = new GroupController(adapter, makeGroupConfig(), []);

            const handled = await group.handleStateChange('groups.other.position', {
                val: 50,
                ack: false,
            } as ioBroker.State);

            expect(handled).to.equal(false);
        });

        it('forwards a position command to every member and acknowledges it', async () => {
            const { adapter, setStateCalls } = createFakeAdapter();
            const memberA = createFakeMember();
            const memberB = createFakeMember();
            const group = new GroupController(adapter, makeGroupConfig(), [memberA.controller, memberB.controller]);

            const handled = await group.handleStateChange('groups.group1.position', {
                val: 42,
                ack: false,
            } as ioBroker.State);

            expect(handled).to.equal(true);
            expect(memberA.positionCalls).to.deep.equal([42]);
            expect(memberB.positionCalls).to.deep.equal([42]);
            expect(setStateCalls).to.deep.equal([{ id: 'groups.group1.position', val: 42, ack: true }]);
        });

        it('forwards openAll to every member and resets the button state', async () => {
            const { adapter, setStateCalls } = createFakeAdapter();
            const memberA = createFakeMember();
            const memberB = createFakeMember();
            const group = new GroupController(adapter, makeGroupConfig(), [memberA.controller, memberB.controller]);

            const handled = await group.handleStateChange('groups.group1.openAll', {
                val: true,
                ack: false,
            } as ioBroker.State);

            expect(handled).to.equal(true);
            expect(memberA.openCalls).to.equal(1);
            expect(memberB.openCalls).to.equal(1);
            expect(setStateCalls).to.deep.equal([{ id: 'groups.group1.openAll', val: false, ack: true }]);
        });

        it('forwards closeAll to every member and resets the button state', async () => {
            const { adapter, setStateCalls } = createFakeAdapter();
            const memberA = createFakeMember();
            const group = new GroupController(adapter, makeGroupConfig(), [memberA.controller]);

            const handled = await group.handleStateChange('groups.group1.closeAll', {
                val: true,
                ack: false,
            } as ioBroker.State);

            expect(handled).to.equal(true);
            expect(memberA.closeCalls).to.equal(1);
            expect(setStateCalls).to.deep.equal([{ id: 'groups.group1.closeAll', val: false, ack: true }]);
        });

        it('works with mixed driver-type members - it never talks to a driver directly', async () => {
            // GroupController only ever calls ShutterController methods, regardless of what backs
            // each member (Homematic, KNX, ...) - simulated here simply by two independent fakes.
            const { adapter } = createFakeAdapter();
            const homematicMember = createFakeMember();
            const knxMember = createFakeMember();
            const group = new GroupController(adapter, makeGroupConfig(), [
                homematicMember.controller,
                knxMember.controller,
            ]);

            await group.handleStateChange('groups.group1.position', { val: 30, ack: false } as ioBroker.State);

            expect(homematicMember.positionCalls).to.deep.equal([30]);
            expect(knxMember.positionCalls).to.deep.equal([30]);
        });
    });
});
