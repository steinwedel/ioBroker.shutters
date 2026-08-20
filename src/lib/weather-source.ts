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
    private effectiveRain: boolean | undefined;
    /** Only ever `false` (pending "rain has stopped") - rain starting is committed immediately, never debounced, see `setValue()`/`getRain()`. */
    private pendingRain: boolean | undefined;
    private pendingRainSinceMs: number | undefined;
    private readonly windDirectionSamples: { value: number; timestampMs: number }[] = [];

    /**
     * @param adapter - Adapter instance, used for foreign state access.
     * @param config - Configured foreign state IDs per weather metric.
     * @param stabilization - Rain debounce and wind-direction smoothing durations in milliseconds.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly config: IWeatherConfig,
        private readonly stabilization = {
            rainStatusDebounceMs: 300_000,
            windDirectionSmoothingDurationMs: 300_000,
        },
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
                this.setValue(stateId, state.val, true);
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

    /**
     * @returns The effective rain status, or undefined before the first reading. Rain starting is
     *   reflected immediately (see `setValue()`); only the transition back to dry is debounced by
     *   `IWeatherConfig.rainStatusDebounceMs`, same asymmetric shape as `evaluateWindProtection()`'s
     *   calm hysteresis - reacting fast to a shower matters far more than not flickering while it lasts.
     */
    public getRain(): boolean | undefined {
        if (!this.config.rainStateId) {
            return undefined;
        }
        if (
            this.pendingRain !== undefined &&
            this.pendingRainSinceMs !== undefined &&
            Date.now() - this.pendingRainSinceMs >= this.stabilization.rainStatusDebounceMs
        ) {
            this.effectiveRain = this.pendingRain;
            this.pendingRain = undefined;
            this.pendingRainSinceMs = undefined;
        }
        return this.effectiveRain;
    }

    /** @returns Circularly smoothed wind direction in degrees, or undefined when unavailable or ambiguous. */
    public getWindDirection(): number | undefined {
        if (!this.config.windDirectionStateId) {
            return undefined;
        }
        const cutoffMs = Date.now() - this.stabilization.windDirectionSmoothingDurationMs;
        while (this.windDirectionSamples[0]?.timestampMs < cutoffMs) {
            this.windDirectionSamples.shift();
        }
        if (this.windDirectionSamples.length === 0) {
            return undefined;
        }
        let northComponent = 0;
        let eastComponent = 0;
        for (const sample of this.windDirectionSamples) {
            const radians = (sample.value * Math.PI) / 180;
            northComponent += Math.cos(radians);
            eastComponent += Math.sin(radians);
        }
        if (Math.hypot(northComponent, eastComponent) < 0.001) {
            return undefined;
        }
        const direction = (Math.atan2(eastComponent, northComponent) * 180) / Math.PI;
        return (direction + 360) % 360;
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

    private setValue(stateId: string, value: ioBroker.StateValue | undefined, initial = false): void {
        this.values.set(stateId, value);
        if (stateId === this.config.rainStateId) {
            const rain = value === undefined ? undefined : Boolean(value);
            if (initial) {
                this.effectiveRain = rain;
                this.pendingRain = undefined;
                this.pendingRainSinceMs = undefined;
            } else if (rain === undefined) {
                this.pendingRain = undefined;
                this.pendingRainSinceMs = undefined;
            } else if (rain === true) {
                // Rain starting (or continuing) takes effect immediately, same as the wind-speed
                // threshold in evaluateWindProtection(): a shower can be over well within a multi-
                // minute debounce window, so waiting here would routinely mean reacting too late to
                // protect anything. This also cancels any "about to become dry" countdown below.
                this.effectiveRain = true;
                this.pendingRain = undefined;
                this.pendingRainSinceMs = undefined;
            } else if (rain === this.effectiveRain) {
                this.pendingRain = undefined;
                this.pendingRainSinceMs = undefined;
            } else if (this.pendingRain !== false) {
                // Rain has just stopped (raw reading is dry) while still effectively "raining" - only
                // let this take effect once it has stayed dry continuously for the debounce duration,
                // so a brief gap between drops mid-shower does not prematurely release protection.
                this.pendingRain = false;
                this.pendingRainSinceMs = Date.now();
            }
        }
        if (stateId === this.config.windDirectionStateId) {
            if (typeof value === 'number' && Number.isFinite(value)) {
                this.windDirectionSamples.push({ value: ((value % 360) + 360) % 360, timestampMs: Date.now() });
            } else {
                this.windDirectionSamples.length = 0;
            }
        }
    }

    private readonly handleForeignStateChange = (id: string, state: ioBroker.State | null | undefined): void => {
        if (!this.idsToKeys.has(id)) {
            return;
        }
        this.setValue(id, state ? state.val : undefined);
    };
}
