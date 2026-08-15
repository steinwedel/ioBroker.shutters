import { clampForDoorProtection } from './door-protection';
import { protectedPosition, safePosition } from './covering-types';
import { evaluateFrostProtection } from './frost-protection';
import { BelowThresholdHysteresis } from './generic-hysteresis';
import { evaluateNightCooling } from './night-cooling';
import { evaluateRainProtection } from './rain-protection';
import type { ShutterController } from './shutter-controller';
import {
    evaluateSunProtection,
    isHeatProtectionMinTempSatisfied,
    isSunProtectionEligible,
    isWithinOrientationWindow,
    isWithinTimeWindow,
} from './sun-protection';
import { getSunPosition } from './twilight';
import type { CoveringType, IShutterConfig } from './types';
import { evaluateWindProtection } from './wind-protection';
import type { WeatherSource } from './weather-source';

/**
 * Default wind/frost protection availability per covering type; explicit `windProtectionEnabled`/`frostProtectionEnabled` always take precedence (plan section 2a.5/7a/7b).
 *
 * @param coveringType - Covering type to look up the default for.
 */
function defaultOutdoorProtectionEnabled(coveringType: CoveringType): boolean {
    return coveringType !== 'lamellen';
}

interface ICoveringAutomationState {
    /** Whether sun protection is currently active for this covering. */
    sunActive: boolean;
    /** Whether wind protection is currently active for this covering. */
    windActive: boolean;
    /** Whether frost protection is currently active (suppressing automated movement) for this covering. */
    frostActive: boolean;
    /** Whether night cooling is currently active (holding the covering open through what would otherwise be the schedule's close) for this covering. */
    nightCoolingActive: boolean;
    /** Tracks how long solar radiation has stayed below the "may open again" threshold. */
    sunHysteresis: BelowThresholdHysteresis;
    /** Tracks how long wind speed has stayed below the "calm enough to deactivate" threshold. */
    windHysteresis: BelowThresholdHysteresis;
    /** Local midnight (ms since epoch) until which sun protection is suspended for this covering, see plan section 6.4; 0 = no active override. */
    sunOverrideUntilMs: number;
}

/** Global thresholds/hysteresis durations for `AutomationEngine`. */
export interface IAutomationOptions {
    /** Solar radiation (W/m²) at/above which sun protection closes. */
    sunCloseThreshold: number;
    /** Whether sun protection is globally enabled. */
    sunProtectionGlobalEnabled: boolean;
    /** Solar radiation (W/m²) below which sun protection may open again, after `sunOpenMinDurationMs`. */
    sunOpenThreshold: number;
    /** How long solar radiation must stay below `sunOpenThreshold` before opening again. */
    sunOpenMinDurationMs: number;
    /** Wind speed (km/h) at/above which wind protection activates. */
    windOpenThreshold: number;
    /** Wind speed (km/h) below which wind protection may deactivate again, after `windCalmMinDurationMs`. */
    windCloseAllowedThreshold: number;
    /** How long wind speed must stay below `windCloseAllowedThreshold` before deactivating wind protection. */
    windCalmMinDurationMs: number;
    /** Outdoor temperature (°C) at/below which frost protection may activate. */
    frostThreshold: number;
    /** Indoor temperature (°C) at/above which night cooling (7c) may activate for an eligible covering. */
    nightCoolingIndoorMinTemp: number;
    /** Minimum indoor-minus-outdoor temperature difference (°C) required for night cooling (7c) to activate. */
    nightCoolingMinDelta: number;
    /** How often the automation engine re-evaluates all coverings, in ms. */
    tickMs: number;
    /** Location used to compute the sun's azimuth for orientation-based sun windows (6.2); undefined disables that mode, falling back to `sunWindowStart`/`sunWindowEnd` for every covering. */
    location: { latitude: number; longitude: number } | undefined;
}

/**
 * Central priority resolver (plan section 8): evaluates wind, rain, sun and
 * frost protection plus door-contact clamping for every automation-enabled
 * covering on a fixed tick, and applies the winning target position. The
 * daily schedule (`scheduler.ts`) feeds its own desired target into this
 * engine via `setScheduleTarget()` rather than driving coverings directly,
 * so schedule and protection modules share one consistent priority order:
 *
 * 1. Wind protection (always wins, even over a sun-protection override)
 * 2. Rain protection
 * 3. Sun protection (unless overridden until local midnight by a manual command)
 * 4. Schedule - or, while the schedule wants to close and night cooling (7c) is active for this
 *    covering, night cooling instead, holding it open
 * 5. Frost protection suppresses automated movement entirely, taking priority over night cooling
 *    (a genuine mechanical/safety concern outranks a comfort feature), but not over wind/rain/sun.
 *
 * All of the above are subject to door-contact clamping (never close
 * further than the current position while the door is open). Manual
 * commands are handled directly by `ShutterController` and are not part of
 * this tick; this engine only reacts to them via `onManualCommand`.
 */
export class AutomationEngine {
    private readonly states = new Map<string, ICoveringAutomationState>();
    private readonly scheduleTargets = new Map<string, number>();
    private readonly lastApplied = new Map<string, { percent: number; reason: string }>();
    private readonly doorOpenByStateId = new Map<string, boolean>();
    /** Most recently read value of every configured `nightCoolingIndoorTempStateId` (plan section 7c), kept up to date the same way as `doorOpenByStateId`. */
    private readonly indoorTempByStateId = new Map<string, number | undefined>();
    private tickTimer: ioBroker.Interval | undefined;
    /** Whether wind protection was active for at least one covering as of the last tick, see `notifyAggregatedProtectionChanges()`. */
    private windProtectionEngaged = false;
    /** Whether frost protection was active for at least one covering as of the last tick, see `notifyAggregatedProtectionChanges()`. */
    private frostProtectionEngaged = false;
    /** Whether sun protection was active for at least one covering as of the last tick, see `notifyAggregatedProtectionChanges()`/`onSunProtectionChange`. */
    private sunProtectionEngaged = false;

    /**
     * Called whenever wind protection (plan section 7a) engages for the first covering or clears for
     * the first one - aggregated across every covering rather than per covering, so a storm affecting
     * many coverings at once produces one notification instead of one per covering (plan section
     * 9a.3/10a.6). Used by `main.ts` to forward it to `notify.ts`.
     */
    public onWindProtectionChange: ((active: boolean) => void) | undefined;
    /** Same as `onWindProtectionChange`, for frost protection (plan section 7b). */
    public onFrostProtectionChange: ((active: boolean) => void) | undefined;
    /**
     * Same as `onWindProtectionChange`, for sun protection (plan section 6) - used by `main.ts` for the
     * seasonal reminder (plan section 10a.14), not for a routine notification (sun protection engaging
     * is normal, expected behavior, unlike wind/frost).
     */
    public onSunProtectionChange: ((active: boolean) => void) | undefined;

    /**
     * @param adapter - Adapter instance, used for `setInterval`/`clearInterval` and foreign door-state access.
     * @param controllers - All configured coverings.
     * @param weather - Central weather value provider.
     * @param options - Global thresholds/hysteresis durations, see `IAutomationOptions`.
     */
    public constructor(
        private readonly adapter: ioBroker.Adapter,
        private readonly controllers: Map<string, ShutterController>,
        private readonly weather: WeatherSource,
        private readonly options: IAutomationOptions,
    ) {
        for (const [id, controller] of controllers) {
            this.states.set(id, {
                sunActive: false,
                windActive: false,
                frostActive: false,
                nightCoolingActive: false,
                sunHysteresis: new BelowThresholdHysteresis(),
                windHysteresis: new BelowThresholdHysteresis(),
                sunOverrideUntilMs: 0,
            });
            controller.onManualCommand = () => this.handleManualCommand(id);
        }
    }

    /** Subscribes all configured door-contact/indoor-temperature states and starts the periodic evaluation tick. */
    public async start(): Promise<void> {
        // Restore any sun-protection override deadline that was still active when the adapter last
        // stopped (plan section 9a.2) - without this, a "Tagessperre" set by a manual command would be
        // silently lost on every restart, and sun protection could re-engage the same day even though
        // the user had just overridden it.
        for (const [id, controller] of this.controllers) {
            const state = this.states.get(id);
            if (state) {
                state.sunOverrideUntilMs = await controller.getPersistedSunProtectionOverrideUntil();
            }
        }

        const doorStateIds = new Set<string>();
        const indoorTempStateIds = new Set<string>();
        for (const controller of this.controllers.values()) {
            const config = controller.getConfig();
            if (config.doorContactStateId) {
                doorStateIds.add(config.doorContactStateId);
            }
            if (config.nightCoolingIndoorTempStateId) {
                indoorTempStateIds.add(config.nightCoolingIndoorTempStateId);
            }
        }
        for (const stateId of doorStateIds) {
            await this.adapter.subscribeForeignStatesAsync(stateId);
            const state = await this.adapter.getForeignStateAsync(stateId);
            this.doorOpenByStateId.set(stateId, state?.val === true);
        }
        for (const stateId of indoorTempStateIds) {
            await this.adapter.subscribeForeignStatesAsync(stateId);
            const state = await this.adapter.getForeignStateAsync(stateId);
            this.indoorTempByStateId.set(stateId, typeof state?.val === 'number' ? state.val : undefined);
        }
        this.adapter.on('stateChange', this.handleForeignStateChange);

        this.tick();
        this.tickTimer = this.adapter.setInterval(() => this.tick(), this.options.tickMs);
    }

    /** Stops the periodic evaluation tick and unsubscribes the door-state/indoor-temperature listener. */
    public stop(): void {
        this.adapter.removeListener('stateChange', this.handleForeignStateChange);
        if (this.tickTimer) {
            this.adapter.clearInterval(this.tickTimer);
            this.tickTimer = undefined;
        }
    }

    /**
     * Sets (or clears) the schedule's desired target for a covering. Called
     * by the `onTrigger` handler wired to `scheduler.ts` in main.ts.
     *
     * @param coveringId - `IShutterConfig.id` of the affected covering.
     * @param percent - Desired covering position, 0-100, or undefined to clear (no schedule target currently pending).
     */
    public setScheduleTarget(coveringId: string, percent: number | undefined): void {
        if (percent === undefined) {
            this.scheduleTargets.delete(coveringId);
        } else {
            this.scheduleTargets.set(coveringId, percent);
        }
    }

    /**
     * Forces an immediate re-evaluation of every covering instead of waiting for the next periodic
     * tick (up to `tickMs` later). Call right after `setScheduleTarget()` for a schedule trigger, so a
     * covering that is already eligible for e.g. sun protection is never briefly commanded to the plain
     * schedule target first.
     */
    public evaluateNow(): void {
        this.tick();
    }

    /** Updates `doorOpenByStateId`/`indoorTempByStateId` as their subscribed foreign states change; ignores every other state change. */
    private readonly handleForeignStateChange = (id: string, state: ioBroker.State | null | undefined): void => {
        if (this.doorOpenByStateId.has(id)) {
            this.doorOpenByStateId.set(id, state?.val === true);
        }
        if (this.indoorTempByStateId.has(id)) {
            this.indoorTempByStateId.set(id, typeof state?.val === 'number' ? state.val : undefined);
        }
    };

    /**
     * Called by a covering's `onManualCommand` hook. If sun protection was
     * active for that covering, suspends it until local midnight (plan
     * section 6.4), persisting the deadline (9a.2) so it survives an
     * adapter restart before that midnight.
     *
     * @param coveringId - `IShutterConfig.id` of the covering that was just manually commanded.
     */
    private handleManualCommand(coveringId: string): void {
        const state = this.states.get(coveringId);
        if (!state || !state.sunActive) {
            return;
        }
        const midnight = new Date();
        midnight.setDate(midnight.getDate() + 1);
        midnight.setHours(0, 0, 0, 0);
        state.sunOverrideUntilMs = midnight.getTime();
        state.sunActive = false;

        const controller = this.controllers.get(coveringId);
        controller?.setSunProtectionOverrideUntil(state.sunOverrideUntilMs).catch(err => {
            this.adapter.log.error(
                `Persisting sun-protection override for covering "${coveringId}" failed: ${(err as Error).message}`,
            );
        });
    }

    private tick(): void {
        const now = new Date();
        const nowMs = now.getTime();

        for (const [id, controller] of this.controllers) {
            if (!controller.isAutomationEnabled()) {
                // Not part of the aggregate wind/frost/sun protection state (below) while disabled - a
                // covering the user has taken out of automation is not being protected anymore, so it
                // must not keep contributing a stale "active" value from before it was disabled.
                const state = this.states.get(id);
                if (state) {
                    state.windActive = false;
                    state.frostActive = false;
                    state.nightCoolingActive = false;
                    state.sunActive = false;
                }
                continue;
            }
            try {
                this.evaluateCovering(id, controller, now, nowMs);
            } catch (err) {
                this.adapter.log.error(`Automation evaluation failed for covering "${id}": ${(err as Error).message}`);
            }
        }

        this.notifyAggregatedProtectionChanges();
    }

    /**
     * Compares this tick's combined wind/frost protection state (active for at least one covering)
     * against the previous tick and fires `onWindProtectionChange`/`onFrostProtectionChange` on a
     * rising/falling edge, see those fields' docs. Called once per tick, after every covering has been
     * (re-)evaluated.
     */
    private notifyAggregatedProtectionChanges(): void {
        let windActiveNow = false;
        let frostActiveNow = false;
        let sunActiveNow = false;
        for (const state of this.states.values()) {
            windActiveNow = windActiveNow || state.windActive;
            frostActiveNow = frostActiveNow || state.frostActive;
            sunActiveNow = sunActiveNow || state.sunActive;
        }

        if (windActiveNow !== this.windProtectionEngaged) {
            this.windProtectionEngaged = windActiveNow;
            this.onWindProtectionChange?.(windActiveNow);
        }
        if (frostActiveNow !== this.frostProtectionEngaged) {
            this.frostProtectionEngaged = frostActiveNow;
            this.onFrostProtectionChange?.(frostActiveNow);
        }
        if (sunActiveNow !== this.sunProtectionEngaged) {
            this.sunProtectionEngaged = sunActiveNow;
            this.onSunProtectionChange?.(sunActiveNow);
        }
    }

    private evaluateCovering(id: string, controller: ShutterController, now: Date, nowMs: number): void {
        const config = controller.getConfig();
        const state = this.states.get(id);
        if (!state) {
            return;
        }

        const windEnabled = config.windProtectionEnabled ?? defaultOutdoorProtectionEnabled(config.coveringType);
        const calmAllowed = state.windHysteresis.update(
            this.weather.getWindSpeed(),
            this.options.windCloseAllowedThreshold,
            this.options.windCalmMinDurationMs,
        );
        state.windActive =
            windEnabled &&
            evaluateWindProtection({
                windSpeed: this.weather.getWindSpeed(),
                openThreshold: this.options.windOpenThreshold,
                calmAllowed,
                wasActive: state.windActive,
            });

        if (state.windActive) {
            state.frostActive = false;
            state.nightCoolingActive = false;
            this.applyTarget(
                id,
                controller,
                safePosition(config.coveringType),
                'Wind protection',
                config.doorContactStateId,
                true,
            );
            return;
        }

        const rainEnabled = config.rainProtectionEnabled ?? true;
        const rainActive = rainEnabled && evaluateRainProtection(this.weather.getRain());
        if (rainActive) {
            state.frostActive = false;
            state.nightCoolingActive = false;
            const target = config.rainTargetPercent ?? protectedPosition(config.coveringType);
            this.applyTarget(id, controller, target, 'Rain protection', config.doorContactStateId);
            return;
        }

        // Once the override deadline has passed, clear it (both in-memory and persisted, plan section
        // 9a.2) so a stale future-looking timestamp does not linger in the visible state tree, and so a
        // manual command later that same day starts from a clean slate rather than instantly appearing
        // "already overridden" from a leftover value.
        if (state.sunOverrideUntilMs !== 0 && nowMs >= state.sunOverrideUntilMs) {
            state.sunOverrideUntilMs = 0;
            controller.setSunProtectionOverrideUntil(0).catch(err => {
                this.adapter.log.error(
                    `Clearing sun-protection override for covering "${id}" failed: ${(err as Error).message}`,
                );
            });
        }

        const sunEnabled = config.sunProtectionEnabled ?? true;
        const sunOverrideActive = nowMs < state.sunOverrideUntilMs;
        const scheduleOpen = this.scheduleTargets.get(id) === 0;
        const inWindow = this.isWithinSunWindow(config, now);
        const minTempSatisfied = isHeatProtectionMinTempSatisfied(
            this.weather.getOutdoorTemperature(),
            config.sunProtectionMinTemp,
        );
        const sunEligible = isSunProtectionEligible(
            this.options.sunProtectionGlobalEnabled,
            sunEnabled,
            this.weather.getIsSummer(),
            scheduleOpen,
            inWindow,
            sunOverrideActive,
            minTempSatisfied,
        );
        if (!sunEligible) {
            state.sunHysteresis.reset();
            state.sunActive = false;
        } else {
            const openAllowed = state.sunHysteresis.update(
                this.weather.getSolarRadiation(),
                this.options.sunOpenThreshold,
                this.options.sunOpenMinDurationMs,
            );
            state.sunActive = evaluateSunProtection({
                inWindow: true,
                solarRadiation: this.weather.getSolarRadiation(),
                closeThreshold: this.options.sunCloseThreshold,
                openAllowed,
                wasActive: state.sunActive,
            });
        }
        if (state.sunActive) {
            state.frostActive = false;
            state.nightCoolingActive = false;
            const target = config.sunTargetPercent ?? 70;
            this.applyTarget(id, controller, target, 'Sun protection', config.doorContactStateId);
            return;
        }

        const frostEnabled = config.frostProtectionEnabled ?? defaultOutdoorProtectionEnabled(config.coveringType);
        const frostActive =
            frostEnabled &&
            evaluateFrostProtection({
                outdoorTemp: this.weather.getOutdoorTemperature(),
                humidity: this.weather.getHumidity(),
                rain: this.weather.getRain(),
                threshold: this.options.frostThreshold,
            });
        state.frostActive = frostActive;
        if (frostActive) {
            // Automated movement is suppressed entirely; leave the covering as-is. This takes
            // priority over night cooling (7c) - a genuine mechanical/safety concern outranks a
            // comfort feature.
            state.nightCoolingActive = false;
            return;
        }

        const scheduleTarget = this.scheduleTargets.get(id);
        if (scheduleTarget === undefined) {
            state.nightCoolingActive = false;
            return;
        }

        // Night cooling (7c) only ever matters while the schedule is about to close the covering -
        // that is already only the case in the evening/night per this covering's own plan, so no
        // separately configured "night window" is needed on top of it (see night-cooling.ts doc).
        if (scheduleTarget === 100) {
            const nightCoolingEnabled = config.nightCoolingEnabled ?? false;
            const indoorTempStateId = config.nightCoolingIndoorTempStateId;
            state.nightCoolingActive =
                nightCoolingEnabled &&
                !!indoorTempStateId &&
                evaluateNightCooling({
                    indoorTemp: this.indoorTempByStateId.get(indoorTempStateId),
                    outdoorTemp: this.weather.getOutdoorTemperature(),
                    indoorMinTemp: this.options.nightCoolingIndoorMinTemp,
                    minDelta: this.options.nightCoolingMinDelta,
                    isSummer: this.weather.getIsSummer(),
                });
            if (state.nightCoolingActive) {
                this.applyTarget(id, controller, 0, 'Night cooling', config.doorContactStateId);
                return;
            }
        } else {
            state.nightCoolingActive = false;
        }

        this.applyTarget(id, controller, scheduleTarget, 'Schedule', config.doorContactStateId);
    }

    /**
     * Resolves whether sun protection may currently apply to a covering, based on the sun's
     * azimuth relative to the covering's `orientation` (6.2) when both `orientation` and a
     * location are configured, otherwise falling back to the fixed `sunWindowStart`/`sunWindowEnd`
     * clock-time window (6.1).
     *
     * @param config - The covering's configuration, providing `orientation`/`orientationToleranceMinusDeg`/`orientationTolerancePlusDeg` or the `sunWindowStart`/`sunWindowEnd` fallback.
     * @param now - Current time.
     */
    private isWithinSunWindow(config: IShutterConfig, now: Date): boolean {
        if (config.orientation !== undefined && this.options.location) {
            const sun = getSunPosition(now, this.options.location.latitude, this.options.location.longitude);
            return isWithinOrientationWindow(
                sun.azimuthDeg,
                config.orientation,
                config.orientationToleranceMinusDeg ?? -60,
                config.orientationTolerancePlusDeg ?? 60,
            );
        }
        return isWithinTimeWindow(now, config.sunWindowStart, config.sunWindowEnd);
    }

    /**
     * @param id - `IShutterConfig.id` of the affected covering.
     * @param controller - The covering's controller.
     * @param desiredPercent - Target covering height/extension, 0-100, before door-contact clamping.
     * @param reason - Human-readable reason for `statusText`, see `ShutterController.applyAutomatedPosition()`.
     * @param doorContactStateId - The covering's configured door-contact state ID, if any.
     * @param bypassMotorProtection - Forwarded to `applyAutomatedPosition()`; set for wind protection (7a), which must never wait on the motor-protection cooldown (7d).
     */
    private applyTarget(
        id: string,
        controller: ShutterController,
        desiredPercent: number,
        reason: string,
        doorContactStateId: string | undefined,
        bypassMotorProtection = false,
    ): void {
        const currentPercent = controller.getCurrentCoveringPercent();
        const doorOpen = doorContactStateId ? (this.doorOpenByStateId.get(doorContactStateId) ?? false) : false;
        const target = clampForDoorProtection(desiredPercent, currentPercent, doorOpen);

        const previous = this.lastApplied.get(id);
        // Wind protection always re-asserts (plan section 7a); everything
        // else only re-applies when the resolved target/reason actually changed.
        if (reason !== 'Wind protection' && previous && previous.percent === target && previous.reason === reason) {
            return;
        }

        this.lastApplied.set(id, { percent: target, reason });
        controller.applyAutomatedPosition(target, reason, bypassMotorProtection).catch(err => {
            this.adapter.log.error(
                `Applying automated position for covering "${id}" failed: ${(err as Error).message}`,
            );
        });
    }
}
