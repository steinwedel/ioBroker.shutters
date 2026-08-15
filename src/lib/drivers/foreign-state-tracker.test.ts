import { expect } from 'chai';
import { ForeignNumberTracker } from './foreign-state-tracker';

/**
 * Minimal fake adapter exposing only what `ForeignNumberTracker` needs.
 *
 * @param initialStates - Values `getForeignStateAsync()` should resolve with, keyed by state ID; a missing key resolves to undefined (state does not exist yet).
 */
function createFakeAdapter(initialStates: Record<string, ioBroker.StateValue> = {}): {
    adapter: ioBroker.Adapter;
    subscribeCalls: string[];
    warnMessages: string[];
    emitStateChange: (id: string, val: ioBroker.StateValue) => void;
    removedListenerCount: number;
} {
    const subscribeCalls: string[] = [];
    const warnMessages: string[] = [];
    const listeners: ((id: string, state: ioBroker.State | null | undefined) => void)[] = [];
    let removedListenerCount = 0;

    const adapter = {
        log: { warn: (msg: string) => warnMessages.push(msg) },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        subscribeForeignStatesAsync: async (id: string) => {
            subscribeCalls.push(id);
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getForeignStateAsync: async (id: string) =>
            id in initialStates ? ({ val: initialStates[id], ack: true } as ioBroker.State) : undefined,
        on: (event: string, listener: (id: string, state: ioBroker.State | null | undefined) => void) => {
            if (event === 'stateChange') {
                listeners.push(listener);
            }
        },
        removeListener: () => {
            removedListenerCount++;
        },
    } as unknown as ioBroker.Adapter;

    return {
        adapter,
        subscribeCalls,
        warnMessages,
        emitStateChange: (id: string, val: ioBroker.StateValue) => {
            for (const listener of listeners) {
                listener(id, { val, ack: true } as ioBroker.State);
            }
        },
        get removedListenerCount() {
            return removedListenerCount;
        },
    };
}

describe('ForeignNumberTracker', () => {
    it('subscribes to the given state on construction', () => {
        const { adapter, subscribeCalls } = createFakeAdapter();
        new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');

        expect(subscribeCalls).to.deep.equal(['foreign.position']);
    });

    it('returns undefined synchronously before the initial read has resolved', () => {
        const { adapter } = createFakeAdapter({ 'foreign.position': 42 });
        const tracker = new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');

        // The initial getForeignStateAsync() read is asynchronous even against this fake adapter -
        // right after construction, nothing has had a chance to resolve yet.
        expect(tracker.getValue()).to.be.undefined;
    });

    it('reads the current value once on construction, without waiting for a stateChange', async () => {
        const { adapter } = createFakeAdapter({ 'foreign.position': 42 });
        const tracker = new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');

        await Promise.resolve();
        await Promise.resolve(); // let the initial getForeignStateAsync().then() chain settle

        expect(tracker.getValue()).to.equal(42);
    });

    it('applies the transform to the initial value read on construction, same as a later stateChange', async () => {
        const { adapter } = createFakeAdapter({ 'foreign.level': 30 });
        const tracker = new ForeignNumberTracker(adapter, 'foreign.level', 'TestDriver', value => 100 - value);

        await Promise.resolve();
        await Promise.resolve();

        expect(tracker.getValue()).to.equal(70);
    });

    it('stays undefined if the state does not exist yet at construction time', async () => {
        const { adapter } = createFakeAdapter();
        const tracker = new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');

        await Promise.resolve();
        await Promise.resolve();

        expect(tracker.getValue()).to.be.undefined;
    });

    it('does not let the initial read overwrite a value already received via a live stateChange', async () => {
        const { adapter, emitStateChange } = createFakeAdapter({ 'foreign.position': 10 });
        const tracker = new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');

        // A real update arrives before the initial getForeignStateAsync() read has resolved.
        emitStateChange('foreign.position', 99);
        await Promise.resolve();
        await Promise.resolve();

        expect(tracker.getValue()).to.equal(99);
    });

    it('returns undefined before any value has been received', () => {
        const { adapter } = createFakeAdapter();
        const tracker = new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');

        expect(tracker.getValue()).to.be.undefined;
    });

    it('tracks numeric updates for the tracked state', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const tracker = new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');

        emitStateChange('foreign.position', 42);

        expect(tracker.getValue()).to.equal(42);
    });

    it('ignores updates for unrelated states', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const tracker = new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');

        emitStateChange('foreign.other', 99);

        expect(tracker.getValue()).to.be.undefined;
    });

    it('ignores non-numeric updates for the tracked state', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const tracker = new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');

        emitStateChange('foreign.position', 'open');

        expect(tracker.getValue()).to.be.undefined;
    });

    it('applies the given transform to every received value', () => {
        const { adapter, emitStateChange } = createFakeAdapter();
        const tracker = new ForeignNumberTracker(adapter, 'foreign.level', 'TestDriver', value => 100 - value);

        emitStateChange('foreign.level', 30);

        expect(tracker.getValue()).to.equal(70);
    });

    it('removes the stateChange listener on destroy()', () => {
        const fake = createFakeAdapter();
        const tracker = new ForeignNumberTracker(fake.adapter, 'foreign.position', 'TestDriver');

        tracker.destroy();

        expect(fake.removedListenerCount).to.equal(1);
    });

    it('logs a warning (with the given driver name) if the subscribe call fails', async () => {
        const warnMessages: string[] = [];
        const adapter = {
            log: { warn: (msg: string) => warnMessages.push(msg) },
            // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous throw for this test double
            subscribeForeignStatesAsync: async () => {
                throw new Error('boom');
            },
            // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
            getForeignStateAsync: async () => undefined,
            on: () => {},
        } as unknown as ioBroker.Adapter;

        new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');
        await Promise.resolve(); // let the rejected promise's .catch() run

        expect(warnMessages).to.have.length(1);
        expect(warnMessages[0]).to.include('TestDriver');
    });

    it('logs a warning (with the state ID) if the initial read fails', async () => {
        const warnMessages: string[] = [];
        const adapter = {
            log: { warn: (msg: string) => warnMessages.push(msg) },
            subscribeForeignStatesAsync: async () => {},
            // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous throw for this test double
            getForeignStateAsync: async () => {
                throw new Error('boom');
            },
            on: () => {},
        } as unknown as ioBroker.Adapter;

        new ForeignNumberTracker(adapter, 'foreign.position', 'TestDriver');
        await Promise.resolve();
        await Promise.resolve();

        expect(warnMessages).to.have.length(1);
        expect(warnMessages[0]).to.include('foreign.position');
    });
});
