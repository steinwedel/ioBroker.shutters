import Holidays from 'date-holidays';

/**
 * Thin wrapper around `date-holidays` for German public holidays, since only
 * a single "is today a public holiday" question is needed here.
 *
 * See plans/shutters-adapter-plan.md, section 5.
 */
export class HolidayChecker {
    private readonly holidays: Holidays | undefined;

    /**
     * @param federalState - German federal state code (ISO 3166-2 subdivision, e.g. "NI" for Niedersachsen), or undefined to disable holiday detection.
     */
    public constructor(federalState: string | undefined) {
        this.holidays = federalState ? new Holidays('DE', federalState) : undefined;
    }

    /**
     * @param date - Date to check.
     * @returns True if `date` is a German public holiday in the configured federal state; always false if no federal state was configured.
     */
    public isPublicHoliday(date: Date): boolean {
        if (!this.holidays) {
            return false;
        }
        const result = this.holidays.isHoliday(date);
        if (!result) {
            return false;
        }
        return result.some(holiday => holiday.type === 'public');
    }
}
