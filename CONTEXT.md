# Context

## Current Task
- Split the sun-protection orientation tolerance into separate minus/plus bounds and added a clock-time preview.

## Key Decisions
- `orientationToleranceDeg` (± single value) replaced by `orientationToleranceMinusDeg`/`orientationTolerancePlusDeg`; a startup migration converts old configs, admin UI auto-fills -70/+70 when empty.
- `isWithinOrientationWindow()` now takes both bounds and compares a signed azimuth diff instead of `abs(diff) <= tolerance`.
- Admin UI gained a self-contained (dependency-free) SunCalc-azimuth port + brute-force time inversion to preview which clock time each bound corresponds to today, using `system.config`'s location.
- Code review caught a critical migration bug: `extendForeignObjectAsync` deep-merges and never deletes a key just because it's absent from the patch, so omitting `orientationToleranceDeg` left it in storage forever (infinite restart loop). Fixed by explicitly writing `null` over it instead of omitting it. Also debounced the tolerance-field keystroke handler and memoized the per-covering hint to stop redundant ~1440-sample azimuth searches on every render.

## Next Steps
- None outstanding for this change (`admin/i18n/*.json` isn't the runtime source for this custom HTML page - `words.js`'s `systemDictionary` already carries en/de directly, matching the existing `orientationToleranceDeg` precedent, which was never in `de.json` either).
