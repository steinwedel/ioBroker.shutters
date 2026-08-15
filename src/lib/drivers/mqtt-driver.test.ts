import { expect } from 'chai';
import { MqttDriver } from './mqtt-driver';

/** Minimal fake adapter exposing only what `MqttDriver` needs. */
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

describe('MqttDriver', () => {
    it('publishes the target position unchanged to the command topic', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new MqttDriver(adapter, 'mqtt.0.cover1.set', 'mqtt.0.cover1.position');

        await driver.setPosition(42);

        expect(setForeignStateCalls).to.deep.equal([{ id: 'mqtt.0.cover1.set', val: 42 }]);
    });

    it('publishes the literal OPEN/CLOSE/STOP commands to the same command topic', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new MqttDriver(adapter, 'mqtt.0.cover1.set', 'mqtt.0.cover1.position');

        await driver.open();
        await driver.close();
        await driver.stop();

        expect(setForeignStateCalls).to.deep.equal([
            { id: 'mqtt.0.cover1.set', val: 'OPEN' },
            { id: 'mqtt.0.cover1.set', val: 'CLOSE' },
            { id: 'mqtt.0.cover1.set', val: 'STOP' },
        ]);
    });

    it('tracks the actual position from numeric status-topic updates', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const driver = new MqttDriver(adapter, 'mqtt.0.cover1.set', 'mqtt.0.cover1.position');

        emitStateChange('mqtt.0.cover1.position', 55);

        expect(driver.getCurrentPosition()).to.equal(55);
    });

    it('ignores non-numeric status-topic updates (e.g. a string "open"/"closed" state)', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const driver = new MqttDriver(adapter, 'mqtt.0.cover1.set', 'mqtt.0.cover1.position');

        emitStateChange('mqtt.0.cover1.position', 'open');

        expect(driver.getCurrentPosition()).to.be.undefined;
    });

    it('ignores state changes for unrelated topics', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const driver = new MqttDriver(adapter, 'mqtt.0.cover1.set', 'mqtt.0.cover1.position');

        emitStateChange('mqtt.0.other.position', 99);

        expect(driver.getCurrentPosition()).to.be.undefined;
    });

    it('reports its type and undefined isMoving()', () => {
        const { adapter } = createFakeAdapter();
        const driver = new MqttDriver(adapter, 'mqtt.0.cover1.set', 'mqtt.0.cover1.position');

        expect(driver.type).to.equal('mqtt');
        expect(driver.isMoving()).to.be.undefined;
    });
});
