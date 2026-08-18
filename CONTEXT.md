# Context

## Current Task
- Investigated why all 8 shutters stayed open on 2026-08-18: the scheduled close (dusk+60min) never fired; closed them manually via `quickActions.allClose` and hardened the holiday/iCal restart path.

## Key Decisions
- `onStateChange`'s holiday/iCal branches now skip `scheduler.stop()`/`start()` entirely when the incoming value is unchanged (a daily no-op holiday-state rewrite ~30s after the Scheduler's own midnight recompute was the prime suspect for the missed close).
- Added `log.debug`/`log.info` in `scheduler.ts`/`main.ts` for computed open/close times and fired triggers, since none of this was previously visible at any log level.
- The 320×320 RGBA icon remains at `admin/shutters.png`; existing metadata references require no changes.

## Next Steps
- Watch tonight's/tomorrow's close trigger in the log (`Scheduler: area ... scheduled for ...` / `Schedule "close" triggered ...`) to confirm the fix holds.
- Run a real Compact Mode restart before stable release.

