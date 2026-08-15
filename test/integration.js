const path = require('path');
const { expect } = require('chai');
const { tests } = require('@iobroker/testing');

// Run integration tests - See https://github.com/ioBroker/testing for a detailed explanation and further options
tests.integration(path.join(__dirname, '..'), {
    defineAdditionalTests({ suite }) {
        suite('Shutters adapter startup and basic covering control', getHarness => {
            let harness;

            before(() => {
                harness = getHarness();
            });

            it('creates objects for a configured generic-position covering and reacts to a manual open command', async () => {
                // A generic-position covering just reads/writes an arbitrary foreign state pair - no
                // real driving adapter instance is needed for that state to exist, only the object
                // itself (see generic-position-driver.ts).
                await harness.objects.setObjectAsync('test-device.0.position', {
                    type: 'state',
                    common: { name: 'Test position', type: 'number', role: 'level.blind', read: true, write: true },
                    native: {},
                });
                await harness.states.setState('test-device.0.position', { val: 100, ack: true });

                await harness.changeAdapterConfig('shutters', {
                    native: {
                        shutters: [
                            {
                                id: 'shutter1',
                                name: 'Integration Test Shutter',
                                driverType: 'generic-position',
                                coveringType: 'rolladen',
                                automationEnabled: true,
                                states: { position: 'test-device.0.position', positionActual: 'test-device.0.position' },
                            },
                        ],
                    },
                });

                await harness.startAdapterAndWait();

                // Every individual covering lives under its own "shutters" channel, relative to the
                // adapter namespace: "shutters.0" + "shutters.<id>.<state>" (see plan section 3) - not
                // to be confused with the adapter namespace itself also being called "shutters".
                //
                // The adapter reads the driver's actual position shortly after startup (createObjects()
                // -> refreshPosition()); poll for it rather than a fixed sleep, since the exact timing is
                // an implementation detail this test should not depend on.
                const positionActual = await waitForState(
                    harness,
                    'shutters.0.shutters.shutter1.positionActual',
                    val => val === 100,
                );
                expect(positionActual).to.equal(100);

                // A manual "open" command must reach the configured foreign state (0 = fully open).
                await harness.states.setState('shutters.0.shutters.shutter1.open', { val: true, ack: false });
                const drivenPosition = await waitForState(harness, 'test-device.0.position', val => val === 0);
                expect(drivenPosition).to.equal(0);
            }).timeout(60_000);
        });
    },
});

/**
 * Polls a state until `predicate` is satisfied or `timeoutMs` elapses, since integration tests must
 * not assume exact timing of the adapter's internal processing.
 *
 * @param harness - Test harness, used for `states.getState`.
 * @param id - Full state ID to poll.
 * @param predicate - Called with the state's current value; polling stops once this returns true.
 * @param timeoutMs - Maximum time to wait before giving up and rejecting.
 * @returns The value `predicate` accepted.
 */
async function waitForState(harness, id, predicate, timeoutMs = 15_000) {
    const start = Date.now();
    for (;;) {
        const state = await harness.states.getState(id);
        if (state && predicate(state.val)) {
            return state.val;
        }
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Timed out waiting for state "${id}" to satisfy the expected condition (last value: ${JSON.stringify(state)})`);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
}
