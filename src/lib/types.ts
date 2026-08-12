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
    /** Area/zone name, used for schedule grouping (Abschnitt 5). */
    area?: string;
    /** Window orientation in degrees (0-359), used by the optional azimuth-based sun protection (6.2). */
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

    /** Whether sun protection (plan section 6) is enabled for this covering. Default: true. */
    sunProtectionEnabled?: boolean;
    /** Target covering position while sun protection is active, 0-100. Default: 70. */
    sunTargetPercent?: number;
    /** Start of the daily time window sun protection may apply in, "HH:MM". */
    sunWindowStart?: string;
    /** End of the daily time window sun protection may apply in, "HH:MM". */
    sunWindowEnd?: string;

    /** Whether rain protection (plan section 7) is enabled for this covering. Default: true. */
    rainProtectionEnabled?: boolean;
    /** Target covering position while rain protection is active, 0-100. Default: 100. */
    rainTargetPercent?: number;

    /**
     * Whether wind/storm protection (plan section 7a) is enabled for this
     * covering. Default depends on `coveringType`: enabled for
     * rolladen/raffstore/markise, disabled for lamellen (typically indoor).
     */
    windProtectionEnabled?: boolean;

    /**
     * Whether frost protection (plan section 7b) is enabled for this
     * covering. Same default rule as `windProtectionEnabled`.
     */
    frostProtectionEnabled?: boolean;

    /**
     * Foreign boolean state of a door/window contact (e.g. a terrace door)
     * that, while open, suppresses automated closing actions for this
     * covering (plan section 7e). Undefined disables door protection.
     */
    doorContactStateId?: string;

    /**
     * Expected time (seconds) for a full 0-100 traversal, used by the
     * watchdog (plan section 9a.1) to detect a covering that stopped
     * responding. Default: 60.
     */
    maxRuntimeSecs?: number;
}

/** Central weather inputs shared by all protection modules (plan section 5a). All are optional; a missing value simply disables the modules that need it. */
export interface IWeatherConfig {
    /** Foreign state, solar radiation in W/m², used by sun protection (6.1). */
    solarRadiationStateId?: string;
    /** Foreign state, wind speed (or gust) in km/h, used by wind protection (7a). */
    windSpeedStateId?: string;
    /** Foreign state, boolean rain indicator, used by rain protection (7). */
    rainStateId?: string;
    /** Foreign state, outdoor temperature in °C, used by frost protection (7b). */
    outdoorTempStateId?: string;
    /** Foreign state, relative humidity in %, used together with `outdoorTempStateId` by frost protection (7b). */
    humidityStateId?: string;
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
     * German federal state code (ISO 3166-2 subdivision, e.g. "NI" for
     * Niedersachsen) used for public holiday detection. Empty/undefined
     * disables holiday-specific schedules (areas fall back to their weekend
     * schedule on public holidays, see scheduler.ts).
     */
    publicHolidayFederalState?: string;
    /** Location used for dusk-based closing times (plan section 5); read from `system.config` if not set here. */
    latitude?: number;
    /** See `latitude`. */
    longitude?: number;

    /** Central weather inputs (plan section 5a). */
    weather?: IWeatherConfig;

    /** Solar radiation (W/m²) at/above which sun protection closes. Default: 200. */
    sunCloseThreshold?: number;
    /** Solar radiation (W/m²) below which sun protection may open again, after `sunOpenMinDurationMs`. Default: 150. */
    sunOpenThreshold?: number;
    /** How long solar radiation must stay below `sunOpenThreshold` before opening again (hysteresis, plan section 6.1). Default: 600000 (10 min). */
    sunOpenMinDurationMs?: number;

    /** Wind speed (km/h) at/above which wind protection activates. Default: 40. */
    windOpenThreshold?: number;
    /** Wind speed (km/h) below which wind protection may deactivate again, after `windCalmMinDurationMs`. Default: 25. */
    windCloseAllowedThreshold?: number;
    /** How long wind speed must stay below `windCloseAllowedThreshold` before deactivating wind protection (hysteresis, plan section 7a). Default: 600000 (10 min). */
    windCalmMinDurationMs?: number;

    /** Outdoor temperature (°C) at/below which frost protection may activate (combined with humidity/rain, plan section 7b). Default: 2. */
    frostThreshold?: number;

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

/** Daily open/close schedule for one area/zone (plan section 5). */
export interface IAreaScheduleConfig {
    /** Area/zone name; matched against `IShutterConfig.area`. */
    name: string;
    /** Schedule applied on regular weekdays (Monday-Friday, unless it is also a public holiday or overridden per-weekday in `days`). */
    weekday: IDaySchedule;
    /** Schedule applied on Saturday/Sunday, and as the fallback for public holidays if `holiday` is undefined (unless overridden per-weekday in `days`). */
    weekend: IDaySchedule;
    /** Falls back to `weekend` if undefined. Takes precedence over both `weekday`/`weekend` and any per-weekday override in `days`. */
    holiday?: IDaySchedule;
    /**
     * Optional per-weekday overrides, keyed by English weekday name. Only present days are affected;
     * within a present day, `open`/`close` fields that are themselves undefined still fall back to the
     * `weekday`/`weekend` schedule above (so e.g. a Monday override with only `close` set keeps the
     * regular weekday opening time). Ignored on days that are also public holidays if `holiday` is set.
     */
    days?: Partial<Record<WeekdayName, IDaySchedule>>;
}
