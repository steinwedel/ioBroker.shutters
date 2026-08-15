# Context

## Current Task
- Closed the last open item in plan section 2a.5: per-covering `windOpenThreshold`/`windCloseAllowedThreshold` override (auto-filled lower for `markise` in the admin UI) and made `rainProtectionEnabled` default off for `lamellen`, matching wind/frost protection's existing coveringType-dependent default.

## Key Decisions
- Wind threshold override reuses the existing global threshold labels in the admin UI (same concept, different scope) rather than introducing new i18n keys.
- The "hide the wind/rain panel for lamellen" part of the original open item was addressed via the correct default (unchecked checkbox) rather than actual conditional panel hiding - simpler, same practical effect, no extra UI-visibility logic needed.
- `defaultOutdoorProtectionEnabled()` in `automation.ts` now covers all three (wind/rain/frost), renamed its doc comment accordingly; behavior for wind/frost is unchanged, only rain's default changed.

## Next Steps
- Not yet deployed to haus20a. No covering there is `markise`/`lamellen` today, so this change has no live behavioral effect until such a covering exists or an override is set.

