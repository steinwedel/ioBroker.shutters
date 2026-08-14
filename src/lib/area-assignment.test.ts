import { expect } from 'chai';
import { normalizeAreaAssignments } from './area-assignment';
import type { IAreaScheduleConfig, IShutterConfig } from './types';

const area = (id: string | undefined, name: string): IAreaScheduleConfig => ({ id, name, weekday: {}, weekend: {} });

const shutter = (areaId?: string, legacyArea?: string): IShutterConfig => ({
    id: 'shutter1',
    name: 'Test',
    driverType: 'generic-position',
    coveringType: 'rolladen',
    automationEnabled: true,
    states: {},
    areaId,
    area: legacyArea,
});

describe('normalizeAreaAssignments', () => {
    it('assigns stable area IDs and migrates unique legacy assignments', () => {
        const result = normalizeAreaAssignments(
            [area(undefined, 'Ground floor')],
            [shutter(undefined, 'Ground floor')],
        );

        expect(result.changed).to.be.true;
        expect(result.areas[0].id).to.equal('area1');
        expect(result.shutters[0].areaId).to.equal('area1');
        expect(result.shutters[0].area).to.be.undefined;
    });

    it('keeps assignments stable when an area is renamed', () => {
        const result = normalizeAreaAssignments([area('area1', 'Renamed plan')], [shutter('area1', 'Old plan')]);

        expect(result.changed).to.be.false;
        expect(result.shutters[0].areaId).to.equal('area1');
    });

    it('migrates a renamed legacy assignment when only one plan exists', () => {
        const result = normalizeAreaAssignments([area(undefined, 'Renamed plan')], [shutter(undefined, 'Old plan')]);

        expect(result.shutters[0].areaId).to.equal('area1');
        expect(result.shutters[0].area).to.be.undefined;
    });

    it('does not guess assignments for duplicate area names', () => {
        const result = normalizeAreaAssignments(
            [area('area1', 'Shared'), area('area2', 'Shared')],
            [shutter(undefined, 'Shared')],
        );

        expect(result.changed).to.be.false;
        expect(result.shutters[0].areaId).to.be.undefined;
        expect(result.ambiguousAreaNames).to.deep.equal(['Shared']);
    });
});
