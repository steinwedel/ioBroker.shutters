import type { IWeatherConfig } from './types';

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

    public getIsSummer(): boolean {
        const stateId = this.config.isSummerStateId;
        return !stateId || this.values.get(stateId) === true;
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

    /** @returns Current outdoor temperature in °C, or undefined if not configured/not yet received. */
    public getOutdoorTemperature(): number | undefined {
        return this.getNumber('outdoorTempStateId');
    }

    /** @returns Current relative humidity in %, or undefined if not configured/not yet received. */
    public getHumidity(): number | undefined {
        return this.getNumber('humidityStateId');
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
