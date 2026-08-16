# Context

## Current Task
- Removed the unused JSONConfig artifact and restored Materialize as the only Admin UI.

## Key Decisions
- `adminUI.config` must remain `materialize`; never activate JSONConfig.
- `jsonConfig.json` has been removed and is not maintained.
- Covering state hierarchy preserves legacy direct-state compatibility.

## Next Steps
- Run a real Compact Mode restart and legacy-object migration test before stable release.
