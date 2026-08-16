# Context

## Current Task
- Disabled sun and rain protection without a configured orientation.

## Key Decisions
- Admin toggles are disabled and values reset when orientation is cleared.
- Runtime also gates sun and rain protection on a valid 0–359° orientation.
- Deployment uses the central `../scripts/deploy.sh` process.

## Next Steps
- Run the public Adapter Checker before releasing to stable.
