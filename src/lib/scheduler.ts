import type { HolidayChecker } from './holiday';
import type { IAreaScheduleConfig, IDaySchedule } from './types';
import { computeSunEventTime } from './twilight';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const OFFSET_MINUTES_RE = /^([+-])(\d+)$/;
const OFFSET_DURATION_RE = /^([+-])(\d+):([0-5]\d)$/;

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
    | { kind: 'sunOffset'; minutes: number }
    | { kind: 'sunOffsetCapped'; minutes: number; capTime: Date };

/**
 * Parses the leading `+`/`-` offset token of a schedule entry (plain minutes or an "HH:MM" duration).
 *
 * @param token - The offset token, e.g. "-30" or "+01:30".
 * @returns The signed offset in minutes, or undefined if `token` is not a valid offset.
 */
function parseOffsetMinutesToken(token: string): number | undefined {
    const durationMatch = OFFSET_DURATION_RE.exec(token);
    if (durationMatch) {
        const minutes = Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
        return durationMatch[1] === '-' ? -minutes : minutes;
    }

    const minutesMatch = OFFSET_MINUTES_RE.exec(token);
    if (minutesMatch) {
        const minutes = Number(minutesMatch[2]);
        return minutesMatch[1] === '-' ? -minutes : minutes;
    }

    return undefined;
}

/**
 * Parses an area's open/close schedule value. Three formats are accepted:
 * - A plain "HH:MM" (24h) clock time, e.g. "07:30".
 * - A leading `+`/`-` offset relative to sunrise (for the opening time) or sunset (for the closing
 *   time), given either as plain minutes (e.g. "-30", "+90") or as an "HH:MM" duration (e.g. "-00:30",
 *   "+01:30").
 * - The above offset followed by `!` and a plain "HH:MM" cap time, e.g. "+30!19:00" ("30 minutes after
 *   the sun event, but never later than 19:00" - the cap always wins if the offset time would be later
 *   than the cap, for both opening and closing).
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
        const minutes = parseOffsetMinutesToken(offsetToken);
        const capTime = parseTimeToday(capToken, now);
        if (minutes === undefined || !capTime) {
            return undefined;
        }
        return { kind: 'sunOffsetCapped', minutes, capTime };
    }

    const offsetMinutes = parseOffsetMinutesToken(trimmed);
    if (offsetMinutes !== undefined) {
        return { kind: 'sunOffset', minutes: offsetMinutes };
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

export type ScheduleAction = 'open' | 'close';

/**
 * Daily schedule engine: for each configured area, determines today's
 * applicable open/close times (weekday/weekend/public holiday) and fires a
 * callback at those times. Recomputes itself once per day shortly after
 * midnight, so day-category changes (e.g. into/out of a public holiday) are
 * picked up automatically.
 *
 * Each open/close field accepts a plain "HH:MM" clock time, an offset relative to sunrise (opening) /
 * sunset (closing) written with a leading `+`/`-` sign as plain minutes (e.g. "-30") or an "HH:MM"
 * duration (e.g. "+01:30"), or that offset combined with a "!HH:MM" cap (e.g. "+30!19:00" = 30 minutes
 * after the sun event, but never later than 19:00) - see `parseScheduleEntry`. No separate configuration
 * fields are needed for this; the format of the string itself is what distinguishes the variants.
 *
 * iCal calendar overrides are not implemented yet, see plan section 5 (M4).
 */
export class Scheduler {
    private timers: ioBroker.Timeout[] = [];

    /**
     * @param adapter - Adapter instance, used for `setTimeout`/`clearTimeout` (never native Node timers, see AGENTS.md).
     * @param areas - Areas to schedule.
     * @param holidayChecker - Used to decide whether "today" counts as a public holiday.
     * @param location - Latitude/longitude used for sunrise/sunset-relative entries; undefined disables them (they are then skipped with a warning).
     * @param onTrigger - Called when an area's open/close time is reached.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly areas: IAreaScheduleConfig[],
        private readonly holidayChecker: HolidayChecker,
        private readonly location: { latitude: number; longitude: number } | undefined,
        private readonly onTrigger: (areaName: string, action: ScheduleAction) => void,
    ) {}

    /** (Re-)schedules all areas for the remainder of today, and arranges the next midnight recompute. */
    public start(): void {
        this.scheduleAll();
    }

    /** Clears all pending timers. Call on adapter unload. */
    public stop(): void {
        this.clearTimers();
    }

    private scheduleAll(): void {
        this.clearTimers();
        const now = new Date();

        for (const area of this.areas) {
            const daySchedule = this.resolveTodaySchedule(area, now);
            this.scheduleAction(area.name, 'open', daySchedule.open, now);
            this.scheduleAction(area.name, 'close', daySchedule.close, now);
        }

        this.scheduleMidnightRecompute(now);
    }

    /**
     * Picks the applicable day schedule for `area` on `now`'s calendar day:
     * public holiday (if configured and applicable) takes precedence over
     * weekend, which takes precedence over the regular weekday schedule.
     *
     * @param area - Area whose day schedule to resolve.
     * @param now - Reference date to determine weekday/weekend/holiday.
     */
    private resolveTodaySchedule(area: IAreaScheduleConfig, now: Date): IDaySchedule {
        const isWeekend = now.getDay() === 0 || now.getDay() === 6;
        if (area.holiday && this.holidayChecker.isPublicHoliday(now)) {
            return area.holiday;
        }
        return isWeekend ? area.weekend : area.weekday;
    }

    private scheduleAction(areaName: string, action: ScheduleAction, value: string | undefined, now: Date): void {
        if (!value) {
            return;
        }
        const entry = parseScheduleEntry(value, now);
        if (!entry) {
            this.adapter.log.warn(
                `Scheduler: invalid schedule value "${value}" for area "${areaName}" (${action}) - skipped.`,
            );
            return;
        }

        if (entry.kind === 'time') {
            this.scheduleAt(areaName, action, entry.time, now);
            return;
        }

        if (entry.kind === 'sunOffset') {
            const target = this.computeSunOffsetTarget(areaName, action, entry.minutes, now);
            if (target) {
                this.scheduleAt(areaName, action, target, now);
            }
            return;
        }

        // sunOffsetCapped: the cap always applies, even if the sun-event time itself could not be
        // computed (e.g. missing location or a polar day/night), so it never simply falls through.
        const sunTarget = this.computeSunOffsetTarget(areaName, action, entry.minutes, now);
        this.scheduleAt(areaName, action, pickSunOffsetCappedTarget(sunTarget, entry.capTime), now);
    }

    /**
     * Computes the sunrise (for `'open'`) or sunset (for `'close'`) time offset by `offsetMinutes`, or
     * undefined (with a warning logged) if no location is configured or the event could not be computed
     * for today (e.g. polar day/night).
     *
     * @param areaName - Area name, used only for the warning message.
     * @param action - Which action this offset drives; determines whether sunrise or sunset is used.
     * @param offsetMinutes - Minutes to add to (positive) or subtract from (negative) the sun event.
     * @param now - Reference date for today's computation.
     */
    private computeSunOffsetTarget(
        areaName: string,
        action: ScheduleAction,
        offsetMinutes: number,
        now: Date,
    ): Date | undefined {
        if (!this.location) {
            this.adapter.log.warn(
                `Scheduler: area "${areaName}" (${action}) uses a sunrise/sunset offset, but no location is configured - skipped.`,
            );
            return undefined;
        }

        const sunEvent = action === 'open' ? 'sunrise' : 'sunset';
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
     * @param areaName - Area name to pass through to `onTrigger`.
     * @param action - Action to pass through to `onTrigger`.
     * @param target - Absolute time to fire at.
     * @param now - Current time, used to decide whether `target` already lies in the past.
     */
    private scheduleAt(areaName: string, action: ScheduleAction, target: Date, now: Date): void {
        if (target.getTime() <= now.getTime()) {
            // Already past for today; will apply again from tomorrow's recompute.
            return;
        }

        const delayMs = target.getTime() - now.getTime();
        const timer = this.adapter.setTimeout(() => this.onTrigger(areaName, action), delayMs);
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
