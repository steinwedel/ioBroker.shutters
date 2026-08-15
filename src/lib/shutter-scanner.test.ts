import { expect } from 'chai';
import { scanForShutters } from './shutter-scanner';

/** Fake object-view row, loosely typed since `common` only needs the fields `scanForShutters()` actually reads. */
interface IFakeRow {
    id: string;
    value: { type: 'state'; common: Partial<ioBroker.StateCommon> };
}

/** Fake `enum.functions.*` object, loosely typed for the `IFunctionEnumObject` shape actually read. */
interface IFakeFunctionEnum {
    common: { name?: ioBroker.StateCommon['name']; members?: string[] };
}

/**
 * Minimal fake adapter exposing only what `scanForShutters()` needs.
 *
 * @param rows - Fake object-view rows to return from `getObjectViewAsync()`.
 * @param functionEnums - Fake `enum.functions.*` objects to return from `getForeignObjectsAsync()`; defaults to none.
 * @param getForeignObjectsAsyncCalls - If provided, every `getForeignObjectsAsync()` call's arguments are appended here.
 */
function createFakeAdapter(
    rows: IFakeRow[],
    functionEnums: Record<string, IFakeFunctionEnum> = {},
    getForeignObjectsAsyncCalls?: unknown[][],
): ioBroker.Adapter {
    return {
        namespace: 'shutters.0',
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getObjectViewAsync: async () => ({ rows }),
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getForeignObjectsAsync: async (...args: unknown[]) => {
            getForeignObjectsAsyncCalls?.push(args);
            return functionEnums;
        },
    } as unknown as ioBroker.Adapter;
}

describe('shutter-scanner', () => {
    it('proposes a generic-position candidate for a writable level.blind state on an unrecognized adapter', async () => {
        const adapter = createFakeAdapter([
            {
                id: 'mqtt.0.livingroom.shutter_position',
                value: { type: 'state', common: { name: 'Living room shutter', role: 'level.blind', write: true } },
            },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.errors).to.deep.equal([]);
        expect(result.shutters).to.have.lengthOf(1);
        expect(result.shutters[0]).to.include({ driverType: 'generic-position', coveringType: 'rolladen' });
        expect(result.shutters[0].states).to.deep.equal({
            position: 'mqtt.0.livingroom.shutter_position',
            positionActual: 'mqtt.0.livingroom.shutter_position',
        });
    });

    it('proposes a homematic candidate with its STOP sibling for a hm-rpc LEVEL state', async () => {
        const adapter = createFakeAdapter([
            { id: 'hm-rpc.0.ABC.1.LEVEL', value: { type: 'state', common: { role: 'level.blind', write: true } } },
            { id: 'hm-rpc.0.ABC.1.STOP', value: { type: 'state', common: { role: 'button.stop' } } },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(1);
        expect(result.shutters[0]).to.include({ driverType: 'homematic' });
        expect(result.shutters[0].states).to.deep.equal({
            position: 'hm-rpc.0.ABC.1.LEVEL',
            positionActual: 'hm-rpc.0.ABC.1.LEVEL',
            stop: 'hm-rpc.0.ABC.1.STOP',
        });
    });

    it('proposes a homematic candidate without a stop state if no STOP sibling exists', async () => {
        const adapter = createFakeAdapter([
            { id: 'hm-rpc.0.ABC.1.LEVEL', value: { type: 'state', common: { role: 'level.blind', write: true } } },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(1);
        expect(result.shutters[0].states).to.not.have.property('stop');
    });

    it('proposes a homematic candidate for a "Verschluss" Gewerk member even without a level.blind role', async () => {
        const adapter = createFakeAdapter(
            [
                { id: 'hm-rpc.0.ABC.1.LEVEL', value: { type: 'state', common: { name: 'Rolladen' } } },
                { id: 'hm-rpc.0.ABC.1.STOP', value: { type: 'state', common: { role: 'button.stop' } } },
            ],
            {
                'enum.functions.shutters': { common: { name: 'Verschluss', members: ['hm-rpc.0.ABC.1'] } },
            },
        );

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(1);
        expect(result.shutters[0]).to.include({ driverType: 'homematic' });
        expect(result.shutters[0].states).to.deep.equal({
            position: 'hm-rpc.0.ABC.1.LEVEL',
            positionActual: 'hm-rpc.0.ABC.1.LEVEL',
            stop: 'hm-rpc.0.ABC.1.STOP',
        });
    });

    it('matches the "Verschluss" Gewerk name case-insensitively and ignores unrelated functions', async () => {
        const adapter = createFakeAdapter([{ id: 'hm-rpc.0.DEF.1.LEVEL', value: { type: 'state', common: {} } }], {
            'enum.functions.lighting': { common: { name: 'Licht', members: ['hm-rpc.0.OTHER.1'] } },
            'enum.functions.shutters': { common: { name: 'VERSCHLUSS', members: ['hm-rpc.0.DEF.1'] } },
        });

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(1);
        expect(result.shutters[0].states.position).to.equal('hm-rpc.0.DEF.1.LEVEL');
    });

    it('ignores "Verschluss" Gewerk members without a LEVEL state or from a non-Homematic adapter', async () => {
        const adapter = createFakeAdapter([{ id: 'knx.0.somestate', value: { type: 'state', common: {} } }], {
            'enum.functions.shutters': {
                common: { name: 'Verschluss', members: ['hm-rpc.0.NOLEVEL.1', 'knx.0.somestate'] },
            },
        });

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(0);
    });

    it('does not duplicate a candidate already found via the level.blind role in the "Verschluss" Gewerk', async () => {
        const adapter = createFakeAdapter(
            [{ id: 'hm-rpc.0.ABC.1.LEVEL', value: { type: 'state', common: { role: 'level.blind', write: true } } }],
            { 'enum.functions.shutters': { common: { name: 'Verschluss', members: ['hm-rpc.0.ABC.1'] } } },
        );

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(1);
    });

    it('proposes a knx candidate for a knx-namespaced level.blind state', async () => {
        const adapter = createFakeAdapter([
            {
                id: 'knx.0.livingroom.shutter_position',
                value: { type: 'state', common: { role: 'level.blind', write: true } },
            },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(1);
        expect(result.shutters[0]).to.include({ driverType: 'knx' });
    });

    it('proposes a shelly candidate for a shelly-namespaced level.blind state', async () => {
        const adapter = createFakeAdapter([
            {
                id: 'shelly.0.SHSW-25.Cover.Pos',
                value: { type: 'state', common: { role: 'level.blind', write: true } },
            },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(1);
        expect(result.shutters[0]).to.include({ driverType: 'shelly' });
    });

    it('proposes zigbee/zigbee2mqtt candidates for their respective namespaces', async () => {
        const adapter = createFakeAdapter([
            { id: 'zigbee.0.device1.position', value: { type: 'state', common: { role: 'level.blind', write: true } } },
            {
                id: 'zigbee2mqtt.0.device2.position',
                value: { type: 'state', common: { role: 'level.blind', write: true } },
            },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(2);
        const driverTypes = result.shutters.map(s => s.driverType).sort();
        expect(driverTypes).to.deep.equal(['zigbee', 'zigbee2mqtt']);
    });

    it('proposes a generic-relay candidate when open+close roles share a parent', async () => {
        const adapter = createFakeAdapter([
            { id: 'hm-rpc.0.ABC.1.OPEN', value: { type: 'state', common: { role: 'button.open.blind' } } },
            { id: 'hm-rpc.0.ABC.1.CLOSE', value: { type: 'state', common: { role: 'button.close.blind' } } },
            { id: 'hm-rpc.0.ABC.1.STOP', value: { type: 'state', common: { role: 'button.stop' } } },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(1);
        expect(result.shutters[0]).to.include({ driverType: 'generic-relay' });
        expect(result.shutters[0].states).to.deep.equal({
            open: 'hm-rpc.0.ABC.1.OPEN',
            close: 'hm-rpc.0.ABC.1.CLOSE',
            stop: 'hm-rpc.0.ABC.1.STOP',
        });
    });

    it('does not propose a relay candidate missing a close state', async () => {
        const adapter = createFakeAdapter([
            { id: 'hm-rpc.0.ABC.1.OPEN', value: { type: 'state', common: { role: 'button.open.blind' } } },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(0);
    });

    it('skips states already referenced by an existing covering', async () => {
        const adapter = createFakeAdapter([
            {
                id: 'knx.0.livingroom.shutter_position',
                value: { type: 'state', common: { role: 'level.blind', write: true } },
            },
        ]);

        const result = await scanForShutters(adapter, new Set(['knx.0.livingroom.shutter_position']));

        expect(result.shutters).to.have.lengthOf(0);
    });

    it('skips states from forbidden adapters and its own namespace', async () => {
        const adapter = createFakeAdapter([
            { id: 'javascript.0.somestate', value: { type: 'state', common: { role: 'level.blind', write: true } } },
            {
                id: 'shutters.0.shutters.other.position',
                value: { type: 'state', common: { role: 'level.blind', write: true } },
            },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(0);
    });

    it('skips a read-only level.blind state', async () => {
        const adapter = createFakeAdapter([
            { id: 'knx.0.readonly', value: { type: 'state', common: { role: 'level.blind', write: false } } },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.have.lengthOf(0);
    });

    it('requests enum.functions.* with the "enum" object type (regression: omitting it defaults to type "state" and returns no enums)', async () => {
        const calls: unknown[][] = [];
        const adapter = createFakeAdapter(
            [],
            { 'enum.functions.shutters': { common: { name: 'Verschluss', members: [] } } },
            calls,
        );

        await scanForShutters(adapter, new Set());

        expect(calls).to.have.lengthOf(1);
        expect(calls[0]).to.deep.equal(['enum.functions.*', 'enum']);
    });

    it('reports scan errors instead of throwing', async () => {
        const adapter = {
            namespace: 'shutters.0',
            // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
            getObjectViewAsync: async () => {
                throw new Error('boom');
            },
        } as unknown as ioBroker.Adapter;

        const result = await scanForShutters(adapter, new Set());

        expect(result.shutters).to.deep.equal([]);
        expect(result.errors).to.have.lengthOf(1);
        expect(result.errors[0]).to.include('boom');
    });

    describe('additional level.blind-role namespaces (hmip, enocean, velbus, velux/klf200, tahoma)', () => {
        it('proposes an hmip candidate with a lowercase "stop" sibling', async () => {
            const adapter = createFakeAdapter([
                {
                    id: 'hmip.0.device1.shutterLevel',
                    value: { type: 'state', common: { role: 'level.blind', write: true } },
                },
                { id: 'hmip.0.device1.stop', value: { type: 'state', common: { role: 'button.stop' } } },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
            expect(result.shutters[0]).to.include({ driverType: 'hmip' });
            expect(result.shutters[0].states).to.deep.equal({
                position: 'hmip.0.device1.shutterLevel',
                positionActual: 'hmip.0.device1.shutterLevel',
                stop: 'hmip.0.device1.stop',
            });
        });

        it('finds a lowercase ".stop" sibling even without the button.stop role', async () => {
            const adapter = createFakeAdapter([
                {
                    id: 'velbus.0.blind1.position',
                    value: { type: 'state', common: { role: 'level.blind', write: true } },
                },
                { id: 'velbus.0.blind1.stop', value: { type: 'state', common: {} } },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
            expect(result.shutters[0].states.stop).to.equal('velbus.0.blind1.stop');
        });

        it('proposes an enocean candidate', async () => {
            const adapter = createFakeAdapter([
                {
                    id: 'enocean.0.actor1.position',
                    value: { type: 'state', common: { role: 'level.blind', write: true } },
                },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
            expect(result.shutters[0]).to.include({ driverType: 'enocean' });
        });

        it('proposes a velux candidate for both the velux and klf200 namespaces', async () => {
            const adapter = createFakeAdapter([
                {
                    id: 'velux.0.product1.position',
                    value: { type: 'state', common: { role: 'level.blind', write: true } },
                },
                {
                    id: 'klf200.0.product2.position',
                    value: { type: 'state', common: { role: 'level.blind', write: true } },
                },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(2);
            expect(result.shutters.every(s => s.driverType === 'velux')).to.equal(true);
        });

        it('proposes a somfy candidate for the tahoma namespace', async () => {
            const adapter = createFakeAdapter([
                {
                    id: 'tahoma.0.device1.core:ClosureState',
                    value: { type: 'state', common: { role: 'level.blind', write: true } },
                },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
            expect(result.shutters[0]).to.include({ driverType: 'somfy' });
        });
    });

    describe('Tuya detection pass', () => {
        it('proposes a tuya candidate from percent_control + percent_state', async () => {
            const adapter = createFakeAdapter([
                { id: 'tuya.0.dev1.1_percent_control', value: { type: 'state', common: { name: 'Blind 1' } } },
                { id: 'tuya.0.dev1.1_percent_state', value: { type: 'state', common: {} } },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
            expect(result.shutters[0]).to.include({ driverType: 'tuya', name: 'Blind 1' });
            expect(result.shutters[0].states).to.deep.equal({
                position: 'tuya.0.dev1.1_percent_control',
                positionActual: 'tuya.0.dev1.1_percent_state',
            });
        });

        it('proposes a tuya candidate from a control DP alone', async () => {
            const adapter = createFakeAdapter([{ id: 'tuya.0.dev2.1_control', value: { type: 'state', common: {} } }]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
            expect(result.shutters[0]).to.include({ driverType: 'tuya' });
            expect(result.shutters[0].states).to.deep.equal({ control: 'tuya.0.dev2.1_control' });
        });

        it('does not match percent_control/control suffixes outside the tuya namespace', async () => {
            const adapter = createFakeAdapter([
                { id: 'someother.0.dev1.percent_control', value: { type: 'state', common: {} } },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(0);
        });

        it('skips an already-configured Tuya state', async () => {
            const adapter = createFakeAdapter([{ id: 'tuya.0.dev1.1_control', value: { type: 'state', common: {} } }]);

            const result = await scanForShutters(adapter, new Set(['tuya.0.dev1.1_control']));

            expect(result.shutters).to.have.lengthOf(0);
        });
    });

    describe('Loxone detection pass', () => {
        it('proposes a loxone candidate from an up/down pair', async () => {
            const adapter = createFakeAdapter([
                { id: 'loxone.0.blind1.up', value: { type: 'state', common: { name: 'Jalousie 1' } } },
                { id: 'loxone.0.blind1.down', value: { type: 'state', common: {} } },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
            expect(result.shutters[0]).to.include({ driverType: 'loxone', name: 'Jalousie 1' });
            expect(result.shutters[0].states).to.deep.equal({
                up: 'loxone.0.blind1.up',
                down: 'loxone.0.blind1.down',
            });
        });

        it('includes optional position/info states when present alongside up/down', async () => {
            const adapter = createFakeAdapter([
                { id: 'loxone.0.blind1.up', value: { type: 'state', common: {} } },
                { id: 'loxone.0.blind1.down', value: { type: 'state', common: {} } },
                { id: 'loxone.0.blind1.position', value: { type: 'state', common: {} } },
                { id: 'loxone.0.blind1.info', value: { type: 'state', common: {} } },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
            expect(result.shutters[0].states).to.deep.equal({
                up: 'loxone.0.blind1.up',
                down: 'loxone.0.blind1.down',
                position: 'loxone.0.blind1.position',
                positionActual: 'loxone.0.blind1.info',
            });
        });

        it('does not propose a candidate with only "up" and no "down"', async () => {
            const adapter = createFakeAdapter([{ id: 'loxone.0.blind1.up', value: { type: 'state', common: {} } }]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(0);
        });
    });

    describe('Homey detection pass', () => {
        it('proposes a homey candidate from windowcoverings_set, in any namespace', async () => {
            const adapter = createFakeAdapter([
                {
                    id: 'homeybridge.0.device1.windowcoverings_set',
                    value: { type: 'state', common: { name: 'Homey Blind' } },
                },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
            expect(result.shutters[0]).to.include({ driverType: 'homey', name: 'Homey Blind' });
            expect(result.shutters[0].states).to.deep.equal({
                position: 'homeybridge.0.device1.windowcoverings_set',
                positionActual: 'homeybridge.0.device1.windowcoverings_set',
            });
        });

        it('skips an already-configured Homey state', async () => {
            const adapter = createFakeAdapter([
                { id: 'homeybridge.0.device1.windowcoverings_set', value: { type: 'state', common: {} } },
            ]);

            const result = await scanForShutters(adapter, new Set(['homeybridge.0.device1.windowcoverings_set']));

            expect(result.shutters).to.have.lengthOf(0);
        });
    });

    describe('onProgress (plan section 2b.3)', () => {
        it('reports every scan phase in order when candidates are found across multiple passes', async () => {
            const adapter = createFakeAdapter([
                {
                    id: 'knx.0.livingroom.shutter_position',
                    value: { type: 'state', common: { role: 'level.blind', write: true } },
                },
                { id: 'tuya.0.dev1.1_percent_control', value: { type: 'state', common: {} } },
                { id: 'loxone.0.jalousie1.up', value: { type: 'state', common: {} } },
                { id: 'loxone.0.jalousie1.down', value: { type: 'state', common: {} } },
                { id: 'homeybridge.0.device1.windowcoverings_set', value: { type: 'state', common: {} } },
            ]);
            const messages: string[] = [];

            await scanForShutters(adapter, new Set(), message => messages.push(message));

            expect(messages).to.deep.equal([
                'Fetching object list...',
                'Scanning for coverings with a level.blind/button role...',
                'Scanning Homematic "Verschluss" channels...',
                'Resolving generic relay candidates...',
                'Scanning Tuya candidates...',
                'Scanning Loxone candidates...',
                'Scanning Homey candidates...',
                'Scan complete.',
            ]);
        });

        it('still reports "Scan complete." even when the scan itself fails', async () => {
            const adapter = {
                namespace: 'shutters.0',
                // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
                getObjectViewAsync: async () => {
                    throw new Error('boom');
                },
                // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
                getForeignObjectsAsync: async () => ({}),
            } as unknown as ioBroker.Adapter;
            const messages: string[] = [];

            const result = await scanForShutters(adapter, new Set(), message => messages.push(message));

            expect(result.errors).to.have.lengthOf(1);
            expect(messages[messages.length - 1]).to.equal('Scan complete.');
        });

        it('works exactly as before when onProgress is omitted', async () => {
            const adapter = createFakeAdapter([
                {
                    id: 'knx.0.livingroom.shutter_position',
                    value: { type: 'state', common: { role: 'level.blind', write: true } },
                },
            ]);

            const result = await scanForShutters(adapter, new Set());

            expect(result.shutters).to.have.lengthOf(1);
        });
    });
});
