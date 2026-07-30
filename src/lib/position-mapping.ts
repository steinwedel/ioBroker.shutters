/**
 * Maps between "covering height/extension" (what the user configures and
 * sees, 0-100 %) and "motor runtime" (what the driver actually needs to be
 * told to move to, 0-100 %), via a configurable piecewise-linear calibration
 * curve. This compensates for coverings where covering height is not
 * proportional to motor runtime (e.g. the last few percent of a roller
 * shutter closing take disproportionately long).
 *
 * See plans/shutters-adapter-plan.md, section 4.
 */

/** One calibration point: `coveringPercent` % of covering height/extension corresponds to `runtimePercent` % of motor runtime. */
export interface ICalibrationPoint {
    /** Covering height/extension, 0-100. */
    coveringPercent: number;
    /** Corresponding motor runtime, 0-100. */
    runtimePercent: number;
}

/** Identity curve (0 -> 0, 100 -> 100), used when no calibration has been configured. */
export const DEFAULT_CALIBRATION_CURVE: ICalibrationPoint[] = [
    { coveringPercent: 0, runtimePercent: 0 },
    { coveringPercent: 100, runtimePercent: 100 },
];

/**
 * Sorts and validates a calibration curve, falling back to the identity
 * curve if it is missing, has fewer than two points, or does not cover the
 * full 0-100 range.
 *
 * @param curve - Calibration points as configured by the user, if any.
 */
export function normalizeCurve(curve: ICalibrationPoint[] | undefined): ICalibrationPoint[] {
    if (!curve || curve.length < 2) {
        return DEFAULT_CALIBRATION_CURVE;
    }

    const sorted = [...curve].sort((a, b) => a.coveringPercent - b.coveringPercent);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (!first || !last || first.coveringPercent !== 0 || last.coveringPercent !== 100) {
        return DEFAULT_CALIBRATION_CURVE;
    }

    return sorted;
}

/**
 * Linearly interpolates `value` between two curve axes, using `fromKey` as
 * the input axis and `toKey` as the output axis.
 *
 * @param curve - Normalized calibration curve (at least 2 points, covering 0-100 on `fromKey`).
 * @param value - Input value to interpolate, 0-100.
 * @param fromKey - Which axis of the curve `value` is expressed in.
 * @param toKey - Which axis of the curve to return the interpolated value in.
 */
function interpolate(
    curve: ICalibrationPoint[],
    value: number,
    fromKey: keyof ICalibrationPoint,
    toKey: keyof ICalibrationPoint,
): number {
    const clamped = Math.min(100, Math.max(0, value));

    for (let i = 0; i < curve.length - 1; i++) {
        const a = curve[i];
        const b = curve[i + 1];
        if (!a || !b) {
            continue;
        }
        if (clamped >= a[fromKey] && clamped <= b[fromKey]) {
            const span = b[fromKey] - a[fromKey];
            if (span === 0) {
                return a[toKey];
            }
            const ratio = (clamped - a[fromKey]) / span;
            return a[toKey] + ratio * (b[toKey] - a[toKey]);
        }
    }

    // Should not be reached for a normalized curve (always covers 0-100), but
    // fall back to the closest endpoint just in case.
    const first = curve[0];
    const lastPoint = curve[curve.length - 1];
    if (!first || !lastPoint) {
        return clamped;
    }
    return clamped <= first.coveringPercent ? first[toKey] : lastPoint[toKey];
}

/**
 * Converts a desired covering height/extension (%) into the motor runtime (%)
 * the driver should be told to move to.
 *
 * @param coveringPercent - Desired covering height/extension, 0-100.
 * @param curve - Calibration curve to use; pass through `normalizeCurve()` first if in doubt.
 */
export function coveringToRuntime(coveringPercent: number, curve: ICalibrationPoint[]): number {
    return interpolate(curve, coveringPercent, 'coveringPercent', 'runtimePercent');
}

/**
 * Converts an actual motor runtime (%) reported by a driver back into the
 * corresponding covering height/extension (%) for display.
 *
 * @param runtimePercent - Actual motor runtime as reported by the driver, 0-100.
 * @param curve - Calibration curve to use; pass through `normalizeCurve()` first if in doubt.
 */
export function runtimeToCovering(runtimePercent: number, curve: ICalibrationPoint[]): number {
    return interpolate(curve, runtimePercent, 'runtimePercent', 'coveringPercent');
}
