import { expect } from 'chai';
import { WeatherSource } from './weather-source';
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
            };
            const { adapter, subscribedIds } = createFakeAdapter({
                'foreign.solar': 250,
                'foreign.wind': 30,
                'foreign.rain': true,
                'foreign.temp': 18.5,
                'foreign.humidity': 65,
                'foreign.isSummer': true,
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
    });

    describe('live updates via stateChange', () => {
        it('picks up a new value for a configured metric', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.solar': 100 });
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });
            await weather.start();

            emitForeignStateChange('foreign.solar', 400);

            expect(weather.getSolarRadiation()).to.equal(400);
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

        it('getRain() distinguishes "unavailable" (undefined) from a falsy boolean value', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.rain': true });
            const weather = new WeatherSource(adapter, { rainStateId: 'foreign.rain' });
            await weather.start();

            expect(weather.getRain()).to.equal(true);

            emitForeignStateChange('foreign.rain', false);
            expect(weather.getRain()).to.equal(false);

            emitForeignStateChange('foreign.rain', null);
            expect(weather.getRain()).to.be.undefined;
        });

        it('returns undefined for a non-numeric value on a numeric metric instead of throwing/coercing', async () => {
            const { adapter, emitForeignStateChange } = createFakeAdapter({ 'foreign.solar': 100 });
            const weather = new WeatherSource(adapter, { solarRadiationStateId: 'foreign.solar' });
            await weather.start();

            emitForeignStateChange('foreign.solar', 'not-a-number');

            expect(weather.getSolarRadiation()).to.be.undefined;
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
