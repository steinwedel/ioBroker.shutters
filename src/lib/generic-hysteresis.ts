/**
 * Tracks how long a value has stayed below a threshold, used as the "may
 * relax now" hysteresis in sun protection (6.1) and wind protection (7a):
 * both close/activate immediately once their upper threshold is exceeded,
 * but only reopen/deactivate once the value has stayed below a lower
 * threshold continuously for a minimum duration - avoiding rapid toggling
 * around a single threshold.
 */
export class BelowThresholdHysteresis {
    private belowSinceMs: number | undefined;

    /**
     * @param value - Current measurement, or undefined if unavailable (resets the hysteresis).
     * @param threshold - Value must stay below this to count as "below".
     * @param minDurationMs - How long `value` must have stayed below `threshold` before this returns true.
     * @param nowMs - Current time in ms since epoch; defaults to `Date.now()`, overridable for tests.
     * @returns True once `value` has been continuously below `threshold` for at least `minDurationMs`.
     */
    public update(
        value: number | undefined,
        threshold: number,
        minDurationMs: number,
        nowMs: number = Date.now(),
    ): boolean {
        if (value === undefined || value >= threshold) {
            this.belowSinceMs = undefined;
            return false;
        }

        if (this.belowSinceMs === undefined) {
            this.belowSinceMs = nowMs;
        }

        return nowMs - this.belowSinceMs >= minDurationMs;
    }

    /** Resets the tracked "below since" timestamp, as if `value` had just risen above the threshold. */
    public reset(): void {
        this.belowSinceMs = undefined;
    }
}
