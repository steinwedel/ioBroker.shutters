// This file extends the AdapterConfig type from "@iobroker/types"

import type { IShutterConfig } from './types';

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig {
            shutters: IShutterConfig[];
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};
