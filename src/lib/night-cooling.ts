/**
 * Summer night cooling (plan section 7c): the opposite of the regular evening close - deliberately
 * keeps a covering open overnight when it is warm inside and meaningfully cooler outside, so opening
 * a window behind it can actually cool the room down. A pure addition over the inspiration script,
 * which has no comfort-driven exception like this at all.
 *
 * Simplified relative to the plan: rather than a separate configurable "night window", this is
 * evaluated only when the daily schedule is about to command a close (see `automation.ts`) - which
 * already only happens in the evening/night per that covering's own plan, without needing a second,
 * separately configured time window that could drift out of sync with it.
 */
export interface INightCoolingEvaluation {
    /** Current indoor temperature of the covering's room/zone, °C, or undefined if not measured/configured. */
    indoorTemp: number | undefined;
    /** Current outdoor temperature, °C, or undefined if not measured. */
    outdoorTemp: number | undefined;
    /** Indoor temperature must be at/above this for night cooling to activate. */
    indoorMinTemp: number;
    /** Indoor temperature must exceed outdoor temperature by at least this much for night cooling to activate. */
    minDelta: number;
    /** Whether "today" currently counts as summer (same signal sun protection uses, plan section 6.1) - night cooling never applies outside summer. */
    isSummer: boolean;
}

/**
 * @param input - Current evaluation inputs, see `INightCoolingEvaluation`.
 * @returns Whether night cooling should keep/drive the covering open right now, overriding a schedule close.
 */
export function evaluateNightCooling(input: INightCoolingEvaluation): boolean {
    if (!input.isSummer || input.indoorTemp === undefined || input.outdoorTemp === undefined) {
        return false;
    }
    if (input.indoorTemp < input.indoorMinTemp) {
        return false;
    }
    return input.indoorTemp - input.outdoorTemp >= input.minDelta;
}
