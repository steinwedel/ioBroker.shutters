# Context

## Current Task
- Positioned the door-contact fields directly beside Rolladensperre in the Coverings Admin UI.

## Key Decisions
- Existing door-contact configurations remain active unless explicitly disabled.
- Disabling the switch preserves the contact ID but stops subscription, status activation, and automated closing clamps.
- Deployment uses the central `../scripts/deploy.sh` process.

## Next Steps
- Run the public Adapter Checker before releasing to stable.
