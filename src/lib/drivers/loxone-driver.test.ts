import { expect } from 'chai';
import { LoxoneDriver } from './loxone-driver';

/** Minimal fake adapter exposing only what `LoxoneDriver` needs. */
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

describe('LoxoneDriver', () => {
    describe('without direct percentage control (up/down impulses only)', () => {
        it('maps setPosition(0)/setPosition(100) to the up/down impulses', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                undefined,
                undefined,
            );

            await driver.setPosition(0);
            await driver.setPosition(100);

            expect(setForeignStateCalls).to.deep.equal([
                { id: 'loxone.0.blind1.up', val: true },
                { id: 'loxone.0.blind1.down', val: true },
            ]);
        });

        it('ignores an intermediate setPosition() and logs a warning', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                undefined,
                undefined,
            );

            await driver.setPosition(50);

            expect(setForeignStateCalls).to.deep.equal([]);
        });

        it('tracks a best-effort position (0/100) from open()/close()', async () => {
            const { adapter } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                undefined,
                undefined,
            );

            expect(driver.getCurrentPosition()).to.be.undefined;
            await driver.open();
            expect(driver.getCurrentPosition()).to.equal(0);
            await driver.close();
            expect(driver.getCurrentPosition()).to.equal(100);
        });

        it('invalidates the best-effort position estimate on stop()', async () => {
            const { adapter } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                undefined,
                undefined,
            );

            await driver.close();
            expect(driver.getCurrentPosition()).to.equal(100);

            await driver.stop();

            expect(driver.getCurrentPosition()).to.be.undefined;
        });

        it('stop() pulses both up and down together', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                undefined,
                undefined,
            );

            await driver.stop();

            expect(setForeignStateCalls).to.have.deep.members([
                { id: 'loxone.0.blind1.up', val: true },
                { id: 'loxone.0.blind1.down', val: true },
            ]);
            expect(setForeignStateCalls).to.have.length(2);
        });
    });

    describe('with a shade tilt state configured', () => {
        it('writes tilt commands and tracks shade read-back from the same state', async () => {
            const { adapter, setForeignStateCalls, emitStateChange } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                undefined,
                undefined,
                'loxone.0.blind1.shade',
            );

            await driver.setTilt(42);
            emitStateChange('loxone.0.blind1.shade', 58);

            expect(setForeignStateCalls).to.deep.equal([{ id: 'loxone.0.blind1.shade', val: 42 }]);
            expect(driver.getCurrentTilt()).to.equal(58);
        });

        it('uses a separately configured tilt read-back state', () => {
            const { adapter, emitStateChange } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                undefined,
                undefined,
                'loxone.0.blind1.shade',
                'loxone.0.blind1.shadeInfo',
            );

            emitStateChange('loxone.0.blind1.shade', 42);
            expect(driver.getCurrentTilt()).to.be.undefined;
            emitStateChange('loxone.0.blind1.shadeInfo', 58);
            expect(driver.getCurrentTilt()).to.equal(58);
        });
    });

    describe('with direct percentage control configured', () => {
        it('writes the target position unchanged, ignoring up/down', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                'loxone.0.blind1.position',
                undefined,
            );

            await driver.setPosition(42);

            expect(setForeignStateCalls).to.deep.equal([{ id: 'loxone.0.blind1.position', val: 42 }]);
        });

        it('tracks the actual position from the configured read-back state', () => {
            const { adapter, emitStateChange } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                'loxone.0.blind1.position',
                'loxone.0.blind1.info',
            );

            emitStateChange('loxone.0.blind1.info', 55);

            expect(driver.getCurrentPosition()).to.equal(55);
        });

        it('still pulses both up and down together for stop(), even with direct percentage control', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new LoxoneDriver(
                adapter,
                'loxone.0.blind1.up',
                'loxone.0.blind1.down',
                'loxone.0.blind1.position',
                undefined,
            );

            await driver.stop();

            expect(setForeignStateCalls).to.have.deep.members([
                { id: 'loxone.0.blind1.up', val: true },
                { id: 'loxone.0.blind1.down', val: true },
            ]);
        });
    });

    it('reports its type and undefined isMoving()', () => {
        const { adapter } = createFakeAdapter();
        const driver = new LoxoneDriver(adapter, 'loxone.0.blind1.up', 'loxone.0.blind1.down', undefined, undefined);

        expect(driver.type).to.equal('loxone');
        expect(driver.isMoving()).to.be.undefined;
    });
});
