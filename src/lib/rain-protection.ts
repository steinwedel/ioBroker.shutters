/**
 * Rain protection (plan section 7): closes coverings while rain is detected.
 * No hysteresis needed for the plain rain boolean itself - a boolean sensor
 * does not flicker the way a continuous measurement would. Optionally also
 * filtered by wind direction (see `IRainProtectionInputs.windDirectionToleranceDeg`),
 * so a covering only protects against rain that is actually being blown
 * toward its window, not rain anywhere at the property.
 */

import { isWithinOrientationWindow } from './sun-protection';

/** Evaluation inputs for `evaluateRainProtection()`. */
export interface IRainProtectionInputs {
    /** Current rain indicator, or undefined if not measured. */
    rain: boolean | undefined;
    /** Current wind speed in km/h, or undefined if not measured. */
    windSpeedKmh: number | undefined;
    /** Minimum wind speed in km/h required before using the direction filter. */
    minWindSpeedForDirectionKmh: number;
    /** Current wind direction in degrees (compass, clockwise from North), or undefined if not measured/configured. */
    windDirectionDeg: number | undefined;
    /** This covering's window orientation in degrees, see `IShutterConfig.orientation`; undefined if not configured. */
    orientationDeg: number | undefined;
    /**
     * `IShutterConfig.rainProtectionWindDirectionToleranceDeg`: tolerance (±°) around `orientationDeg`
     * counting as "wind is blowing rain toward this window". Undefined disables the wind-direction
     * filter entirely for this covering (previous, backwards-compatible behavior: protect on any rain,
     * regardless of direction).
     */
    windDirectionToleranceDeg: number | undefined;
}

/**
 * @param inputs - See `IRainProtectionInputs`.
 * @returns Whether rain protection should be active now.
 */
export function evaluateRainProtection(inputs: IRainProtectionInputs): boolean {
    if (inputs.rain !== true) {
        return false;
    }
    if (
        inputs.windDirectionToleranceDeg === undefined ||
        inputs.orientationDeg === undefined ||
        inputs.windSpeedKmh === undefined ||
        inputs.windSpeedKmh < inputs.minWindSpeedForDirectionKmh ||
        inputs.windDirectionDeg === undefined
    ) {
        // No filter configured, or a required input is currently unavailable - fail open towards
        // protection (the previous default), not away from it: better to needlessly close a covering
        // than to miss protecting one during genuine wind-driven rain.
        return true;
    }
    return isWithinOrientationWindow(
        inputs.windDirectionDeg,
        inputs.orientationDeg,
        -inputs.windDirectionToleranceDeg,
        inputs.windDirectionToleranceDeg,
    );
}
