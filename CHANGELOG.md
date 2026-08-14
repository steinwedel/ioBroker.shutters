# Changelog
## 0.0.11 (2026-08-14)

* (steinwedel) **FIXED**: Make the automation checkbox and weather-data state selectors usable in the Admin UI

## 0.0.10 (2026-08-13)

* (steinwedel) Automatically migrate coverings still using an older, non-sequential ID to the new "shutterN" scheme on adapter start, rewriting group/scene references and recreating the state tree under the new ID

## 0.0.9 (2026-08-13)

* (steinwedel) Assign coverings a stable, sequential ID (shutter1, shutter2, ...) instead of deriving it from the source system's state ID; the ID field is now shown but not editable

## 0.0.8 (2026-08-13)

* (steinwedel) Fix the Coverings tab's state ID fields (Position/Actual-Position/Stop/Open/Close) always showing empty: they read/wrote the wrong states.* keys ("statePosition" etc.) instead of the actual driver keys ("position" etc.), so existing values were silently never displayed even though they were correctly saved

## 0.0.7 (2026-08-13)

* (steinwedel) Add the state-ID browse button/picker to the Coverings tab's state and door contact fields, reusing the same tree/search picker

## 0.0.6 (2026-08-13)

* (steinwedel) Rebuild the state picker as a hierarchical folder-tree browser (like the classic ioBroker object browser), with role/name/live-value display and a boolean-only filter

## 0.0.5 (2026-08-13)

* (steinwedel) Fix a crash in the state picker for objects whose common.name is a localized object instead of a plain string

## 0.0.4 (2026-08-13)

* (steinwedel) Add a lightweight, self-contained state-ID picker (search + list) for the holiday state field in the admin UI

## 0.0.3 (2026-08-13)

* (steinwedel) Simplify public holiday detection to a single configurable boolean state, with an object-tree picker in the admin UI

## 0.0.2 (2026-08-13)

* (steinwedel) initial development version
