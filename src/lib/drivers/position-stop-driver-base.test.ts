import { expect } from 'chai';
import { HomematicDriver } from './homematic-driver';
import { PositionStopDriverBase } from './position-stop-driver-base';

/** Minimal fake adapter exposing only what `PositionStopDriverBase` needs. */
class IdentityDriver extends PositionStopDriverBase {
    public readonly type = 'identity';
}

function createFakeAdapter(): {
    adapter: ioBroker.Adapter;
    setForeignStateCalls: { id: string; val: ioBroker.StateValue }[];
    emitStateChange: (id: string, val: number) => void;
} {
    const setForeignStateCalls: { id: string; val: ioBroker.StateValue }[] = [];
    const listeners: ((id: string, state: ioBroker.State | null | undefined) => void)[] = [];

    const adapter = {
        log: { warn: () => {} },

        subscribeForeignStatesAsync: async () => {},
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        setForeignStateAsync: async (id: string, val: ioBroker.StateValue) => {
            setForeignStateCalls.push({ id, val });
        },
        on: (event: string, listener: (id: string, state: ioBroker.State | null | undefined) => void) => {
            if (event === 'stateChange') {
                listeners.push(listener);
            }
        },
        removeListener: () => {},
    } as unknown as ioBroker.Adapter;

    return {
        adapter,
        setForeignStateCalls,
        emitStateChange: (id: string, val: number) => {
            for (const listener of listeners) {
                listener(id, { val, ack: true } as ioBroker.State);
            }
        },
    };
}

describe('PositionStopDriverBase (via HomematicDriver)', () => {
    it('converts normalized positions to Homematic LEVEL values', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new HomematicDriver(adapter, 'hm-rpc.0.ABC.1.LEVEL', 'hm-rpc.0.ABC.1.LEVEL', undefined);

        await driver.setPosition(42);

        expect(setForeignStateCalls).to.have.length(1);
        expect(setForeignStateCalls[0].id).to.equal('hm-rpc.0.ABC.1.LEVEL');
        expect(setForeignStateCalls[0].val).to.be.closeTo(0.58, 0.000_001);
    });

    it('opens with LEVEL 1 and closes with LEVEL 0', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new HomematicDriver(adapter, 'hm-rpc.0.ABC.1.LEVEL', 'hm-rpc.0.ABC.1.LEVEL', undefined);

        await driver.open();
        await driver.close();

        expect(setForeignStateCalls).to.deep.equal([
            { id: 'hm-rpc.0.ABC.1.LEVEL', val: 1 },
            { id: 'hm-rpc.0.ABC.1.LEVEL', val: 0 },
        ]);
    });

    it('keeps identity mapping for non-Homematic position drivers', async () => {
        const { adapter, setForeignStateCalls, emitStateChange } = createFakeAdapter();
        const driver = new IdentityDriver(adapter, 'foreign.position', 'foreign.position', undefined);

        await driver.setPosition(42);
        emitStateChange('foreign.position', 55);

        expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.position', val: 42 }]);
        expect(driver.getCurrentPosition()).to.equal(55);
    });

    it('stop() writes to the stop state if configured, otherwise is a no-op', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const withStop = new HomematicDriver(
            adapter,
            'hm-rpc.0.ABC.1.LEVEL',
            'hm-rpc.0.ABC.1.LEVEL',
            'hm-rpc.0.ABC.1.STOP',
        );
        const withoutStop = new HomematicDriver(adapter, 'hm-rpc.0.DEF.1.LEVEL', 'hm-rpc.0.DEF.1.LEVEL', undefined);

        await withStop.stop();
        await withoutStop.stop();

        expect(setForeignStateCalls).to.deep.equal([{ id: 'hm-rpc.0.ABC.1.STOP', val: true }]);
    });

    it('tracks the actual position from state changes on the read-back state', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const driver = new HomematicDriver(adapter, 'hm-rpc.0.ABC.1.LEVEL', 'hm-rpc.0.ABC.1.LEVEL', undefined);

        expect(driver.getCurrentPosition()).to.be.undefined;

        emitStateChange('hm-rpc.0.ABC.1.LEVEL', 0.45);

        expect(driver.getCurrentPosition()).to.be.closeTo(55, 0.000_001);
    });

    it('ignores state changes for unrelated states', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const driver = new HomematicDriver(adapter, 'hm-rpc.0.ABC.1.LEVEL', 'hm-rpc.0.ABC.1.LEVEL', undefined);

        emitStateChange('hm-rpc.0.OTHER.1.LEVEL', 99);

        expect(driver.getCurrentPosition()).to.be.undefined;
    });

    it('reports its type', () => {
        const { adapter } = createFakeAdapter();
        const driver = new HomematicDriver(adapter, 'hm-rpc.0.ABC.1.LEVEL', 'hm-rpc.0.ABC.1.LEVEL', undefined);

        expect(driver.type).to.equal('homematic');
        expect(driver.isMoving()).to.be.undefined;
    });
});
