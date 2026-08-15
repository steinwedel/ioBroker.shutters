/**
 * Sends notifications via `sendTo` to configured Pushover/Telegram instances (plan section 9a.3).
 * Modeled directly on the analogous `NotificationManager` in the irrigation adapter
 * (`../ioBroker.irrigation/src/lib/notifications.ts`), with the same minimal design: at most two
 * channels, both optional and independent, `sendToAsync` errors caught and logged per channel so a
 * misconfigured/offline target adapter never breaks the calling code.
 */

/** Configuration this module reads; a subset of `IShuttersNativeConfig` so callers do not need to depend on the full config type. */
export interface INotifyConfig {
    /** Adapter instance ID of a `pushover` instance (e.g. "pushover.0"), or empty/undefined to disable this channel. */
    pushoverInstance?: string;
    /** Adapter instance ID of a `telegram` instance (e.g. "telegram.0"), or empty/undefined to disable this channel. */
    telegramInstance?: string;
}

/** Minimal adapter surface `sendNotification()` needs; matches `ioBroker.Adapter`. */
export interface INotifyAdapter {
    /** Sends a message to another adapter instance's message handler; matches `ioBroker.Adapter.sendToAsync`. */
    sendToAsync(instance: string, command: string, message: unknown): Promise<unknown>;
    /** Matches the subset of `ioBroker.Adapter.log` used here. */
    log: { debug(message: string): void; warn(message: string): void };
}

/**
 * Sends a notification to every configured channel in `config`, independently and in parallel;
 * never throws - per-channel failures (target adapter not installed/not running) are caught and
 * logged via `adapter.log.warn`, and are never allowed to affect the other channel or propagate to
 * the caller. If no channel is configured, logs a debug line and does nothing.
 *
 * @param adapter - Adapter instance, used for `sendToAsync`/`log`.
 * @param config - `pushoverInstance`/`telegramInstance`, see `INotifyConfig`.
 * @param title - Short notification title/subject.
 * @param message - Notification body.
 */
export async function sendNotification(
    adapter: INotifyAdapter,
    config: INotifyConfig,
    title: string,
    message: string,
): Promise<void> {
    const sends: Promise<void>[] = [];
    if (config.pushoverInstance) {
        sends.push(sendTo(adapter, config.pushoverInstance, { title, message }));
    }
    if (config.telegramInstance) {
        sends.push(sendTo(adapter, config.telegramInstance, `${title}: ${message}`));
    }

    if (sends.length === 0) {
        adapter.log.debug(`Notification "${title}" not sent: no pushoverInstance/telegramInstance configured.`);
        return;
    }

    // Promise.allSettled rather than Promise.all: sendTo() below already catches and logs its own
    // errors, so a failing/hanging channel must never prevent the other channel's send from
    // completing, and there is nothing left to inspect on the settled results here.
    await Promise.allSettled(sends);
}

/**
 * @param adapter - Adapter instance, used for `sendToAsync`/`log`.
 * @param instance - Target adapter instance ID.
 * @param message - Already channel-specific message payload (object for Pushover, string for Telegram).
 */
async function sendTo(adapter: INotifyAdapter, instance: string, message: unknown): Promise<void> {
    try {
        await adapter.sendToAsync(instance, 'send', message);
    } catch (err) {
        adapter.log.warn(`Failed to send notification via "${instance}": ${(err as Error).message}`);
    }
}
