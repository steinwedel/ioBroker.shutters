import type { CoveringType, DriverType } from './types';

/**
 * Auto-discovery for coverings (plan section 2b). Scans all foreign state
 * objects for the standard ioBroker roles that indicate a motorized
 * covering, and proposes ready-to-use `IShutterConfig` fragments.
 *
 * The "Kern-Set" system-specific drivers from the plan's priority order
 * (section 2a.4: homematic, knx, shelly, zigbee, zigbee2mqtt) are detected
 * by adapter namespace and proposed with the matching `driverType`;
 * everything else with a `level.blind`/`button.open.blind` role falls back
 * to the generic drivers (2b.2 "Generic" row). The remaining
 * system-specific drivers from the plan (hmip, tuya, somfy, velux,
 * enocean, velbus, loxone, homey, mqtt) are not detected/implemented yet.
 *
 * There is also no setup wizard UI yet that could let a user
 * review/rename/import a scan result interactively; results are logged and
 * written to `info.lastScanResult` as JSON for manual copy-paste into the
 * `shutters` table instead (see admin/jsonConfig.json for the scan button).
 */

/** One auto-discovered covering candidate, ready to copy into `native.shutters[]` after review. */
export interface IScannedShutter {
    /** Proposed `IShutterConfig.id`, derived from the discovered state ID. */
    id: string;
    /** Proposed display name, taken from `common.name` if available. */
    name: string;
    /** Detected/assumed driver type, see class doc. */
    driverType: DriverType;
    /** Always `"rolladen"`, since the discovered role gives no further hint about the actual covering type. */
    coveringType: CoveringType;
    /** Always `true`; the user can disable automation after reviewing the candidate. */
    automationEnabled: boolean;
    /** Foreign state IDs found for this candidate, matching the shape `IShutterConfig.states` expects for `driverType`. */
    states: Record<string, string>;
}

/** Result of `scanForShutters()`. */
export interface IScanResult {
    /** All discovered candidates not already referenced by an existing covering. */
    shutters: IScannedShutter[];
    /** Any errors encountered while scanning; a non-empty scan result may still be returned alongside errors. */
    errors: string[];
}

/** Adapter instances never scanned, to avoid duplicates/recursion (plan section 2b.2). */
const FORBIDDEN_SCAN_ADAPTERS = new Set(['admin', 'alias', 'linkeddevices', 'javascript']);

/** Maps an adapter instance's namespace prefix (`id.split('.')[0]`) to the driver type it implies, for the "Kern-Set" from plan section 2a.4. */
const ADAPTER_TO_DRIVER_TYPE: Record<string, DriverType> = {
    'hm-rpc': 'homematic',
    'hm-rega': 'homematic',
    knx: 'knx',
    shelly: 'shelly',
    zigbee: 'zigbee',
    zigbee2mqtt: 'zigbee2mqtt',
};

/**
 * @param id - Full state ID, e.g. "hm-rpc.0.ABC123.1.LEVEL".
 * @param ownAdapterNamespace - This adapter's own namespace (e.g. "shutters.0"), always excluded.
 * @returns Whether `id` belongs to an adapter instance that must never be scanned.
 */
function isForbidden(id: string, ownAdapterNamespace: string): boolean {
    const adapterName = id.split('.')[0];
    if (!adapterName) {
        return true;
    }
    if (id.startsWith(`${ownAdapterNamespace}.`)) {
        return true;
    }
    return FORBIDDEN_SCAN_ADAPTERS.has(adapterName);
}

/**
 * @param id - Full state ID.
 * @returns The driver type implied by `id`'s adapter instance, or `"generic-position"` if it does not belong to one of the "Kern-Set" adapters.
 */
function classifyDriverType(id: string): DriverType {
    const adapterName = id.split('.')[0] ?? '';
    return ADAPTER_TO_DRIVER_TYPE[adapterName] ?? 'generic-position';
}

/**
 * Looks for a sibling stop state in the same parent channel/device
 * (`button.stop` role, or a Homematic-style `STOP` state), used to fill in
 * `states.stop` for the "Kern-Set" drivers.
 *
 * @param positionStateId - Position state whose parent to search for a stop sibling.
 * @param objectsById - All scanned state objects, keyed by ID.
 */
function findStopSibling(positionStateId: string, objectsById: Map<string, ioBroker.StateObject>): string | undefined {
    const parentId = positionStateId.slice(0, positionStateId.lastIndexOf('.'));
    for (const [id, obj] of objectsById) {
        if (id === positionStateId || !id.startsWith(`${parentId}.`)) {
            continue;
        }
        if (obj.common?.role === 'button.stop' || id.endsWith('.STOP')) {
            return id;
        }
    }
    return undefined;
}

/**
 * German label used for the Homematic/CCU "Gewerk" (function/`enum.functions.*`
 * category) that groups shutter/blind actuators - typically named
 * "Verschluss" in German CCU/ioBroker setups. Devices tagged with this
 * function are proposed as Homematic candidates even if their `LEVEL`
 * state is missing the `level.blind` role (plan: Homematic detection via
 * `enum.functions.*`, analogous to the irrigation adapter's valve
 * detection).
 */
const HOMEMATIC_SHUTTER_FUNCTION_NAME = 'verschluss';

/** Minimal shape read from `enum.functions.*` objects - `@iobroker/types` does not model enum objects' `common.members`. */
interface IFunctionEnumObject {
    common?: { name?: ioBroker.StateCommon['name']; members?: string[] };
}

/**
 * Finds all `enum.functions.*` members belonging to a function named
 * "Verschluss" (case-insensitive, any language), for the Homematic
 * Gewerk-based detection described above. Errors are swallowed and logged
 * to `errors` rather than aborting the whole scan, since this is a
 * best-effort enhancement on top of the role-based detection.
 *
 * @param adapter - Adapter instance, used for object access.
 * @param errors - Collected scan errors; a fetch failure here is appended instead of thrown.
 */
async function findHomematicShutterFunctionMembers(adapter: ioBroker.Adapter, errors: string[]): Promise<Set<string>> {
    const members = new Set<string>();
    try {
        // The `type` argument is required here: without it, `getForeignObjectsAsync`
        // defaults to type "state" and would never return `enum` objects.
        const enums = (await adapter.getForeignObjectsAsync('enum.functions.*', 'enum')) as unknown as Record<
            string,
            IFunctionEnumObject | undefined
        >;

        for (const enumObj of Object.values(enums)) {
            const name = resolveName(enumObj?.common?.name, '');
            if (name.toLowerCase() !== HOMEMATIC_SHUTTER_FUNCTION_NAME) {
                continue;
            }
            for (const member of enumObj?.common?.members ?? []) {
                members.add(member);
            }
        }
    } catch (err) {
        errors.push(`"Verschluss" function scan failed: ${(err as Error).message}`);
    }

    return members;
}

/**
 * Derives a stable, valid `IShutterConfig.id` from a foreign state ID.
 *
 * @param stateId - Full foreign state ID to derive an ID from.
 */
function deriveCoveringId(stateId: string): string {
    return stateId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/**
 * @param name - `common.name`, which may be a plain string or a per-language object.
 * @param fallback - Value to use if `name` is empty/not resolvable.
 */
function resolveName(name: ioBroker.StateCommon['name'] | undefined, fallback: string): string {
    if (typeof name === 'string' && name.trim()) {
        return name;
    }
    if (name && typeof name === 'object') {
        const translated = (name as Record<string, string>).en ?? Object.values(name)[0];
        if (translated) {
            return translated;
        }
    }
    return fallback;
}

/**
 * Scans all foreign state objects for coverings not yet configured.
 *
 * @param adapter - Adapter instance, used for object access and its own namespace.
 * @param alreadyConfiguredStateIds - Foreign state IDs already referenced by an existing covering, to avoid proposing duplicates.
 */
export async function scanForShutters(
    adapter: ioBroker.Adapter,
    alreadyConfiguredStateIds: Set<string>,
): Promise<IScanResult> {
    const errors: string[] = [];
    const shutters: IScannedShutter[] = [];
    const seenCoveringIds = new Set<string>();

    // Parent channel/device ID -> open/close/stop state IDs found so far, for the generic-relay pass below.
    const relayCandidatesByParent = new Map<string, { open?: string; close?: string; stop?: string; name?: string }>();

    try {
        const view = await adapter.getObjectViewAsync('system', 'state', { startkey: '', endkey: '\u9999' });

        const objectsById = new Map<string, ioBroker.StateObject>();
        for (const row of view.rows) {
            if (row.value && row.value.type === 'state' && row.value.common) {
                objectsById.set(row.id, row.value);
            }
        }

        for (const [id, obj] of objectsById) {
            if (isForbidden(id, adapter.namespace) || alreadyConfiguredStateIds.has(id)) {
                continue;
            }

            const role = obj.common.role;
            if (role === 'level.blind' && obj.common.write !== false) {
                const coveringId = deriveCoveringId(id);
                if (seenCoveringIds.has(coveringId)) {
                    continue;
                }
                seenCoveringIds.add(coveringId);
                const driverType = classifyDriverType(id);
                const stopStateId = findStopSibling(id, objectsById);
                const states: Record<string, string> = { position: id, positionActual: id };
                if (stopStateId) {
                    states.stop = stopStateId;
                }
                shutters.push({
                    id: coveringId,
                    name: resolveName(obj.common.name, coveringId),
                    driverType,
                    coveringType: 'rolladen',
                    automationEnabled: true,
                    states,
                });
                continue;
            }

            if (role === 'button.open.blind' || role === 'button.close.blind' || role === 'button.stop') {
                const parentId = id.slice(0, id.lastIndexOf('.'));
                const entry = relayCandidatesByParent.get(parentId) ?? {};
                if (role === 'button.open.blind') {
                    entry.open = id;
                } else if (role === 'button.close.blind') {
                    entry.close = id;
                } else {
                    entry.stop = id;
                }
                entry.name ??= resolveName(obj.common.name, parentId);
                relayCandidatesByParent.set(parentId, entry);
            }
        }

        // Homematic "Verschluss" Gewerk pass: some CCU/hm-rpc setups tag
        // shutter/blind channels with the "Verschluss" function instead of
        // (or in addition to) a `level.blind` role on the LEVEL state. Catch
        // those here so they are not missed by the role-based pass above.
        const shutterFunctionMembers = await findHomematicShutterFunctionMembers(adapter, errors);
        for (const member of shutterFunctionMembers) {
            const adapterName = member.split('.')[0] ?? '';
            if (!(adapterName === 'hm-rpc' || adapterName === 'hm-rega')) {
                continue; // "Verschluss" Gewerk lookup only implemented for Homematic so far.
            }
            const levelStateId = `${member}.LEVEL`;
            if (!objectsById.has(levelStateId)) {
                continue;
            }
            if (isForbidden(levelStateId, adapter.namespace) || alreadyConfiguredStateIds.has(levelStateId)) {
                continue;
            }
            const coveringId = deriveCoveringId(levelStateId);
            if (seenCoveringIds.has(coveringId)) {
                continue; // Already found via the role-based pass above.
            }
            seenCoveringIds.add(coveringId);
            const levelObj = objectsById.get(levelStateId);
            const stopStateId = findStopSibling(levelStateId, objectsById);
            const states: Record<string, string> = { position: levelStateId, positionActual: levelStateId };
            if (stopStateId) {
                states.stop = stopStateId;
            }
            shutters.push({
                id: coveringId,
                name: resolveName(levelObj?.common.name, coveringId),
                driverType: 'homematic',
                coveringType: 'rolladen',
                automationEnabled: true,
                states,
            });
        }

        for (const [parentId, entry] of relayCandidatesByParent) {
            if (!entry.open || !entry.close) {
                continue; // Need at least open+close to be usable by generic-relay-driver.
            }
            const coveringId = deriveCoveringId(parentId);
            if (seenCoveringIds.has(coveringId)) {
                continue;
            }
            seenCoveringIds.add(coveringId);
            const states: Record<string, string> = { open: entry.open, close: entry.close };
            if (entry.stop) {
                states.stop = entry.stop;
            }
            shutters.push({
                id: coveringId,
                name: entry.name ?? coveringId,
                driverType: 'generic-relay',
                coveringType: 'rolladen',
                automationEnabled: true,
                states,
            });
        }
    } catch (err) {
        errors.push(`Scan failed: ${(err as Error).message}`);
    }

    return { shutters, errors };
}
