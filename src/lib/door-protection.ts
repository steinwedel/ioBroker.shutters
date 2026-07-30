/**
 * Door contact protection (plan section 7e): prevents automated closing
 * actions for a covering above an open terrace/balcony door, without ever
 * blocking opening actions or manual commands.
 */

/**
 * @param desiredPercent - Target covering position an automation module wants to apply, 0-100.
 * @param currentPercent - Current covering position, or undefined if unknown (in which case no clamping is applied, to avoid falsely blocking movement).
 * @param doorOpen - Whether the associated door/window contact currently reports "open".
 * @returns `desiredPercent`, or `currentPercent` if the door is open and `desiredPercent` would close the covering further than its current position.
 */
export function clampForDoorProtection(
    desiredPercent: number,
    currentPercent: number | undefined,
    doorOpen: boolean,
): number {
    if (!doorOpen || currentPercent === undefined) {
        return desiredPercent;
    }
    return desiredPercent > currentPercent ? currentPercent : desiredPercent;
}
