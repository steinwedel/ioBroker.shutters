import type { HolidayChecker } from './holiday';
import type { IAreaScheduleConfig, IDaySchedule } from './types';

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

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

export type ScheduleAction = 'open' | 'close';

/**
 * Daily schedule engine: for each configured area, determines today's
 * applicable open/close times (weekday/weekend/public holiday) and fires a
 * callback at those times. Recomputes itself once per day shortly after
 * midnight, so day-category changes (e.g. into/out of a public holiday) are
 * picked up automatically.
 *
 * Dusk/dawn coupling and iCal overrides are added on top of this in a later
 * milestone (plan section 5, M4) and are not part of this class.
 */
export class Scheduler {
    private timers: ioBroker.Timeout[] = [];

    /**
     * @param adapter - Adapter instance, used for `setTimeout`/`clearTimeout` (never native Node timers, see AGENTS.md).
     * @param areas - Areas to schedule.
     * @param holidayChecker - Used to decide whether "today" counts as a public holiday.
     * @param onTrigger - Called when an area's open/close time is reached.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly areas: IAreaScheduleConfig[],
        private readonly holidayChecker: HolidayChecker,
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

    private scheduleAction(areaName: string, action: ScheduleAction, timeString: string | undefined, now: Date): void {
        if (!timeString) {
            return;
        }
        const target = parseTimeToday(timeString, now);
        if (!target) {
            this.adapter.log.warn(
                `Scheduler: invalid time "${timeString}" for area "${areaName}" (${action}) - skipped.`,
            );
            return;
        }
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
