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

/**
 * @param globalEnabled - Whether sun protection is enabled adapter-wide, see `IAutomationOptions.sunProtectionGlobalEnabled`.
 * @param coveringEnabled - Whether sun protection is enabled for this covering, see `IShutterConfig.sunProtectionEnabled`.
 * @param isSummer - Whether the configured summer/heating-period state currently reads "summer" (or no such state is configured).
 * @param scheduleOpen - Whether the daily schedule currently wants this covering open (0%).
 * @param inWindow - Whether the sun is currently within this covering's active window, see `isWithinTimeWindow()`/`isWithinOrientationWindow()`.
 * @param overridden - Whether a manual command has suspended sun protection until local midnight, see `AutomationEngine.handleManualCommand()`.
 * @returns Whether sun protection may currently apply to this covering, before evaluating the radiation threshold/hysteresis itself.
 */
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

/**
 * Orientation-based alternative to `isWithinTimeWindow()` (plan section 6.2): the sun is
 * "in front of" a facade facing `orientationDeg` (compass degrees, 0=N/90=E/180=S/270=W)
 * whenever its current azimuth lies within `toleranceDeg` on either side, e.g. a south-facing
 * window (`orientationDeg=180`) with the default 70° tolerance is active for azimuths 110-250°.
 *
 * @param sunAzimuthDeg - Current sun azimuth, compass degrees clockwise from North.
 * @param orientationDeg - Facade orientation, compass degrees clockwise from North (`IShutterConfig.orientation`).
 * @param toleranceDeg - Half-width of the active azimuth range around `orientationDeg`.
 * @returns Whether the sun's azimuth currently lies within `orientationDeg ± toleranceDeg`.
 */
export function isWithinOrientationWindow(
    sunAzimuthDeg: number,
    orientationDeg: number,
    toleranceDeg: number,
): boolean {
    const diff = Math.abs(((sunAzimuthDeg - orientationDeg + 540) % 360) - 180);
    return diff <= toleranceDeg;
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
