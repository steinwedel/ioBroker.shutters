import { expect } from 'chai';
import { TuyaDriver } from './tuya-driver';

/** Minimal fake adapter exposing only what `TuyaDriver` needs. */
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
        emitStateChange: (id: string, val: number) => {
            for (const listener of listeners) {
                listener(id, { val, ack: true } as ioBroker.State);
            }
        },
    };
}

describe('TuyaDriver', () => {
    describe('with percent_control configured', () => {
        it('writes the target position unchanged', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new TuyaDriver(adapter, 'tuya.0.dev1.1_101', 'tuya.0.dev1.1_102', undefined);

            await driver.setPosition(42);

            expect(setForeignStateCalls).to.deep.equal([{ id: 'tuya.0.dev1.1_101', val: 42 }]);
        });

        it('tracks the actual position from the percent_state read-back', () => {
            const { adapter, emitStateChange } = createFakeAdapter();
            const driver = new TuyaDriver(adapter, 'tuya.0.dev1.1_101', 'tuya.0.dev1.1_102', undefined);

            emitStateChange('tuya.0.dev1.1_102', 55);

            expect(driver.getCurrentPosition()).to.equal(55);
        });

        it('falls back to setPosition(0)/(100) for open/close when no control DP is configured', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new TuyaDriver(adapter, 'tuya.0.dev1.1_101', undefined, undefined);

            await driver.open();
            await driver.close();

            expect(setForeignStateCalls).to.deep.equal([
                { id: 'tuya.0.dev1.1_101', val: 0 },
                { id: 'tuya.0.dev1.1_101', val: 100 },
            ]);
        });

        it('prefers the control DP for open/close when both are configured', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new TuyaDriver(adapter, 'tuya.0.dev1.1_101', undefined, 'tuya.0.dev1.1_control');

            await driver.open();

            expect(setForeignStateCalls).to.deep.equal([{ id: 'tuya.0.dev1.1_control', val: 'open' }]);
        });
    });

    describe('without percent_control (control DP only)', () => {
        it('writes "open"/"close"/"stop" to the control DP', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new TuyaDriver(adapter, undefined, undefined, 'tuya.0.dev1.1_control');

            await driver.open();
            await driver.close();
            await driver.stop();

            expect(setForeignStateCalls).to.deep.equal([
                { id: 'tuya.0.dev1.1_control', val: 'open' },
                { id: 'tuya.0.dev1.1_control', val: 'close' },
                { id: 'tuya.0.dev1.1_control', val: 'stop' },
            ]);
        });

        it('maps setPosition(0)/setPosition(100) to open/close', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new TuyaDriver(adapter, undefined, undefined, 'tuya.0.dev1.1_control');

            await driver.setPosition(0);
            await driver.setPosition(100);

            expect(setForeignStateCalls).to.deep.equal([
                { id: 'tuya.0.dev1.1_control', val: 'open' },
                { id: 'tuya.0.dev1.1_control', val: 'close' },
            ]);
        });

        it('ignores an intermediate setPosition() and logs a warning', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new TuyaDriver(adapter, undefined, undefined, 'tuya.0.dev1.1_control');

            await driver.setPosition(50);

            expect(setForeignStateCalls).to.deep.equal([]);
        });

        it('tracks a best-effort position (0/100) from open()/close() when there is no percent feedback', async () => {
            const { adapter } = createFakeAdapter();
            const driver = new TuyaDriver(adapter, undefined, undefined, 'tuya.0.dev1.1_control');

            expect(driver.getCurrentPosition()).to.be.undefined;
            await driver.open();
            expect(driver.getCurrentPosition()).to.equal(0);
            await driver.close();
            expect(driver.getCurrentPosition()).to.equal(100);
        });

        it('invalidates the best-effort position estimate on stop()', async () => {
            const { adapter } = createFakeAdapter();
            const driver = new TuyaDriver(adapter, undefined, undefined, 'tuya.0.dev1.1_control');

            await driver.close();
            expect(driver.getCurrentPosition()).to.equal(100);

            await driver.stop();

            expect(driver.getCurrentPosition()).to.be.undefined;
        });
    });

    it('reports its type and undefined isMoving()', () => {
        const { adapter } = createFakeAdapter();
        const driver = new TuyaDriver(adapter, 'tuya.0.dev1.1_101', undefined, undefined);

        expect(driver.type).to.equal('tuya');
        expect(driver.isMoving()).to.be.undefined;
    });
});
