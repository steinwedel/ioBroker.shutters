import { expect } from 'chai';
import { EnoceanDriver } from './enocean-driver';
import { HmipDriver } from './hmip-driver';
import { HomematicDriver } from './homematic-driver';
import { HomeyDriver } from './homey-driver';
import { KnxDriver } from './knx-driver';
import { PositionStopDriverBase } from './position-stop-driver-base';
import { ShellyDriver } from './shelly-driver';
import { SomfyDriver } from './somfy-driver';
import { VelbusDriver } from './velbus-driver';
import { VeluxDriver } from './velux-driver';
import { Zigbee2MqttDriver, ZigbeeDriver } from './zigbee-driver';

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

describe('PositionStopDriverBase (via HomematicDriver)', () => {
    it('converts normalized positions to Homematic LEVEL values', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new HomematicDriver(adapter, 'hm-rpc.0.ABC.1.LEVEL', 'hm-rpc.0.ABC.1.LEVEL', undefined);

        await driver.setPosition(42);

        expect(setForeignStateCalls).to.deep.equal([{ id: 'hm-rpc.0.ABC.1.LEVEL', val: 58 }]);
    });

    it('opens with LEVEL 100 and closes with LEVEL 0', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new HomematicDriver(adapter, 'hm-rpc.0.ABC.1.LEVEL', 'hm-rpc.0.ABC.1.LEVEL', undefined);

        await driver.open();
        await driver.close();

        expect(setForeignStateCalls).to.deep.equal([
            { id: 'hm-rpc.0.ABC.1.LEVEL', val: 100 },
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

    describe('slat tilt (plan section 2a.5)', () => {
        it('setTilt() writes to the configured tilt state', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new IdentityDriver(
                adapter,
                'foreign.position',
                'foreign.position',
                undefined,
                'foreign.tilt',
            );

            await driver.setTilt(40);

            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.tilt', val: 40 }]);
        });

        it('setTilt() is a no-op when no tilt state is configured', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new IdentityDriver(adapter, 'foreign.position', 'foreign.position', undefined);

            await driver.setTilt(40);

            expect(setForeignStateCalls).to.deep.equal([]);
        });

        it('getCurrentTilt() tracks the actual-tilt state, defaulting to the tilt command state', () => {
            const { adapter, emitStateChange } = createFakeAdapter();
            const driver = new IdentityDriver(
                adapter,
                'foreign.position',
                'foreign.position',
                undefined,
                'foreign.tilt',
            );

            expect(driver.getCurrentTilt()).to.be.undefined;

            emitStateChange('foreign.tilt', 65);

            expect(driver.getCurrentTilt()).to.equal(65);
        });

        it('getCurrentTilt() reads from a dedicated tiltActual state when configured separately', () => {
            const { adapter, emitStateChange } = createFakeAdapter();
            const driver = new IdentityDriver(
                adapter,
                'foreign.position',
                'foreign.position',
                undefined,
                'foreign.tilt',
                'foreign.tiltActual',
            );

            emitStateChange('foreign.tilt', 65); // command state - must not be mistaken for the actual value
            expect(driver.getCurrentTilt()).to.be.undefined;

            emitStateChange('foreign.tiltActual', 80);
            expect(driver.getCurrentTilt()).to.equal(80);
        });

        it('getCurrentTilt() is always undefined when no tilt state is configured', () => {
            const { adapter } = createFakeAdapter();
            const driver = new IdentityDriver(adapter, 'foreign.position', 'foreign.position', undefined);

            expect(driver.getCurrentTilt()).to.be.undefined;
        });

        it('does not affect getCurrentPosition()/setPosition() - tilt is a fully independent axis', async () => {
            const { adapter, setForeignStateCalls, emitStateChange } = createFakeAdapter();
            const driver = new IdentityDriver(
                adapter,
                'foreign.position',
                'foreign.position',
                undefined,
                'foreign.tilt',
            );

            await driver.setPosition(30);
            emitStateChange('foreign.position', 30);
            await driver.setTilt(90);

            expect(driver.getCurrentPosition()).to.equal(30);
            expect(setForeignStateCalls).to.deep.equal([
                { id: 'foreign.position', val: 30 },
                { id: 'foreign.tilt', val: 90 },
            ]);
        });
    });

    it('tracks the actual position from state changes on the read-back state', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const driver = new HomematicDriver(adapter, 'hm-rpc.0.ABC.1.LEVEL', 'hm-rpc.0.ABC.1.LEVEL', undefined);

        expect(driver.getCurrentPosition()).to.be.undefined;

        emitStateChange('hm-rpc.0.ABC.1.LEVEL', 45);

        expect(driver.getCurrentPosition()).to.equal(55);
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

describe('HmipDriver (0-1 scale, inverted like classic Homematic)', () => {
    it('converts covering percent to the inverted 0-1 shutterLevel scale', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new HmipDriver(adapter, 'hmip.0.ABC.1.shutterLevel', 'hmip.0.ABC.1.shutterLevel', undefined);

        await driver.setPosition(25); // 25% closed -> 75% open -> 0.75

        expect(setForeignStateCalls).to.deep.equal([{ id: 'hmip.0.ABC.1.shutterLevel', val: 0.75 }]);
    });

    it('opens with shutterLevel 1 and closes with shutterLevel 0', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new HmipDriver(adapter, 'hmip.0.ABC.1.shutterLevel', 'hmip.0.ABC.1.shutterLevel', undefined);

        await driver.open();
        await driver.close();

        expect(setForeignStateCalls).to.deep.equal([
            { id: 'hmip.0.ABC.1.shutterLevel', val: 1 },
            { id: 'hmip.0.ABC.1.shutterLevel', val: 0 },
        ]);
    });

    it('converts a read-back shutterLevel back to covering percent', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const driver = new HmipDriver(adapter, 'hmip.0.ABC.1.shutterLevel', 'hmip.0.ABC.1.shutterLevel', undefined);

        emitStateChange('hmip.0.ABC.1.shutterLevel', 0.75); // 75% open -> 25% closed

        expect(driver.getCurrentPosition()).to.equal(25);
    });

    it('pulses a configured stop state', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new HmipDriver(
            adapter,
            'hmip.0.ABC.1.shutterLevel',
            'hmip.0.ABC.1.shutterLevel',
            'hmip.0.ABC.1.stop',
        );

        await driver.stop();

        expect(setForeignStateCalls).to.deep.equal([{ id: 'hmip.0.ABC.1.stop', val: true }]);
    });

    it('reports its type', () => {
        const { adapter } = createFakeAdapter();
        const driver = new HmipDriver(adapter, 'hmip.0.ABC.1.shutterLevel', 'hmip.0.ABC.1.shutterLevel', undefined);

        expect(driver.type).to.equal('hmip');
    });
});

describe('HomeyDriver (0-1 scale, inverted like classic Homematic)', () => {
    it('converts covering percent to the inverted windowcoverings_set scale', async () => {
        const { adapter, setForeignStateCalls } = createFakeAdapter();
        const driver = new HomeyDriver(
            adapter,
            'homey.0.device1.windowcoverings_set',
            'homey.0.device1.windowcoverings_state',
            undefined,
        );

        await driver.setPosition(30); // 30% closed -> 70% open -> 0.7

        expect(setForeignStateCalls).to.deep.equal([{ id: 'homey.0.device1.windowcoverings_set', val: 0.7 }]);
    });

    it('converts a read-back windowcoverings_state value back to covering percent', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const driver = new HomeyDriver(
            adapter,
            'homey.0.device1.windowcoverings_set',
            'homey.0.device1.windowcoverings_state',
            undefined,
        );

        emitStateChange('homey.0.device1.windowcoverings_state', 0.7); // 70% open -> 30% closed

        expect(driver.getCurrentPosition()).to.equal(30);
    });

    it('reports its type', () => {
        const { adapter } = createFakeAdapter();
        const driver = new HomeyDriver(
            adapter,
            'homey.0.device1.windowcoverings_set',
            'homey.0.device1.windowcoverings_state',
            undefined,
        );

        expect(driver.type).to.equal('homey');
    });
});

describe('identity-mapped drivers (Velux, EnOcean, Velbus, Somfy, KNX, Shelly, Zigbee, Zigbee2MQTT)', () => {
    const cases: {
        Driver: new (
            adapter: ioBroker.Adapter,
            position: string,
            positionActual: string,
            stop: string | undefined,
        ) => PositionStopDriverBase;
        type: string;
    }[] = [
        { Driver: VeluxDriver, type: 'velux' },
        { Driver: EnoceanDriver, type: 'enocean' },
        { Driver: VelbusDriver, type: 'velbus' },
        { Driver: SomfyDriver, type: 'somfy' },
        { Driver: KnxDriver, type: 'knx' },
        { Driver: ShellyDriver, type: 'shelly' },
        { Driver: ZigbeeDriver, type: 'zigbee' },
        { Driver: Zigbee2MqttDriver, type: 'zigbee2mqtt' },
    ];

    for (const { Driver, type } of cases) {
        it(`${type}: writes the position unchanged and reports its type`, async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const driver = new Driver(adapter, 'foreign.position', 'foreign.position', undefined);

            await driver.setPosition(42);

            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.position', val: 42 }]);
            expect(driver.type).to.equal(type);
        });
    }
});
