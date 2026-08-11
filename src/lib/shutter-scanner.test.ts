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
 */
function createFakeAdapter(rows: IFakeRow[], functionEnums: Record<string, IFakeFunctionEnum> = {}): ioBroker.Adapter {
    return {
        namespace: 'shutters.0',
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getObjectViewAsync: async () => ({ rows }),
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getForeignObjectsAsync: async () => functionEnums,
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
});
