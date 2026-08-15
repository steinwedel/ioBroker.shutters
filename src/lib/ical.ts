/**
 * iCal-driven daily-schedule overrides (plan section 5.1). Delegates all `.ics` parsing to the
 * official `ioBroker.ical` adapter - this module only consumes its standard `data.table` output
 * state and looks for events whose title follows a simple convention to override a single area's
 * (or every area's) opening/closing time for one specific calendar day.
 *
 * Title convention: `"<prefix>[: <area name>] <auf|zu> <HH:MM>"`, e.g.:
 * - `"Rolläden auf 07:00"` - overrides the opening time of every area for that day.
 * - `"Rolläden: Kinderzimmer auf 07:00"` - overrides only the "Kinderzimmer" area (matched
 *   case-insensitively against `IAreaScheduleConfig.name`; no match means the event is ignored
 *   rather than falling back to a global override).
 * - `"Rolläden: Kinderzimmer zu 20:30"` - same, for the closing time.
 *
 * Unlike the analogous `resolvePlanFromIcalTitle` in the irrigation adapter, `shutters` polls
 * `data.table` itself (see `main.ts`) instead of requiring the user to additionally maintain a
 * boolean trigger state.
 */

import type { IAreaScheduleConfig, IDaySchedule } from './types';

/** Which schedule action an `IIcalOverride` replaces for the day it applies to. */
export type IcalOverrideAction = 'open' | 'close';

/** One title-parsed override for a specific calendar day, see the module doc for the title convention. */
export interface IIcalOverride {
    /**
     * Area name this override applies to (matched case-insensitively against
     * `IAreaScheduleConfig.name` by `applyIcalOverrides`), or undefined for a global override that
     * applies to every area.
     */
    areaName: string | undefined;
    /** Which of the day's two schedule actions this override replaces. */
    action: IcalOverrideAction;
    /** Override time, "HH:MM" (24h) - directly usable as an `IDaySchedule.open`/`close` value. */
    time: string;
}

/**
 * One event as read from an `ioBroker.ical` instance's `data.table` state. Only the fields used
 * here are typed; the actual state contains more (location, description, ...).
 */
export interface IIcalTableEvent {
    /** Event title/summary. */
    event?: string;
    /**
     * Event start. `ioBroker.ical` returns `Date` objects from its own API, but by the time this
     * adapter reads `data.table` back through `getForeignStateAsync()` it has already been
     * serialized to JSON (a plain ISO string) at least once - a numeric epoch value is accepted
     * defensively as well, in case a differently configured/versioned instance serializes it
     * differently.
     */
    _date?: string | number;
}

const TIME_TOKEN = '(?:[01]?\\d|2[0-3]):[0-5]\\d';

/**
 * @param value - Raw string to escape for use inside a `RegExp` constructor.
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parses a single event title against the `"<prefix>[: <area name>] <auf|zu> <HH:MM>"` convention,
 * see the module doc.
 *
 * @param title - Raw event title/summary.
 * @param prefix - Configured `icalTitlePrefix` (e.g. `"Rolläden"`); matched case-insensitively. An empty/blank prefix never matches anything, since it would otherwise match every event's leading whitespace.
 * @returns The parsed override, or undefined if `title` does not match the convention (e.g. wrong prefix, unrelated event, invalid time).
 */
export function parseIcalOverrideTitle(title: string, prefix: string): IIcalOverride | undefined {
    const trimmedPrefix = prefix.trim();
    if (!trimmedPrefix) {
        return undefined;
    }

    const pattern = new RegExp(
        `^\\s*${escapeRegExp(trimmedPrefix)}\\s*(?:[:\\-–]\\s*(.+?)\\s+)?(auf|zu)\\s+(${TIME_TOKEN})\\s*$`,
        'iu',
    );
    const match = pattern.exec(title);
    if (!match) {
        return undefined;
    }

    const [, areaNameRaw, keyword, time] = match;
    return {
        areaName: areaNameRaw?.trim() || undefined,
        action: keyword?.toLowerCase() === 'auf' ? 'open' : 'close',
        time,
    };
}

/**
 * @param a - First date to compare.
 * @param b - Second date to compare.
 * @returns Whether `a` and `b` fall on the same local calendar day.
 */
function isSameCalendarDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Filters `events` down to those whose title matches the override convention (see
 * `parseIcalOverrideTitle`) and whose start date falls on `day`'s local calendar day - unlike the
 * "is this event currently running" check used elsewhere for time-window matching, these events
 * announce a day-level exception and so are matched purely by calendar day, not by a `now >= start
 * && now < end` time-window comparison.
 *
 * @param events - Raw entries from an `ioBroker.ical` instance's `data.table` state.
 * @param prefix - Configured `icalTitlePrefix`, forwarded to `parseIcalOverrideTitle`.
 * @param day - The calendar day to resolve overrides for (typically today).
 */
export function resolveIcalOverridesForDay(
    events: readonly IIcalTableEvent[],
    prefix: string,
    day: Date,
): IIcalOverride[] {
    const overrides: IIcalOverride[] = [];
    for (const event of events) {
        if (typeof event.event !== 'string' || event._date === undefined) {
            continue;
        }
        const eventDate = new Date(event._date);
        if (Number.isNaN(eventDate.getTime()) || !isSameCalendarDay(eventDate, day)) {
            continue;
        }
        const override = parseIcalOverrideTitle(event.event, prefix);
        if (override) {
            overrides.push(override);
        }
    }
    return overrides;
}

/**
 * Applies whichever of `overrides` target `area` (by name, case-insensitive) or every area (a
 * global override, see `IIcalOverride.areaName`) on top of `daySchedule`, replacing its `open`/
 * `close` field for each matching action. Overrides never remove an action outright: an area/action
 * combination with no matching override simply keeps `daySchedule`'s original value.
 *
 * @param daySchedule - The day schedule already resolved by `resolveDaySchedule` (weekday/weekend/holiday), before iCal overrides.
 * @param area - The area to apply overrides for; only `area.name` is used, matched case-insensitively.
 * @param overrides - Overrides for the current day, see `resolveIcalOverridesForDay`. If more than one override targets the same area/action, the last one in this array wins.
 */
export function applyIcalOverrides(
    daySchedule: IDaySchedule,
    area: IAreaScheduleConfig,
    overrides: readonly IIcalOverride[],
): IDaySchedule {
    if (overrides.length === 0) {
        return daySchedule;
    }

    let open = daySchedule.open;
    let close = daySchedule.close;
    for (const override of overrides) {
        if (override.areaName !== undefined && override.areaName.toLowerCase() !== area.name.toLowerCase()) {
            continue;
        }
        if (override.action === 'open') {
            open = override.time;
        } else {
            close = override.time;
        }
    }
    return { open, close };
}
