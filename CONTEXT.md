# Context

## Current Task
- Published the project to the public GitHub repository `steinwedel/ioBroker.shutters`.

## Key Decisions
- `INSTANCE=0` in `../.env` covers the shutters adapter; no `SHUTTERS_INSTANCE` override is required.
- Deployment and changelog API settings are shared; the adapter-local `.env` was removed.
- GitHub credentials in `../.env` use the active GitHub CLI account.

## Next Steps
- Run a real Compact Mode restart before stable release.

