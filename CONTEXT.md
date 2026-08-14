# Context

## Current Task
- Replaced the fixed HH:MM sun window with an orientation/azimuth-based window.

## Key Decisions
- Active window = sun azimuth within `orientation ± orientationToleranceDeg` (default 70°).
- `sunWindowStart`/`sunWindowEnd` remain only as a fallback when no orientation is set.
- `admin/i18n/*.json` is unused by the live Materialize UI; `words.js` is the real source.

## Next Steps
- Deploy and verify sun protection engages only while each window faces the sun.
