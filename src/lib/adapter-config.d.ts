// This file extends the AdapterConfig type from "@iobroker/types"

import type { IAreaScheduleConfig, IGroupConfig, ISceneConfig, IShutterConfig, IWeatherConfig } from './types';

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            shutters: IShutterConfig[];
            areas: IAreaScheduleConfig[];
            holidayStateId?: string;
            icalAdapterInstance?: string;
            icalTitlePrefix?: string;
            pushoverInstance?: string;
            telegramInstance?: string;
            latitude?: number;
            longitude?: number;
            weather?: IWeatherConfig;
            sunCloseThreshold?: number;
            sunProtectionGlobalEnabled?: boolean;
            sunOpenThreshold?: number;
            sunOpenMinDurationMs?: number;
            sunProtectionCloudCoverTriggerEnabled?: boolean;
            sunProtectionClearSkyCloudCoverMaxPercent?: number;
            windOpenThreshold?: number;
            windCloseAllowedThreshold?: number;
            windCalmMinDurationMs?: number;
            rainStatusDebounceMs?: number;
            windDirectionSmoothingDurationMs?: number;
            rainProtectionMinWindSpeedForDirectionKmh?: number;
            frostThreshold?: number;
            nightCoolingIndoorMinTemp?: number;
            nightCoolingMinDelta?: number;
            automationTickMs?: number;
            groups?: IGroupConfig[];
            scenes?: ISceneConfig[];
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
