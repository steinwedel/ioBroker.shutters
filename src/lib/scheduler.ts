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
export type ScheduleEntry = { kind: 'time'; time: Date } | { kind: 'sunOffset'; minutes: number };

/**
 * Parses an area's open/close schedule value. Two formats are accepted, distinguished by a leading
 * `+`/`-` sign:
 * - No sign: a plain "HH:MM" (24h) clock time, e.g. "07:30".
 * - Leading `+`/`-`: an offset relative to sunrise (for the opening time) or sunset (for the closing
 *   time), given either as plain minutes (e.g. "-30", "+90") or as an "HH:MM" duration (e.g. "-00:30",
 *   "+01:30").
 *
 * @param value - Raw string entered by the user for an open/close field.
 * @param now - Reference date; only its year/month/day are used for the "time" variant.
 */
export function parseScheduleEntry(value: string, now: Date): ScheduleEntry | undefined {
    const trimmed = value.trim();

    const durationMatch = OFFSET_DURATION_RE.exec(trimmed);
    if (durationMatch) {
        const minutes = Number(durationMatch[2]) * 60 + Number(durationMatch[3]);
        return { kind: 'sunOffset', minutes: durationMatch[1] === '-' ? -minutes : minutes };
    }

    const minutesMatch = OFFSET_MINUTES_RE.exec(trimmed);
    if (minutesMatch) {
        const minutes = Number(minutesMatch[2]);
        return { kind: 'sunOffset', minutes: minutesMatch[1] === '-' ? -minutes : minutes };
    }

    const time = parseTimeToday(trimmed, now);
    if (time) {
        return { kind: 'time', time };
    }

    return undefined;
}

export type ScheduleAction = 'open' | 'close';

/**
 * Daily schedule engine: for each configured area, determines today's
 * applicable open/close times (weekday/weekend/public holiday) and fires a
 * callback at those times. Recomputes itself once per day shortly after
 * midnight, so day-category changes (e.g. into/out of a public holiday) are
 * picked up automatically.
 *
 * Each open/close field accepts either a plain "HH:MM" clock time, or an offset relative to sunrise
 * (opening) / sunset (closing), written with a leading `+`/`-` sign as plain minutes (e.g. "-30") or an
 * "HH:MM" duration (e.g. "+01:30") - see `parseScheduleEntry`. No separate configuration fields are
 * needed for this; the sign in the same field is what distinguishes a clock time from an offset.
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

        if (!this.location) {
            this.adapter.log.warn(
                `Scheduler: area "${areaName}" (${action}) uses a sunrise/sunset offset, but no location is configured - skipped.`,
            );
            return;
        }

        const sunEvent = action === 'open' ? 'sunrise' : 'sunset';
        const target = computeSunEventTime(
            now,
            this.location.latitude,
            this.location.longitude,
            sunEvent,
            entry.minutes,
        );
        if (!target) {
            this.adapter.log.warn(
                `Scheduler: could not compute ${sunEvent} time for area "${areaName}" at the configured location today - skipping ${action}.`,
            );
            return;
        }
        this.scheduleAt(areaName, action, target, now);
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
