# Context

## Current Task
- Fixed the rain-protection Admin UI so its visible setting matches the runtime default and its direction tolerance is inline.

## Key Decisions
- The 320×320 RGBA icon remains at `admin/shutters.png`; existing metadata references require no changes.
- `deploy.sh` supports npm 12 `npm pack --json` object output as well as the legacy array output.
- Re-add `iobroker.live` badges after the adapter is listed in the ioBroker repository.

## Next Steps
- Run a real Compact Mode restart before stable release.

