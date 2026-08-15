# Context

## Current Task
- Implemented the optional wind-direction filter for rain protection (plan section 7): `IWeatherConfig.windDirectionStateId`, `IShutterConfig.rainProtectionWindDirectionToleranceDeg`, `rain-protection.ts` rewritten to accept an inputs object, admin UI (weather panel + per-covering field), full test coverage. Cleaned up plan docs: removed the iCal open question (not needed, per user) and the wind-direction open question (now implemented, not just answered) from section 11, which is now fully closed.

## Key Decisions
- Wind-direction filter is opt-in per covering (`rainProtectionWindDirectionToleranceDeg` undefined = old unconditional behavior unchanged) and "fails open" toward protection if orientation/tolerance/reading are missing.
- Reused `isWithinOrientationWindow()` from `sun-protection.ts` for the ±° window check instead of duplicating wraparound-safe angle math.
- Confirmed on haus20a: `davis.0.sensors.tx1.windDirAvg10Min` is the real wind-direction sensor state (10-min average, matches the already-configured `windSpeedHi10Min`).
- Section 11 ("Offene Fragen") is now empty/closed - both remaining bullets (iCal, Windrichtung) were resolved this session.

## Next Steps
- Not yet deployed to haus20a (code complete, tests/lint green). No `windDirectionStateId`/`rainProtectionWindDirectionToleranceDeg` configured on any live covering yet - purely additive until the user opts in.

