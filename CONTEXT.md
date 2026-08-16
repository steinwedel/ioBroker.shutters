# Context

## Current Task
- Centralized environment configuration in `../.env`, including GitHub CLI credentials.

## Key Decisions
- `INSTANCE=0` in `../.env` covers the shutters adapter; no `SHUTTERS_INSTANCE` override is required.
- Deployment and changelog API settings are shared; the adapter-local `.env` was removed.
- `GITHUB_REPO_OWNER` and `GITHUB_TOKEN` use the active GitHub CLI account.

## Next Steps
- Run a real Compact Mode restart before stable release.

