import type { CoveringType, DriverType } from './types';

/**
 * Auto-discovery for coverings (plan section 2b). Scans all foreign state
 * objects for the standard ioBroker roles/naming conventions that indicate
 * a motorized covering, and proposes ready-to-use `IShutterConfig`
 * fragments.
 *
 * Detection strategy per system (plan section 2b.2):
 * - homematic, knx, shelly, zigbee, zigbee2mqtt, hmip, enocean, velbus,
 *   velux/klf200, somfy (tahoma): a `level.blind` role, classified by
 *   adapter namespace via `ADAPTER_TO_DRIVER_TYPE`. Anything else with a
 *   `level.blind` role falls back to the generic `generic-position` driver.
 * - homematic additionally has a dedicated "Verschluss" Gewerk pass for
 *   channels missing the role.
 * - `button.open.blind`/`button.close.blind`/`button.stop` roles (any
 *   namespace) are proposed as `generic-relay`.
 * - tuya: a dedicated pass matching the `percent_control`/`percent_state`/
 *   `control` DP name suffixes under the `tuya.*` namespace (Tuya DPs are
 *   not tagged with a `level.blind` role).
 * - loxone: a dedicated pass matching sibling `up`/`down` (and optional
 *   `position`/`info`) state name suffixes under the `loxone.*` namespace.
 * - homey: a dedicated pass matching the `windowcoverings_set` state name
 *   suffix, in any namespace (Homey bridges vary).
 * - generic MQTT covers are intentionally not auto-discovered: the whole
 *   point of that driver is that its command/status topics have no fixed
 *   naming convention to pattern-match on (see `mqtt-driver.ts`), so they
 *   must be configured manually.
 *
 * All namespace-based classifications above are best-effort assumptions
 * about each system's typical ioBroker integration conventions, since they
 * cannot be verified against a real instance of every system; a covering
 * that is not detected, or detected with the wrong `driverType`, can always
 * be added/corrected manually.
 *
 * The admin UI (plan section 2b.3, `admin/shutters.js`) presents the result as a preview list with a
 * checkbox and editable name per candidate rather than importing every candidate automatically; only
 * the ones the user leaves checked when confirming are actually added to `native.shutters[]` (see
 * `main.ts`'s `applyScannedShutters` message handler).
 */

/** One auto-discovered covering candidate, ready to copy into `native.shutters[]` after review. */
export interface IScannedShutter {
    /**
     * A candidate identifier derived from the discovered state ID, used only for internal
     * duplicate-detection within a single scan result. The final `IShutterConfig.id` actually written
     * to `native.shutters[]` is a fresh sequential ID assigned by `nextAvailableCoveringId` in
     * `main.ts` instead - see there for why (in short: covering IDs must be stable and are not meant to
     * be user-facing, so a plain running number is friendlier than an often cryptic source state ID).
     */
    id: string;
    /** Proposed display name, taken from `common.name` if available. */
    name: string;
    /** Detected/assumed driver type, see class doc. */
    driverType: DriverType;
    /** Always `"rolladen"`, since the discovered role gives no further hint about the actual covering type. */
    coveringType: CoveringType;
    /** Always `true`; the user can disable automation after reviewing the candidate. */
    automationEnabled: boolean;
    /** Whether detected Homematic levels use the normalized 0-1 range. */
    homematicLevelNormalized?: boolean;
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

/**
 * Reports a human-readable progress message as `scanForShutters()` moves through its sequential
 * phases (plan section 2b.3) - genuinely sequential, not a cosmetic split of otherwise-parallel work:
 * fetching the full object list is normally the only phase with real latency, but each classification
 * pass below still iterates the entire (potentially very large, in a real installation) object list
 * again, so surfacing them individually is useful, not just decorative.
 */
export type ScanProgressCallback = (message: string) => void;

/** Adapter instances never scanned, to avoid duplicates/recursion (plan section 2b.2). */
const FORBIDDEN_SCAN_ADAPTERS = new Set(['admin', 'alias', 'linkeddevices', 'javascript']);

/** Maps an adapter instance's namespace prefix (`id.split('.')[0]`) to the driver type it implies, for every system whose ioBroker integration is expected to tag its position state with the standard `level.blind` role (plan section 2b.2). */
const ADAPTER_TO_DRIVER_TYPE: Record<string, DriverType> = {
    'hm-rpc': 'homematic',
    'hm-rega': 'homematic',
    knx: 'knx',
    shelly: 'shelly',
    zigbee: 'zigbee',
    zigbee2mqtt: 'zigbee2mqtt',
    hmip: 'hmip',
    enocean: 'enocean',
    velbus: 'velbus',
    velux: 'velux',
    klf200: 'velux',
    tahoma: 'somfy',
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
 * @returns The driver type implied by `id`'s adapter instance, or `"generic-position"` if it does not belong to one of the namespaces in `ADAPTER_TO_DRIVER_TYPE`.
 */
function classifyDriverType(id: string): DriverType {
    const adapterName = id.split('.')[0] ?? '';
    return ADAPTER_TO_DRIVER_TYPE[adapterName] ?? 'generic-position';
}

/**
 * Looks for a sibling stop state in the same parent channel/device
 * (`button.stop` role, or an id ending in `.STOP`/`.stop`, matching every
 * system-specific stop naming convention seen across the plan's driver
 * table, e.g. Homematic's `STOP` and HmIP/Velbus's lowercase `stop`), used
 * to fill in `states.stop` for the `level.blind`-role-based drivers.
 *
 * @param positionStateId - Position state whose parent to search for a stop sibling.
 * @param objectsById - All scanned state objects, keyed by ID.
 */
function findHomematicActualState(
    positionStateId: string,
    objectsById: Map<string, ioBroker.StateObject>,
): string | undefined {
    if (!/^hm-(rpc|rega)\.\d+\.[^.]+\.4\.LEVEL$/.test(positionStateId)) {
        return undefined;
    }
    const actualStateId = positionStateId.replace(/\.4\.LEVEL$/, '.3.LEVEL');
    const actualState = objectsById.get(actualStateId);
    return actualState && actualState.common.write === false ? actualStateId : undefined;
}

function findStopSibling(positionStateId: string, objectsById: Map<string, ioBroker.StateObject>): string | undefined {
    const parentId = positionStateId.slice(0, positionStateId.lastIndexOf('.'));
    for (const [id, obj] of objectsById) {
        if (id === positionStateId || !id.startsWith(`${parentId}.`)) {
            continue;
        }
        if (obj.common?.role === 'button.stop' || id.endsWith('.STOP') || id.endsWith('.stop')) {
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
 * @param id - Full state ID.
 * @returns The final segment after the last `.`, lower-cased, e.g. `"percent_control"` for `"tuya.0.dev1.percent_control"`.
 */
function lastIdSegment(id: string): string {
    return (id.slice(id.lastIndexOf('.') + 1) ?? '').toLowerCase();
}

function nativeStringValue(obj: ioBroker.StateObject, key: 'type' | 'deviceType' | 'eep' | 'EEP'): string | undefined {
    const value = (obj.native as Record<string, unknown> | undefined)?.[key];
    return typeof value === 'string' ? value : undefined;
}

function isSomfyRollerShutter(obj: ioBroker.StateObject): boolean {
    return (['type', 'deviceType'] as const).some(key => nativeStringValue(obj, key) === 'io:RollerShutter');
}

function isEnoceanShutterEep(obj: ioBroker.StateObject): boolean {
    return (['eep', 'EEP'] as const).some(key => /^D2-05(?:-|$)/i.test(nativeStringValue(obj, key) ?? ''));
}

function isWritableNumber(obj: ioBroker.StateObject): boolean {
    return obj.common.type === 'number' && obj.common.write !== false;
}

/**
 * Tuya (`ioBroker.tuya`) detection pass (plan section 2b.2): Tuya DPs are not tagged with a
 * `level.blind` role, so this matches the `percent_control`/`percent_state`/`control` DP name
 * suffixes directly instead, scoped to the `tuya.*` namespace to avoid false positives from unrelated
 * devices using the same generic suffix names elsewhere.
 *
 * @param objectsById - All scanned state objects, keyed by ID.
 * @param isSkipped - Whether a given state ID must be excluded (forbidden namespace or already configured).
 * @param seenCoveringIds - Covering IDs already proposed in this scan, to avoid duplicates.
 * @param shutters - Result array to push newly discovered candidates onto.
 */
function scanTuyaCandidates(
    objectsById: Map<string, ioBroker.StateObject>,
    isSkipped: (id: string) => boolean,
    seenCoveringIds: Set<string>,
    shutters: IScannedShutter[],
): void {
    const byParent = new Map<
        string,
        { percentControl?: string; percentState?: string; control?: string; name?: string }
    >();

    for (const [id, obj] of objectsById) {
        if (!id.startsWith('tuya.') || isSkipped(id)) {
            continue;
        }
        // Tuya DP names are typically prefixed with a DP number, e.g. "1_percent_control" rather than a
        // bare "percent_control" segment - `endsWith()` (not exact equality) accommodates that.
        const suffix = lastIdSegment(id);
        const isPercentControl = suffix.endsWith('percent_control');
        const isPercentState = !isPercentControl && suffix.endsWith('percent_state');
        const isControl = !isPercentControl && !isPercentState && suffix.endsWith('control');
        if (!isPercentControl && !isPercentState && !isControl) {
            continue;
        }
        const parentId = id.slice(0, id.lastIndexOf('.'));
        const entry = byParent.get(parentId) ?? {};
        if (isPercentControl) {
            entry.percentControl = id;
        } else if (isPercentState) {
            entry.percentState = id;
        } else {
            entry.control = id;
        }
        entry.name ??= resolveName(obj.common.name, parentId);
        byParent.set(parentId, entry);
    }

    for (const [parentId, entry] of byParent) {
        // Matches driver-factory.ts's own validation: at least a percent-control or a control DP is required.
        if (!entry.percentControl && !entry.control) {
            continue;
        }
        const coveringId = deriveCoveringId(parentId);
        if (seenCoveringIds.has(coveringId)) {
            continue;
        }
        seenCoveringIds.add(coveringId);
        const states: Record<string, string> = {};
        if (entry.percentControl) {
            states.position = entry.percentControl;
        }
        if (entry.percentState) {
            states.positionActual = entry.percentState;
        }
        if (entry.control) {
            states.control = entry.control;
        }
        shutters.push({
            id: coveringId,
            name: entry.name ?? coveringId,
            driverType: 'tuya',
            coveringType: 'rolladen',
            automationEnabled: true,
            states,
        });
    }
}

function scanMetadataCandidates(
    objectsById: Map<string, ioBroker.StateObject>,
    isSkipped: (id: string) => boolean,
    seenCoveringIds: Set<string>,
    shutters: IScannedShutter[],
): void {
    for (const [id, obj] of objectsById) {
        if (isSkipped(id) || !isWritableNumber(obj)) {
            continue;
        }
        let driverType: DriverType | undefined;
        if (isSomfyRollerShutter(obj)) {
            driverType = 'somfy';
        } else if (id.startsWith('enocean.') && isEnoceanShutterEep(obj)) {
            driverType = 'enocean';
        }
        if (!driverType) {
            continue;
        }
        const coveringId = deriveCoveringId(id);
        if (seenCoveringIds.has(coveringId)) {
            continue;
        }
        seenCoveringIds.add(coveringId);
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
    }
}

/**
 * Loxone (`ioBroker.loxone`) detection pass (plan section 2b.2): matches sibling `up`/`down` impulse
 * states (and, if present, `position`/`info` for direct percentage control) under the same parent
 * Jalousie block, scoped to the `loxone.*` namespace.
 *
 * @param objectsById - All scanned state objects, keyed by ID.
 * @param isSkipped - Whether a given state ID must be excluded (forbidden namespace or already configured).
 * @param seenCoveringIds - Covering IDs already proposed in this scan, to avoid duplicates.
 * @param shutters - Result array to push newly discovered candidates onto.
 */
function scanLoxoneCandidates(
    objectsById: Map<string, ioBroker.StateObject>,
    isSkipped: (id: string) => boolean,
    seenCoveringIds: Set<string>,
    shutters: IScannedShutter[],
): void {
    const byParent = new Map<
        string,
        { up?: string; down?: string; position?: string; positionActual?: string; shade?: string; name?: string }
    >();

    for (const [id, obj] of objectsById) {
        if (!id.startsWith('loxone.') || isSkipped(id)) {
            continue;
        }
        const suffix = lastIdSegment(id);
        if (suffix !== 'up' && suffix !== 'down' && suffix !== 'position' && suffix !== 'info' && suffix !== 'shade') {
            continue;
        }
        const parentId = id.slice(0, id.lastIndexOf('.'));
        const entry = byParent.get(parentId) ?? {};
        if (suffix === 'up') {
            entry.up = id;
        } else if (suffix === 'down') {
            entry.down = id;
        } else if (suffix === 'position') {
            entry.position = id;
        } else if (suffix === 'info') {
            entry.positionActual = id;
        } else {
            entry.shade = id;
        }
        entry.name ??= resolveName(obj.common.name, parentId);
        byParent.set(parentId, entry);
    }

    for (const [parentId, entry] of byParent) {
        // Matches driver-factory.ts's own validation: both up and down are required.
        if (!entry.up || !entry.down) {
            continue;
        }
        const coveringId = deriveCoveringId(parentId);
        if (seenCoveringIds.has(coveringId)) {
            continue;
        }
        seenCoveringIds.add(coveringId);
        const states: Record<string, string> = { up: entry.up, down: entry.down };
        if (entry.position) {
            states.position = entry.position;
        }
        if (entry.positionActual) {
            states.positionActual = entry.positionActual;
        }
        if (entry.shade) {
            states.tilt = entry.shade;
            states.tiltActual = entry.shade;
        }
        shutters.push({
            id: coveringId,
            name: entry.name ?? coveringId,
            driverType: 'loxone',
            coveringType: 'rolladen',
            automationEnabled: true,
            states,
        });
    }
}

/**
 * Homey detection pass (plan section 2b.2): matches the `windowcoverings_set` capability state name
 * suffix, in any namespace (Homey bridge integrations vary). Homey's real `windowcoverings_state`
 * capability is a string status enum, not a numeric position, so it is not usable as a read-back (see
 * `homey-driver.ts`) - `windowcoverings_set` is proposed as both `position` and `positionActual`,
 * assuming a bridge that mirrors the last-written value back onto the same state.
 *
 * @param objectsById - All scanned state objects, keyed by ID.
 * @param isSkipped - Whether a given state ID must be excluded (forbidden namespace or already configured).
 * @param seenCoveringIds - Covering IDs already proposed in this scan, to avoid duplicates.
 * @param shutters - Result array to push newly discovered candidates onto.
 */
function scanHomeyCandidates(
    objectsById: Map<string, ioBroker.StateObject>,
    isSkipped: (id: string) => boolean,
    seenCoveringIds: Set<string>,
    shutters: IScannedShutter[],
): void {
    for (const [id, obj] of objectsById) {
        if (isSkipped(id) || lastIdSegment(id) !== 'windowcoverings_set') {
            continue;
        }
        const coveringId = deriveCoveringId(id);
        if (seenCoveringIds.has(coveringId)) {
            continue;
        }
        seenCoveringIds.add(coveringId);
        shutters.push({
            id: coveringId,
            name: resolveName(obj.common.name, coveringId),
            driverType: 'homey',
            coveringType: 'rolladen',
            automationEnabled: true,
            states: { position: id, positionActual: id },
        });
    }
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
 * @param onProgress - Optional callback invoked with a human-readable message as each scan phase starts, see `ScanProgressCallback`.
 */
export async function scanForShutters(
    adapter: ioBroker.Adapter,
    alreadyConfiguredStateIds: Set<string>,
    onProgress?: ScanProgressCallback,
): Promise<IScanResult> {
    const errors: string[] = [];
    const shutters: IScannedShutter[] = [];
    const seenCoveringIds = new Set<string>();

    // Parent channel/device ID -> open/close/stop state IDs found so far, for the generic-relay pass below.
    const relayCandidatesByParent = new Map<string, { open?: string; close?: string; stop?: string; name?: string }>();

    try {
        onProgress?.('Fetching object list...');
        const view = await adapter.getObjectViewAsync('system', 'state', { startkey: '', endkey: '\u9999' });

        const objectsById = new Map<string, ioBroker.StateObject>();
        for (const row of view.rows) {
            if (row.value && row.value.type === 'state' && row.value.common) {
                objectsById.set(row.id, row.value);
            }
        }

        onProgress?.('Scanning for coverings with a level.blind/button role...');
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
                const actualStateId =
                    driverType === 'homematic' ? findHomematicActualState(id, objectsById) : undefined;
                const states: Record<string, string> = { position: id, positionActual: actualStateId ?? id };
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
        onProgress?.('Scanning Homematic "Verschluss" channels...');
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
            const actualStateId = findHomematicActualState(levelStateId, objectsById);
            const states: Record<string, string> = {
                position: levelStateId,
                positionActual: actualStateId ?? levelStateId,
            };
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

        onProgress?.('Resolving generic relay candidates...');
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

        // Systems whose state naming does not follow the `level.blind`-role convention above get a
        // dedicated pass each, matching the state name suffixes described in plan section 2b.2.
        const isSkipped = (id: string): boolean =>
            isForbidden(id, adapter.namespace) || alreadyConfiguredStateIds.has(id);
        onProgress?.('Scanning Somfy/EnOcean metadata candidates...');
        scanMetadataCandidates(objectsById, isSkipped, seenCoveringIds, shutters);
        onProgress?.('Scanning Tuya candidates...');
        scanTuyaCandidates(objectsById, isSkipped, seenCoveringIds, shutters);
        onProgress?.('Scanning Loxone candidates...');
        scanLoxoneCandidates(objectsById, isSkipped, seenCoveringIds, shutters);
        onProgress?.('Scanning Homey candidates...');
        scanHomeyCandidates(objectsById, isSkipped, seenCoveringIds, shutters);
    } catch (err) {
        errors.push(`Scan failed: ${(err as Error).message}`);
    }

    onProgress?.('Scan complete.');
    return { shutters, errors };
}
