const path = require('path');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');

tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Shutters adapter foreign-state integration', getHarness => {
            let harness;
            const genericPositionId = 'test-device.0.generic.position';
            const hmipPositionId = 'test-device.0.hmip.target';
            const hmipActualId = 'test-device.0.hmip.actual';
            const icalTableId = 'ical.0.data.table';

            before(async () => {
                harness = getHarness();
                await createNumberState(harness, genericPositionId);
                await createNumberState(harness, hmipPositionId);
                await createNumberState(harness, hmipActualId);
                await harness.objects.setObjectAsync(icalTableId, {
                    type: 'state',
                    common: { name: 'Calendar table', type: 'string', role: 'json', read: true, write: true },
                    native: {},
                });
                await harness.states.setState(genericPositionId, { val: 100, ack: true });
                await harness.states.setState(hmipPositionId, { val: 1, ack: true });
                await harness.states.setState(hmipActualId, { val: 0.25, ack: true });
                await harness.states.setState(icalTableId, { val: JSON.stringify([todayEvent('Test calendar auf', pastTime(2))]), ack: true });

                await harness.changeAdapterConfig('shutters', {
                    native: {
                        shutters: [
                            {
                                id: 'shutter1',
                                name: 'Generic covering',
                                driverType: 'generic-position',
                                coveringType: 'rolladen',
                                areaId: 'living',
                                automationEnabled: true,
                                states: { position: genericPositionId, positionActual: genericPositionId },
                            },
                            {
                                id: 'shutter2',
                                name: 'HmIP covering',
                                driverType: 'hmip',
                                coveringType: 'rolladen',
                                automationEnabled: true,
                                states: { position: hmipPositionId, positionActual: hmipActualId },
                            },
                        ],
                        areas: [
                            {
                                id: 'living',
                                name: 'Living',
                                weekday: { open: '00:00', close: '00:01' },
                                weekend: { open: '00:00', close: '00:01' },
                            },
                        ],
                        icalAdapterInstance: 'ical.0',
                        icalTitlePrefix: 'Test calendar',
                    },
                });
                await harness.startAdapterAndWait();
            }).timeout(60_000);

            it('uses the configured iCal table fixture to apply the current-day override at startup', async () => {
                expect((await waitForState(harness, genericPositionId, value => value === 0)).val).to.equal(0);
            }).timeout(30_000);

            it('scales HmIP foreign feedback and commands in the adapter position convention', async () => {
                expect((await waitForState(harness, 'shutters.0.shutters.shutter2.positionActual', value => value === 75)).val).to.equal(75);

                await harness.states.setState('shutters.0.shutters.shutter2.position', { val: 40, ack: false });
                const target = await waitForState(harness, hmipPositionId, value => value === 0.6);
                expect(target.val).to.equal(0.6);
                expect(target.ack).to.equal(false);

                await harness.states.setState(hmipActualId, { val: 0.1, ack: true });
                expect((await waitForState(harness, 'shutters.0.shutters.shutter2.positionActual', value => value === 90)).val).to.equal(90);
            }).timeout(30_000);
        });
    },
});

async function createNumberState(harness, id) {
    await harness.objects.setObjectAsync(id, {
        type: 'state',
        common: { name: id, type: 'number', role: 'level.blind', read: true, write: true },
        native: {},
    });
}

function todayEvent(event, time) {
    const now = new Date();
    return { event: `${event} ${time}`, _date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).toISOString() };
}

function timeOfDay(offsetMinutes) {
    const date = new Date(Date.now() + offsetMinutes * 60_000);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function pastTime(minutes) {
    return timeOfDay(-minutes);
}

async function waitForState(harness, id, predicate, timeoutMs = 15_000) {
    const start = Date.now();
    for (;;) {
        const state = await harness.states.getState(id);
        if (state && predicate(state.val)) {
            return state;
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Timed out waiting for state "${id}" to satisfy the expected condition (last value: ${JSON.stringify(state)})`);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}
