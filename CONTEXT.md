# Context

## Current Task
- Replaced the adapter icon with a custom smart-home roller-shutter design.

## Key Decisions
- The 320×320 RGBA icon remains at `admin/shutters.png`; existing metadata references require no changes.
- `INSTANCE=0` in `../.env` covers the shutters adapter; no `SHUTTERS_INSTANCE` override is required.
- Re-add `iobroker.live` badges after the adapter is listed in the ioBroker repository.

## Next Steps
- Run a real Compact Mode restart before stable release.

