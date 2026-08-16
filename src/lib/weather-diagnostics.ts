/**
 * Central, adapter-wide diagnostic states for astro/weather values (plan section 3, `astro.*`/`weather.*`)
 * that were previously computed only internally (in `automation.ts`/`weather-source.ts`/`twilight.ts`)
 * and never surfaced as visible ioBroker states - unlike the per-covering diagnostics owned by
 * `ShutterController`, these are adapter-global (one location, one weather source), so they get their
 * own small, focused module rather than being folded into `main.ts` directly.
 */

import { computeSunEventTime, getSunPosition } from './twilight';
import type { WeatherSource } from './weather-source';

/** Adapter-configured location, see `main.ts`'s `resolveLocation()`. */
export interface ILocation {
    /** Latitude in degrees. */
    latitude: number;
    /** Longitude in degrees. */
    longitude: number;
}

/**
 * Creates every state written by `updateWeatherDiagnosticStates()`. Idempotent (`setObjectNotExists`); safe to call on every adapter start.
 *
 * @param adapter - Adapter instance, used for object access.
 */
export async function createWeatherDiagnosticObjects(adapter: ioBroker.Adapter): Promise<void> {
    await adapter.setObjectNotExistsAsync('astro', { type: 'channel', common: { name: 'Astro' }, native: {} });
    await adapter.setObjectNotExistsAsync('astro.twilightEnd', {
        type: 'state',
        common: {
            name: 'Civil dusk today (ISO), no offset',
            type: 'string',
            role: 'value.time',
            read: true,
            write: false,
        },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('astro.isHeatingPeriod', {
        type: 'state',
        common: {
            name: 'Whether today is within the configured heating period (plan section 6.2/2)',
            type: 'boolean',
            role: 'indicator',
            read: true,
            write: false,
        },
        native: {},
    });

    await adapter.setObjectNotExistsAsync('weather', { type: 'channel', common: { name: 'Weather' }, native: {} });
    await adapter.setObjectNotExistsAsync('weather.cloudCover', {
        type: 'state',
        common: { name: 'Cloud cover', type: 'number', role: 'value', unit: '%', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('weather.rain', {
        type: 'state',
        common: { name: 'Rain detected', type: 'boolean', role: 'indicator.rain', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('weather.windSpeed', {
        type: 'state',
        common: {
            name: 'Wind speed',
            type: 'number',
            role: 'value.speed.wind',
            unit: 'km/h',
            read: true,
            write: false,
        },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('weather.windDirection', {
        type: 'state',
        common: {
            name: 'Wind direction',
            type: 'number',
            role: 'value.direction.wind',
            unit: '°',
            read: true,
            write: false,
        },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('weather.sunElevation', {
        type: 'state',
        common: { name: 'Sun elevation', type: 'number', role: 'value', unit: '°', read: true, write: false },
        native: {},
    });
    await adapter.setObjectNotExistsAsync('weather.sunAzimuth', {
        type: 'state',
        common: { name: 'Sun azimuth', type: 'number', role: 'value', unit: '°', read: true, write: false },
        native: {},
    });
}

/**
 * Writes current values for every plan-section-3 astro/weather diagnostic state. Purely a mirror of
 * values already available through `WeatherSource`/`twilight.ts` - this module does not compute
 * anything protection logic itself does not already compute or could not already compute the same way.
 *
 * @param adapter - Adapter instance, used for state access.
 * @param weather - Source of the plain weather metrics.
 * @param location - Adapter-configured location; astro-derived values (`twilightEnd`, `sunElevation`/`sunAzimuth`) are written as `null` if this is undefined (no location configured, see `main.ts`'s `resolveLocation()`).
 * @param now - Defaults to the actual current time; exposed as a parameter purely for deterministic testing.
 */
export async function updateWeatherDiagnosticStates(
    adapter: ioBroker.Adapter,
    weather: WeatherSource,
    location: ILocation | undefined,
    now = new Date(),
): Promise<void> {
    await adapter.setStateAsync('weather.cloudCover', { val: weather.getCloudCover() ?? null, ack: true });
    await adapter.setStateAsync('weather.rain', { val: weather.getRain() ?? null, ack: true });
    await adapter.setStateAsync('weather.windSpeed', { val: weather.getWindSpeed() ?? null, ack: true });
    await adapter.setStateAsync('weather.windDirection', { val: weather.getWindDirection() ?? null, ack: true });
    await adapter.setStateAsync('astro.isHeatingPeriod', { val: weather.getIsHeatingPeriod(now), ack: true });

    if (!location) {
        await adapter.setStateAsync('weather.sunElevation', { val: null, ack: true });
        await adapter.setStateAsync('weather.sunAzimuth', { val: null, ack: true });
        await adapter.setStateAsync('astro.twilightEnd', { val: null, ack: true });
        return;
    }
    const sun = getSunPosition(now, location.latitude, location.longitude);
    await adapter.setStateAsync('weather.sunElevation', { val: sun.elevationDeg, ack: true });
    await adapter.setStateAsync('weather.sunAzimuth', { val: sun.azimuthDeg, ack: true });
    const dusk = computeSunEventTime(now, location.latitude, location.longitude, 'dusk', 0);
    await adapter.setStateAsync('astro.twilightEnd', { val: dusk ? dusk.toISOString() : null, ack: true });
}
