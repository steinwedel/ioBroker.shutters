# Context

## Current Task
- Synchronized all Admin i18n files from the authoritative German dictionary.

## Key Decisions
- All 11 locale files contain the same 150 translation keys.
- Missing non-German translations use generated localized text or English fallback.
- Deployment uses the central `../scripts/deploy.sh` process.

## Next Steps
- Run the public Adapter Checker before releasing to stable.
