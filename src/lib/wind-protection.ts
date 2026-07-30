/**
 * Wind/storm protection (plan section 7a): activates immediately once wind
 * speed reaches the upper threshold, deactivates only after wind has stayed
 * calm (below the lower threshold) continuously for a minimum duration -
 * same flicker-free hysteresis shape as sun protection.
 */
export interface IWindProtectionEvaluation {
    /** Current wind speed (or gust), km/h, or undefined if not measured. */
    windSpeed: number | undefined;
    /** Wind speed threshold at/above which wind protection activates. */
    openThreshold: number;
    /** Whether the "calm long enough to deactivate" hysteresis has been satisfied (see `BelowThresholdHysteresis`). */
    calmAllowed: boolean;
    /** Whether wind protection was active on the previous evaluation, used to hold the current state while calm hysteresis has not been satisfied yet. */
    wasActive: boolean;
}

/**
 * @param input - Current evaluation inputs, see `IWindProtectionEvaluation`.
 * @returns Whether wind protection should be active now.
 */
export function evaluateWindProtection(input: IWindProtectionEvaluation): boolean {
    if (input.windSpeed === undefined) {
        return input.wasActive;
    }
    if (input.windSpeed >= input.openThreshold) {
        return true;
    }
    if (input.calmAllowed) {
        return false;
    }
    return input.wasActive;
}
