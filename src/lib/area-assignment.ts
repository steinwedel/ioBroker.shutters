import { nextAvailableAreaId } from './id-generator';
import type { IAreaScheduleConfig, IShutterConfig } from './types';

export interface IAreaAssignmentNormalization {
    areas: IAreaScheduleConfig[];
    shutters: IShutterConfig[];
    changed: boolean;
    ambiguousAreaNames: string[];
}

export function normalizeAreaAssignments(
    areas: IAreaScheduleConfig[],
    shutters: IShutterConfig[],
): IAreaAssignmentNormalization {
    const usedIds = new Set<string>();
    let changed = false;
    const normalizedAreas = areas.map(area => {
        if (area.id && !usedIds.has(area.id)) {
            usedIds.add(area.id);
            return area;
        }
        const id = nextAvailableAreaId(usedIds);
        usedIds.add(id);
        changed = true;
        return { ...area, id };
    });

    const idsByName = new Map<string, string[]>();
    for (const area of normalizedAreas) {
        if (!area.name || !area.id) {
            continue;
        }
        const ids = idsByName.get(area.name) ?? [];
        ids.push(area.id);
        idsByName.set(area.name, ids);
    }

    const ambiguousAreaNames = new Set<string>();
    const normalizedShutters = shutters.map(shutter => {
        if (shutter.areaId || !shutter.area) {
            return shutter;
        }
        const ids = idsByName.get(shutter.area) ?? [];
        const areaId = ids.length === 1 ? ids[0] : normalizedAreas.length === 1 ? normalizedAreas[0].id : undefined;
        if (!areaId) {
            if (ids.length > 1) {
                ambiguousAreaNames.add(shutter.area);
            }
            return shutter;
        }
        const { area: _legacyArea, ...normalizedShutter } = shutter;
        changed = true;
        return { ...normalizedShutter, areaId };
    });

    return {
        areas: normalizedAreas,
        shutters: normalizedShutters,
        changed,
        ambiguousAreaNames: Array.from(ambiguousAreaNames),
    };
}
