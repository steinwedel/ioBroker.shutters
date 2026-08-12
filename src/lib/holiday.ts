import Holidays from 'date-holidays';

/**
 * Thin wrapper around `date-holidays` for public holidays, since only a single "is today a public
 * holiday" question is needed here. Supports any country `date-holidays` knows about, not just Germany,
 * since the adapter is used internationally; which subdivisions (federal states, provinces, etc.) are
 * selectable depends entirely on the chosen country - see `getCountries`/`getStates`.
 *
 * See plans/shutters-adapter-plan.md, section 5.
 */
export class HolidayChecker {
    private readonly holidays: Holidays | undefined;

    /**
     * @param country - ISO 3166-1 country code (e.g. "DE", "US", "FR"), or undefined to disable holiday detection entirely.
     * @param state - Country-specific subdivision code (ISO 3166-2, e.g. "NI" for Niedersachsen in Germany, or "CA" for California in the US), or undefined to use the country's nationwide holidays only (if the country has no subdivisions, or none was selected).
     */
    public constructor(country: string | undefined, state?: string) {
        if (!country) {
            this.holidays = undefined;
        } else if (state) {
            this.holidays = new Holidays(country, state);
        } else {
            this.holidays = new Holidays(country);
        }
    }

    /**
     * @param date - Date to check.
     * @returns True if `date` is a public holiday in the configured country/subdivision; always false if no country was configured.
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

    /**
     * @param lang - ISO 639-1 language code for the country names, or undefined for the library default (English).
     * @returns Country code -> localized country name, for every country `date-holidays` supports.
     */
    public static getCountries(lang?: string): Record<string, string> {
        return new Holidays().getCountries(lang);
    }

    /**
     * @param country - ISO 3166-1 country code to get subdivisions for.
     * @param lang - ISO 639-1 language code for the subdivision names, or undefined for the library default.
     * @returns Subdivision code -> localized subdivision name for `country`; an empty object if `country` has no subdivisions known to `date-holidays` (in which case only the nationwide holidays apply).
     */
    public static getStates(country: string, lang?: string): Record<string, string> {
        return new Holidays().getStates(country, lang) ?? {};
    }
}
