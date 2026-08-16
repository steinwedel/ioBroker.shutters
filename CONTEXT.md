# Context

## Current Task
- Removed unavailable ioBroker repository badges from the GitHub README.

## Key Decisions
- `INSTANCE=0` in `../.env` covers the shutters adapter; no `SHUTTERS_INSTANCE` override is required.
- Deployment and changelog API settings are shared; the adapter-local `.env` was removed.
- Re-add `iobroker.live` badges after the adapter is listed in the ioBroker repository.

## Next Steps
- Run a real Compact Mode restart before stable release.

