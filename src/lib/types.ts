/**
 * Core configuration and domain types for the shutters adapter.
 *
 * See plans/shutters-adapter-plan.md for the full design.
 */

import type { ICalibrationPoint } from './position-mapping';

/** Which physical system controls a covering. Additional systems are added here without touching automation logic. */
export type DriverType =
    | 'homematic'
    | 'hmip'
    | 'knx'
    | 'shelly'
    | 'zigbee'
    | 'zigbee2mqtt'
    | 'tuya'
    | 'somfy'
    | 'velux'
    | 'enocean'
    | 'velbus'
    | 'loxone'
    | 'homey'
    | 'mqtt'
    | 'generic-relay'
    | 'generic-position';

/** Which kind of covering this is. Determines position/tilt semantics and safe-position direction for protection modules. */
export type CoveringType = 'rolladen' | 'raffstore' | 'markise' | 'lamellen';

/** Configuration of a single covering (shutter/blind/awning), as stored in `native.shutters[]`. */
export interface IShutterConfig {
    /** Stable identifier used to derive the object ID (`shutters.<id>`). */
    id: string;
    /** Display name shown in the object tree and admin UI. */
    name: string;
    /** Physical system used to control this covering. */
    driverType: DriverType;
    /** Kind of covering; determines position/tilt semantics, see covering-types.ts. */
    coveringType: CoveringType;
    /** Stable ID of the assigned area. */
    areaId?: string;
    /** Window orientation in degrees (0-359, compass, clockwise from North), used to derive the active sun-protection window (6.2). */
    orientation?: number;
    /** Whether this covering participates in automated control at all. */
    automationEnabled: boolean;
    /**
     * Calibration curve mapping covering height/extension (%) to motor
     * runtime (%), see position-mapping.ts. Undefined/too short falls back
     * to a 1:1 identity curve (no calibration needed).
     */
    calibrationCurve?: ICalibrationPoint[];
    /** Foreign state IDs used by the driver. Which keys are relevant depends on `driverType`. */
    states: Record<string, string | undefined>;
    /**
     * Compensates for a position/stop driver (`driverType` in `POSITION_STOP_DRIVERS`, e.g.
     * `homematic`) whose foreign position state runs the opposite direction from its siblings on the
     * same system - a real-world wiring/CCU-channel-configuration quirk seen on individual actuators,
     * not a per-`driverType` property (two devices of the same `driverType` can disagree). When `true`,
     * `PositionStopDriverBase` flips the covering-height percentage (`100 - x`) before/after applying
     * the driver's own external-position convention, so this covering keeps the adapter's normal 0
     * (open)/100 (closed) meaning without the driver-specific formula needing to know about it.
     * Ignored by drivers outside `POSITION_STOP_DRIVERS`. Default: `false`.
     */
    invertPosition?: boolean;
    /** Whether Homematic position states use normalized 0-1 levels instead of 0-100. */
    homematicLevelNormalized?: boolean;

    /** Whether sun protection (plan section 6) is enabled for this covering. Default: true. */
    sunProtectionEnabled?: boolean;
    /** Target covering position while sun protection is active, 0-100. Default: 70. */
    sunTargetPercent?: number;
    /**
     * Lower bound (typically negative) of the active sun-azimuth range around `orientation`, in degrees
     * relative to it; sun protection may only apply while the sun's azimuth lies within
     * `orientation + orientationToleranceMinusDeg` .. `orientation + orientationTolerancePlusDeg`. The
     * admin UI auto-fills this with -60 whenever a covering with sun protection enabled is shown and it
     * is still unset, so no runtime default is needed for coverings configured through the UI. Only
     * used when `orientation` is set.
     */
    orientationToleranceMinusDeg?: number;
    /** Upper bound (typically positive) of the active sun-azimuth range, see `orientationToleranceMinusDeg`. Auto-filled with +60 under the same conditions. */
    orientationTolerancePlusDeg?: number;
    /**
     * Minimum sun elevation, degrees, for the orientation-based sun window (plan section 6.2, part
     * a) to count as active - only used together with `orientation`. Default: 0 (sun at/above the
     * horizon), a permissive default that changes nothing for existing configurations; raise it (e.g.
     * to 10-15°) to also ignore a grazing, low sun whose azimuth happens to match but that delivers
     * little real heat/glare.
     */
    sunProtectionMinElevationDeg?: number;
    /**
     * Maximum cloud cover, % (plan section 6.2, part c), for the orientation-based sun window to
     * count as active - only used together with `orientation`; requires `IWeatherConfig.cloudCoverStateId`
     * to be configured to have any effect. Undefined (default) disables this check entirely, i.e. the
     * orientation-based window ignores cloud cover, same as before this field existed. Distinct from
     * `IAutomationOptions.sunProtectionClearSkyCloudCoverMaxPercent` (plan section 6.3): that one is an
     * independent global trigger regardless of orientation; this one narrows this specific covering's
     * own orientation-based window on top of its azimuth/elevation match, and does not force sun
     * protection active on its own.
     */
    sunProtectionMaxCloudCoverPercent?: number;
    /** Start of the daily time window sun protection may apply in, "HH:MM". Fallback used only when `orientation` is not set. */
    sunWindowStart?: string;
    /** End of the daily time window sun protection may apply in, "HH:MM". Fallback used only when `orientation` is not set. */
    sunWindowEnd?: string;
    /**
     * Optional outdoor-temperature filter against unnecessary shading on bright but cool days (plan
     * section 6.5): sun protection additionally requires the outdoor temperature to be at/above this
     * value, on top of the radiation/window condition. Undefined disables this filter entirely
     * (default; not every user has a reliable outdoor temperature source).
     */
    sunProtectionMinTemp?: number;

    /**
     * Whether rain protection (plan section 7) is enabled for this covering. Default depends on
     * `coveringType`: enabled for rolladen/raffstore/markise, disabled for lamellen (typically indoor,
     * no weather exposure) - same default rule as `windProtectionEnabled`/`frostProtectionEnabled`.
     */
    rainProtectionEnabled?: boolean;
    /** Target covering position while rain protection is active, 0-100. Default: 100. */
    rainTargetPercent?: number;
    /**
     * Optional wind-direction filter for rain protection (plan section 7): tolerance (±°) around
     * `orientation` counting as "wind is blowing rain toward this window". Requires both `orientation`
     * and `IWeatherConfig.windDirectionStateId` to be set to have any effect; undefined (default)
     * disables the filter entirely, i.e. rain protection reacts to rain regardless of wind direction -
     * the previous, still backwards-compatible default behavior. A missing wind-direction reading at
     * evaluation time also falls back to protecting unconditionally (fails open towards protection,
     * not away from it).
     */
    rainProtectionWindDirectionToleranceDeg?: number;

    /**
     * Whether wind/storm protection (plan section 7a) is enabled for this
     * covering. Default depends on `coveringType`: enabled for
     * rolladen/raffstore/markise, disabled for lamellen (typically indoor).
     */
    windProtectionEnabled?: boolean;

    /**
     * Per-covering override of the global `windOpenThreshold`/`windCloseAllowedThreshold` (km/h,
     * plan section 7a/2a.5), for a covering whose material is more wind-sensitive than the rest -
     * markise fabric/arms in particular are far more vulnerable to wind than a closed rolladen panzer,
     * so the same global threshold that is fine for rolläden is often too high for a markise. Either
     * both must be set together or neither - undefined (default) falls back to the corresponding
     * global `IAutomationOptions` value for this covering. The admin UI pre-fills a lower suggestion
     * for both fields the moment `coveringType` is switched to `markise`, but the user may still
     * change or clear it.
     */
    windOpenThreshold?: number;
    /** See `windOpenThreshold`; per-covering override of the global `windCloseAllowedThreshold`. */
    windCloseAllowedThreshold?: number;

    /**
     * Whether frost protection (plan section 7b) is enabled for this
     * covering. Same default rule as `windProtectionEnabled`.
     */
    frostProtectionEnabled?: boolean;

    /** Whether door-contact protection is active for this covering. Default: true. */
    doorProtectionEnabled?: boolean;
    /**
     * Foreign boolean state of a door/window contact (e.g. a terrace door)
     * that, while open, suppresses automated closing actions for this
     * covering (plan section 7e). Undefined disables door protection.
     */
    doorContactStateId?: string;
    /** Whether a false door-contact value indicates an open door or window. */
    invertDoorContact?: boolean;
    /** Calibrated full opening time for generic relays, in seconds. */
    relayOpenRuntimeSecs?: number;
    /** Calibrated full closing time for generic relays, in seconds. */
    relayCloseRuntimeSecs?: number;

    /**
     * Whether summer night cooling (plan section 7c) is enabled for this covering. Unlike
     * `windProtectionEnabled`/`frostProtectionEnabled`, this is a comfort feature with no
     * safety aspect and additionally requires `nightCoolingIndoorTempStateId` to be configured, so it
     * defaults to `false` for every `coveringType` - the user opts in per covering/zone where nightly
     * opening is actually wanted (e.g. not a bedroom with a blackout preference) and an indoor
     * temperature sensor is available.
     */
    nightCoolingEnabled?: boolean;
    /**
     * Foreign state, indoor temperature (°C) of the room/zone this covering is in, used by night
     * cooling (7c) together with the outdoor temperature already configured in `IWeatherConfig`.
     * Undefined disables night cooling for this covering, even if `nightCoolingEnabled` is `true`.
     */
    nightCoolingIndoorTempStateId?: string;

    /**
     * Expected time (seconds) for a full 0-100 traversal, used by the
     * watchdog (plan section 9a.1) to detect a covering that stopped
     * responding. Default: 60.
     */
    maxRuntimeSecs?: number;

    /**
     * Minimum time (ms) between two actually-executed movement commands to the driver, regardless of
     * which module (schedule, sun protection, manual command, ...) triggered it - protects the motor
     * from excessive short-cycling, e.g. from hysteresis edge cases or rapid repeated user taps (plan
     * section 7d). Commands arriving within the cooldown are not discarded: only the most recently
     * requested target is buffered and applied once, after the cooldown elapses. Wind protection (7a)
     * always bypasses this, and a `stop` command is never delayed by it either. Default: 8000 (8s).
     */
    minCommandIntervalMs?: number;
}

/** Central weather inputs shared by all protection modules (plan section 5a). All are optional; a missing value simply disables the modules that need it. */
export interface IWeatherConfig {
    /** Foreign state, solar radiation in W/m², used by sun protection (6.1). */
    solarRadiationStateId?: string;
    /** Foreign state, wind speed (or gust) in km/h, used by wind protection (7a). */
    windSpeedStateId?: string;
    /** Foreign state, boolean rain indicator, used by rain protection (7). */
    rainStateId?: string;
    /**
     * Foreign state, wind direction in degrees (0-359, compass, clockwise from North), used by the
     * optional per-covering wind-direction filter for rain protection (plan section 7, see
     * `IShutterConfig.rainProtectionWindDirectionToleranceDeg`). Undefined disables that filter for
     * every covering, regardless of their own tolerance setting.
     */
    windDirectionStateId?: string;
    /** Foreign state, outdoor temperature in °C, used by frost protection (7b). */
    outdoorTempStateId?: string;
    /** Foreign state, relative humidity in %, used together with `outdoorTempStateId` by frost protection (7b). */
    humidityStateId?: string;
    /** Foreign boolean state indicating summer operation. */
    isSummerStateId?: string;
    /**
     * Calendar-based heating-period fallback for `WeatherSource.getIsSummer()` (plan section 6.2/2),
     * used only while `isSummerStateId` is not configured - once it is, the foreign state always
     * takes precedence, exactly like `holidayStateId` vs. a computed holiday. Format `"MM-DD"` (e.g.
     * `"10-15"` for October 15th). Wraps across the New Year if `heatingPeriodStart` is later in the
     * year than `heatingPeriodEnd` (the normal case, e.g. October to April) - see
     * `isDateWithinMonthDayRange()`. Both must be set together to have any effect; if either is
     * missing/invalid, the heating period is treated as never active (i.e. always summer), the same
     * as today's zero-config default.
     */
    heatingPeriodStart?: string;
    /** See `heatingPeriodStart`; the day the heating period ends (inclusive). */
    heatingPeriodEnd?: string;
    /**
     * Foreign state, cloud cover in % (0 = clear sky, 100 = fully overcast), used by the optional
     * cloud-cover-only sun-protection trigger (plan section 6.3, see
     * `IAutomationOptions.sunProtectionCloudCoverTriggerEnabled`).
     */
    cloudCoverStateId?: string;
}

/** One covering/target-position pair used by a group or scene action. */
export interface ISceneTarget {
    /** `IShutterConfig.id` of the affected covering. */
    coveringId: string;
    /** Target covering position to drive to, 0-100. */
    percent: number;
}

/** A named collection of coverings with combined open/close/position control (plan section 3/M7). */
export interface IGroupConfig {
    /** Stable identifier used to derive the object ID (`groups.<id>`). */
    id: string;
    /** Display name shown in the object tree and admin UI. */
    name: string;
    /** `IShutterConfig.id`s of the member coverings; may mix different driver types. */
    memberIds: string[];
}

/** A named preset that drives one or more coverings to specific positions at once (plan section 9b/M7b). */
export interface ISceneConfig {
    /** Stable identifier used to derive the object ID (`scenes.<id>`). */
    id: string;
    /** Display name shown in the object tree and admin UI. */
    name: string;
    /** Coverings and target positions applied when this scene is activated. */
    targets: ISceneTarget[];
}

/** Root shape of `native` for this adapter. */
export interface IShuttersNativeConfig {
    /** All configured coverings. */
    shutters: IShutterConfig[];
    /** All configured areas/zones, used by the daily open/close schedule (plan section 5). */
    areas: IAreaScheduleConfig[];
    /**
     * ID of an existing boolean state (own or foreign, e.g. from a calendar/iCal adapter) whose current
     * value decides whether "today" counts as a public holiday for every area's schedule (plan section
     * 5). `true` = public holiday, `false`/anything else = not a public holiday. Empty/undefined
     * disables holiday-specific schedules entirely (areas fall back to their weekend/current-weekday
     * schedule, see `resolveDaySchedule` in scheduler.ts). The adapter only reads this state's current
     * value; it does not compute holidays itself.
     */
    holidayStateId?: string;
    /**
     * Adapter instance ID of an `ioBroker.ical` instance (e.g. "ical.0") whose `data.table` state
     * is polled for day-level schedule overrides (plan section 5.1). The actual calendar URL/file is
     * configured on that instance, not here. Empty/undefined disables iCal overrides entirely.
     */
    icalAdapterInstance?: string;
    /**
     * Event-title prefix `resolveIcalOverridesForDay`/`parseIcalOverrideTitle` (ical.ts) match
     * against, e.g. `"Rolläden"` for a title like `"Rolläden auf 07:00"` (plan section 5.1). Only
     * relevant when `icalAdapterInstance` is set. Default: `"Rolläden"`.
     */
    icalTitlePrefix?: string;
    /**
     * Adapter instance ID of a `pushover` instance (e.g. "pushover.0") notifications are sent to (plan
     * section 9a.3): watchdog issues (9a.1) and every covering's wind/frost protection activating or
     * deactivating (aggregated across all coverings, not per covering, to avoid notification fatigue).
     * Empty/undefined disables this channel; both channels can be configured independently/simultaneously.
     */
    pushoverInstance?: string;
    /** Adapter instance ID of a `telegram` instance (e.g. "telegram.0") notifications are sent to, see `pushoverInstance`. */
    telegramInstance?: string;
    /** Location used for dusk-based closing times (plan section 5); read from `system.config` if not set here. */
    latitude?: number;
    /** See `latitude`. */
    longitude?: number;

    /** Central weather inputs (plan section 5a). */
    weather?: IWeatherConfig;

    /** Solar radiation (W/m²) at/above which sun protection closes. Default: 200. */
    sunCloseThreshold?: number;
    /** Whether sun protection is enabled globally. */
    sunProtectionGlobalEnabled?: boolean;
    /** Solar radiation (W/m²) below which sun protection may open again, after `sunOpenMinDurationMs`. Default: 150. */
    sunOpenThreshold?: number;
    /** How long solar radiation must stay below `sunOpenThreshold` before opening again (hysteresis, plan section 6.1). Default: 600000 (10 min). */
    sunOpenMinDurationMs?: number;
    /** Whether clear/mostly-clear cloud cover can independently activate sun protection. Default: false. */
    sunProtectionCloudCoverTriggerEnabled?: boolean;
    /** Maximum cloud cover (%) considered clear/mostly clear by the optional cloud-cover trigger. Default: 40. */
    sunProtectionClearSkyCloudCoverMaxPercent?: number;
    /**
     * Minimum time (ms) between two changes of a covering's combined sun-protection decision
     * (radiation- or cloud-cover-triggered), regardless of cause - an anti-flapping lock on top of
     * `sunOpenMinDurationMs`'s existing radiation-only hysteresis, since the cloud-cover trigger has
     * no hysteresis of its own and would otherwise toggle the covering up/down on every tick during
     * scattered/broken clouds. Default: 600000 (10 min).
     */
    sunActiveLockMs?: number;
    /**
     * Time window (ms) `WeatherSource` averages solar radiation and cloud cover readings over before
     * sun protection sees them, to smooth out momentary sensor noise/randomness rather than reacting
     * to individual readings - same idea as `windDirectionSmoothingDurationMs` for wind direction.
     * Default: 600000 (10 min).
     */
    sunProtectionAveragingDurationMs?: number;

    /** Wind speed (km/h) at/above which wind protection activates. Default: 40. */
    windOpenThreshold?: number;
    /** Wind speed (km/h) below which wind protection may deactivate again, after `windCalmMinDurationMs`. Default: 25. */
    windCloseAllowedThreshold?: number;
    /** How long wind speed must stay below `windCloseAllowedThreshold` before deactivating wind protection (hysteresis, plan section 7a). Default: 600000 (10 min). */
    windCalmMinDurationMs?: number;

    /** How long rain must have stopped (raw reading dry) before that becomes effective; rain starting is always effective immediately, regardless of this value - see `WeatherSource.getRain()`. Default: 300000 (5 min). */
    rainStatusDebounceMs?: number;
    /** Time window used to calculate the circular average of wind direction. Default: 300000 (5 min). */
    windDirectionSmoothingDurationMs?: number;
    /** Minimum wind speed (km/h) before rain protection applies the wind-direction filter. Default: 5. */
    rainProtectionMinWindSpeedForDirectionKmh?: number;

    /** Outdoor temperature (°C) at/below which frost protection may activate (combined with humidity/rain, plan section 7b). Default: 2. */
    frostThreshold?: number;

    /** Indoor temperature (°C) at/above which night cooling (7c) may activate for a covering with `nightCoolingEnabled: true`. Default: 24. */
    nightCoolingIndoorMinTemp?: number;
    /** Minimum indoor-minus-outdoor temperature difference (°C) required for night cooling (7c) to activate, on top of `nightCoolingIndoorMinTemp`. Default: 3. */
    nightCoolingMinDelta?: number;

    /** How often the automation engine re-evaluates sun/rain/wind/frost/door protection, in ms. Default: 30000. */
    automationTickMs?: number;

    /** Groups of coverings with combined control (plan section 3/M7). */
    groups?: IGroupConfig[];
    /** Named position presets (plan section 9b/M7b). */
    scenes?: ISceneConfig[];
}

/**
 * Opening/closing time for one day category, or undefined to skip that action.
 *
 * Three formats are accepted per field, see `parseScheduleEntry` in scheduler.ts:
 * - A plain "HH:MM" (24h) clock time, e.g. "07:30".
 * - A leading `+`/`-` offset relative to sunrise (`open`) or sunset (`close`), as plain minutes (e.g.
 *   "-30" to fire 30 minutes before the event) or an "HH:MM" duration (e.g. "+01:30" to fire 90 minutes
 *   after the event). Append `d` (e.g. "-30d", "+01:30d") to couple to civil dawn (`open`) / dusk
 *   (`close`) instead of the actual sunrise/sunset.
 * - The above offset followed by `!` and a plain "HH:MM" cap time, e.g. "+30!19:00" ("30 minutes after
 *   the sun event, but never later than 19:00" for `close`; analogous for `open`), or "+30d!19:00" for
 *   the dawn/dusk variant.
 *
 * The sunrise/sunset/dawn/dusk-relative variants require latitude/longitude to be resolvable;
 * otherwise skipped with a warning (except the capped variant, which then falls back to the cap time
 * alone).
 */
export interface IDaySchedule {
    /** Opening time/offset, see above, or undefined to skip opening on this day category. */
    open?: string;
    /** Closing time/offset, see above, or undefined to skip closing on this day category. */
    close?: string;
}

/** English weekday name, used as the key for `IAreaScheduleConfig.days`. */
export type WeekdayName = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

/**
 * Which set of fields a plan's schedule is defined with, see `resolveDaySchedule` in scheduler.ts:
 * - `'uniform'`: a single schedule (`weekday`) applies every day, including public holidays.
 * - `'weekdayWeekend'`: separate `weekday`/`weekend` schedules, with `holiday` (falling back to
 *   `weekend`) applied on public holidays. This is the classic three-field mode and the default for
 *   plans that don't set `scheduleMode` explicitly.
 * - `'perWeekday'`: a separate schedule per individual weekday in `days`, with `holiday` applied on
 *   public holidays (taking precedence over the weekday's own entry in `days`).
 */
export type ScheduleMode = 'uniform' | 'weekdayWeekend' | 'perWeekday';

/** Daily open/close schedule for one area/zone (plan section 5). */
export interface IAreaScheduleConfig {
    /** Stable identifier used to derive the area object ID. */
    id?: string;
    /** Area/zone name shown in the admin UI. */
    name: string;
    /**
     * Which fields define this plan's schedule, see `ScheduleMode`. Defaults to `'weekdayWeekend'` if
     * undefined (matches the schedule shape used before this field was introduced).
     */
    scheduleMode?: ScheduleMode;
    /**
     * In `'uniform'` mode: the single schedule applied every day. In `'weekdayWeekend'` mode: the
     * schedule applied on regular weekdays (Monday-Friday, unless it is also a public holiday). Unused
     * in `'perWeekday'` mode.
     */
    weekday: IDaySchedule;
    /** In `'weekdayWeekend'` mode: the schedule applied on Saturday/Sunday, and as the fallback for public holidays if `holiday` is undefined. Unused in the other modes. */
    weekend: IDaySchedule;
    /**
     * The schedule applied on public holidays in `'weekdayWeekend'` and `'perWeekday'` mode. Falls back
     * to `weekend` if undefined in `'weekdayWeekend'` mode; skips both actions if undefined in
     * `'perWeekday'` mode. Unused (i.e. holidays use the same schedule as every other day) in `'uniform'`
     * mode.
     */
    holiday?: IDaySchedule;
    /**
     * In `'perWeekday'` mode: this weekday's schedule, keyed by English weekday name. A day missing from
     * this map (or with an unset `open`/`close` field) simply skips that action on that weekday. Unused
     * in the other modes.
     */
    days?: Partial<Record<WeekdayName, IDaySchedule>>;
}
