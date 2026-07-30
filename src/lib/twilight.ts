import SunCalc from 'suncalc';

/**
 * Computes dusk-based closing times, see plans/shutters-adapter-plan.md,
 * section 5 (dusk/dawn coupling). Only civil dusk is used, since that is the
 * commonly desired "getting dark" trigger for closing shutters.
 *
 * Full iCal calendar override (also part of section 5) is not implemented
 * yet - see the adapter README/plan for the current status.
 */

/**
 * @param date - Calendar day to compute dusk for (only the date part is used).
 * @param latitude - Location latitude in degrees.
 * @param longitude - Location longitude in degrees.
 * @param offsetMinutes - Minutes to add to (or subtract from, if negative) the computed dusk time.
 * @returns The offset dusk time on `date`, or undefined if the location never reaches civil dusk that day (e.g. polar summer).
 */
export function computeDuskTime(
    date: Date,
    latitude: number,
    longitude: number,
    offsetMinutes: number,
): Date | undefined {
    const times = SunCalc.getTimes(date, latitude, longitude);
    const dusk = times.dusk;
    if (!dusk || Number.isNaN(dusk.getTime())) {
        return undefined;
    }
    return new Date(dusk.getTime() + offsetMinutes * 60_000);
}
