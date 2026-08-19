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
     * regardless of direction). When set but the wind is currently too weak (or unmeasured) to trust
     * a direction reading, this covering does *not* protect - see `evaluateRainProtection()`.
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
    if (inputs.windDirectionToleranceDeg === undefined || inputs.orientationDeg === undefined) {
        // No wind-direction filter configured for this covering (or it has no orientation to filter
        // against) - protect on any rain, same as before the filter existed.
        return true;
    }
    if (
        inputs.windSpeedKmh === undefined ||
        inputs.windSpeedKmh < inputs.minWindSpeedForDirectionKmh ||
        inputs.windDirectionDeg === undefined
    ) {
        // A wind-direction filter IS configured for this covering, but the wind is too weak (or its
        // speed/direction is not currently measured) to trust a direction reading at all: assume the
        // rain is not being blown toward this specific window rather than closing it just in case -
        // closing every wind-direction-filtered covering whenever the wind happens to be calm would
        // defeat the point of configuring the filter in the first place.
        return false;
    }
    return isWithinOrientationWindow(
        inputs.windDirectionDeg,
        inputs.orientationDeg,
        -inputs.windDirectionToleranceDeg,
        inputs.windDirectionToleranceDeg,
    );
}
