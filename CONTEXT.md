# Context

## Current Task
- Fixed a real gap exposed by the `script.js.Shutters` conflict (now resolved - user disabled the legacy script, confirmed): `applyTarget()` in `automation.ts` only re-applied a target on an actual target/reason change, never noticing if the covering had settled but then drifted away from that target for any other reason. Added a drift check against `ShutterController.getCurrentCoveringPercent()`, gated by a new `hasPendingMove()` so it does not fire during normal in-flight travel (that stays the watchdog's job).

## Key Decisions
- Drift check only applies once `hasPendingMove()` is `false` (settled) - deliberately not compared while a move is still in flight, to avoid duplicating/conflicting with the watchdog (9a.1).
- Reused `WATCHDOG_TOLERANCE_PERCENT` (now exported from `shutter-controller.ts`) as the "close enough to be considered arrived" tolerance, for consistency with the watchdog's own notion of "reached".
- `invertPosition` (previous change) turned out not to be the actual root cause of the original incident - the legacy script conflict was - but it remains as a legitimate, independently useful feature.

## Next Steps
- None outstanding. Both the immediate live incident (legacy script) and the adapter-side gap it exposed are resolved.

