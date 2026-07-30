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
}

/** Opening/closing time for one day category, as "HH:MM" (24h), or undefined to skip that action. */
export interface IDaySchedule {
    /** Time to open at, "HH:MM" (24h), or undefined to skip opening on this day category. */
    open?: string;
    /** Time to close at, "HH:MM" (24h), or undefined to skip closing on this day category. */
    close?: string;
}

/** Daily open/close schedule for one area/zone (plan section 5). */
export interface IAreaScheduleConfig {
    /** Area/zone name; matched against `IShutterConfig.area`. */
    name: string;
    /** Schedule applied on regular weekdays (Monday-Friday, unless it is also a public holiday). */
    weekday: IDaySchedule;
    /** Schedule applied on Saturday/Sunday, and as the fallback for public holidays if `holiday` is undefined. */
    weekend: IDaySchedule;
    /** Falls back to `weekend` if undefined. */
    holiday?: IDaySchedule;
}
