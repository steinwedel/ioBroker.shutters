import { expect } from 'chai';
import { GenericRelayDriver } from './generic-relay-driver';

/** Minimal fake adapter exposing only what `GenericRelayDriver` needs. */
function createFakeAdapter(): {
    adapter: ioBroker.Adapter;
    setForeignStateCalls: { id: string; val: ioBroker.StateValue }[];
} {
    const setForeignStateCalls: { id: string; val: ioBroker.StateValue }[] = [];
    const adapter = {
        log: { warn: () => {} },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        setForeignStateAsync: async (id: string, val: ioBroker.StateValue) => {
            setForeignStateCalls.push({ id, val });
        },
    } as unknown as ioBroker.Adapter;
    return { adapter, setForeignStateCalls };
}

describe('GenericRelayDriver', () => {
    it('pulses the open relay and estimates position 0', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new GenericRelayDriver(adapter, 'foreign.open', 'foreign.close', 'foreign.stop');

        await driver.open();

        expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.open', val: true }]);
        expect(driver.getCurrentPosition()).to.equal(0);
    });

    it('pulses the close relay and estimates position 100', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new GenericRelayDriver(adapter, 'foreign.open', 'foreign.close', 'foreign.stop');

        await driver.close();

        expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.close', val: true }]);
        expect(driver.getCurrentPosition()).to.equal(100);
    });

    it('maps setPosition(0)/setPosition(100) to open/close', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new GenericRelayDriver(adapter, 'foreign.open', 'foreign.close', 'foreign.stop');

        await driver.setPosition(0);
        await driver.setPosition(100);

        expect(setForeignStateCalls).to.deep.equal([
            { id: 'foreign.open', val: true },
            { id: 'foreign.close', val: true },
        ]);
    });

    it('ignores an intermediate setPosition() and logs a warning', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new GenericRelayDriver(adapter, 'foreign.open', 'foreign.close', 'foreign.stop');

        await driver.setPosition(50);

        expect(setForeignStateCalls).to.deep.equal([]);
    });

    it('pulses the stop relay if configured', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new GenericRelayDriver(adapter, 'foreign.open', 'foreign.close', 'foreign.stop');

        await driver.stop();

        expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.stop', val: true }]);
    });

    it('stop() is a no-op if no stop relay is configured', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new GenericRelayDriver(adapter, 'foreign.open', 'foreign.close', undefined);

        await driver.stop();

        expect(setForeignStateCalls).to.deep.equal([]);
    });

    it('invalidates the best-effort position estimate on stop()', async () => {
        const { adapter } = createFakeAdapter();
        const driver = new GenericRelayDriver(adapter, 'foreign.open', 'foreign.close', 'foreign.stop');

        await driver.close();
        expect(driver.getCurrentPosition()).to.equal(100);

        await driver.stop();

        expect(driver.getCurrentPosition()).to.be.undefined;
    });

    it('reports its type, undefined getCurrentPosition() before any command, and undefined isMoving()', () => {
        const { adapter } = createFakeAdapter();
        const driver = new GenericRelayDriver(adapter, 'foreign.open', 'foreign.close', undefined);

        expect(driver.type).to.equal('generic-relay');
        expect(driver.getCurrentPosition()).to.be.undefined;
        expect(driver.isMoving()).to.be.undefined;
    });

    it('destroy() does not throw (no subscriptions held)', () => {
        const { adapter } = createFakeAdapter();
        const driver = new GenericRelayDriver(adapter, 'foreign.open', 'foreign.close', undefined);

        expect(() => driver.destroy()).to.not.throw();
    });
});
