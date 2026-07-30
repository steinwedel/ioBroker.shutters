import { clampForDoorProtection } from './door-protection';
import { evaluateFrostProtection } from './frost-protection';
import { BelowThresholdHysteresis } from './generic-hysteresis';
import { evaluateRainProtection } from './rain-protection';
import type { ShutterController } from './shutter-controller';
import { evaluateSunProtection, isWithinTimeWindow } from './sun-protection';
import type { CoveringType } from './types';
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
    /** How often the automation engine re-evaluates all coverings, in ms. */
    tickMs: number;
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
 * 4. Schedule (suppressed entirely while frost protection is active)
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
    private tickTimer: ioBroker.Interval | undefined;

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
                sunHysteresis: new BelowThresholdHysteresis(),
                windHysteresis: new BelowThresholdHysteresis(),
                sunOverrideUntilMs: 0,
            });
            controller.onManualCommand = () => this.handleManualCommand(id);
        }
    }

    /** Subscribes all configured door-contact states and starts the periodic evaluation tick. */
    public async start(): Promise<void> {
        const doorStateIds = new Set<string>();
        for (const controller of this.controllers.values()) {
            const stateId = controller.getConfig().doorContactStateId;
            if (stateId) {
                doorStateIds.add(stateId);
            }
        }
        for (const stateId of doorStateIds) {
            await this.adapter.subscribeForeignStatesAsync(stateId);
            const state = await this.adapter.getForeignStateAsync(stateId);
            this.doorOpenByStateId.set(stateId, state?.val === true);
        }
        this.adapter.on('stateChange', this.handleDoorStateChange);

        this.tick();
        this.tickTimer = this.adapter.setInterval(() => this.tick(), this.options.tickMs);
    }

    /** Stops the periodic evaluation tick and unsubscribes the door-state listener. */
    public stop(): void {
        this.adapter.removeListener('stateChange', this.handleDoorStateChange);
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

    private readonly handleDoorStateChange = (id: string, state: ioBroker.State | null | undefined): void => {
        if (!this.doorOpenByStateId.has(id)) {
            return;
        }
        this.doorOpenByStateId.set(id, state?.val === true);
    };

    /**
     * Called by a covering's `onManualCommand` hook. If sun protection was
     * active for that covering, suspends it until local midnight (plan
     * section 6.4).
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
    }

    private tick(): void {
        const now = new Date();
        const nowMs = now.getTime();

        for (const [id, controller] of this.controllers) {
            if (!controller.isAutomationEnabled()) {
                continue;
            }
            try {
                this.evaluateCovering(id, controller, now, nowMs);
            } catch (err) {
                this.adapter.log.error(`Automation evaluation failed for covering "${id}": ${(err as Error).message}`);
            }
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
            this.applyTarget(id, controller, 0, 'Wind protection', config.doorContactStateId);
            return;
        }

        const rainEnabled = config.rainProtectionEnabled ?? true;
        const rainActive = rainEnabled && evaluateRainProtection(this.weather.getRain());
        if (rainActive) {
            const target = config.rainTargetPercent ?? 100;
            this.applyTarget(id, controller, target, 'Rain protection', config.doorContactStateId);
            return;
        }

        const sunEnabled = config.sunProtectionEnabled ?? true;
        const sunOverrideActive = nowMs < state.sunOverrideUntilMs;
        const openAllowed = state.sunHysteresis.update(
            this.weather.getSolarRadiation(),
            this.options.sunOpenThreshold,
            this.options.sunOpenMinDurationMs,
        );
        state.sunActive =
            sunEnabled &&
            !sunOverrideActive &&
            evaluateSunProtection({
                inWindow: isWithinTimeWindow(now, config.sunWindowStart, config.sunWindowEnd),
                solarRadiation: this.weather.getSolarRadiation(),
                closeThreshold: this.options.sunCloseThreshold,
                openAllowed,
                wasActive: state.sunActive,
            });
        if (state.sunActive) {
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
        if (frostActive) {
            // Automated movement is suppressed entirely; leave the covering as-is.
            return;
        }

        const scheduleTarget = this.scheduleTargets.get(id);
        if (scheduleTarget !== undefined) {
            this.applyTarget(id, controller, scheduleTarget, 'Schedule', config.doorContactStateId);
        }
    }

    private applyTarget(
        id: string,
        controller: ShutterController,
        desiredPercent: number,
        reason: string,
        doorContactStateId: string | undefined,
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
        controller.applyAutomatedPosition(target, reason).catch(err => {
            this.adapter.log.error(
                `Applying automated position for covering "${id}" failed: ${(err as Error).message}`,
            );
        });
    }
}
