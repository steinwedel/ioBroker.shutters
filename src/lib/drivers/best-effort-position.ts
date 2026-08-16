/**
 * Best-effort position estimate for drivers with no real position feedback at all (e.g. simple
 * open/close/stop relays, or a percent-capable system falling back to discrete open/close/stop
 * commands because no percentage DP/state is configured): assumes `open()`/`close()` complete
 * instantly to 0/100, and invalidates that estimate on `stop()`, since the actual resting position
 * after stopping mid-movement is genuinely unknown - leaving the previous 0/100 guess in place would
 * be actively misleading rather than merely imprecise. Shared by every driver that falls back to this
 * approximation, so this behavior only needs to be implemented (and fixed, if needed) once. See plan
 * section 2a.2.
 */
export class BestEffortPositionEstimate {
    private value: number | undefined;

    /** Records that the covering was just commanded to fully open (0%). */
    public markOpened(): void {
        this.value = 0;
    }

    /** Records that the covering was just commanded to fully close (100%). */
    public markClosed(): void {
        this.value = 100;
    }

    /**
     * Sets the current best-effort position estimate.
     *
     * @param value - Position estimate, 0-100.
     */
    public setValue(value: number): void {
        this.value = value;
    }

    /** Discards the current estimate, e.g. because movement was stopped before reaching either end. */
    public invalidate(): void {
        this.value = undefined;
    }

    /** @returns The current best-effort estimate, or undefined if unknown (never commanded yet, or invalidated by a stop). */
    public getValue(): number | undefined {
        return this.value;
    }
}
