/**
 * Tracks the latest numeric value of a foreign state via a `stateChange` subscription. Every driver
 * that reads back an actual position/state from a foreign adapter used the exact same
 * subscribe-once/listen-forever/unsubscribe-on-destroy shape by hand; sharing it here means a
 * correctness fix (e.g. retrying a failed subscribe) only needs to be made in one place instead of in
 * every driver that needs read-back tracking. See plan section 2a.2.
 */
export class ForeignNumberTracker {
    private value: number | undefined;
    private readonly handler: (id: string, state: ioBroker.State | null | undefined) => void;

    /**
     * @param adapter - Adapter instance, used for foreign state subscription.
     * @param stateId - Foreign state to subscribe to and track.
     * @param driverName - Name used in the subscribe-failure warning log, e.g. `"TuyaDriver"`.
     * @param transform - Applied to every received numeric value before storing it, e.g. to invert/rescale a system-specific external convention back to this adapter's 0-100 covering percentage. Defaults to the identity function.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        stateId: string,
        driverName: string,
        private readonly transform: (value: number) => number = value => value,
    ) {
        this.handler = (id, state) => {
            if (id === stateId && state && typeof state.val === 'number') {
                this.value = this.transform(state.val);
            }
        };
        this.adapter.on('stateChange', this.handler);

        void this.adapter
            .subscribeForeignStatesAsync(stateId)
            .catch(err => this.adapter.log.warn(`${driverName}: subscribe failed: ${err}`));

        // Subscribing only delivers *future* changes - without also reading the state's current value
        // once up front, getValue() would stay undefined after every adapter (re)start until the
        // foreign state happens to change again, even though the underlying device may already be
        // reporting a perfectly valid position (this broke the watchdog-recovery reality-check right
        // after a restart, see plan section 9a.2, until an integration test surfaced it). Guarded by
        // `this.value === undefined` so a `stateChange` that arrives before this read resolves is never
        // overwritten by a possibly slightly older snapshot.
        void this.adapter
            .getForeignStateAsync(stateId)
            .then(state => {
                if (this.value === undefined && state && typeof state.val === 'number') {
                    this.value = this.transform(state.val);
                }
            })
            .catch(err => this.adapter.log.warn(`${driverName}: initial read of "${stateId}" failed: ${err}`));
    }

    /** @returns The last received (and transformed) value, or undefined if none has been received yet. */
    public getValue(): number | undefined {
        return this.value;
    }

    /** Unsubscribes the `stateChange` listener registered in the constructor. Call on driver `destroy()`. */
    public destroy(): void {
        this.adapter.removeListener('stateChange', this.handler);
    }
}
