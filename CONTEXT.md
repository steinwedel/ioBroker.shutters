# Context

## Current Task
- Removed all obsolete configuration migration and compatibility code after verifying production uses canonical IDs, plan assignments, and tolerance bounds.

## Key Decisions
- `adminUI.config` must remain `materialize`; never activate JSONConfig.
- Canonical state `shutter1.control.position` exists on the target system.
- Covering states use only the canonical device → channel → state hierarchy.

## Next Steps
- Run a real Compact Mode restart before stable release.
