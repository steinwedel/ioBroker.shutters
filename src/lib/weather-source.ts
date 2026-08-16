import type { IWeatherConfig } from './types';

/**
 * Parses a plan-section-6.2/2 `"MM-DD"` heating-period boundary (e.g. `"10-15"` for October 15th)
 * into a same-year comparable day-of-year-like number (`month * 100 + day`, so lexical/numeric
 * ordering matches calendar ordering within a year without needing an actual `Date`). Returns
 * `undefined` for a missing, malformed, or out-of-range (`month` 1-12, `day` 1-31) value, so callers
 * can treat it as "not configured" rather than silently misinterpreting a typo.
 *
 * @param monthDay - `"MM-DD"` string, or undefined.
 */
function parseMonthDay(monthDay: string | undefined): number | undefined {
    const match = /^(\d{1,2})-(\d{1,2})$/.exec(monthDay ?? '');
    if (!match) {
        return undefined;
    }
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        return undefined;
    }
    return month * 100 + day;
}

/**
 * @param now - The date to check.
 * @param startMonthDay - `IWeatherConfig.heatingPeriodStart`, `"MM-DD"`.
 * @param endMonthDay - `IWeatherConfig.heatingPeriodEnd`, `"MM-DD"`.
 * @returns Whether `now`'s calendar day falls within `[startMonthDay, endMonthDay]` (both inclusive).
 *   Wraps across the New Year when `startMonthDay` sorts later in the year than `endMonthDay` (the
 *   normal heating-period case, e.g. October to April) - a same-year range (e.g. a summer maintenance
 *   window) is also supported by simply having `startMonthDay` sort earlier. Returns `false` -
 *   i.e. never in the heating period, matching the zero-config "always summer" default - if either
 *   boundary is missing or unparseable, see `parseMonthDay()`.
 */
export function isDateWithinMonthDayRange(
    now: Date,
    startMonthDay: string | undefined,
    endMonthDay: string | undefined,
): boolean {
    const start = parseMonthDay(startMonthDay);
    const end = parseMonthDay(endMonthDay);
    if (start === undefined || end === undefined) {
        return false;
    }
    const today = (now.getMonth() + 1) * 100 + now.getDate();
    if (start <= end) {
        return today >= start && today <= end;
    }
    // Wraps across the New Year (e.g. start=October, end=April): "within range" means on/after
    // start OR on/before end, not the (impossible for a wrapping range) "between" both.
    return today >= start || today <= end;
}

/**
 * Central provider of weather measurements for the protection modules
 * (sun/rain/wind/frost). Reads configurable foreign states and caches the
 * latest value of each, so protection modules never talk to foreign states
 * directly.
 *
 * The external weather-service fallback described in the plan (section
 * 5a.3, e.g. Open-Meteo) is not implemented yet - only own-sensor values
 * (section 5a.2) are supported so far. A metric with no configured state ID
 * simply stays `undefined`, which disables the modules that depend on it.
 */
export class WeatherSource {
    private readonly values = new Map<string, ioBroker.StateValue | undefined>();
    private readonly idsToKeys = new Map<string, keyof IWeatherConfig>();

    /**
     * @param adapter - Adapter instance, used for foreign state access.
     * @param config - Configured foreign state IDs per weather metric.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly config: IWeatherConfig,
    ) {
        for (const key of Object.keys(config) as (keyof IWeatherConfig)[]) {
            const stateId = config[key];
            if (stateId) {
                this.idsToKeys.set(stateId, key);
            }
        }
    }

    /** Subscribes to all configured foreign states and reads their current values once. Call once during startup. */
    public async start(): Promise<void> {
        for (const stateId of this.idsToKeys.keys()) {
            await this.adapter.subscribeForeignStatesAsync(stateId);
            const state = await this.adapter.getForeignStateAsync(stateId);
            if (state) {
                this.values.set(stateId, state.val);
            }
        }
        this.adapter.on('stateChange', this.handleForeignStateChange);
    }

    /** Unsubscribes the state-change listener registered in `start()`. */
    public stop(): void {
        this.adapter.removeListener('stateChange', this.handleForeignStateChange);
    }

    /** @returns Current solar radiation in W/m², or undefined if not configured/not yet received. */
    public getSolarRadiation(): number | undefined {
        return this.getNumber('solarRadiationStateId');
    }

    /**
     * @param now - Only used for the calendar-based `heatingPeriodStart`/`heatingPeriodEnd` fallback
     *   while `isSummerStateId` is not configured; defaults to the actual current time. Exposed as a
     *   parameter purely for deterministic testing.
     * @returns Whether it is currently "summer" for sun-protection purposes (plan section 6.2/2):
     *   `isSummerStateId`'s foreign state if configured (an external heating-period tracker always
     *   wins, exactly like `holidayStateId`); otherwise the calendar-based
     *   `heatingPeriodStart`/`heatingPeriodEnd` fallback (see `isDateWithinMonthDayRange()`);
     *   otherwise `true` (always summer, the pre-existing zero-config default).
     */
    public getIsSummer(now = new Date()): boolean {
        const stateId = this.config.isSummerStateId;
        if (stateId) {
            return this.values.get(stateId) === true;
        }
        return !this.getIsHeatingPeriod(now);
    }

    /**
     * @param now - See `getIsSummer()`.
     * @returns The inverse of `getIsSummer()`'s calendar-based fallback - exposed separately as a
     *   diagnostic value (plan section 3, `isHeatingPeriod`) and because it is meaningful even while
     *   `isSummerStateId` is configured (unlike `getIsSummer()`, which then ignores the calendar
     *   entirely in favor of the foreign state).
     */
    public getIsHeatingPeriod(now = new Date()): boolean {
        return isDateWithinMonthDayRange(now, this.config.heatingPeriodStart, this.config.heatingPeriodEnd);
    }

    /** @returns Current wind speed (or gust) in km/h, or undefined if not configured/not yet received. */
    public getWindSpeed(): number | undefined {
        return this.getNumber('windSpeedStateId');
    }

    /** @returns Whether rain is currently detected, or undefined if not configured/not yet received. */
    public getRain(): boolean | undefined {
        const stateId = this.config.rainStateId;
        if (!stateId) {
            return undefined;
        }
        const val = this.values.get(stateId);
        return val === undefined ? undefined : Boolean(val);
    }

    /** @returns Current wind direction in degrees (0-359, compass, clockwise from North), or undefined if not configured/not yet received. */
    public getWindDirection(): number | undefined {
        return this.getNumber('windDirectionStateId');
    }

    /** @returns Current outdoor temperature in °C, or undefined if not configured/not yet received. */
    public getOutdoorTemperature(): number | undefined {
        return this.getNumber('outdoorTempStateId');
    }

    /** @returns Current relative humidity in %, or undefined if not configured/not yet received. */
    public getHumidity(): number | undefined {
        return this.getNumber('humidityStateId');
    }

    /** @returns Current cloud cover in % (0 = clear sky, 100 = fully overcast), or undefined if not configured/not yet received. */
    public getCloudCover(): number | undefined {
        return this.getNumber('cloudCoverStateId');
    }

    private getNumber(key: keyof IWeatherConfig): number | undefined {
        const stateId = this.config[key];
        if (!stateId) {
            return undefined;
        }
        const val = this.values.get(stateId);
        return typeof val === 'number' ? val : undefined;
    }

    private readonly handleForeignStateChange = (id: string, state: ioBroker.State | null | undefined): void => {
        if (!this.idsToKeys.has(id)) {
            return;
        }
        this.values.set(id, state ? state.val : undefined);
    };
}
