// This file extends the AdapterConfig type from "@iobroker/types"

import type { IAreaScheduleConfig, IGroupConfig, ISceneConfig, IShutterConfig, IWeatherConfig } from './types';

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            shutters: IShutterConfig[];
            areas: IAreaScheduleConfig[];
            holidayStateId?: string;
            latitude?: number;
            longitude?: number;
            weather?: IWeatherConfig;
            sunCloseThreshold?: number;
            sunOpenThreshold?: number;
            sunOpenMinDurationMs?: number;
            windOpenThreshold?: number;
            windCloseAllowedThreshold?: number;
            windCalmMinDurationMs?: number;
            frostThreshold?: number;
            automationTickMs?: number;
            groups?: IGroupConfig[];
            scenes?: ISceneConfig[];
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
