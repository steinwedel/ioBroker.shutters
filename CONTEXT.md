# Context

## Current Task
- Restoring the Materialize Admin UI after an incorrect JSONConfig activation.

## Key Decisions
- `adminUI.config` must remain `materialize`; never activate JSONConfig.
- `jsonConfig.json` remains inactive and does not control the Admin UI.
- Covering state hierarchy preserves legacy direct-state compatibility.

## Next Steps
- Run a real Compact Mode restart and legacy-object migration test before stable release.
