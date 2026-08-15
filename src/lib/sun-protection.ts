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
 * @param minTempSatisfied - Whether the optional heat-protection temperature filter (plan section 6.5, see `isHeatProtectionMinTempSatisfied()`) is satisfied; always `true` when `IShutterConfig.sunProtectionMinTemp` is unset.
 * @returns Whether sun protection may currently apply to this covering, before evaluating the radiation threshold/hysteresis itself.
 */
export function isSunProtectionEligible(
    globalEnabled: boolean,
    coveringEnabled: boolean,
    isSummer: boolean,
    scheduleOpen: boolean,
    inWindow: boolean,
    overridden: boolean,
    minTempSatisfied: boolean,
): boolean {
    return globalEnabled && coveringEnabled && isSummer && scheduleOpen && inWindow && !overridden && minTempSatisfied;
}

/**
 * Optional filter against unnecessary shading on bright but cool days (plan section 6.5): sun
 * protection may additionally require the outdoor temperature to reach a configurable threshold
 * (`IShutterConfig.sunProtectionMinTemp`) on top of the radiation/window condition - a clear but cool
 * day (e.g. in spring) has no overheating risk, so shading purely by radiation would otherwise feel
 * like a malfunction to the user ("why did the shutter come down, it's pleasant outside?").
 *
 * @param outdoorTemp - Current outdoor temperature, °C, or undefined if not measured.
 * @param minTemp - `IShutterConfig.sunProtectionMinTemp`, or undefined to disable this filter entirely (returns `true` unconditionally, matching the pre-6.5 behavior).
 * @returns Whether the temperature filter is satisfied (or disabled). If a threshold is configured but the temperature is unavailable, this returns `false` rather than assuming the filter passed - the whole point of this filter is to avoid unconfirmed shading, so an unknown temperature must not silently be treated as "warm enough".
 */
export function isHeatProtectionMinTempSatisfied(
    outdoorTemp: number | undefined,
    minTemp: number | undefined,
): boolean {
    if (minTemp === undefined) {
        return true;
    }
    return outdoorTemp !== undefined && outdoorTemp >= minTemp;
}

/**
 * Orientation-based alternative to `isWithinTimeWindow()` (plan section 6.2): the sun is
 * "in front of" a facade facing `orientationDeg` (compass degrees, 0=N/90=E/180=S/270=W)
 * whenever its current azimuth lies within `[orientationDeg + toleranceMinusDeg, orientationDeg +
 * tolerancePlusDeg]`, e.g. a south-facing window (`orientationDeg=180`) with the default -60°/+60°
 * bounds is active for azimuths 120-240°. The two bounds need not be symmetric.
 *
 * @param sunAzimuthDeg - Current sun azimuth, compass degrees clockwise from North.
 * @param orientationDeg - Facade orientation, compass degrees clockwise from North (`IShutterConfig.orientation`).
 * @param toleranceMinusDeg - Lower bound offset (typically negative, e.g. -60) relative to `orientationDeg`, see `IShutterConfig.orientationToleranceMinusDeg`.
 * @param tolerancePlusDeg - Upper bound offset (typically positive, e.g. 60) relative to `orientationDeg`, see `IShutterConfig.orientationTolerancePlusDeg`.
 * @returns Whether the sun's azimuth currently lies within `orientationDeg + [toleranceMinusDeg, tolerancePlusDeg]`.
 */
export function isWithinOrientationWindow(
    sunAzimuthDeg: number,
    orientationDeg: number,
    toleranceMinusDeg: number,
    tolerancePlusDeg: number,
): boolean {
    // Signed difference in (-180, 180], i.e. how far `sunAzimuthDeg` is ahead of (positive) or behind
    // (negative) `orientationDeg`, avoiding a naive subtraction breaking down near the 0°/360° wrap.
    const diff = ((sunAzimuthDeg - orientationDeg + 540) % 360) - 180;
    return diff >= toleranceMinusDeg && diff <= tolerancePlusDeg;
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
