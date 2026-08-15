/**
 * Behangtyp-abhängige Zielrichtungen für Wind- und Regenschutz (plan section 2a.5).
 *
 * `IShutterConfig.coveringType` determines *which direction* is safe/protective for a given
 * covering - "0" and "100" don't have a fixed real-world meaning by themselves, they only mean
 * "fully retracted/raised" vs. "fully extended/lowered" per the position convention in plan
 * section 2a.5. For most covering types the safe wind position and the rain-protective position
 * happen to be the same direction as for a plain `rolladen`, but `markise` inverts both: an
 * extended* awning is the vulnerable position in both storm and rain, not the retracted one.
 *
 * Adding a new `CoveringType` only requires extending the two functions below (and the table in
 * plan section 2a.5) - `automation.ts` and the individual protection modules never hardcode a
 * direction themselves.
 */

import type { CoveringType } from './types';

/**
 * Target covering position (0-100) that wind protection (plan section 7a) drives a covering with
 * this `coveringType` to once active.
 *
 * `0` for every currently supported type: for `rolladen`/`raffstore` that means fully raised
 * (the lowered/extended position is the one at risk in storm); for `markise` it means fully
 * retracted, which is *also* `0` under the position convention even though height and extension
 * otherwise invert (see the `coveringType` table in plan section 2a.5) - a `markise` must never
 * be driven to `100` (fully extended) by wind protection. `lamellen` coverings are typically
 * indoor and have wind protection disabled by default (`automation.ts`'s
 * `defaultOutdoorProtectionEnabled()`), but this still resolves a value for the rare case of an
 * outdoor installation with wind protection explicitly enabled.
 *
 * @param _coveringType - Covering type to resolve the safe wind-protection position for. Currently unused since every type resolves to the same value, but kept as a parameter so call sites read naturally and future covering types can differ.
 */
export function safePosition(_coveringType: CoveringType): number {
    return 0;
}

/**
 * Target covering position (0-100) that rain protection (plan section 7) drives a covering with
 * this `coveringType` to once active. Unlike `safePosition()`, this genuinely differs by type,
 * per the "Regenschutz-Zielrichtung" column of the `coveringType` table in plan section 2a.5:
 *
 * - `rolladen`/`raffstore`/`lamellen`: `100` (close further, keeps the sill/frame dry).
 * - `markise`: `0` (retract) - an *extended* awning is itself what gets wet and can accumulate
 *   water/be damaged; extending it further (the `rolladen` default of `100`) would be exactly
 *   backwards.
 *
 * `IShutterConfig.rainTargetPercent`, when explicitly configured, always takes precedence over
 * this default; callers only fall back to `protectedPosition()` when it is unset.
 *
 * @param coveringType - Covering type to resolve the rain-protective position for.
 */
export function protectedPosition(coveringType: CoveringType): number {
    return coveringType === 'markise' ? 0 : 100;
}
