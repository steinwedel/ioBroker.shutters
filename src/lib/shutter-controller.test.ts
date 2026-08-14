import { expect } from 'chai';
import sinon from 'sinon';
import { ShutterController } from './shutter-controller';
import type { IShutterConfig } from './types';

interface IFakeState {
    val: ioBroker.StateValue;
    ack: boolean;
}

interface IFakeTimer {
    callback: () => void;
    cancelled: boolean;
}

interface IFakeAdapterHandle {
    adapter: ioBroker.Adapter;
    /** Every `setForeignStateAsync` call, in order - i.e. every value actually sent to the (fake) driver. */
    setForeignStateCalls: { id: string; val: ioBroker.StateValue }[];
    /** Current value of one of this controller's own states, as last written via `setStateAsync`/`setStateChangedAsync`. */
    getOwnState: (id: string) => IFakeState | undefined;
    /** Simulates the driver reporting a new actual position on its configured `positionActual` state. */
    emitPositionActual: (id: string, val: number) => void;
    /** Number of motor-protection buffer timers currently pending (not yet fired/cancelled). */
    pendingTimerCount: () => number;
    /** Fires every currently pending timer once (like real timers, each only fires once). */
    runTimers: () => void;
}

/** Minimal fake adapter exposing only what `ShutterController` and its `PositionStopDriverBase`-derived driver need. */
function createFakeAdapter(): IFakeAdapterHandle {
    const states = new Map<string, IFakeState>();
    const setForeignStateCalls: { id: string; val: ioBroker.StateValue }[] = [];
    const listeners: ((id: string, state: ioBroker.State | null | undefined) => void)[] = [];
    const timers: IFakeTimer[] = [];

    function storeState(
        id: string,
        valueOrPatch: ioBroker.StateValue | { val: ioBroker.StateValue; ack?: boolean },
        ack?: boolean,
    ): void {
        if (valueOrPatch !== null && typeof valueOrPatch === 'object' && 'val' in valueOrPatch) {
            states.set(id, { val: valueOrPatch.val, ack: valueOrPatch.ack ?? false });
        } else {
            states.set(id, { val: valueOrPatch, ack: ack ?? false });
        }
    }

    const adapter = {
        log: { warn: () => {}, error: () => {}, info: () => {} },

        setObjectNotExistsAsync: async () => {},
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        setStateAsync: async (
            id: string,
            valueOrPatch: ioBroker.StateValue | { val: ioBroker.StateValue; ack?: boolean },
            ack?: boolean,
        ) => {
            storeState(id, valueOrPatch, ack);
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        setStateChangedAsync: async (id: string, val: ioBroker.StateValue, ack: boolean) => {
            storeState(id, val, ack);
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getStateAsync: async (id: string) => states.get(id) as ioBroker.State | undefined,

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

        setTimeout: (callback: () => void) => {
            const timer: IFakeTimer = { callback, cancelled: false };
            timers.push(timer);
            return timer as unknown as ioBroker.Timeout;
        },
        clearTimeout: (handle: ioBroker.Timeout) => {
            (handle as unknown as IFakeTimer).cancelled = true;
        },
    } as unknown as ioBroker.Adapter;

    return {
        adapter,
        setForeignStateCalls,
        getOwnState: (id: string) => states.get(id),
        emitPositionActual: (id: string, val: number) => {
            for (const listener of listeners) {
                listener(id, { val, ack: true } as ioBroker.State);
            }
        },
        pendingTimerCount: () => timers.filter(t => !t.cancelled).length,
        runTimers: () => {
            const toRun = timers.filter(t => !t.cancelled);
            timers.length = 0;
            for (const timer of toRun) {
                timer.callback();
            }
        },
    };
}

/**
 * Uses the `shelly` driver (identity position mapping, no LEVEL inversion like Homematic) to keep assertions simple.
 *
 * @param overrides - Fields to override on top of the defaults.
 */
function makeConfig(overrides: Partial<IShutterConfig> = {}): IShutterConfig {
    return {
        id: 'shutter1',
        name: 'Test Shutter',
        driverType: 'shelly',
        coveringType: 'rolladen',
        automationEnabled: true,
        states: { position: 'foreign.position', positionActual: 'foreign.positionActual', stop: 'foreign.stop' },
        ...overrides,
    };
}

describe('ShutterController', () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        clock = sinon.useFakeTimers({ now: new Date(2026, 6, 15, 12, 0, 0, 0).getTime() });
    });

    afterEach(() => {
        clock.restore();
    });

    describe('createObjects', () => {
        it('creates the sunProtectionOverrideUntil object without writing an initial value, so a persisted deadline survives a restart', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.createObjects();

            expect(getOwnState('shutters.shutter1.sunProtectionOverrideUntil')).to.be.undefined;
        });

        it('initializes automationEnabled and statusText', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ automationEnabled: true }));

            await controller.createObjects();

            expect(getOwnState('shutters.shutter1.automationEnabled')).to.deep.equal({ val: true, ack: true });
            expect(getOwnState('shutters.shutter1.statusText')?.val).to.equal('Idle');
        });
    });

    describe('sun-protection override persistence (plan section 9a.2)', () => {
        it('returns 0 when nothing has been persisted yet', async () => {
            const { adapter } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            expect(await controller.getPersistedSunProtectionOverrideUntil()).to.equal(0);
        });

        it('round-trips a persisted override deadline', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.setSunProtectionOverrideUntil(123_456);

            expect(await controller.getPersistedSunProtectionOverrideUntil()).to.equal(123_456);
            expect(getOwnState('shutters.shutter1.sunProtectionOverrideUntil')).to.deep.equal({
                val: 123_456,
                ack: true,
            });
        });
    });

    describe('motor-protection gate (plan section 7d)', () => {
        it('executes the first command immediately', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.commandPosition(50);

            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.position', val: 50 }]);
        });

        it('buffers commands within the cooldown and applies only the most recently requested one', async () => {
            const { adapter, setForeignStateCalls, runTimers } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.commandPosition(50);
            await controller.commandPosition(70); // within the cooldown - buffered
            await controller.commandPosition(80); // replaces the buffered 70, never fires itself

            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.position', val: 50 }]);

            clock.tick(8_000);
            runTimers();
            await Promise.resolve(); // let the buffered command's async execution settle

            expect(setForeignStateCalls).to.deep.equal([
                { id: 'foreign.position', val: 50 },
                { id: 'foreign.position', val: 80 },
            ]);
        });

        it('executes immediately once the configured cooldown has fully elapsed', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ minCommandIntervalMs: 1_000 }));

            await controller.commandPosition(50);
            clock.tick(1_000);
            await controller.commandPosition(80);

            expect(setForeignStateCalls).to.deep.equal([
                { id: 'foreign.position', val: 50 },
                { id: 'foreign.position', val: 80 },
            ]);
        });

        it('bypasses the cooldown entirely for wind protection', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.commandPosition(50);
            await controller.applyAutomatedPosition(0, 'Wind protection', true);

            expect(setForeignStateCalls).to.deep.equal([
                { id: 'foreign.position', val: 50 },
                { id: 'foreign.position', val: 0 },
            ]);
        });

        it('buffers non-wind automated commands like manual ones', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.commandPosition(50);
            await controller.applyAutomatedPosition(100, 'Rain protection');

            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.position', val: 50 }]);
        });

        it('commandStop() bypasses the cooldown and discards any buffered command', async () => {
            const { adapter, setForeignStateCalls, pendingTimerCount, runTimers } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.commandPosition(50);
            await controller.commandPosition(80); // buffered
            expect(pendingTimerCount()).to.equal(1);

            await controller.commandStop();
            expect(pendingTimerCount()).to.equal(0);

            clock.tick(60_000);
            runTimers(); // no-op: the buffered command was cancelled by commandStop()

            expect(setForeignStateCalls).to.deep.equal([
                { id: 'foreign.position', val: 50 },
                { id: 'foreign.stop', val: true },
            ]);
        });

        it('destroy() cancels any buffered command as well', async () => {
            const { adapter, setForeignStateCalls, runTimers } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.commandPosition(50);
            await controller.commandPosition(80); // buffered

            controller.destroy();
            clock.tick(60_000);
            runTimers();

            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.position', val: 50 }]);
        });

        it('notifies onManualCommand immediately even while the actual drive is buffered', async () => {
            const { adapter } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());
            let manualCommandCount = 0;
            controller.onManualCommand = () => manualCommandCount++;

            await controller.commandPosition(50);
            await controller.commandPosition(80); // buffered

            expect(manualCommandCount).to.equal(2);
        });

        it('does not notify onManualCommand for automated commands', async () => {
            const { adapter } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());
            let manualCommandCount = 0;
            controller.onManualCommand = () => manualCommandCount++;

            await controller.applyAutomatedPosition(50, 'Schedule');

            expect(manualCommandCount).to.equal(0);
        });
    });

    describe('watchdog (plan section 9a.1)', () => {
        it('reports a stuck covering once max runtime + grace period elapses without reaching the target', async () => {
            const { adapter, emitPositionActual, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));

            await controller.commandPosition(100);
            emitPositionActual('foreign.positionActual', 0); // never actually reaches the target

            clock.tick(10_000 + 30_000 + 1);
            await controller.refreshPosition();

            expect(getOwnState('shutters.shutter1.watchdogLastIssue')?.val).to.be.a('string');
            expect(getOwnState('shutters.shutter1.watchdogIssueCount')?.val).to.equal(1);
        });

        it('does not report an issue once the target has actually been reached', async () => {
            const { adapter, emitPositionActual, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));

            await controller.commandPosition(100);
            emitPositionActual('foreign.positionActual', 100);

            clock.tick(10_000 + 30_000 + 1);
            await controller.refreshPosition();

            expect(getOwnState('shutters.shutter1.watchdogLastIssue')).to.be.undefined;
        });

        it('does not report before max runtime + grace period has elapsed', async () => {
            const { adapter, emitPositionActual, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));

            await controller.commandPosition(100);
            emitPositionActual('foreign.positionActual', 0);

            clock.tick(10_000 + 30_000 - 1);
            await controller.refreshPosition();

            expect(getOwnState('shutters.shutter1.watchdogLastIssue')).to.be.undefined;
        });

        it('only reports once for the same stuck move (dedupe)', async () => {
            const { adapter, emitPositionActual, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));

            await controller.commandPosition(100);
            emitPositionActual('foreign.positionActual', 0);

            clock.tick(10_000 + 30_000 + 1);
            await controller.refreshPosition();
            await controller.refreshPosition();

            expect(getOwnState('shutters.shutter1.watchdogIssueCount')?.val).to.equal(1);
        });
    });

    describe('getConfig/isAutomationEnabled/getAreaId', () => {
        it('exposes the configuration and derived accessors', () => {
            const { adapter } = createFakeAdapter();
            const config = makeConfig({ areaId: 'area1', area: 'Legacy', automationEnabled: false });
            const controller = new ShutterController(adapter, config);

            expect(controller.getConfig()).to.equal(config);
            expect(controller.getAreaId()).to.equal('area1');
            expect(controller.getLegacyAreaName()).to.equal('Legacy');
            expect(controller.isAutomationEnabled()).to.equal(false);
        });
    });
});
