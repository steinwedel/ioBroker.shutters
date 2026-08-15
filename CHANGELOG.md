# Changelog
## 0.0.20 (2026-08-15)

* (steinwedel) **NEW**: Add an optional cloud-cover-only sun-protection trigger (plan section 6.3): configure a cloud-cover weather state, then optionally enable a global switch so sun protection activates whenever the sky is clear/mostly clear, independent of the solar-radiation threshold
* (steinwedel) **NEW**: Add drivers for Homematic IP Cloud, Tuya, Somfy, Velux, EnOcean, Velbus, Loxone, Homey and generic MQTT covers, completing the plan's full driver list (auto-discovery for these still needs manual state IDs for now)
* (steinwedel) **FIXED**: Tuya/Loxone drivers now clear their best-effort position estimate on `stop()` instead of leaving it wrongly pinned at 0/100 after a mid-movement stop, matching the existing generic-relay driver's behavior
* (steinwedel) **ENHANCED**: Deduplicate the foreign-state read-back subscription and best-effort position-estimate logic shared across drivers into two reusable helpers
* (steinwedel) **NEW**: Extend auto-discovery to Homematic IP Cloud, EnOcean, Velbus, Velux/KLF200 and Somfy (role-based, same mechanism as the existing systems), plus dedicated detection for Tuya, Loxone and Homey (name-based, since they don't use the standard role convention); generic MQTT covers remain manual-only by design

## 0.0.19 (2026-08-14)

* (steinwedel) **ENHANCED**: Change the default sun-protection orientation tolerance from -70°/+70° to -60°/+60°
* (steinwedel) **FIXED**: Persist the sun-protection manual-override deadline so it survives an adapter restart instead of being silently lost
* (steinwedel) **NEW**: Add a configurable minimum pause between movement commands (`minCommandIntervalMs`) to protect the motor from excessive short-cycling; wind protection always bypasses it
* (steinwedel) **FIXED**: Correct README claims for features that are not implemented yet (additional drivers, notifications, external weather-service fallback, summer night cooling)

## 0.0.18 (2026-08-14)

* (steinwedel) **ENHANCED**: Split the sun-protection orientation tolerance into independent lower/upper bounds (`orientationToleranceMinusDeg`/`orientationTolerancePlusDeg`, default -70°/+70°), auto-filled by the admin UI and migrated from the old single `orientationToleranceDeg` field; the admin UI now also shows the approximate clock time each bound corresponds to today

## 0.0.17 (2026-08-14)

* (steinwedel) **ENHANCED**: Reconcile every covering's intended position (schedule/sun/wind/rain/frost) immediately on adapter startup, and re-evaluate immediately on every schedule trigger instead of waiting up to `automationTickMs`

## 0.0.16 (2026-08-14)

* (steinwedel) **ENHANCED**: Derive the sun-protection active window from window orientation (± tolerance) and sun azimuth instead of a fixed clock-time window

## 0.0.15 (2026-08-14)

* (steinwedel) **ENHANCED**: Restrict sun protection to the scheduled-open period and optional summer mode

## 0.0.14 (2026-08-14)

* (steinwedel) **FIXED**: Use Homematic's configured 0-100 LEVEL percentage scale for shutter commands

## 0.0.13 (2026-08-14)

* (steinwedel) **FIXED**: Convert Homematic LEVEL values between the adapter's covering position and the inverted Homematic percentage direction

## 0.0.12 (2026-08-14)

* (steinwedel) **FIXED**: Use stable plan IDs for covering assignments and migrate legacy name-based assignments

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
