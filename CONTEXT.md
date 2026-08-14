# Context

## Current Task
- Implemented plan items: fixed README/code discrepancies, persisted the sun-protection override (9a.2), added motor-protection cooldown (7d), and added unit tests for `automation.ts`/`shutter-controller.ts`.

## Key Decisions
- `sunProtectionOverrideUntil` is now a persisted `ack=true` state per covering (`ShutterController.getPersistedSunProtectionOverrideUntil()`/`setSunProtectionOverrideUntil()`); `AutomationEngine.start()` restores it, and it's cleared back to 0 once expired instead of just becoming logically irrelevant.
- Motor protection (7d) is a central gate in `shutter-controller.ts` (`gatedDriverCommand()`/`executeDriverCommand()`) shared by manual commands, schedule, and protection modules; only wind protection (`bypassMotorProtection: true`) skips it; `stop()` is exempt entirely and cancels any buffered command.
- Added `sinon`/`@types/sinon` as direct devDependencies (previously only transitive via `@iobroker/testing`) to fake `Date.now()`/control timers deterministically in the new tests, since `automation.ts`/`shutter-controller.ts` call `Date.now()`/`new Date()` directly rather than taking an injectable clock.
- README corrected: removed/qualified claims for drivers, notify, weather fallback, and night cooling that aren't implemented; added a "Planned, not yet implemented" section.

## Next Steps
- None outstanding for this change.
