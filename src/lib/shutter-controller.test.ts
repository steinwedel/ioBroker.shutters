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
    /** The underlying state store, exposed so a test can simulate an adapter restart by handing it to a second `createFakeAdapter()` call - persisted (`ack: true`) states then survive, exactly like real ioBroker states across a restart. */
    states: Map<string, IFakeState>;
}

/**
 * Minimal fake adapter exposing only what `ShutterController` and its `PositionStopDriverBase`-derived driver need.
 *
 * @param states - Existing state store to reuse (see `IFakeAdapterHandle.states`); defaults to a fresh, empty one.
 * @param legacyObjects - Legacy direct state IDs that should appear as existing objects.
 */
function createFakeAdapter(
    states: Map<string, IFakeState> = new Map(),
    legacyObjects: Set<string> = new Set(),
): IFakeAdapterHandle {
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
        getObjectAsync: (id: string) =>
            Promise.resolve(legacyObjects.has(id) ? ({ type: 'state' } as ioBroker.Object) : undefined),
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
        states,
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

            expect(getOwnState('shutters.shutter1.protection.sunProtectionOverrideUntil')).to.be.undefined;
        });

        it('initializes observability and configuration mirror states', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(
                adapter,
                makeConfig({ automationEnabled: true, orientation: 180, areaId: 'living-room' }),
            );

            await controller.createObjects();

            expect(getOwnState('shutters.shutter1.configuration.automationEnabled')).to.deep.equal({
                val: true,
                ack: true,
            });
            expect(getOwnState('shutters.shutter1.status.statusText')?.val).to.equal('Idle');
            expect(getOwnState('shutters.shutter1.status.state')).to.deep.equal({ val: 1, ack: true });
            expect(getOwnState('shutters.shutter1.configuration.orientation')).to.deep.equal({ val: 180, ack: true });
            expect(getOwnState('shutters.shutter1.configuration.area')).to.deep.equal({
                val: 'living-room',
                ack: true,
            });
            expect(getOwnState('shutters.shutter1.configuration.driverType')).to.deep.equal({
                val: 'shelly',
                ack: true,
            });
            expect(getOwnState('shutters.shutter1.configuration.coveringType')).to.deep.equal({
                val: 'rolladen',
                ack: true,
            });
            expect(getOwnState('shutters.shutter1.protection.sunProtectionEnabled')).to.deep.equal({
                val: true,
                ack: true,
            });
            expect(getOwnState('shutters.shutter1.protection.rainProtectionEnabled')).to.deep.equal({
                val: true,
                ack: true,
            });
            expect(getOwnState('shutters.shutter1.protection.nightCoolingEnabled')).to.deep.equal({
                val: false,
                ack: true,
            });
        });

        it('migrates and accepts an existing legacy command state without creating one for fresh installations', async () => {
            const states = new Map<string, IFakeState>([['shutters.shutter1.position', { val: 25, ack: true }]]);
            const { adapter, getOwnState, setForeignStateCalls } = createFakeAdapter(
                states,
                new Set(['shutters.shutter1.position']),
            );
            const controller = new ShutterController(adapter, makeConfig());

            await controller.createObjects();
            expect(getOwnState('shutters.shutter1.control.position')).to.deep.equal({ val: 25, ack: true });
            expect(controller.getOwnStateIds()).to.include('shutters.shutter1.position');

            await controller.handleStateChange('shutters.shutter1.position', { val: 40, ack: false } as ioBroker.State);
            expect(setForeignStateCalls).to.deep.include({ id: 'foreign.position', val: 40 });
            expect(getOwnState('shutters.shutter1.position')).to.deep.equal({ val: 40, ack: true });
        });

        it('sets state to moving while a command is pending', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.commandPosition(50);

            expect(getOwnState('shutters.shutter1.status.state')).to.deep.equal({ val: 2, ack: true });
        });
    });

    describe('setDoorProtectionActive (plan section 3/7e)', () => {
        it('writes the doorProtectionActive state', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.setDoorProtectionActive(true);
            expect(getOwnState('shutters.shutter1.protection.doorProtectionActive')).to.deep.equal({
                val: true,
                ack: true,
            });

            await controller.setDoorProtectionActive(false);
            expect(getOwnState('shutters.shutter1.protection.doorProtectionActive')).to.deep.equal({
                val: false,
                ack: true,
            });
        });
    });

    describe('protection activity states', () => {
        it('sets all activity states false except active protections', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.setProtectionActivityStates({ rainProtection: true, nightCooling: true });

            expect(getOwnState('shutters.shutter1.protection.sunProtectionActive')).to.deep.equal({
                val: false,
                ack: true,
            });
            expect(getOwnState('shutters.shutter1.protection.rainProtectionActive')).to.deep.equal({
                val: true,
                ack: true,
            });
            expect(getOwnState('shutters.shutter1.protection.nightCoolingActive')).to.deep.equal({
                val: true,
                ack: true,
            });
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
            expect(getOwnState('shutters.shutter1.protection.sunProtectionOverrideUntil')).to.deep.equal({
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
            // Let the buffered command's async execution settle - it now awaits several
            // microtask-hops worth of state persistence (pendingMove tracking, plan section 9a.2)
            // before actually reaching the driver call being asserted on below.
            for (let i = 0; i < 10; i++) {
                await Promise.resolve();
            }

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

            expect(getOwnState('shutters.shutter1.diagnostics.watchdogLastIssue')?.val).to.be.a('string');
            expect(getOwnState('shutters.shutter1.diagnostics.watchdogIssueCount')?.val).to.equal(1);
        });

        it('does not report an issue once the target has actually been reached', async () => {
            const { adapter, emitPositionActual, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));

            await controller.commandPosition(100);
            emitPositionActual('foreign.positionActual', 100);

            clock.tick(10_000 + 30_000 + 1);
            await controller.refreshPosition();

            expect(getOwnState('shutters.shutter1.diagnostics.watchdogLastIssue')).to.be.undefined;
        });

        it('does not report before max runtime + grace period has elapsed', async () => {
            const { adapter, emitPositionActual, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));

            await controller.commandPosition(100);
            emitPositionActual('foreign.positionActual', 0);

            clock.tick(10_000 + 30_000 - 1);
            await controller.refreshPosition();

            expect(getOwnState('shutters.shutter1.diagnostics.watchdogLastIssue')).to.be.undefined;
        });

        it('only reports once for the same stuck move (dedupe)', async () => {
            const { adapter, emitPositionActual, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));

            await controller.commandPosition(100);
            emitPositionActual('foreign.positionActual', 0);

            clock.tick(10_000 + 30_000 + 1);
            await controller.refreshPosition();
            await controller.refreshPosition();

            expect(getOwnState('shutters.shutter1.diagnostics.watchdogIssueCount')?.val).to.equal(1);
        });

        it('invokes onWatchdogIssue with the same message written to watchdogLastIssue', async () => {
            const { adapter, emitPositionActual, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));
            const issues: string[] = [];
            controller.onWatchdogIssue = message => issues.push(message);

            await controller.commandPosition(100);
            emitPositionActual('foreign.positionActual', 0);

            clock.tick(10_000 + 30_000 + 1);
            await controller.refreshPosition();

            expect(issues).to.have.length(1);
            expect(issues[0]).to.equal(getOwnState('shutters.shutter1.diagnostics.watchdogLastIssue')?.val);
        });

        it('does not invoke onWatchdogIssue when no issue occurs', async () => {
            const { adapter, emitPositionActual } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));
            const issues: string[] = [];
            controller.onWatchdogIssue = message => issues.push(message);

            await controller.commandPosition(100);
            emitPositionActual('foreign.positionActual', 100);

            clock.tick(10_000 + 30_000 + 1);
            await controller.refreshPosition();

            expect(issues).to.deep.equal([]);
        });
    });

    describe('pending-move recovery across an adapter restart (plan section 9a.2)', () => {
        it('does nothing when no move was pending at restart', async () => {
            const { adapter, states } = createFakeAdapter();
            const controllerA = new ShutterController(adapter, makeConfig());
            await controllerA.createObjects();

            const { adapter: adapterB } = createFakeAdapter(states);
            const controllerB = new ShutterController(adapterB, makeConfig());
            // Must not throw, and must not fabricate a pending move out of nothing.
            await controllerB.createObjects();

            const issuesB: string[] = [];
            controllerB.onWatchdogIssue = message => issuesB.push(message);
            clock.tick(10_000 + 30_000 + 1);
            await controllerB.refreshPosition();
            expect(issuesB).to.deep.equal([]);
        });

        it('re-arms the watchdog for a move that is still stuck after restart, without resetting its grace period', async () => {
            const { adapter, states, emitPositionActual } = createFakeAdapter();
            const controllerA = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));
            await controllerA.createObjects();

            await controllerA.commandPosition(100);
            emitPositionActual('foreign.positionActual', 0); // never actually reaches the target before "restart"

            // The grace period has already fully elapsed by the time the adapter comes back up.
            clock.tick(10_000 + 30_000 + 1);

            const { adapter: adapterB, emitPositionActual: emitB } = createFakeAdapter(states);
            const controllerB = new ShutterController(adapterB, makeConfig({ maxRuntimeSecs: 10 }));
            const issuesB: string[] = [];
            controllerB.onWatchdogIssue = message => issuesB.push(message);
            await controllerB.createObjects();

            // The new driver instance does not know the real position until it receives one.
            emitB('foreign.positionActual', 0);
            await controllerB.refreshPosition();

            expect(issuesB).to.have.length(1);
        });

        it('silently resolves a move that actually finished while the adapter was stopped', async () => {
            const { adapter, states, emitPositionActual } = createFakeAdapter();
            const controllerA = new ShutterController(adapter, makeConfig({ maxRuntimeSecs: 10 }));
            await controllerA.createObjects();

            await controllerA.commandPosition(100);
            emitPositionActual('foreign.positionActual', 0);

            clock.tick(10_000 + 30_000 + 1);

            const {
                adapter: adapterB,
                emitPositionActual: emitB,
                getOwnState: getOwnStateB,
            } = createFakeAdapter(states);
            const controllerB = new ShutterController(adapterB, makeConfig({ maxRuntimeSecs: 10 }));
            const issuesB: string[] = [];
            controllerB.onWatchdogIssue = message => issuesB.push(message);
            await controllerB.createObjects();

            // The covering actually reached its target while the adapter was down.
            emitB('foreign.positionActual', 100);
            await controllerB.refreshPosition();

            expect(issuesB).to.deep.equal([]);
            expect(getOwnStateB('shutters.shutter1.diagnostics.pendingMoveTargetPercent')?.val).to.equal(-1);
        });
    });

    describe('activityLog (plan section 10a.8)', () => {
        function readActivityLog(getOwnState: (id: string) => IFakeState | undefined): unknown[] {
            const raw = getOwnState('shutters.shutter1.status.activityLog')?.val;
            return typeof raw === 'string' ? JSON.parse(raw) : [];
        }

        it('adds one entry per automated action, most recent first', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.applyAutomatedPosition(70, 'Sun protection');
            await controller.applyAutomatedPosition(0, 'Wind protection', true);

            const entries = readActivityLog(getOwnState);
            expect(entries).to.have.length(2);
            expect(entries[0]).to.deep.include({ reason: 'Wind protection', percent: 0 });
            expect(entries[1]).to.deep.include({ reason: 'Sun protection', percent: 70 });
            expect((entries[0] as { ts: number }).ts).to.be.a('number');
        });

        it('caps the log at 10 entries, dropping the oldest', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            for (let i = 0; i < 12; i++) {
                // bypassMotorProtection=true: this test is about the log itself, not the motor-protection cooldown (7d).
                await controller.applyAutomatedPosition(i, `Reason ${i}`, true);
            }

            const entries = readActivityLog(getOwnState);
            expect(entries).to.have.length(10);
            expect((entries[0] as { reason: string }).reason).to.equal('Reason 11');
            expect((entries[9] as { reason: string }).reason).to.equal('Reason 2');
        });

        it('does not log a manual command', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.commandPosition(50);

            expect(readActivityLog(getOwnState)).to.deep.equal([]);
        });

        it('recovers from a corrupted activityLog value instead of throwing', async () => {
            const { adapter, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());
            await adapter.setStateAsync('shutters.shutter1.status.activityLog', { val: 'not json', ack: true });

            await controller.applyAutomatedPosition(50, 'Schedule');

            const entries = readActivityLog(getOwnState);
            expect(entries).to.have.length(1);
            expect(entries[0]).to.deep.include({ reason: 'Schedule', percent: 50 });
        });
    });

    describe('tilt control (plan section 2a.5)', () => {
        it('does not create tilt/tiltActual objects when no tilt state is configured', async () => {
            const { adapter } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            await controller.createObjects();

            expect(controller.getOwnStateIds()).to.not.include('shutters.shutter1.control.tilt');
        });

        it('creates tilt/tiltActual objects and includes tilt in getOwnStateIds when configured', async () => {
            const { adapter } = createFakeAdapter();
            const controller = new ShutterController(
                adapter,
                makeConfig({
                    coveringType: 'raffstore',
                    states: {
                        position: 'foreign.position',
                        positionActual: 'foreign.positionActual',
                        stop: 'foreign.stop',
                        tilt: 'foreign.tilt',
                        tiltActual: 'foreign.tiltActual',
                    },
                }),
            );

            await controller.createObjects();

            expect(controller.getOwnStateIds()).to.include('shutters.shutter1.control.tilt');
        });

        it('commandTilt() forwards to the driver and acknowledges the tilt state', async () => {
            const { adapter, setForeignStateCalls, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(
                adapter,
                makeConfig({
                    coveringType: 'raffstore',
                    states: {
                        position: 'foreign.position',
                        positionActual: 'foreign.positionActual',
                        tilt: 'foreign.tilt',
                        tiltActual: 'foreign.tiltActual',
                    },
                }),
            );

            await controller.commandTilt(40);

            expect(setForeignStateCalls).to.deep.equal([{ id: 'foreign.tilt', val: 40 }]);
            expect(getOwnState('shutters.shutter1.control.tilt')).to.deep.include({ val: 40, ack: true });
        });

        it('commandTilt() notifies onManualCommand, same as other manual commands', async () => {
            const { adapter } = createFakeAdapter();
            const controller = new ShutterController(
                adapter,
                makeConfig({
                    states: {
                        position: 'foreign.position',
                        positionActual: 'foreign.positionActual',
                        tilt: 'foreign.tilt',
                    },
                }),
            );
            let manualCommandCount = 0;
            controller.onManualCommand = () => manualCommandCount++;

            await controller.commandTilt(20);

            expect(manualCommandCount).to.equal(1);
        });

        it('refreshPosition() updates tiltActual from the driver, independent of position feedback', async () => {
            const { adapter, emitPositionActual, getOwnState } = createFakeAdapter();
            const controller = new ShutterController(
                adapter,
                makeConfig({
                    coveringType: 'raffstore',
                    states: {
                        position: 'foreign.position',
                        positionActual: 'foreign.positionActual',
                        tilt: 'foreign.tilt',
                        tiltActual: 'foreign.tiltActual',
                    },
                }),
            );
            await controller.createObjects();

            emitPositionActual('foreign.tiltActual', 65);
            await controller.refreshPosition();

            expect(getOwnState('shutters.shutter1.status.tiltActual')?.val).to.equal(65);
        });

        it('does nothing when handleStateChange receives a tilt state change but no tilt is configured', async () => {
            const { adapter, setForeignStateCalls } = createFakeAdapter();
            const controller = new ShutterController(adapter, makeConfig());

            // Not configured, so getOwnStateIds() would never dispatch this in real use, but the
            // driver-level no-op (PositionStopDriverBase.setTilt()) must still not throw/write anything.
            const handled = await controller.handleStateChange('shutters.shutter1.control.tilt', {
                val: 30,
                ack: false,
            } as ioBroker.State);

            expect(handled).to.equal(true);
            expect(setForeignStateCalls).to.deep.equal([]);
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
