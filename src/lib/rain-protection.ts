/**
 * Rain protection (plan section 7): closes coverings while rain is detected.
 * Simplest possible evaluation - no hysteresis needed since a boolean rain
 * sensor does not flicker the way a continuous measurement would.
 */

/**
 * @param rain - Current rain indicator, or undefined if not measured.
 * @returns Whether rain protection should be active now.
 */
export function evaluateRainProtection(rain: boolean | undefined): boolean {
    return rain === true;
}
