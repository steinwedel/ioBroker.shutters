import { expect } from 'chai';
import { createDriver } from './driver-factory';
import type { IShutterConfig } from '../types';

/** Minimal fake adapter satisfying every driver constructor's needs (`ForeignNumberTracker` subscribes immediately). */
function createFakeAdapter(): ioBroker.Adapter {
    return {
        subscribeForeignStatesAsync: async () => {},
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getForeignStateAsync: async () => undefined,
        setForeignStateAsync: async () => {},
        on: () => {},
        removeListener: () => {},
        log: { warn: () => {}, debug: () => {}, error: () => {}, info: () => {} },
    } as unknown as ioBroker.Adapter;
}

/** Same as `createFakeAdapter()`, but also records `setForeignStateAsync` calls and lets a test simulate a `stateChange` event, for verifying that config fields are actually wired through to the created driver instance. */
function createTrackingFakeAdapter(): {
    adapter: ioBroker.Adapter;
    setForeignStateCalls: { id: string; val: ioBroker.StateValue }[];
    emitStateChange: (id: string, val: number) => void;
} {
    const setForeignStateCalls: { id: string; val: ioBroker.StateValue }[] = [];
    const listeners: ((id: string, state: ioBroker.State | null | undefined) => void)[] = [];
    const adapter = {
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
        log: { warn: () => {}, debug: () => {}, error: () => {}, info: () => {} },
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

/**
 * @param overrides - Fields to override on top of a minimal valid config; `states` is shallow-merged separately.
 * @param states - Foreign state IDs to use for this config's `states` field.
 */
function makeConfig(
    overrides: Partial<IShutterConfig> = {},
    states: Record<string, string | undefined> = {},
): IShutterConfig {
    return {
        id: 'shutter1',
        name: 'Test Shutter',
        driverType: 'generic-position',
        coveringType: 'rolladen',
        automationEnabled: true,
        states,
        ...overrides,
    };
}

describe('driver-factory', () => {
    describe('position+stop driver types (plan section 2a.2)', () => {
        const positionStopTypes: IShutterConfig['driverType'][] = [
            'homematic',
            'hmip',
            'knx',
            'shelly',
            'zigbee',
            'zigbee2mqtt',
            'somfy',
            'velux',
            'enocean',
            'velbus',
            'homey',
        ];

        for (const driverType of positionStopTypes) {
            it(`creates a "${driverType}" driver when states.position is configured`, () => {
                const driver = createDriver(
                    createFakeAdapter(),
                    makeConfig({ driverType }, { position: 'foreign.position' }),
                );
                expect(driver.type).to.equal(driverType);
            });

            it(`throws for "${driverType}" when states.position is missing`, () => {
                expect(() => createDriver(createFakeAdapter(), makeConfig({ driverType }, {}))).to.throw(
                    /requires states\.position/,
                );
            });
        }

        it('wires states.tilt/tiltActual through to every position+stop driver (plan section 2a.5)', async () => {
            const { adapter, setForeignStateCalls, emitStateChange } = createTrackingFakeAdapter();
            const driver = createDriver(
                adapter,
                makeConfig(
                    { driverType: 'knx', coveringType: 'raffstore' },
                    { position: 'foreign.position', tilt: 'foreign.tilt', tiltActual: 'foreign.tiltActual' },
                ),
            );

            await driver.setTilt?.(55);
            emitStateChange('foreign.tiltActual', 70);

            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.tilt', val: 55 }]);
            expect(driver.getCurrentTilt?.()).to.equal(70);
        });

        it('wires invertPosition through to every position+stop driver (a single actuator wired opposite from its siblings)', async () => {
            const { adapter, setForeignStateCalls, emitStateChange } = createTrackingFakeAdapter();
            const driver = createDriver(
                adapter,
                makeConfig({ driverType: 'homematic', invertPosition: true }, { position: 'foreign.position' }),
            );

            // Homematic's own external convention is `100 - x`; invertPosition flips the covering
            // percentage once more on top of that, so a target of 85 (85% closed) becomes 100-(100-85)=85
            // externally instead of homematic's usual 100-85=15 - i.e. the two inversions cancel out.
            await driver.setPosition(85);
            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.position', val: 85 }]);

            // Round-trip: the device reporting back the same external value it was just commanded to
            // (85) must decode to the same covering percentage (85) that was requested.
            emitStateChange('foreign.position', 85);
            expect(driver.getCurrentPosition()).to.equal(85);
        });

        it('does not invert when invertPosition is left unset (default false)', async () => {
            const { adapter, setForeignStateCalls } = createTrackingFakeAdapter();
            const driver = createDriver(
                adapter,
                makeConfig({ driverType: 'homematic' }, { position: 'foreign.position' }),
            );

            await driver.setPosition(85);

            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.position', val: 15 }]);
        });

        it('leaves setTilt()/getCurrentTilt() as no-ops when states.tilt is not configured', async () => {
            const { adapter, setForeignStateCalls } = createTrackingFakeAdapter();
            const driver = createDriver(adapter, makeConfig({ driverType: 'knx' }, { position: 'foreign.position' }));

            await driver.setTilt?.(55);

            expect(setForeignStateCalls).to.deep.equal([]);
            expect(driver.getCurrentTilt?.()).to.be.undefined;
        });
    });

    describe('generic-position', () => {
        it('creates a driver when states.position is configured', () => {
            const driver = createDriver(
                createFakeAdapter(),
                makeConfig({ driverType: 'generic-position' }, { position: 'foreign.position' }),
            );
            expect(driver.type).to.equal('generic-position');
        });

        it('throws when states.position is missing', () => {
            expect(() =>
                createDriver(createFakeAdapter(), makeConfig({ driverType: 'generic-position' }, {})),
            ).to.throw(/requires states\.position/);
        });
    });

    describe('generic-relay', () => {
        it('creates a driver when states.open and states.close are configured', () => {
            const driver = createDriver(
                createFakeAdapter(),
                makeConfig({ driverType: 'generic-relay' }, { open: 'foreign.open', close: 'foreign.close' }),
            );
            expect(driver.type).to.equal('generic-relay');
        });

        it('throws when states.close is missing', () => {
            expect(() =>
                createDriver(
                    createFakeAdapter(),
                    makeConfig({ driverType: 'generic-relay' }, { open: 'foreign.open' }),
                ),
            ).to.throw(/requires states\.open and states\.close/);
        });

        it('throws when both states.open and states.close are missing', () => {
            expect(() => createDriver(createFakeAdapter(), makeConfig({ driverType: 'generic-relay' }, {}))).to.throw(
                /requires states\.open and states\.close/,
            );
        });
    });

    describe('tuya', () => {
        it('creates a driver when only states.position (percent_control) is configured', () => {
            const driver = createDriver(
                createFakeAdapter(),
                makeConfig({ driverType: 'tuya' }, { position: 'foreign.percent_control' }),
            );
            expect(driver.type).to.equal('tuya');
        });

        it('creates a driver when only states.control (open/close/stop DP) is configured', () => {
            const driver = createDriver(
                createFakeAdapter(),
                makeConfig({ driverType: 'tuya' }, { control: 'foreign.control' }),
            );
            expect(driver.type).to.equal('tuya');
        });

        it('throws when neither states.position nor states.control is configured', () => {
            expect(() => createDriver(createFakeAdapter(), makeConfig({ driverType: 'tuya' }, {}))).to.throw(
                /requires states\.position and\/or states\.control/,
            );
        });
    });

    describe('mqtt', () => {
        it('creates a driver when states.position is configured', () => {
            const driver = createDriver(
                createFakeAdapter(),
                makeConfig({ driverType: 'mqtt' }, { position: 'foreign.cmnd' }),
            );
            expect(driver.type).to.equal('mqtt');
        });

        it('throws when states.position is missing', () => {
            expect(() => createDriver(createFakeAdapter(), makeConfig({ driverType: 'mqtt' }, {}))).to.throw(
                /requires states\.position/,
            );
        });
    });

    describe('loxone', () => {
        it('creates a driver when states.up and states.down are configured', () => {
            const driver = createDriver(
                createFakeAdapter(),
                makeConfig({ driverType: 'loxone' }, { up: 'foreign.up', down: 'foreign.down' }),
            );
            expect(driver.type).to.equal('loxone');
        });

        it('throws when states.down is missing', () => {
            expect(() =>
                createDriver(createFakeAdapter(), makeConfig({ driverType: 'loxone' }, { up: 'foreign.up' })),
            ).to.throw(/requires states\.up and states\.down/);
        });
    });

    describe('unimplemented driverType', () => {
        it('throws a clear "not implemented" error', () => {
            expect(() =>
                createDriver(
                    createFakeAdapter(),
                    makeConfig({ driverType: 'does-not-exist' as IShutterConfig['driverType'] }, {}),
                ),
            ).to.throw(/is not implemented/);
        });
    });
});
