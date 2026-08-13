/**
 * Generates the next unused sequential covering ID like "shutter1", "shutter2", ..., skipping any value
 * already present in `existingIds`. Plan section 2b: covering IDs are meant to be simple, stable,
 * user-agnostic numbers instead of being derived from the source system's often cryptic state ID (e.g. a
 * Homematic channel address like "hm-rpc_2_00111BE99280E9_4_LEVEL"). Once assigned, an ID must not
 * change again, since it is the ioBroker object ID namespace segment for all of that covering's own
 * states ("shutters.<instance>.<id>.*"); renaming it later would orphan the old state objects (and their
 * history) and silently break any user automation/VIS binding that references them - which is also why
 * the admin UI does not let the user edit an existing covering's ID.
 *
 * @param existingIds - IDs already in use (from `native.shutters[]`), so a newly generated ID never collides with one already assigned to a different covering.
 * @param prefix - ID prefix; defaults to `"shutter"`.
 */
export function nextAvailableCoveringId(existingIds: Iterable<string>, prefix = 'shutter'): string {
    const used = new Set(existingIds);
    let n = 1;
    while (used.has(`${prefix}${n}`)) {
        n++;
    }
    return `${prefix}${n}`;
}
