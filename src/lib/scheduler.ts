import type { IAreaScheduleConfig, IDaySchedule, WeekdayName } from './types';
import { computeSunEventTime } from './twilight';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const OFFSET_MINUTES_RE = /^([+-])(\d+)(d)?$/i;
const OFFSET_DURATION_RE = /^([+-])(\d+):([0-5]\d)(d)?$/i;

/** `Date.getDay()` index (0 = Sunday) to `WeekdayName`, used to look up `IAreaScheduleConfig.days`. */
const WEEKDAY_NAMES: WeekdayName[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Parses a "HH:MM" string into a Date on the same calendar day as `now`.
 *
 * @param timeString - Time in "HH:MM" (24h) format.
 * @param now - Reference date; only its year/month/day are used.
 */
export function parseTimeToday(timeString: string, now: Date): Date | undefined {
    const match = TIME_RE.exec(timeString.trim());
    if (!match) {
        return undefined;
    }
    const result = new Date(now);
    result.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return result;
}

/** An area's open/close schedule entry, parsed from the plain string the user enters. */
export type ScheduleEntry =
    | { kind: 'time'; time: Date }
    | { kind: 'sunOffset'; minutes: number; useTwilight: boolean }
    | { kind: 'sunOffsetCapped'; minutes: number; useTwilight: boolean; capTime: Date };

/** A parsed offset token: signed minutes, and whether the trailing `d` (dawn/dusk) modifier was present. */
interface OffsetToken {
    minutes: number;
    useTwilight: boolean;
}

/**
 * Parses the leading `+`/`-` offset token of a schedule entry: plain minutes or an "HH:MM" duration,
 * optionally followed by a `d` modifier that selects civil dawn/dusk instead of sunrise/sunset.
 *
 * @param token - The offset token, e.g. "-30", "+01:30", "-30d" or "+01:30d".
 * @returns The parsed offset, or undefined if `token` is not a valid offset.
 */
function parseOffsetToken(token: string): OffsetToken | undefined {
    const durationMatch = OFFSET_DURATION_RE.exec(token);
    if (durationMatch) {
        const minutes = Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
        return {
            minutes: durationMatch[1] === '-' ? -minutes : minutes,
            useTwilight: durationMatch[4] !== undefined,
        };
    }

    const minutesMatch = OFFSET_MINUTES_RE.exec(token);
    if (minutesMatch) {
        const minutes = Number(minutesMatch[2]);
        return {
            minutes: minutesMatch[1] === '-' ? -minutes : minutes,
            useTwilight: minutesMatch[3] !== undefined,
        };
    }

    return undefined;
}

/**
 * Parses an area's open/close schedule value. Three formats are accepted:
 * - A plain "HH:MM" (24h) clock time, e.g. "07:30".
 * - A leading `+`/`-` offset relative to sunrise (for the opening time) or sunset (for the closing
 *   time), given either as plain minutes (e.g. "-30", "+90") or as an "HH:MM" duration (e.g. "-00:30",
 *   "+01:30"). Appending `d` (e.g. "-30d", "+01:30d") couples to civil dawn/dusk instead of the actual
 *   sunrise/sunset.
 * - The above offset followed by `!` and a plain "HH:MM" cap time, e.g. "+30!19:00" ("30 minutes after
 *   the sun event, but never later than 19:00" - the cap always wins if the offset time would be later
 *   than the cap, for both opening and closing), or "+30d!19:00" for the dawn/dusk variant.
 *
 * @param value - Raw string entered by the user for an open/close field.
 * @param now - Reference date; only its year/month/day are used for the "time"/cap variants.
 */
export function parseScheduleEntry(value: string, now: Date): ScheduleEntry | undefined {
    const trimmed = value.trim();

    const bangIndex = trimmed.indexOf('!');
    if (bangIndex >= 0) {
        const offsetToken = trimmed.slice(0, bangIndex).trim();
        const capToken = trimmed.slice(bangIndex + 1).trim();
        const offset = parseOffsetToken(offsetToken);
        const capTime = parseTimeToday(capToken, now);
        if (!offset || !capTime) {
            return undefined;
        }
        return { kind: 'sunOffsetCapped', minutes: offset.minutes, useTwilight: offset.useTwilight, capTime };
    }

    const offset = parseOffsetToken(trimmed);
    if (offset) {
        return { kind: 'sunOffset', minutes: offset.minutes, useTwilight: offset.useTwilight };
    }

    const time = parseTimeToday(trimmed, now);
    if (time) {
        return { kind: 'time', time };
    }

    return undefined;
}

/**
 * Picks the actual target time for a capped sun-offset entry: the sun-event-relative time if it is
 * earlier than the cap (or if it could not be computed at all, e.g. missing location), otherwise the
 * cap itself. This makes the cap act as a "never later than" safety bound in both directions.
 *
 * @param sunTarget - The computed sunrise/sunset-relative time, or undefined if it could not be computed.
 * @param capTime - The configured cap time.
 */
export function pickSunOffsetCappedTarget(sunTarget: Date | undefined, capTime: Date): Date {
    if (!sunTarget || sunTarget.getTime() >= capTime.getTime()) {
        return capTime;
    }
    return sunTarget;
}

/**
 * Picks the applicable day schedule for `area` on `now`'s calendar day, depending on `area.scheduleMode`
 * (defaulting to `'weekdayWeekend'` if undefined):
 * - `'uniform'`: always `area.weekday`, even on public holidays.
 * - `'weekdayWeekend'`: `area.holiday` on public holidays (falling back to `area.weekend` if `holiday`
 *   is undefined), otherwise `area.weekend` on Saturday/Sunday and `area.weekday` on other days.
 * - `'perWeekday'`: `area.holiday` on public holidays (falling back to today's own entry in `area.days`
 *   if `holiday` is undefined), otherwise `area.days[<today's weekday>]` (or `{}`, i.e. no action for
 *   either field, if that weekday has no entry).
 *
 * @param area - Area whose day schedule to resolve.
 * @param now - Reference date, used to determine today's weekday (Sunday/Saturday count as weekend).
 * @param isPublicHoliday - Whether `now`'s calendar day is a public holiday.
 */
export function resolveDaySchedule(area: IAreaScheduleConfig, now: Date, isPublicHoliday: boolean): IDaySchedule {
    const mode = area.scheduleMode ?? 'weekdayWeekend';

    if (mode === 'uniform') {
        return area.weekday;
    }

    if (mode === 'perWeekday') {
        const todaysEntry = area.days?.[WEEKDAY_NAMES[now.getDay()]] ?? {};
        if (isPublicHoliday) {
            // A public holiday is treated like a non-working day: fall back to today's own entry if no
            // dedicated holiday schedule is set, mirroring the weekend fallback in 'weekdayWeekend' mode.
            return area.holiday ?? todaysEntry;
        }
        return todaysEntry;
    }

    // 'weekdayWeekend'
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    if (isPublicHoliday) {
        return area.holiday ?? area.weekend;
    }
    return isWeekend ? area.weekend : area.weekday;
}

export type ScheduleAction = 'open' | 'close';

/**
 * Daily schedule engine: for each configured area, determines today's
 * applicable open/close times and fires a callback at those times. Recomputes itself once per day
 * shortly after midnight, so day-category changes (e.g. into/out of a public holiday) are picked up
 * automatically. Which fields determine a given day's schedule depends on the area's `scheduleMode` -
 * uniform (all days the same), weekday/weekend/holiday, or a separate schedule per weekday plus holiday
 * - see `resolveDaySchedule`.
 *
 * Each open/close field accepts a plain "HH:MM" clock time, an offset relative to sunrise (opening) /
 * sunset (closing) written with a leading `+`/`-` sign as plain minutes (e.g. "-30") or an "HH:MM"
 * duration (e.g. "+01:30"), optionally with a trailing `d` to couple to civil dawn/dusk instead (e.g.
 * "-30d"), or any of the above combined with a "!HH:MM" cap (e.g. "+30!19:00" or "+30d!19:00" = 30
 * minutes after the event, but never later than 19:00) - see `parseScheduleEntry`. No separate
 * configuration fields are needed for this; the format of the string itself is what distinguishes the
 * variants.
 *
 * iCal calendar overrides are not implemented yet, see plan section 5 (M4).
 */
export class Scheduler {
    private timers: ioBroker.Timeout[] = [];

    /**
     * @param adapter - Adapter instance, used for `setTimeout`/`clearTimeout` (never native Node timers, see AGENTS.md).
     * @param areas - Areas to schedule.
     * @param isPublicHoliday - Returns whether "today" currently counts as a public holiday. The
     *   adapter derives this from a single configured boolean state (`native.holidayStateId`), e.g. an
     *   iCal/calendar adapter's "is public holiday" indicator - this class only needs the current
     *   boolean value, not how it was computed.
     * @param location - Latitude/longitude used for sunrise/sunset-relative entries; undefined disables them (they are then skipped with a warning).
     * @param onTrigger - Called when an area's open/close time is reached.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly areas: IAreaScheduleConfig[],
        private readonly isPublicHoliday: () => boolean,
        private readonly location: { latitude: number; longitude: number } | undefined,
        private readonly onTrigger: (area: IAreaScheduleConfig, action: ScheduleAction) => void,
    ) {}

    /** (Re-)schedules all areas for the remainder of today, and arranges the next midnight recompute. */
    public start(): void {
        this.scheduleAll();
    }

    /**
     * Resolves which action (open/close) should currently be in effect for `area`, based on today's
     * schedule and which of today's open/close times already lie in the past. Used at adapter startup
     * to immediately reconcile each covering's position instead of waiting for the next future timer
     * (which `scheduleAt()` deliberately does not fire for already-past times) or, worse, for tomorrow's
     * recompute if today's trigger time has already passed.
     *
     * @param area - Area to resolve the current action for.
     * @param now - Current time.
     * @returns `'open'` or `'close'`, whichever of today's already-past open/close times is the most
     *   recent, or undefined if neither has passed yet today (or neither is scheduled at all).
     */
    public resolveCurrentAction(area: IAreaScheduleConfig, now: Date): ScheduleAction | undefined {
        const daySchedule = this.resolveTodaySchedule(area, now);
        const openTime = this.resolveActionTime(area, 'open', daySchedule.open, now);
        const closeTime = this.resolveActionTime(area, 'close', daySchedule.close, now);

        const passed: { time: Date; action: ScheduleAction }[] = [];
        if (openTime && openTime.getTime() <= now.getTime()) {
            passed.push({ time: openTime, action: 'open' });
        }
        if (closeTime && closeTime.getTime() <= now.getTime()) {
            passed.push({ time: closeTime, action: 'close' });
        }
        if (passed.length === 0) {
            return undefined;
        }
        // Whichever of today's already-past times is the most recent wins, regardless of open/close order.
        passed.sort((a, b) => b.time.getTime() - a.time.getTime());
        return passed[0].action;
    }

    /** Clears all pending timers. Call on adapter unload. */
    public stop(): void {
        this.clearTimers();
    }

    private scheduleAll(): void {
        this.clearTimers();
        const now = new Date();

        for (const area of this.areas) {
            if (!area.id) {
                this.adapter.log.warn(`Scheduler: area "${area.name}" has no ID - skipped.`);
                continue;
            }
            const daySchedule = this.resolveTodaySchedule(area, now);
            this.scheduleAction(area, 'open', daySchedule.open, now);
            this.scheduleAction(area, 'close', daySchedule.close, now);
        }

        this.scheduleMidnightRecompute(now);
    }

    /**
     * Picks the applicable day schedule for `area` on `now`'s calendar day, see `resolveDaySchedule`.
     *
     * @param area - Area whose day schedule to resolve.
     * @param now - Reference date to determine weekday/weekend/holiday.
     */
    private resolveTodaySchedule(area: IAreaScheduleConfig, now: Date): IDaySchedule {
        return resolveDaySchedule(area, now, this.isPublicHoliday());
    }

    private scheduleAction(
        area: IAreaScheduleConfig,
        action: ScheduleAction,
        value: string | undefined,
        now: Date,
    ): void {
        const target = this.resolveActionTime(area, action, value, now);
        if (target) {
            this.scheduleAt(area, action, target, now);
        }
    }

    /**
     * Resolves today's absolute target time for one action ("open" or "close") from its raw schedule
     * string, see `parseScheduleEntry` for the accepted formats. Pure resolution, shared by
     * `scheduleAction()` (which schedules a future timer for it) and `resolveCurrentAction()` (which
     * only needs to know whether it already lies in the past).
     *
     * @param area - Area the value belongs to, used only for warning messages.
     * @param action - Which action this value drives; determines the sunrise/dawn vs. sunset/dusk pairing for offset entries.
     * @param value - Raw schedule string, or undefined/empty to skip this action entirely.
     * @param now - Reference date for today's computation.
     */
    private resolveActionTime(
        area: IAreaScheduleConfig,
        action: ScheduleAction,
        value: string | undefined,
        now: Date,
    ): Date | undefined {
        if (!value) {
            return undefined;
        }
        const entry = parseScheduleEntry(value, now);
        if (!entry) {
            this.adapter.log.warn(
                `Scheduler: invalid schedule value "${value}" for area "${area.name}" (${action}) - skipped.`,
            );
            return undefined;
        }

        if (entry.kind === 'time') {
            return entry.time;
        }

        if (entry.kind === 'sunOffset') {
            return this.computeSunOffsetTarget(area.name, action, entry.minutes, entry.useTwilight, now);
        }

        const sunTarget = this.computeSunOffsetTarget(area.name, action, entry.minutes, entry.useTwilight, now);
        return pickSunOffsetCappedTarget(sunTarget, entry.capTime);
    }

    /**
     * Computes the sunrise/dawn (for `'open'`) or sunset/dusk (for `'close'`) time offset by
     * `offsetMinutes`, or undefined (with a warning logged) if no location is configured or the event
     * could not be computed for today (e.g. polar day/night).
     *
     * @param areaName - Area name, used only for the warning message.
     * @param action - Which action this offset drives; determines whether the sunrise/dawn or sunset/dusk pair is used.
     * @param offsetMinutes - Minutes to add to (positive) or subtract from (negative) the event.
     * @param useTwilight - If true, use civil dawn/dusk instead of the actual sunrise/sunset.
     * @param now - Reference date for today's computation.
     */
    private computeSunOffsetTarget(
        areaName: string,
        action: ScheduleAction,
        offsetMinutes: number,
        useTwilight: boolean,
        now: Date,
    ): Date | undefined {
        if (!this.location) {
            this.adapter.log.warn(
                `Scheduler: area "${areaName}" (${action}) uses a sunrise/sunset offset, but no location is configured - skipped.`,
            );
            return undefined;
        }

        const sunEvent = action === 'open' ? (useTwilight ? 'dawn' : 'sunrise') : useTwilight ? 'dusk' : 'sunset';
        const target = computeSunEventTime(
            now,
            this.location.latitude,
            this.location.longitude,
            sunEvent,
            offsetMinutes,
        );
        if (!target) {
            this.adapter.log.warn(
                `Scheduler: could not compute ${sunEvent} time for area "${areaName}" at the configured location today - skipping ${action}.`,
            );
            return undefined;
        }
        return target;
    }

    /**
     * Schedules `onTrigger` to fire at `target`, unless it already lies in the past for today.
     *
     * @param area - Area to pass through to `onTrigger`.
     * @param action - Action to pass through to `onTrigger`.
     * @param target - Absolute time to fire at.
     * @param now - Current time, used to decide whether `target` already lies in the past.
     */
    private scheduleAt(area: IAreaScheduleConfig, action: ScheduleAction, target: Date, now: Date): void {
        if (target.getTime() <= now.getTime()) {
            // Already past for today; will apply again from tomorrow's recompute.
            return;
        }

        const delayMs = target.getTime() - now.getTime();
        const timer = this.adapter.setTimeout(() => this.onTrigger(area, action), delayMs);
        if (timer) {
            this.timers.push(timer);
        }
    }

    /**
     * Schedules `scheduleAll()` to run again shortly after the next local midnight.
     *
     * @param now - Current time, used as the base for computing the delay.
     */
    private scheduleMidnightRecompute(now: Date): void {
        const nextRecompute = new Date(now);
        nextRecompute.setDate(nextRecompute.getDate() + 1);
        nextRecompute.setHours(0, 0, 5, 0);

        const delayMs = nextRecompute.getTime() - now.getTime();
        const timer = this.adapter.setTimeout(() => this.scheduleAll(), delayMs);
        if (timer) {
            this.timers.push(timer);
        }
    }

    private clearTimers(): void {
        for (const timer of this.timers) {
            this.adapter.clearTimeout(timer);
        }
        this.timers = [];
    }
}
