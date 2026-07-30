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
}
