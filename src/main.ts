/*
 * ioBroker Shutters Adapter
 * See plans/shutters-adapter-plan.md for the full design.
 */

import * as utils from '@iobroker/adapter-core';
import { HolidayChecker } from './lib/holiday';
import { Scheduler } from './lib/scheduler';
import { ShutterController } from './lib/shutter-controller';

class Shutters extends utils.Adapter {
    private readonly controllers = new Map<string, ShutterController>();
    /** Maps a full state ID (e.g. "shutters.0.shutters.wz.position") to the covering ID that owns it. */
    private readonly stateIdToCoveringId = new Map<string, string>();
    /** Periodic driver -> positionActual/positionRaw sync, see `dataSource: poll` in io-package.json. */
    private positionRefreshTimer: ioBroker.Interval | undefined;
    private scheduler: Scheduler | undefined;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'shutters',
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Is called when databases are connected and adapter received configuration.
     */
    private async onReady(): Promise<void> {
        await this.setObjectNotExistsAsync('info', { type: 'channel', common: { name: 'Information' }, native: {} });
        await this.setObjectNotExistsAsync('info.connection', {
            type: 'state',
            common: {
                name: 'Connected to all configured systems',
                type: 'boolean',
                role: 'indicator.connected',
                read: true,
                write: false,
            },
            native: {},
        });

        const shutterConfigs = this.config.shutters ?? [];
        const idsToSubscribe: string[] = [];

        for (const shutterConfig of shutterConfigs) {
            try {
                const controller = new ShutterController(this, shutterConfig);
                await controller.createObjects();
                this.controllers.set(shutterConfig.id, controller);

                for (const ownStateId of controller.getOwnStateIds()) {
                    this.stateIdToCoveringId.set(`${this.namespace}.${ownStateId}`, shutterConfig.id);
                    idsToSubscribe.push(ownStateId);
                }
            } catch (err) {
                // A single misconfigured covering must not prevent the rest of
                // the adapter from starting up (plan section: startup validation).
                this.log.error(`Skipping covering "${shutterConfig.id}": ${(err as Error).message}`);
            }
        }

        for (const stateId of idsToSubscribe) {
            this.subscribeStates(stateId);
        }

        await this.setStateAsync('info.connection', shutterConfigs.length > 0, true);

        // Periodically sync each covering's actual position from its driver,
        // since not every system pushes changes immediately/reliably.
        this.positionRefreshTimer = this.setInterval(() => {
            for (const controller of this.controllers.values()) {
                controller.refreshPosition().catch(err => {
                    this.log.warn(`Position refresh failed: ${(err as Error).message}`);
                });
            }
        }, 5000);

        const holidayChecker = new HolidayChecker(this.config.publicHolidayFederalState);
        this.scheduler = new Scheduler(this, this.config.areas ?? [], holidayChecker, (areaName, action) => {
            this.onScheduleTrigger(areaName, action);
        });
        this.scheduler.start();
    }

    /**
     * Applies a schedule-triggered open/close action to every covering in
     * the given area that currently has automation enabled.
     *
     * @param areaName - Area/zone name as configured on the triggered coverings.
     * @param action - Whether to open (0%) or close (100%) the affected coverings.
     */
    private onScheduleTrigger(areaName: string, action: 'open' | 'close'): void {
        const targetPercent = action === 'open' ? 0 : 100;
        for (const controller of this.controllers.values()) {
            if (controller.getArea() !== areaName || !controller.isAutomationEnabled()) {
                continue;
            }
            controller.applyAutomatedPosition(targetPercent, `Schedule: ${action}`).catch(err => {
                this.log.error(`Scheduled ${action} for area "${areaName}" failed: ${(err as Error).message}`);
            });
        }
    }

    /**
     * Is called if a subscribed state changes.
     *
     * @param id - State ID
     * @param state - State object
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state) {
            return;
        }

        // `id` here is the fully qualified state ID (`<namespace>.<relativeId>`),
        // matching the keys stored in stateIdToCoveringId above.
        const coveringId = this.stateIdToCoveringId.get(id);
        if (!coveringId) {
            return;
        }

        const controller = this.controllers.get(coveringId);
        // ShutterController compares against the relative state IDs it created
        // itself (see getOwnStateIds()), so strip the "<namespace>." prefix here.
        const relativeId = id.startsWith(`${this.namespace}.`) ? id.slice(this.namespace.length + 1) : id;
        controller?.handleStateChange(relativeId, state).catch(err => {
            this.log.error(`Error handling state change for "${id}": ${(err as Error).message}`);
        });
    }

    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     *
     * @param callback - Callback function
     */
    private onUnload(callback: () => void): void {
        try {
            this.scheduler?.stop();
            if (this.positionRefreshTimer) {
                this.clearInterval(this.positionRefreshTimer);
            }
            for (const controller of this.controllers.values()) {
                controller.destroy();
            }
            callback();
        } catch (error) {
            this.log.error(`Error during unloading: ${(error as Error).message}`);
            callback();
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new Shutters(options);
} else {
    // otherwise start the instance directly
    (() => new Shutters())();
}
