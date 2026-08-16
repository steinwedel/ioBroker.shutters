# Context

## Current Task
- Published `iobroker.shutters@0.0.53` publicly to npm and verified the `latest` tag.

## Key Decisions
- `INSTANCE=0` in `../.env` covers the shutters adapter; no `SHUTTERS_INSTANCE` override is required.
- Deployment and changelog API settings are shared; the adapter-local `.env` was removed.
- GitHub credentials in `../.env` use the active GitHub CLI account.

## Next Steps
- Run a real Compact Mode restart before stable release.

