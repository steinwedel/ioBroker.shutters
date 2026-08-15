import { expect } from 'chai';
import { GenericPositionDriver } from './generic-position-driver';

/** Minimal fake adapter exposing only what `GenericPositionDriver` needs. */
function createFakeAdapter(): {
    adapter: ioBroker.Adapter;
    setForeignStateCalls: { id: string; val: ioBroker.StateValue }[];
    emitStateChange: (id: string, val: ioBroker.StateValue) => void;
} {
    const setForeignStateCalls: { id: string; val: ioBroker.StateValue }[] = [];
    const listeners: ((id: string, state: ioBroker.State | null | undefined) => void)[] = [];

    const adapter = {
        log: { warn: () => {} },
        subscribeForeignStatesAsync: async () => {},
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getForeignStateAsync: async () => undefined,
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
        emitStateChange: (id: string, val: ioBroker.StateValue) => {
            for (const listener of listeners) {
                listener(id, { val, ack: true } as ioBroker.State);
            }
        },
    };
}

describe('GenericPositionDriver', () => {
    it('writes the target position unchanged', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new GenericPositionDriver(adapter, 'foreign.position', 'foreign.positionActual');

        await driver.setPosition(42);

        expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.position', val: 42 }]);
    });

    it('maps open()/close() to setPosition(0)/setPosition(100)', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new GenericPositionDriver(adapter, 'foreign.position', 'foreign.positionActual');

        await driver.open();
        await driver.close();

        expect(setForeignStateCalls).to.deep.equal([
            { id: 'foreign.position', val: 0 },
            { id: 'foreign.position', val: 100 },
        ]);
    });

    it('stop() is a no-op (no dedicated stop state)', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new GenericPositionDriver(adapter, 'foreign.position', 'foreign.positionActual');

        await driver.stop();

        expect(setForeignStateCalls).to.deep.equal([]);
    });

    it('tracks the actual position from the read-back state', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const driver = new GenericPositionDriver(adapter, 'foreign.position', 'foreign.positionActual');

        expect(driver.getCurrentPosition()).to.be.undefined;
        emitStateChange('foreign.positionActual', 55);

        expect(driver.getCurrentPosition()).to.equal(55);
    });

    it('reports its type and undefined isMoving()', () => {
        const { adapter } = createFakeAdapter();
        const driver = new GenericPositionDriver(adapter, 'foreign.position', 'foreign.positionActual');

        expect(driver.type).to.equal('generic-position');
        expect(driver.isMoving()).to.be.undefined;
    });
});
