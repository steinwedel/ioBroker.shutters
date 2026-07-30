import type { CoveringType, DriverType } from './types';

/**
 * Auto-discovery for coverings (plan section 2b). Scans all foreign state
 * objects for the standard ioBroker roles that indicate a motorized
 * covering, and proposes ready-to-use `IShutterConfig` fragments.
 *
 * Only the generic drivers can be proposed so far (2b.2 "Generic" row),
 * since no system-specific driver (Homematic, KNX, Shelly, Zigbee, ...) is
 * implemented yet - those specialized scans from the plan are not
 * implemented. There is also no setup wizard UI yet that could let a user
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
    /** Always `"generic-position"` or `"generic-relay"`, see class doc. */
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
function resolveName(name: ioBroker.StateCommon['name'], fallback: string): string {
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

        for (const row of view.rows) {
            const obj = row.value;
            const id = row.id;
            if (!obj || obj.type !== 'state' || !obj.common) {
                continue;
            }
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
                shutters.push({
                    id: coveringId,
                    name: resolveName(obj.common.name, coveringId),
                    driverType: 'generic-position',
                    coveringType: 'rolladen',
                    automationEnabled: true,
                    states: { position: id, positionActual: id },
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
