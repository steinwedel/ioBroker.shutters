# Context

## Current Task
- Made startup and schedule triggers immediately reconcile the intended position.

## Key Decisions
- `Scheduler.resolveCurrentAction()` resolves today's already-past open/close action, seeded into `AutomationEngine` before its first tick on startup.
- `AutomationEngine.evaluateNow()` re-evaluates immediately after a schedule trigger, so sun/wind/rain protection is checked before a covering is ever commanded to the plain schedule target.

## Next Steps
- Deploy and verify a restart mid-day immediately drives coverings to their correct position.
