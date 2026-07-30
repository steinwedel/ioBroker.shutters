import { expect } from 'chai';
import { scanForShutters } from './shutter-scanner';

/** Fake object-view row, loosely typed since `common` only needs the fields `scanForShutters()` actually reads. */
interface IFakeRow {
    id: string;
    value: { type: 'state'; common: Partial<ioBroker.StateCommon> };
}

/**
 * Minimal fake adapter exposing only what `scanForShutters()` needs.
 *
 * @param rows - Fake object-view rows to return from `getObjectViewAsync()`.
 */
function createFakeAdapter(rows: IFakeRow[]): ioBroker.Adapter {
    return {
        namespace: 'shutters.0',
        // eslint-disable-next-line @typescript-eslint/require-await -- intentionally synchronous test double for an async adapter method
        getObjectViewAsync: async () => ({ rows }),
    } as unknown as ioBroker.Adapter;
}

describe('shutter-scanner', () => {
    it('proposes a generic-position candidate for a writable level.blind state', async () => {
        const adapter = createFakeAdapter([
            {
                id: 'knx.0.livingroom.shutter_position',
                value: { type: 'state', common: { name: 'Living room shutter', role: 'level.blind', write: true } },
            },
        ]);

        const result = await scanForShutters(adapter, new Set());

        expect(result.errors).to.deep.equal([]);
        expect(result.shutters).to.have.lengthOf(1);
        expect(result.shutters[0]).to.include({ driverType: 'generic-position', coveringType: 'rolladen' });
        expect(result.shutters[0].states).to.deep.equal({
            position: 'knx.0.livingroom.shutter_position',
            positionActual: 'knx.0.livingroom.shutter_position',
        });
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
