# Context

## Current Task
- Migrated Admin configuration to JSONConfig and the current holiday-state model.

## Key Decisions
- JSONConfig uses a boolean external `holidayStateId` and updates schedules on holiday-state changes.
- All JSONConfig labels are present in every generated i18n file.
- Covering state hierarchy preserves legacy direct-state compatibility.

## Next Steps
- Run a real Compact Mode restart and legacy-object migration test before stable release.
