# Context

## Current Task
- Hide door-contact configuration fields when Rolladensperre is disabled.

## Key Decisions
- Switching Rolladensperre immediately re-renders its configuration row.
- Disabled fields retain their saved values for later reactivation.
- Deployment uses the central `../scripts/deploy.sh` process.

## Next Steps
- Run the public Adapter Checker before releasing to stable.
