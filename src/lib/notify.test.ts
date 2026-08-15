import { expect } from 'chai';
import { sendNotification } from './notify';
import type { INotifyAdapter } from './notify';

/**
 * Minimal fake adapter recording every `sendToAsync` call, with configurable per-instance failure.
 *
 * @param failingInstances - Instance IDs whose `sendToAsync` call should reject, to exercise the per-channel error handling in `sendNotification()`.
 */
function createFakeAdapter(failingInstances: Set<string> = new Set()): {
    adapter: INotifyAdapter;
    calls: { instance: string; command: string; message: unknown }[];
    warnings: string[];
    debugs: string[];
} {
    const calls: { instance: string; command: string; message: unknown }[] = [];
    const warnings: string[] = [];
    const debugs: string[] = [];
    const adapter: INotifyAdapter = {
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        async sendToAsync(instance, command, message) {
            calls.push({ instance, command, message });
            if (failingInstances.has(instance)) {
                throw new Error(`${instance} is not running`);
            }
            return undefined;
        },
        log: {
            warn: message => warnings.push(message),
            debug: message => debugs.push(message),
        },
    };
    return { adapter, calls, warnings, debugs };
}

describe('notify', () => {
    describe('sendNotification', () => {
        it('sends a Pushover-formatted object when only pushoverInstance is configured', async () => {
            const { adapter, calls } = createFakeAdapter();

            await sendNotification(adapter, { pushoverInstance: 'pushover.0' }, 'Storm', 'Wind protection engaged');

            expect(calls).to.deep.equal([
                {
                    instance: 'pushover.0',
                    command: 'send',
                    message: { title: 'Storm', message: 'Wind protection engaged' },
                },
            ]);
        });

        it('sends a Telegram-formatted "title: message" string when only telegramInstance is configured', async () => {
            const { adapter, calls } = createFakeAdapter();

            await sendNotification(adapter, { telegramInstance: 'telegram.0' }, 'Storm', 'Wind protection engaged');

            expect(calls).to.deep.equal([
                { instance: 'telegram.0', command: 'send', message: 'Storm: Wind protection engaged' },
            ]);
        });

        it('sends to both channels independently when both are configured', async () => {
            const { adapter, calls } = createFakeAdapter();

            await sendNotification(
                adapter,
                { pushoverInstance: 'pushover.0', telegramInstance: 'telegram.0' },
                'Storm',
                'Wind protection engaged',
            );

            expect(calls).to.have.length(2);
            expect(calls.map(c => c.instance).sort()).to.deep.equal(['pushover.0', 'telegram.0']);
        });

        it('does nothing but log a debug line when neither channel is configured', async () => {
            const { adapter, calls, debugs } = createFakeAdapter();

            await sendNotification(adapter, {}, 'Storm', 'Wind protection engaged');

            expect(calls).to.deep.equal([]);
            expect(debugs).to.have.length(1);
        });

        it('ignores an empty-string instance the same as undefined', async () => {
            const { adapter, calls } = createFakeAdapter();

            await sendNotification(adapter, { pushoverInstance: '', telegramInstance: '' }, 'Storm', 'x');

            expect(calls).to.deep.equal([]);
        });

        it('logs a warning and still resolves when a channel send fails', async () => {
            const { adapter, warnings } = createFakeAdapter(new Set(['pushover.0']));

            await sendNotification(adapter, { pushoverInstance: 'pushover.0' }, 'Storm', 'x');

            expect(warnings).to.have.length(1);
            expect(warnings[0]).to.include('pushover.0');
        });

        it('still delivers to the working channel when the other channel fails', async () => {
            const { adapter, calls, warnings } = createFakeAdapter(new Set(['pushover.0']));

            await sendNotification(
                adapter,
                { pushoverInstance: 'pushover.0', telegramInstance: 'telegram.0' },
                'Storm',
                'x',
            );

            expect(calls.map(c => c.instance).sort()).to.deep.equal(['pushover.0', 'telegram.0']);
            expect(warnings).to.have.length(1);
        });
    });
});
