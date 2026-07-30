/**
 * Frost protection (plan section 7b): suppresses automated movement during
 * freezing, damp conditions (to avoid ice damage), without forcing an
 * already-open or already-closed covering into a different position.
 *
 * Simplified relative to the plan: "damp" is approximated as either active
 * rain, or relative humidity at/above 80%, rather than a full dew-point
 * calculation.
 */
export interface IFrostProtectionEvaluation {
    /** Current outdoor temperature, °C, or undefined if not measured. */
    outdoorTemp: number | undefined;
    /** Current relative humidity, %, or undefined if not measured. */
    humidity: number | undefined;
    /** Current rain indicator, or undefined if not measured. */
    rain: boolean | undefined;
    /** Temperature threshold at/below which frost protection may activate. */
    threshold: number;
}

const DAMP_HUMIDITY_THRESHOLD_PERCENT = 80;

/**
 * @param input - Current evaluation inputs, see `IFrostProtectionEvaluation`.
 * @returns Whether frost protection should suppress automated movement now.
 */
export function evaluateFrostProtection(input: IFrostProtectionEvaluation): boolean {
    if (input.outdoorTemp === undefined || input.outdoorTemp > input.threshold) {
        return false;
    }
    if (input.rain === true) {
        return true;
    }
    return input.humidity !== undefined && input.humidity >= DAMP_HUMIDITY_THRESHOLD_PERCENT;
}
