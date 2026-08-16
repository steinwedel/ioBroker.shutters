import { expect } from 'chai';
import { createWeatherDiagnosticObjects, updateWeatherDiagnosticStates } from './weather-diagnostics';
import type { WeatherSource } from './weather-source';

/** Minimal fake adapter exposing only what `weather-diagnostics.ts` needs. */
function createFakeAdapter(): {
    adapter: ioBroker.Adapter;
    setObjectCalls: string[];
    setStateCalls: { id: string; val: ioBroker.StateValue; ack: boolean }[];
} {
    const setObjectCalls: string[] = [];
    const setStateCalls: { id: string; val: ioBroker.StateValue; ack: boolean }[] = [];
    const adapter = {
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        setObjectNotExistsAsync: async (id: string) => {
            setObjectCalls.push(id);
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        setStateAsync: async (id: string, state: ioBroker.State | ioBroker.StateValue) => {
            const { val, ack } = typeof state === 'object' && state !== null ? state : { val: state, ack: false };
            setStateCalls.push({ id, val: val ?? null, ack: !!ack });
        },
    } as unknown as ioBroker.Adapter;
    return { adapter, setObjectCalls, setStateCalls };
}

/**
 * Minimal fake weather source, duck-typed as `WeatherSource`.
 *
 * @param overrides - Weather values returned by the fake source.
 */
function createFakeWeather(overrides: Partial<Record<string, unknown>> = {}): WeatherSource {
    return {
        getCloudCover: () => overrides.cloudCover as number | undefined,
        getRain: () => overrides.rain as boolean | undefined,
        getWindSpeed: () => overrides.windSpeed as number | undefined,
        getWindDirection: () => overrides.windDirection as number | undefined,
        getIsHeatingPeriod: () => (overrides.isHeatingPeriod as boolean | undefined) ?? false,
    } as unknown as WeatherSource;
}

describe('weather-diagnostics (plan section 3)', () => {
    describe('createWeatherDiagnosticObjects', () => {
        it('creates the astro channel/states and the weather channel/states', async () => {
            const { adapter, setObjectCalls } = createFakeAdapter();

            await createWeatherDiagnosticObjects(adapter);

            expect(setObjectCalls).to.deep.equal([
                'astro',
                'astro.twilightEnd',
                'astro.isHeatingPeriod',
                'weather',
                'weather.cloudCover',
                'weather.rain',
                'weather.windSpeed',
                'weather.windDirection',
                'weather.sunElevation',
                'weather.sunAzimuth',
            ]);
        });
    });

    describe('updateWeatherDiagnosticStates', () => {
        it('mirrors every plain weather metric and isHeatingPeriod, with a location configured', async () => {
            const { adapter, setStateCalls } = createFakeAdapter();
            const weather = createFakeWeather({
                cloudCover: 40,
                rain: true,
                windSpeed: 12,
                windDirection: 270,
                isHeatingPeriod: true,
            });

            // Solar noon at the equator/prime meridian - a fixed, deterministic reference point.
            await updateWeatherDiagnosticStates(
                adapter,
                weather,
                { latitude: 0, longitude: 0 },
                new Date('2026-03-20T12:00:00Z'),
            );

            expect(setStateCalls).to.deep.include({ id: 'weather.cloudCover', val: 40, ack: true });
            expect(setStateCalls).to.deep.include({ id: 'weather.rain', val: true, ack: true });
            expect(setStateCalls).to.deep.include({ id: 'weather.windSpeed', val: 12, ack: true });
            expect(setStateCalls).to.deep.include({ id: 'weather.windDirection', val: 270, ack: true });
            expect(setStateCalls).to.deep.include({ id: 'astro.isHeatingPeriod', val: true, ack: true });
        });

        it('writes null for every unavailable metric instead of undefined', async () => {
            const { adapter, setStateCalls } = createFakeAdapter();
            const weather = createFakeWeather();

            await updateWeatherDiagnosticStates(adapter, weather, undefined, new Date('2026-03-20T12:00:00Z'));

            expect(setStateCalls).to.deep.include({ id: 'weather.cloudCover', val: null, ack: true });
            expect(setStateCalls).to.deep.include({ id: 'weather.rain', val: null, ack: true });
            expect(setStateCalls).to.deep.include({ id: 'weather.windSpeed', val: null, ack: true });
            expect(setStateCalls).to.deep.include({ id: 'weather.windDirection', val: null, ack: true });
        });

        it('computes sunElevation/sunAzimuth/twilightEnd once a location is configured', async () => {
            const { adapter, setStateCalls } = createFakeAdapter();
            const weather = createFakeWeather();

            await updateWeatherDiagnosticStates(
                adapter,
                weather,
                { latitude: 0, longitude: 0 },
                new Date('2026-03-20T12:00:00Z'),
            );

            const elevation = setStateCalls.find(c => c.id === 'weather.sunElevation');
            const azimuth = setStateCalls.find(c => c.id === 'weather.sunAzimuth');
            const twilightEnd = setStateCalls.find(c => c.id === 'astro.twilightEnd');
            expect(elevation?.val).to.be.a('number');
            expect(azimuth?.val).to.be.a('number');
            expect(twilightEnd?.val).to.be.a('string');
            expect(twilightEnd?.ack).to.equal(true);
        });

        it('writes null for the astro-derived values when no location is configured', async () => {
            const { adapter, setStateCalls } = createFakeAdapter();
            const weather = createFakeWeather();

            await updateWeatherDiagnosticStates(adapter, weather, undefined, new Date('2026-03-20T12:00:00Z'));

            expect(setStateCalls).to.deep.include({ id: 'weather.sunElevation', val: null, ack: true });
            expect(setStateCalls).to.deep.include({ id: 'weather.sunAzimuth', val: null, ack: true });
            expect(setStateCalls).to.deep.include({ id: 'astro.twilightEnd', val: null, ack: true });
        });
    });
});
