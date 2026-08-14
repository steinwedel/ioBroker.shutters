import { parseTimeToday } from './scheduler';

/**
 * Primary sun protection approach (plan section 6.1): solar radiation
 * threshold plus a fixed daily time window plus flicker-free hysteresis.
 * The azimuth/elevation-based alternative (6.2) is not implemented yet.
 */

/**
 * @param now - Current time.
 * @param windowStart - Start of the time window, "HH:MM", or undefined for "always" (no restriction).
 * @param windowEnd - End of the time window, "HH:MM", or undefined for "always" (no restriction).
 * @returns Whether `now` lies within `[windowStart, windowEnd)` on the same calendar day. Returns true if no window is configured, or if either time fails to parse.
 */
export function isWithinTimeWindow(now: Date, windowStart: string | undefined, windowEnd: string | undefined): boolean {
    if (!windowStart || !windowEnd) {
        return true;
    }
    const start = parseTimeToday(windowStart, now);
    const end = parseTimeToday(windowEnd, now);
    if (!start || !end) {
        return true;
    }
    return now >= start && now < end;
}

export function isSunProtectionEligible(
    globalEnabled: boolean,
    coveringEnabled: boolean,
    isSummer: boolean,
    scheduleOpen: boolean,
    inWindow: boolean,
    overridden: boolean,
): boolean {
    return globalEnabled && coveringEnabled && isSummer && scheduleOpen && inWindow && !overridden;
}

/** Evaluation inputs for `evaluateSunProtection()`. */
export interface ISunProtectionEvaluation {
    /** Whether sun protection currently applies to this covering (inside its time window). */
    inWindow: boolean;
    /** Current solar radiation, W/m², or undefined if not measured. */
    solarRadiation: number | undefined;
    /** Solar radiation threshold at/above which sun protection closes. */
    closeThreshold: number;
    /** Whether the "may open again" hysteresis has been satisfied (see `BelowThresholdHysteresis`). */
    openAllowed: boolean;
    /** Whether sun protection was active on the previous evaluation, used to hold the current state in the dead zone between the two thresholds. */
    wasActive: boolean;
}

/**
 * @param input - Current evaluation inputs, see `ISunProtectionEvaluation`.
 * @returns Whether sun protection should be active now.
 */
export function evaluateSunProtection(input: ISunProtectionEvaluation): boolean {
    if (!input.inWindow) {
        return false;
    }
    if (input.solarRadiation === undefined) {
        return input.wasActive;
    }
    if (input.solarRadiation >= input.closeThreshold) {
        return true;
    }
    if (input.openAllowed) {
        return false;
    }
    return input.wasActive;
}
