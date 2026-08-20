import { expect } from 'chai';
import sinon from 'sinon';
import { AutomationEngine, type IAutomationOptions } from './automation';
import type { ShutterController } from './shutter-controller';
import type { IShutterConfig } from './types';
import type { WeatherSource } from './weather-source';

/** Mutable weather readings, duck-typed as `WeatherSource` (a concrete class) so automation.ts's real evaluation logic runs against controllable inputs without needing a real adapter/foreign states. */
interface IFakeWeatherHandle {
    weather: WeatherSource;
    windSpeed: number | undefined;
    rain: boolean | undefined;
    solarRadiation: number | undefined;
    isSummer: boolean;
    outdoorTemp: number | undefined;
    humidity: number | undefined;
    cloudCover: number | undefined;
    windDirection: number | undefined;
}

function createFakeWeather(): IFakeWeatherHandle {
    const handle: IFakeWeatherHandle = {
        weather: undefined as unknown as WeatherSource,
        windSpeed: undefined,
        rain: undefined,
        solarRadiation: undefined,
        isSummer: true,
        outdoorTemp: undefined,
        humidity: undefined,
        cloudCover: undefined,
        windDirection: undefined,
    };
    handle.weather = {
        getWindSpeed: () => handle.windSpeed,
        getRain: () => handle.rain,
        getSolarRadiation: () => handle.solarRadiation,
        getIsSummer: () => handle.isSummer,
        getOutdoorTemperature: () => handle.outdoorTemp,
        getHumidity: () => handle.humidity,
        getCloudCover: () => handle.cloudCover,
        getWindDirection: () => handle.windDirection,
    } as unknown as WeatherSource;
    return handle;
}

/** Records every `applyAutomatedPosition()` call and lets tests drive `getCurrentCoveringPercent()`/the persisted override, duck-typed as `ShutterController`. */
interface IFakeControllerHandle {
    controller: ShutterController;
    config: IShutterConfig;
    appliedCalls: { percent: number; reason: string; bypass: boolean }[];
    overrideSetCalls: number[];
    currentPercent: number | undefined;
    persistedOverrideUntil: number;
    /** Defaults to `false` (settled/not moving) - see `hasDrifted` in `automation.ts`'s `applyTarget()`. */
    hasPendingMove: boolean;
    /** Every value passed to `setDoorProtectionActive()` (plan section 3/7e), in call order. */
    doorProtectionActiveCalls: boolean[];
    protectionActivityCalls: Partial<
        Record<'sunProtection' | 'rainProtection' | 'windProtection' | 'frostProtection' | 'nightCooling', boolean>
    >[];
    /** Every value passed to `setReasonDetail()`, in call order. */
    reasonDetailCalls: string[];
}

function createFakeController(config: IShutterConfig, persistedOverrideUntil = 0): IFakeControllerHandle {
    const handle: IFakeControllerHandle = {
        controller: undefined as unknown as ShutterController,
        config,
        appliedCalls: [],
        overrideSetCalls: [],
        currentPercent: undefined,
        persistedOverrideUntil,
        hasPendingMove: false,
        doorProtectionActiveCalls: [],
        protectionActivityCalls: [],
        reasonDetailCalls: [],
    };
    handle.controller = {
        onManualCommand: undefined as (() => void) | undefined,
        getConfig: () => config,
        isAutomationEnabled: () => config.automationEnabled,
        getCurrentCoveringPercent: () => handle.currentPercent,
        hasPendingMove: () => handle.hasPendingMove,
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async controller method
        setDoorProtectionActive: async (active: boolean) => {
            handle.doorProtectionActiveCalls.push(active);
        },
        setProtectionActivityStates: (
            active: Partial<
                Record<
                    'sunProtection' | 'rainProtection' | 'windProtection' | 'frostProtection' | 'nightCooling',
                    boolean
                >
            >,
        ) => {
            handle.protectionActivityCalls.push(active);
            return Promise.resolve();
        },
        setReasonDetail: (detail: string) => {
            handle.reasonDetailCalls.push(detail);
            return Promise.resolve();
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async controller method
        applyAutomatedPosition: async (percent: number, reason: string, bypass = false) => {
            handle.appliedCalls.push({ percent, reason, bypass });
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async controller method
        getPersistedSunProtectionOverrideUntil: async () => handle.persistedOverrideUntil,
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async controller method
        setSunProtectionOverrideUntil: async (untilMs: number) => {
            handle.persistedOverrideUntil = untilMs;
            handle.overrideSetCalls.push(untilMs);
        },
    } as unknown as ShutterController;
    return handle;
}

/** Minimal fake adapter exposing only what `AutomationEngine` needs (door-contact subscription + `setInterval`/`clearInterval`, never actually fired in these tests - see `evaluateNow()` used instead of waiting for the tick timer). */
function createFakeAdapter(): {
    adapter: ioBroker.Adapter;
    foreignStates: Map<string, ioBroker.State>;
    subscribedStateIds: string[];
    emitForeignStateChange: (id: string, val: ioBroker.StateValue) => void;
} {
    const foreignStates = new Map<string, ioBroker.State>();
    const subscribedStateIds: string[] = [];
    const listeners: ((id: string, state: ioBroker.State | null | undefined) => void)[] = [];

    const adapter = {
        log: { error: () => {}, warn: () => {} },
        setInterval: () => ({}) as unknown as ioBroker.Interval,
        clearInterval: () => {},
        subscribeForeignStatesAsync: (id: string) => {
            subscribedStateIds.push(id);
            return Promise.resolve();
        },
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getForeignStateAsync: async (id: string) => foreignStates.get(id),
        on: (event: string, listener: (id: string, state: ioBroker.State | null | undefined) => void) => {
            if (event === 'stateChange') {
                listeners.push(listener);
            }
        },
        removeListener: () => {},
    } as unknown as ioBroker.Adapter;

    return {
        adapter,
        foreignStates,
        subscribedStateIds,
        emitForeignStateChange: (id: string, val: ioBroker.StateValue) => {
            for (const listener of listeners) {
                listener(id, { val, ack: true } as ioBroker.State);
            }
        },
    };
}

function makeConfig(overrides: Partial<IShutterConfig> = {}): IShutterConfig {
    return {
        id: 'shutter1',
        name: 'Test Shutter',
        driverType: 'generic-position',
        coveringType: 'rolladen',
        automationEnabled: true,
        orientation: 180,
        states: {},
        ...overrides,
    };
}

const DEFAULT_OPTIONS: IAutomationOptions = {
    sunCloseThreshold: 200,
    sunProtectionGlobalEnabled: true,
    sunOpenThreshold: 150,
    sunOpenMinDurationMs: 600_000,
    sunProtectionCloudCoverTriggerEnabled: false,
    sunProtectionClearSkyCloudCoverMaxPercent: 40,
    windOpenThreshold: 40,
    windCloseAllowedThreshold: 25,
    windCalmMinDurationMs: 600_000,
    rainProtectionMinWindSpeedForDirectionKmh: 0,
    frostThreshold: 2,
    nightCoolingIndoorMinTemp: 24,
    nightCoolingMinDelta: 3,
    tickMs: 30_000,
    location: undefined,
};

describe('AutomationEngine', () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        // A summer afternoon, comfortably inside any plausible sun-protection time window (no
        // sunWindowStart/End configured in these tests means "always", but a realistic instant still
        // makes override/midnight-boundary math in the 6.4 tests easy to reason about).
        clock = sinon.useFakeTimers({ now: new Date(2026, 6, 15, 14, 0, 0, 0).getTime() });
    });

    afterEach(() => {
        clock.restore();
    });

    describe('priority order (plan section 8)', () => {
        it('wind protection wins over rain, sun and schedule', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: true }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 50; // >= windOpenThreshold (40)
            weather.rain = true;
            weather.solarRadiation = 999;
            engine.setScheduleTarget(controllerHandle.config.id, 100);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 0, reason: 'Wind protection', bypass: true },
            ]);
        });

        it('rain protection wins over sun protection and schedule (but not wind)', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: true }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = true;
            weather.solarRadiation = 999; // would also trigger sun protection if evaluated
            engine.setScheduleTarget(controllerHandle.config.id, 100);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 100, reason: 'Rain protection', bypass: false },
            ]);
        });

        it('sun protection wins over the schedule', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: true, sunTargetPercent: 70 }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = false;
            weather.solarRadiation = 300; // >= sunCloseThreshold (200)
            weather.isSummer = true;
            // Sun protection is only eligible while the schedule currently wants the covering open (0%).
            engine.setScheduleTarget(controllerHandle.config.id, 0);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 70, reason: 'Sun protection', bypass: false },
            ]);
        });

        it('a clear sky triggers sun protection independent of radiation once the cloud-cover trigger is enabled (plan section 6.3)', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: true, sunTargetPercent: 70 }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                {
                    ...DEFAULT_OPTIONS,
                    sunProtectionCloudCoverTriggerEnabled: true,
                    sunProtectionClearSkyCloudCoverMaxPercent: 40,
                },
            );

            weather.windSpeed = 0;
            weather.rain = false;
            weather.solarRadiation = 0; // well below sunCloseThreshold (200) - radiation alone would not trigger
            weather.cloudCover = 10; // clear sky
            weather.isSummer = true;
            engine.setScheduleTarget(controllerHandle.config.id, 0);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 70, reason: 'Sun protection', bypass: false },
            ]);
        });

        it('does not use the cloud-cover trigger while it is disabled, even at a clear sky reading', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: true, sunTargetPercent: 70 }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS, // sunProtectionCloudCoverTriggerEnabled: false
            );

            weather.windSpeed = 0;
            weather.rain = false;
            weather.solarRadiation = 0;
            weather.cloudCover = 0; // perfectly clear, but the trigger is disabled
            weather.isSummer = true;
            engine.setScheduleTarget(controllerHandle.config.id, 0);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 0, reason: 'Schedule', bypass: false }]);
        });

        it('does not trigger via cloud cover once the sky is no longer clear/mostly clear', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: true, sunTargetPercent: 70 }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                {
                    ...DEFAULT_OPTIONS,
                    sunProtectionCloudCoverTriggerEnabled: true,
                    sunProtectionClearSkyCloudCoverMaxPercent: 40,
                },
            );

            weather.windSpeed = 0;
            weather.rain = false;
            weather.solarRadiation = 0;
            weather.cloudCover = 80; // overcast
            weather.isSummer = true;
            engine.setScheduleTarget(controllerHandle.config.id, 0);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 0, reason: 'Schedule', bypass: false }]);
        });

        it('sun protection stays inactive below sunProtectionMinTemp, even at high radiation (plan section 6.5)', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: true, sunTargetPercent: 70, sunProtectionMinTemp: 20 }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = false;
            weather.solarRadiation = 300;
            weather.isSummer = true;
            weather.outdoorTemp = 15; // below sunProtectionMinTemp (20)
            engine.setScheduleTarget(controllerHandle.config.id, 0);

            engine.evaluateNow();

            // Sun protection is blocked by the temperature filter, so the schedule's own target (0%, i.e. open) applies instead.
            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 0, reason: 'Schedule', bypass: false }]);
        });

        it('sun protection applies once sunProtectionMinTemp is reached', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: true, sunTargetPercent: 70, sunProtectionMinTemp: 20 }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = false;
            weather.solarRadiation = 300;
            weather.isSummer = true;
            weather.outdoorTemp = 22;
            engine.setScheduleTarget(controllerHandle.config.id, 0);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 70, reason: 'Sun protection', bypass: false },
            ]);
        });

        it('frost protection suppresses the schedule entirely (no call at all)', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = false;
            weather.outdoorTemp = 0; // <= frostThreshold (2)
            weather.humidity = 90; // "damp" via humidity, since rain would otherwise win priority over frost
            engine.setScheduleTarget(controllerHandle.config.id, 100);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([]);
        });

        it('applies the schedule target when no protection is active', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = false;
            engine.setScheduleTarget(controllerHandle.config.id, 100);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 100, reason: 'Schedule', bypass: false }]);
        });

        it('does nothing when neither a protection nor a schedule target apply', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = false;

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([]);
        });

        it('skips coverings with automation disabled', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ automationEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.rain = true;
            engine.setScheduleTarget(controllerHandle.config.id, 100);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([]);
        });
    });

    it('disables sun and rain protection when orientation is missing', async () => {
        const weather = createFakeWeather();
        weather.rain = true;
        weather.solarRadiation = 500;
        const controllerHandle = createFakeController(makeConfig({ orientation: undefined }));
        controllerHandle.currentPercent = 0;
        const { adapter } = createFakeAdapter();
        const engine = new AutomationEngine(
            adapter,
            new Map([[controllerHandle.config.id, controllerHandle.controller]]),
            weather.weather,
            DEFAULT_OPTIONS,
        );

        await engine.start();
        engine.setScheduleTarget(controllerHandle.config.id, 0);
        engine.evaluateNow();

        expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 0, reason: 'Schedule', bypass: false }]);
        engine.stop();
    });

    describe('re-apply/dedupe behavior', () => {
        it('does not re-apply an unchanged schedule target on a later evaluation', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.have.length(1);
        });

        it('re-applies once the resolved target actually changes', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();
            engine.setScheduleTarget(controllerHandle.config.id, 0);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 100, reason: 'Schedule', bypass: false },
                { percent: 0, reason: 'Schedule', bypass: false },
            ]);
        });

        it('re-applies an unchanged target once the covering has settled but drifted away from it (e.g. an external system writing the same foreign state)', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            engine.setScheduleTarget(controllerHandle.config.id, 85);
            controllerHandle.currentPercent = 85; // arrived, matches target
            engine.evaluateNow();
            expect(controllerHandle.appliedCalls).to.have.length(1);

            // Something else (not this engine) moved the covering away from the still-unchanged target.
            controllerHandle.currentPercent = 100;
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 85, reason: 'Schedule', bypass: false },
                { percent: 85, reason: 'Schedule', bypass: false },
            ]);
        });

        it('does not treat normal in-flight travel towards an unchanged target as drift', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            engine.setScheduleTarget(controllerHandle.config.id, 85);
            controllerHandle.currentPercent = 20; // nowhere near the target yet
            controllerHandle.hasPendingMove = true; // ...but a move is still in flight - the watchdog's job, not this check's
            engine.evaluateNow();
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.have.length(1);
        });

        it('tolerates a small difference from the target as "arrived", matching the watchdog tolerance', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            engine.setScheduleTarget(controllerHandle.config.id, 85);
            controllerHandle.currentPercent = 83; // within WATCHDOG_TOLERANCE_PERCENT (3) of 85
            engine.evaluateNow();
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.have.length(1);
        });

        it('always re-asserts wind protection, even with an unchanged target', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig());
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 50;
            engine.evaluateNow();
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 0, reason: 'Wind protection', bypass: true },
                { percent: 0, reason: 'Wind protection', bypass: true },
            ]);
        });
    });

    describe('covering-type defaults for wind/frost protection (plan section 2a.5/7a/7b)', () => {
        it('does not activate wind protection for a lamellen covering by default', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ coveringType: 'lamellen', sunProtectionEnabled: false }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 50; // would activate wind protection for a rolladen
            engine.setScheduleTarget(controllerHandle.config.id, 100);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 100, reason: 'Schedule', bypass: false }]);
        });

        it('activates wind protection for a lamellen covering when explicitly enabled', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ coveringType: 'lamellen', windProtectionEnabled: true }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 50;

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 0, reason: 'Wind protection', bypass: true },
            ]);
        });

        it('does not activate rain protection for a lamellen covering by default (typically indoor, no weather exposure)', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ coveringType: 'lamellen', sunProtectionEnabled: false }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = true; // would activate rain protection for a rolladen
            engine.setScheduleTarget(controllerHandle.config.id, 100);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 100, reason: 'Schedule', bypass: false }]);
        });

        it('activates rain protection for a lamellen covering when explicitly enabled', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ coveringType: 'lamellen', rainProtectionEnabled: true, sunProtectionEnabled: false }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = true;

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 100, reason: 'Rain protection', bypass: false },
            ]);
        });

        it('uses a per-covering windOpenThreshold/windCloseAllowedThreshold override instead of the global thresholds (plan section 2a.5, e.g. a wind-sensitive markise)', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({
                    coveringType: 'markise',
                    windOpenThreshold: 20,
                    windCloseAllowedThreshold: 10,
                    sunProtectionEnabled: false,
                }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS, // global windOpenThreshold: 40, windCloseAllowedThreshold: 25
            );

            // Below the global threshold (40) but at/above this covering's own, lower override (20).
            weather.windSpeed = 25;
            engine.setScheduleTarget(controllerHandle.config.id, 0);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 0, reason: 'Wind protection', bypass: true },
            ]);
        });
    });

    describe('covering-type-dependent target positions (plan section 2a.5/7/7a)', () => {
        it('drives a markise to 0 (retracted) for wind protection, same as a rolladen', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ coveringType: 'markise' }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 50; // >= windOpenThreshold (40)

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 0, reason: 'Wind protection', bypass: true },
            ]);
        });

        it('drives a rolladen to 100 (closed) for rain protection by default', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = true;

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 100, reason: 'Rain protection', bypass: false },
            ]);
        });

        it('drives a markise to 0 (retracted), not 100, for rain protection by default', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ coveringType: 'markise', sunProtectionEnabled: false }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = true;

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 0, reason: 'Rain protection', bypass: false },
            ]);
        });

        it('an explicit rainTargetPercent still overrides the markise default', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ coveringType: 'markise', rainTargetPercent: 40, sunProtectionEnabled: false }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = true;

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 40, reason: 'Rain protection', bypass: false },
            ]);
        });

        it('protects on any rain when no wind-direction filter is configured, even with orientation set', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ orientation: 180, sunProtectionEnabled: false }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = true;
            weather.windDirection = 0; // blowing away from this South-facing window

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 100, reason: 'Rain protection', bypass: false },
            ]);
        });

        it('protects when the wind-direction filter is configured and the wind blows toward the window', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({
                    orientation: 180,
                    rainProtectionWindDirectionToleranceDeg: 45,
                    sunProtectionEnabled: false,
                }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = true;
            weather.windDirection = 190; // within ±45° of 180°

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 100, reason: 'Rain protection', bypass: false },
            ]);
        });

        it('does not protect when the wind-direction filter is configured and the wind blows away from the window', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({
                    orientation: 180,
                    rainProtectionWindDirectionToleranceDeg: 45,
                    sunProtectionEnabled: false,
                }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 0;
            weather.rain = true;
            weather.windDirection = 0; // outside ±45° of 180°
            engine.setScheduleTarget(controllerHandle.config.id, 0);

            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 0, reason: 'Schedule', bypass: false }]);
        });
    });

    describe('night cooling (plan section 7c)', () => {
        it('holds the covering open instead of closing when eligible and the schedule wants to close', async () => {
            const weather = createFakeWeather();
            weather.isSummer = true;
            weather.outdoorTemp = 18;
            const controllerHandle = createFakeController(
                makeConfig({
                    sunProtectionEnabled: false,
                    nightCoolingEnabled: true,
                    nightCoolingIndoorTempStateId: 'foreign.indoorTemp',
                }),
            );
            const { adapter, foreignStates } = createFakeAdapter();
            foreignStates.set('foreign.indoorTemp', { val: 26, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 0, reason: 'Night cooling', bypass: false },
            ]);

            engine.stop();
        });

        it('closes normally per schedule when night cooling is not enabled for the covering', async () => {
            const weather = createFakeWeather();
            weather.isSummer = true;
            weather.outdoorTemp = 18;
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: false, nightCoolingIndoorTempStateId: 'foreign.indoorTemp' }),
            );
            const { adapter, foreignStates } = createFakeAdapter();
            foreignStates.set('foreign.indoorTemp', { val: 26, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 100, reason: 'Schedule', bypass: false }]);

            engine.stop();
        });

        it('closes normally when no indoor-temperature sensor is configured, even if enabled', async () => {
            const weather = createFakeWeather();
            weather.isSummer = true;
            weather.outdoorTemp = 18;
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: false, nightCoolingEnabled: true }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 100, reason: 'Schedule', bypass: false }]);

            engine.stop();
        });

        it('does not apply outside summer, even if otherwise eligible', async () => {
            const weather = createFakeWeather();
            weather.isSummer = false;
            weather.outdoorTemp = 18;
            const controllerHandle = createFakeController(
                makeConfig({
                    sunProtectionEnabled: false,
                    nightCoolingEnabled: true,
                    nightCoolingIndoorTempStateId: 'foreign.indoorTemp',
                }),
            );
            const { adapter, foreignStates } = createFakeAdapter();
            foreignStates.set('foreign.indoorTemp', { val: 26, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 100, reason: 'Schedule', bypass: false }]);

            engine.stop();
        });

        it('never overrides an open schedule target (only ever competes with a close)', async () => {
            const weather = createFakeWeather();
            weather.isSummer = true;
            weather.outdoorTemp = 18;
            const controllerHandle = createFakeController(
                makeConfig({
                    sunProtectionEnabled: false,
                    nightCoolingEnabled: true,
                    nightCoolingIndoorTempStateId: 'foreign.indoorTemp',
                }),
            );
            const { adapter, foreignStates } = createFakeAdapter();
            foreignStates.set('foreign.indoorTemp', { val: 26, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 0);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 0, reason: 'Schedule', bypass: false }]);

            engine.stop();
        });

        it('does not hold the covering open while frost protection is active (safety outranks comfort)', async () => {
            const weather = createFakeWeather();
            weather.isSummer = true;
            weather.outdoorTemp = 0;
            weather.humidity = 90;
            const controllerHandle = createFakeController(
                makeConfig({
                    sunProtectionEnabled: false,
                    nightCoolingEnabled: true,
                    nightCoolingIndoorTempStateId: 'foreign.indoorTemp',
                }),
            );
            const { adapter, foreignStates } = createFakeAdapter();
            // Indoor temperature would otherwise qualify (>= indoorMinTemp with a big enough delta),
            // but the outdoor conditions above also happen to satisfy frost protection (7b), which must win.
            foreignStates.set('foreign.indoorTemp', { val: 26, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([]);

            engine.stop();
        });

        it('picks up a live indoor-temperature change without needing a restart', async () => {
            const weather = createFakeWeather();
            weather.isSummer = true;
            weather.outdoorTemp = 18;
            const controllerHandle = createFakeController(
                makeConfig({
                    sunProtectionEnabled: false,
                    nightCoolingEnabled: true,
                    nightCoolingIndoorTempStateId: 'foreign.indoorTemp',
                }),
            );
            const { adapter, foreignStates, emitForeignStateChange } = createFakeAdapter();
            foreignStates.set('foreign.indoorTemp', { val: 20, ack: true } as ioBroker.State); // too cool at first
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 100, reason: 'Schedule', bypass: false }]);

            emitForeignStateChange('foreign.indoorTemp', 27); // now hot enough
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 100, reason: 'Schedule', bypass: false },
                { percent: 0, reason: 'Night cooling', bypass: false },
            ]);

            engine.stop();
        });
    });

    describe('door-contact clamping (plan section 7e)', () => {
        it('clamps a closing schedule target to the current position while the door is open', async () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ doorContactStateId: 'foreign.door', sunProtectionEnabled: false }),
            );
            controllerHandle.currentPercent = 20;
            const { adapter, foreignStates, emitForeignStateChange } = createFakeAdapter();
            foreignStates.set('foreign.door', { val: true, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 20, reason: 'Schedule', bypass: false }]);

            emitForeignStateChange('foreign.door', false);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 20, reason: 'Schedule', bypass: false },
                { percent: 100, reason: 'Schedule', bypass: false },
            ]);

            engine.stop();
        });

        it('does not subscribe to or clamp a disabled door contact', async () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({
                    doorContactStateId: 'foreign.door',
                    doorProtectionEnabled: false,
                    sunProtectionEnabled: false,
                }),
            );
            controllerHandle.currentPercent = 20;
            const { adapter, foreignStates, subscribedStateIds } = createFakeAdapter();
            foreignStates.set('foreign.door', { val: true, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();

            expect(subscribedStateIds).not.to.include('foreign.door');
            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 100, reason: 'Schedule', bypass: false }]);
            expect(controllerHandle.doorProtectionActiveCalls).to.deep.equal([false, false]);
            engine.stop();
        });

        it('inverts the configured door-contact state when requested', async () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({
                    doorContactStateId: 'foreign.door',
                    invertDoorContact: true,
                    sunProtectionEnabled: false,
                }),
            );
            controllerHandle.currentPercent = 20;
            const { adapter, foreignStates, emitForeignStateChange } = createFakeAdapter();
            foreignStates.set('foreign.door', { val: true, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 100);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 100, reason: 'Schedule', bypass: false }]);
            expect(controllerHandle.doorProtectionActiveCalls).to.deep.equal([false, false]);

            emitForeignStateChange('foreign.door', false);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 100, reason: 'Schedule', bypass: false },
                { percent: 20, reason: 'Schedule', bypass: false },
            ]);
            expect(controllerHandle.doorProtectionActiveCalls).to.deep.equal([false, false, true]);

            engine.stop();
        });

        it('never clamps an opening target', async () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ doorContactStateId: 'foreign.door', sunProtectionEnabled: false }),
            );
            controllerHandle.currentPercent = 80;
            const { adapter, foreignStates } = createFakeAdapter();
            foreignStates.set('foreign.door', { val: true, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();
            engine.setScheduleTarget(controllerHandle.config.id, 0);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([{ percent: 0, reason: 'Schedule', bypass: false }]);

            engine.stop();
        });

        it('reports doorProtectionActive as reflecting the door-contact state, independent of clamping (plan section 3)', async () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ doorContactStateId: 'foreign.door', sunProtectionEnabled: false }),
            );
            const { adapter, foreignStates, emitForeignStateChange } = createFakeAdapter();
            foreignStates.set('foreign.door', { val: false, ack: true } as ioBroker.State);
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            // start() itself already runs one tick, hence one `false` call before evaluateNow() below.
            await engine.start();
            engine.evaluateNow();
            expect(controllerHandle.doorProtectionActiveCalls).to.deep.equal([false, false]);

            emitForeignStateChange('foreign.door', true);
            engine.evaluateNow();
            expect(controllerHandle.doorProtectionActiveCalls).to.deep.equal([false, false, true]);

            engine.stop();
        });

        it('reports doorProtectionActive as false for a covering with no door contact configured', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            engine.evaluateNow();

            expect(controllerHandle.doorProtectionActiveCalls).to.deep.equal([false]);
        });
    });

    describe('manual sun-protection override (plan section 6.4/9a.2)', () => {
        it('suspends sun protection until midnight after a manual command, and persists the deadline', async () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: true, sunTargetPercent: 70 }),
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );
            await engine.start();

            weather.windSpeed = 0;
            weather.rain = false;
            weather.solarRadiation = 300;
            engine.setScheduleTarget(controllerHandle.config.id, 0);
            engine.evaluateNow();
            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 70, reason: 'Sun protection', bypass: false },
            ]);

            // Simulate a manual command: ShutterController would call this directly.
            controllerHandle.controller.onManualCommand?.();

            expect(controllerHandle.overrideSetCalls).to.have.length(2);
            const expectedMidnight = new Date(2026, 6, 16, 0, 0, 0, 0).getTime();
            expect(controllerHandle.overrideSetCalls[1]).to.equal(expectedMidnight);

            engine.evaluateNow();
            expect(controllerHandle.appliedCalls).to.deep.equal([
                {
                    percent: 70,
                    reason: 'Sun protection',
                    bypass: false,
                },
            ]);

            engine.setScheduleTarget(controllerHandle.config.id, 0);
            engine.evaluateNow();
            expect(controllerHandle.overrideSetCalls).to.deep.equal([0, expectedMidnight, 0]);
            expect(controllerHandle.appliedCalls).to.deep.equal([
                {
                    percent: 70,
                    reason: 'Sun protection',
                    bypass: false,
                },
            ]);

            engine.stop();
        });

        it('clears a persisted override deadline on start(), allowing sun protection after a restart', async () => {
            const weather = createFakeWeather();
            const futureOverride = new Date(2026, 6, 16, 0, 0, 0, 0).getTime(); // later tonight
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: true, sunTargetPercent: 70 }),
                futureOverride,
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();

            weather.windSpeed = 0;
            weather.rain = false;
            weather.solarRadiation = 300;
            engine.setScheduleTarget(controllerHandle.config.id, 0);
            engine.evaluateNow();

            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 70, reason: 'Sun protection', bypass: false },
            ]);
            expect(controllerHandle.overrideSetCalls).to.deep.equal([0]);

            engine.stop();
        });

        it('clears the override (in-memory and persisted) once its deadline has passed', async () => {
            const weather = createFakeWeather();
            const pastOverride = new Date(2026, 6, 15, 0, 0, 0, 0).getTime(); // earlier today, already expired
            const controllerHandle = createFakeController(
                makeConfig({ sunProtectionEnabled: true, sunTargetPercent: 70 }),
                pastOverride,
            );
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            await engine.start();

            weather.windSpeed = 0;
            weather.rain = false;
            weather.solarRadiation = 300;
            engine.setScheduleTarget(controllerHandle.config.id, 0);
            engine.evaluateNow();

            // The expired override no longer suppresses sun protection...
            expect(controllerHandle.appliedCalls).to.deep.equal([
                { percent: 70, reason: 'Sun protection', bypass: false },
            ]);
            // ...and was explicitly cleared back to 0 in storage, not left at the stale past timestamp.
            expect(controllerHandle.overrideSetCalls).to.deep.equal([0]);
            expect(controllerHandle.persistedOverrideUntil).to.equal(0);

            engine.stop();
        });
    });

    describe('aggregated wind/frost protection notifications (plan section 9a.3)', () => {
        it('fires onWindProtectionChange(true) once wind protection engages, and (false) once it clears', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig());
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );
            const changes: boolean[] = [];
            engine.onWindProtectionChange = active => changes.push(active);

            weather.windSpeed = 0;
            engine.evaluateNow();
            expect(changes).to.deep.equal([]); // never engaged - no edge yet

            weather.windSpeed = 50; // >= windOpenThreshold (40)
            engine.evaluateNow();
            expect(changes).to.deep.equal([true]);

            engine.evaluateNow(); // stays active - must not re-fire
            expect(changes).to.deep.equal([true]);

            weather.windSpeed = 0;
            engine.evaluateNow(); // calm hysteresis satisfied immediately (windCalmMinDurationMs elapsed via update() below threshold)
            clock.tick(DEFAULT_OPTIONS.windCalmMinDurationMs + 1);
            engine.evaluateNow();
            expect(changes).to.deep.equal([true, false]);
        });

        it('fires only one combined onWindProtectionChange(true) even when a second covering also engages afterwards', () => {
            const weather = createFakeWeather();
            const controllerA = createFakeController(makeConfig({ id: 'shutter1' }));
            const controllerB = createFakeController(makeConfig({ id: 'shutter2' }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([
                    [controllerA.config.id, controllerA.controller],
                    [controllerB.config.id, controllerB.controller],
                ]),
                weather.weather,
                DEFAULT_OPTIONS,
            );
            const changes: boolean[] = [];
            engine.onWindProtectionChange = active => changes.push(active);

            weather.windSpeed = 50;
            engine.evaluateNow(); // both coverings engage on the same tick
            expect(changes).to.deep.equal([true]);

            // Both coverings are affected identically by the same shared weather reading, so this
            // scenario (one covering's wind protection clearing while another's is still active) is
            // exercised structurally by the "does not count a covering with automation disabled"
            // test below instead of via a real staggered-threshold setup.
        });

        it('fires onFrostProtectionChange(true)/(false) on the aggregate rising/falling edge', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig());
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );
            const changes: boolean[] = [];
            engine.onFrostProtectionChange = active => changes.push(active);

            weather.windSpeed = 0;
            weather.rain = false;
            weather.outdoorTemp = 10;
            engine.evaluateNow();
            expect(changes).to.deep.equal([]);

            weather.outdoorTemp = 0; // <= frostThreshold (2)
            weather.humidity = 90; // "damp" per evaluateFrostProtection, without also triggering rain protection
            engine.evaluateNow();
            expect(changes).to.deep.equal([true]);

            engine.evaluateNow(); // stays active - must not re-fire
            expect(changes).to.deep.equal([true]);

            weather.outdoorTemp = 15;
            engine.evaluateNow();
            expect(changes).to.deep.equal([true, false]);
        });

        it('does not count a covering with automation disabled towards the aggregate', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ automationEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );
            const changes: boolean[] = [];
            engine.onWindProtectionChange = active => changes.push(active);

            weather.windSpeed = 50;
            engine.evaluateNow();

            expect(changes).to.deep.equal([]);
            expect(controllerHandle.appliedCalls).to.deep.equal([]);
        });

        it('publishes only the protection that wins the automation decision', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: true }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            weather.windSpeed = 50;
            weather.rain = true;
            weather.solarRadiation = 300;
            engine.setScheduleTarget(controllerHandle.config.id, 0);
            engine.evaluateNow();

            expect(controllerHandle.protectionActivityCalls).to.deep.equal([{ windProtection: true }]);
        });

        it('clears protection activity when automation is disabled', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ automationEnabled: false }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );

            engine.evaluateNow();

            expect(controllerHandle.protectionActivityCalls).to.deep.equal([{}]);
        });

        it('fires onSunProtectionChange(true)/(false) on the aggregate rising/falling edge (plan section 10a.14)', () => {
            const weather = createFakeWeather();
            const controllerHandle = createFakeController(makeConfig({ sunProtectionEnabled: true }));
            const { adapter } = createFakeAdapter();
            const engine = new AutomationEngine(
                adapter,
                new Map([[controllerHandle.config.id, controllerHandle.controller]]),
                weather.weather,
                DEFAULT_OPTIONS,
            );
            const changes: boolean[] = [];
            engine.onSunProtectionChange = active => changes.push(active);

            weather.windSpeed = 0;
            weather.rain = false;
            weather.isSummer = true;
            weather.solarRadiation = 0;
            engine.setScheduleTarget(controllerHandle.config.id, 0);
            engine.evaluateNow();
            expect(changes).to.deep.equal([]);

            weather.solarRadiation = 300; // >= sunCloseThreshold (200)
            engine.evaluateNow();
            expect(changes).to.deep.equal([true]);

            engine.evaluateNow(); // stays active - must not re-fire
            expect(changes).to.deep.equal([true]);

            weather.solarRadiation = 0;
            engine.evaluateNow(); // starts the "below open threshold since" hysteresis clock
            clock.tick(DEFAULT_OPTIONS.sunOpenMinDurationMs + 1);
            engine.evaluateNow();
            expect(changes).to.deep.equal([true, false]);
        });
    });
});
