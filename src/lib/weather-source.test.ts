import { expect } from 'chai';
import sinon from 'sinon';
import { isDateWithinMonthDayRange, WeatherSource } from './weather-source';
import type { IWeatherConfig } from './types';

/**
 * Minimal fake adapter exposing only what `WeatherSource` needs.
 *
 * @param initialStates - Foreign state values `getForeignStateAsync()` should return during `start()`, keyed by state ID.
 */
function createFakeAdapter(initialStates: Record<string, ioBroker.StateValue> = {}): {
    adapter: ioBroker.Adapter;
    subscribedIds: string[];
    emitForeignStateChange: (id: string, val: ioBroker.StateValue | null) => void;
    listenerCount: () => number;
} {
    const subscribedIds: string[] = [];
    const listeners: ((id: string, state: ioBroker.State | null | undefined) => void)[] = [];

    const adapter = {
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        subscribeForeignStatesAsync: async (id: string) => {
            subscribedIds.push(id);
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getForeignStateAsync: async (id: string) =>
            id in initialStates ? ({ val: initialStates[id], ack: true } as ioBroker.State) : undefined,
        on: (event: string, listener: (id: string, state: ioBroker.State | null | undefined) => void) => {
            if (event === 'stateChange') {
                listeners.push(listener);
            }
        },
        removeListener: (event: string, listener: (id: string, state: ioBroker.State | null | undefined) => void) => {
            if (event === 'stateChange') {
                const index = listeners.indexOf(listener);
                if (index !== -1) {
                    listeners.splice(index, 1);
                }
            }
        },
    } as unknown as ioBroker.Adapter;

    return {
        adapter,
        subscribedIds,
        emitForeignStateChange: (id: string, val: ioBroker.StateValue | null) => {
            for (const listener of listeners) {
                listener(id, val === null ? null : ({ val, ack: true } as ioBroker.State));
            }
        },
        listenerCount: () => listeners.length,
    };
}

describe('isDateWithinMonthDayRange (plan section 6.2/2, calendar-based heating period)', () => {
    it('is inside a same-year range on the boundaries and in between', () => {
        expect(isDateWithinMonthDayRange(new Date(2026, 5, 1), '06-01', '08-31')).to.equal(true); // June 1st, start
        expect(isDateWithinMonthDayRange(new Date(2026, 6, 15), '06-01', '08-31')).to.equal(true); // July 15th, middle
        expect(isDateWithinMonthDayRange(new Date(2026, 7, 31), '06-01', '08-31')).to.equal(true); // August 31st, end
    });

    it('is outside a same-year range just before/after it', () => {
        expect(isDateWithinMonthDayRange(new Date(2026, 4, 31), '06-01', '08-31')).to.equal(false); // May 31st
        expect(isDateWithinMonthDayRange(new Date(2026, 8, 1), '06-01', '08-31')).to.equal(false); // September 1st
    });

    it('handles a range wrapping across the New Year (the typical heating-period case)', () => {
        expect(isDateWithinMonthDayRange(new Date(2026, 10, 1), '10-15', '04-15')).to.equal(true); // November 1st
        expect(isDateWithinMonthDayRange(new Date(2027, 0, 1), '10-15', '04-15')).to.equal(true); // January 1st
        expect(isDateWithinMonthDayRange(new Date(2027, 3, 15), '10-15', '04-15')).to.equal(true); // April 15th, end boundary
        expect(isDateWithinMonthDayRange(new Date(2026, 9, 15), '10-15', '04-15')).to.equal(true); // October 15th, start boundary
    });

    it('is outside a wrapping range in the middle of the year', () => {
        expect(isDateWithinMonthDayRange(new Date(2027, 5, 1), '10-15', '04-15')).to.equal(false); // June 1st
    });

    it('treats a missing or unparseable boundary as never in the heating period', () => {
        expect(isDateWithinMonthDayRange(new Date(2026, 10, 1), undefined, '04-15')).to.equal(false);
        expect(isDateWithinMonthDayRange(new Date(2026, 10, 1), '10-15', undefined)).to.equal(false);
        expect(isDateWithinMonthDayRange(new Date(2026, 10, 1), 'not-a-date', '04-15')).to.equal(false);
        expect(isDateWithinMonthDayRange(new Date(2026, 10, 1), '13-01', '04-15')).to.equal(false); // month 13 invalid
    });
});

describe('WeatherSource', () => {
    describe('before start()', () => {
        it('returns undefined/false defaults for every metric when nothing is configured', () => {
            const { adapter } = createFakeAdapter();
            const weather = new WeatherSource(adapter, {});

            expect(weather.getSolarRadiation()).to.be.undefined;
            expect(weather.getWindSpeed()).to.be.undefined;
            expect(weather.getRain()).to.be.undefined;
            expect(weather.getOutdoorTemperature()).to.be.undefined;
            expect(weather.getHumidity()).to.be.undefined;
            expect(weather.getCloudCover()).to.be.undefined;
            expect(weather.getWindDirection()).to.be.undefined;
            expect(weather.getIsSummer()).to.equal(true); // no isSummerStateId configured => always summer
        });
    });

    describe('start()', () => {
        it('subscribes to and reads every configured state ID', async () => {
            const config: IWeatherConfig = {
                solarRadiationStateId: 'foreign.solar',
                windSpeedStateId: 'foreign.wind',
                rainStateId: 'foreign.rain',
                outdoorTempStateId: 'foreign.temp',
                humidityStateId: 'foreign.humidity',
                isSummerStateId: 'foreign.isSummer',
                cloudCoverStateId: 'foreign.cloudCover',
                windDirectionStateId: 'foreign.windDirection',
            };
            const { adapter, subscribedIds } = createFakeAdapter({
                'foreign.solar': 250,
                'foreign.wind': 30,
                'foreign.rain': true,
                'foreign.temp': 18.5,
                'foreign.humidity': 65,
                'foreign.isSummer': true,
                'foreign.cloudCover': 20,
                'foreign.windDirection': 270,
            });
            const weather = new WeatherSource(adapter, config);

            await weather.start();

            expect(subscribedIds.sort()).to.deep.equal(Object.values(config).sort());
            expect(weather.getSolarRadiation()).to.equal(250);
            expect(weather.getWindSpeed()).to.equal(30);
            expect(weather.getRain()).to.equal(true);
            expect(weather.getOutdoorTemperature()).to.equal(18.5);
            expect(weather.getHumidity()).to.equal(65);
            expect(weather.getIsSummer()).to.equal(true);
            expect(weather.getCloudCover()).to.equal(20);
            expect(weather.getWindDirection()).to.equal(270);
        });

        it('does not subscribe to metrics without a configured state ID', async () => {
            const { adapter, subscribedIds } = createFakeAdapter();
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });

            await weather.start();

            expect(subscribedIds).to.deep.equal(['foreign.solar']);
        });

        it('leaves a metric undefined if its foreign state does not exist yet', async () => {
            const { adapter } = createFakeAdapter(); // no initial value for foreign.solar
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });

            await weather.start();

            expect(weather.getSolarRadiation()).to.be.undefined;
        });

        it('getIsSummer() reflects the configured state, not just "configured or not"', async () => {
            const { adapter } = createFakeAdapter({ 'foreign.isSummer': false });
            const weather = new WeatherSource(adapter, { isSummerStateId: 'foreign.isSummer' });

            await weather.start();

            expect(weather.getIsSummer()).to.equal(false);
        });

        it('getIsSummer() falls back to the calendar-based heating period when isSummerStateId is not configured', () => {
            const { adapter } = createFakeAdapter();
            const weather = new WeatherSource(adapter, { heatingPeriodStart: '10-15', heatingPeriodEnd: '04-15' });

            expect(weather.getIsSummer(new Date(2026, 10, 1))).to.equal(false); // November, within heating period
            expect(weather.getIsSummer(new Date(2027, 5, 1))).to.equal(true); // June, outside heating period
        });

        it('getIsSummer() ignores the calendar fallback once isSummerStateId is configured, even while unset (undefined => not true)', async () => {
            const { adapter } = createFakeAdapter();
            const weather = new WeatherSource(adapter, {
                isSummerStateId: 'foreign.isSummer',
                heatingPeriodStart: '10-15',
                heatingPeriodEnd: '04-15',
            });
            await weather.start();

            // June, i.e. outside the calendar heating period - but isSummerStateId takes precedence
            // and its value is unknown, so this must not fall back to the calendar and say "true".
            expect(weather.getIsSummer(new Date(2027, 5, 1))).to.equal(false);
        });

        it('getIsHeatingPeriod() reports the calendar-based value independent of isSummerStateId', async () => {
            const { adapter } = createFakeAdapter({ 'foreign.isSummer': true });
            const weather = new WeatherSource(adapter, {
                isSummerStateId: 'foreign.isSummer',
                heatingPeriodStart: '10-15',
                heatingPeriodEnd: '04-15',
            });
            await weather.start();

            expect(weather.getIsHeatingPeriod(new Date(2026, 10, 1))).to.equal(true); // November
            expect(weather.getIsHeatingPeriod(new Date(2027, 5, 1))).to.equal(false); // June
        });
    });

    describe('live updates via stateChange', () => {
        it('picks up a new value for a configured metric, averaged with the still-recent previous reading', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.solar': 100 });
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });
            await weather.start();

            emitForeignStateChange('foreign.solar', 400);

            // Averaged over the default 10-minute window (getSolarRadiation()), not the raw new
            // reading in isolation - see the dedicated averaging tests below for that behavior.
            expect(weather.getSolarRadiation()).to.equal(250);
        });

        it('ignores a state change for an unrelated/unconfigured state ID', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.solar': 100 });
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });
            await weather.start();

            emitForeignStateChange('foreign.somethingElse', 999);

            expect(weather.getSolarRadiation()).to.equal(100);
        });

        it('treats a state being deleted (null) as "value unavailable" rather than throwing', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.solar': 100 });
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });
            await weather.start();

            emitForeignStateChange('foreign.solar', null);

            expect(weather.getSolarRadiation()).to.be.undefined;
        });

        it('getRain() preserves its last effective status when the raw reading becomes unavailable', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.rain': true });
            const weather = new WeatherSource(
                adapter,
                { rainStateId: 'foreign.rain' },
                {
                    rainStatusDebounceMs: 0,
                    windDirectionSmoothingDurationMs: 300_000,
                },
            );
            await weather.start();

            expect(weather.getRain()).to.equal(true);

            emitForeignStateChange('foreign.rain', false);
            expect(weather.getRain()).to.equal(false);

            emitForeignStateChange('foreign.rain', null);
            expect(weather.getRain()).to.equal(false);
        });

        it('returns undefined for a non-numeric value on a numeric metric instead of throwing/coercing', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.solar': 100 });
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });
            await weather.start();

            emitForeignStateChange('foreign.solar', 'not-a-number');

            expect(weather.getSolarRadiation()).to.be.undefined;
        });
    });

    describe('weather stabilization', () => {
        it('makes rain starting effective immediately, but debounces the transition back to dry', async () => {
            const clock = sinon.useFakeTimers();
            try {
                const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.rain': false });
                const weather = new WeatherSource(
                    adapter,
                    { rainStateId: 'foreign.rain' },
                    {
                        rainStatusDebounceMs: 300_000,
                        windDirectionSmoothingDurationMs: 300_000,
                    },
                );
                await weather.start();
                expect(weather.getRain()).to.equal(false);

                // Rain starting takes effect immediately - a shower can be over well within a
                // multi-minute debounce window, so waiting here would mean reacting too late.
                emitForeignStateChange('foreign.rain', true);
                expect(weather.getRain()).to.equal(true);

                // Rain stopping is still debounced: stays effectively "raining" until it has been
                // dry continuously for the full duration, same as before.
                emitForeignStateChange('foreign.rain', false);
                clock.tick(299_999);
                expect(weather.getRain()).to.equal(true);
                clock.tick(1);
                expect(weather.getRain()).to.equal(false);
            } finally {
                clock.restore();
            }
        });

        it('cancels a pending "rain has stopped" debounce if rain resumes before it completes', async () => {
            const clock = sinon.useFakeTimers();
            try {
                const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.rain': true });
                const weather = new WeatherSource(
                    adapter,
                    { rainStateId: 'foreign.rain' },
                    {
                        rainStatusDebounceMs: 300_000,
                        windDirectionSmoothingDurationMs: 300_000,
                    },
                );
                await weather.start();
                expect(weather.getRain()).to.equal(true);

                emitForeignStateChange('foreign.rain', false);
                clock.tick(120_000);
                expect(weather.getRain()).to.equal(true); // still within the debounce window

                emitForeignStateChange('foreign.rain', true); // shower resumes mid-debounce
                expect(weather.getRain()).to.equal(true);

                clock.tick(300_000); // even a full debounce duration later, still raining
                expect(weather.getRain()).to.equal(true);
            } finally {
                clock.restore();
            }
        });

        it('uses a circular moving average for wind direction and expires stale samples', async () => {
            const clock = sinon.useFakeTimers();
            try {
                const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.direction': 350 });
                const weather = new WeatherSource(
                    adapter,
                    { windDirectionStateId: 'foreign.direction' },
                    {
                        rainStatusDebounceMs: 300_000,
                        windDirectionSmoothingDurationMs: 300_000,
                    },
                );
                await weather.start();
                emitForeignStateChange('foreign.direction', 10);
                expect(weather.getWindDirection()).to.be.closeTo(0, 0.001);

                clock.tick(300_001);
                expect(weather.getWindDirection()).to.be.undefined;
            } finally {
                clock.restore();
            }
        });

        it('treats opposing directions as ambiguous and normalizes 360 degrees to north', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.direction': 360 });
            const weather = new WeatherSource(adapter, { windDirectionStateId: 'foreign.direction' });
            await weather.start();
            expect(weather.getWindDirection()).to.equal(0);

            emitForeignStateChange('foreign.direction', 180);
            expect(weather.getWindDirection()).to.be.undefined;
        });

        it('clears the effective wind direction for invalid or unavailable readings', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.direction': 180 });
            const weather = new WeatherSource(adapter, { windDirectionStateId: 'foreign.direction' });
            await weather.start();
            expect(weather.getWindDirection()).to.equal(180);

            emitForeignStateChange('foreign.direction', 'invalid');
            expect(weather.getWindDirection()).to.be.undefined;
            emitForeignStateChange('foreign.direction', null);
            expect(weather.getWindDirection()).to.be.undefined;
        });

        it('averages solar radiation and cloud cover over sunProtectionAveragingDurationMs, and expires stale samples', async () => {
            const clock = sinon.useFakeTimers();
            try {
                const { adapter, emitForeignStateChange } = createFakeAdapter({
                    'foreign.solar': 100,
                    'foreign.cloudCover': 60,
                });
                const weather = new WeatherSource(
                    adapter,
                    { solarRadiationStateId: 'foreign.solar', cloudCoverStateId: 'foreign.cloudCover' },
                    { sunProtectionAveragingDurationMs: 600_000 },
                );
                await weather.start();
                expect(weather.getSolarRadiation()).to.equal(100);
                expect(weather.getCloudCover()).to.equal(60);

                // A momentary spike (e.g. a single noisy reading) only shifts the average, not the
                // reported value outright - the whole point of averaging away randomness.
                clock.tick(60_000);
                emitForeignStateChange('foreign.solar', 700);
                emitForeignStateChange('foreign.cloudCover', 0);
                expect(weather.getSolarRadiation()).to.equal(400); // (100 + 700) / 2
                expect(weather.getCloudCover()).to.equal(30); // (60 + 0) / 2

                // Once the first (spike-preceding) sample falls outside the averaging window, only the
                // still-recent one remains.
                clock.tick(600_000);
                expect(weather.getSolarRadiation()).to.equal(700);
                expect(weather.getCloudCover()).to.equal(0);
            } finally {
                clock.restore();
            }
        });

        it('clears the solar-radiation/cloud-cover average for an invalid or unavailable reading, instead of keeping stale samples', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.solar': 100 });
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });
            await weather.start();
            expect(weather.getSolarRadiation()).to.equal(100);

            emitForeignStateChange('foreign.solar', null);
            expect(weather.getSolarRadiation()).to.be.undefined;

            emitForeignStateChange('foreign.solar', 250);
            expect(weather.getSolarRadiation()).to.equal(250);
        });
    });

    describe('stop()', () => {
        it('unsubscribes the state-change listener so later changes are no longer picked up', async () => {
            const { adapter, emitForeignStateChange, listenerCount } = createFakeAdapter({ 'foreign.solar': 100 });
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });
            await weather.start();
            expect(listenerCount()).to.equal(1);

            weather.stop();
            expect(listenerCount()).to.equal(0);

            emitForeignStateChange('foreign.solar', 400);
            expect(weather.getSolarRadiation()).to.equal(100);
        });
    });
});
