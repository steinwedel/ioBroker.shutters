import SunCalc from 'suncalc';

/**
 * Computes sunrise/sunset-based open/close times, see plans/shutters-adapter-plan.md, section 5
 * (dusk/dawn coupling - implemented here as an offset relative to sunrise/sunset, entered directly in
 * an area's open/close field, see `parseScheduleEntry` in scheduler.ts).
 *
 * Full iCal calendar override (also part of section 5) is not implemented yet - see the adapter
 * README/plan for the current status.
 */

/** Which astronomical sun event a schedule entry can be coupled to. */
export type SunEvent = 'sunrise' | 'sunset';

/**
 * Computes an offset sunrise or sunset time, used to open/close coverings a fixed number of minutes
 * before or after the actual sunrise/sunset (e.g. "open 30 minutes before sunrise" or "close 90 minutes
 * after sunset").
 *
 * @param date - Calendar day to compute the event for (only the date part is used).
 * @param latitude - Location latitude in degrees.
 * @param longitude - Location longitude in degrees.
 * @param event - Which sun event to compute: `'sunrise'` or `'sunset'`.
 * @param offsetMinutes - Minutes to add to (positive) or subtract from (negative) the computed time.
 * @returns The offset event time on `date`, or undefined if the location does not reach that event that day (e.g. polar day/night).
 */
export function computeSunEventTime(
    date: Date,
    latitude: number,
    longitude: number,
    event: SunEvent,
    offsetMinutes: number,
): Date | undefined {
    const times = SunCalc.getTimes(date, latitude, longitude);
    const base = event === 'sunrise' ? times.sunrise : times.sunset;
    if (!base || Number.isNaN(base.getTime())) {
        return undefined;
    }
    return new Date(base.getTime() + offsetMinutes * 60_000);
}
