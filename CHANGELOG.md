# Changelog
## **WORK IN PROGRESS**

## 0.0.61 (2026-08-21)

* (Gerhard Steinwedel) **FIXED**: Sun protection no longer flaps a covering up/down repeatedly during scattered/broken clouds: once its combined sun-protection decision changes, it now holds for `sunActiveLockMs` (default 10 min) before it can change again, and solar radiation/cloud cover are averaged over `sunProtectionAveragingDurationMs` (default 10 min) instead of reacting to single readings.

## 0.0.60 (2026-08-20)

* (Gerhard Steinwedel) **NEW**: Added `status.reasonDetail` per covering: a human-readable explanation of *why* it is currently open/closed/held (concrete thresholds and measurements behind the short `statusText` reason), updated every automation tick.

## 0.0.59 (2026-08-20)
* (Gerhard Steinwedel) **FIXED**: Rain protection now engages immediately when rain starts, instead of waiting up to 5 minutes — only the transition back to dry is still debounced (`rainStatusDebounceMs`), so a brief gap between drops mid-shower does not prematurely release protection. Same asymmetric hysteresis already used by wind protection's calm-down logic.

## 0.0.58 (2026-08-19)
* (Gerhard Steinwedel) **NEW**: Rain protection target position (covering height) now configurable in admin UI — `rainTargetPercent` field appears next to rain protection checkbox when enabled, matching the existing sun protection height field
* (Gerhard Steinwedel) **FIXED**: Rain-protected coverings with wind-direction filters no longer close unconditionally when wind is too weak to determine direction reliably — once a direction filter is configured (orientation + tolerance), unmeasured or sub-threshold wind means that covering does not protect, rather than protecting regardless of configured direction (previous behavior caused all rain-protected coverings to close together during light rain below 5 km/h minimum). Coverings without a direction filter configured retain the original behavior of protecting on any rain

## 0.0.57 (2026-08-18)

* (steinwedel) **FIXED**: Skip a redundant Scheduler restart on a no-op holiday/iCal state rewrite, and log schedule computations/triggers for diagnosability

## 0.0.56 (2026-08-17)

* (steinwedel) **FIXED**: Stabilize rain status and wind direction to prevent rain-protection oscillation

## 0.0.55 (2026-08-17)

* (steinwedel) **FIXED**: Show the effective rain-protection setting and place its wind-direction tolerance beside the checkbox

## 0.0.54 (2026-08-16)

* (steinwedel) **ENHANCED**: Add a custom roller-shutter adapter icon and remove unavailable repository badges

## 0.0.53 (2026-08-16)

* (steinwedel) **ENHANCED**: Remove all obsolete configuration migration and compatibility code; require canonical covering IDs, plan IDs, and orientation tolerance bounds

## 0.0.52 (2026-08-16)

* (steinwedel) **ENHANCED**: Remove the unused JSONConfig admin artifact

## 0.0.51 (2026-08-16)

* (steinwedel) **FIXED**: Restore the Materialize Admin UI

## 0.0.50 (2026-08-16)

* (steinwedel) **ENHANCED**: Migrate covering objects to the canonical device → channel → state hierarchy
* (steinwedel) **FIXED**: Reset the adapter connection state during unload and refresh calibration documentation
* (steinwedel) **ENHANCED**: Remove the unused vulnerable development server dependency
* (steinwedel) **ENHANCED**: Replace the legacy Admin UI with JSONConfig and support the current holiday state model

## 0.0.49 (2026-08-16)

* (steinwedel) **ENHANCED**: Synchronize all Admin UI translations from the authoritative German dictionary

## 0.0.48 (2026-08-16)

* (steinwedel) **ENHANCED**: Disable per-covering sun and rain protection when orientation is missing

## 0.0.47 (2026-08-16)

* (steinwedel) **FIXED**: Align the minimum sun-elevation field to the left in the Coverings UI

## 0.0.46 (2026-08-16)

* (steinwedel) **FIXED**: Align the maximum cloud-cover field directly beside the sun-protection minimum temperature

## 0.0.45 (2026-08-16)

* (steinwedel) **ENHANCED**: Refine the Coverings sun-protection cloud cover and tolerance field layout

## 0.0.44 (2026-08-16)

* (steinwedel) **ENHANCED**: Refine the Coverings sun-protection field labels, alignment, and row layout

## 0.0.43 (2026-08-16)

* (steinwedel) **ENHANCED**: Start remaining sun-protection settings on a new line after the target position

## 0.0.42 (2026-08-16)

* (steinwedel) **ENHANCED**: Nest and indent Coverings sun-protection settings beneath their checkbox

## 0.0.41 (2026-08-16)

* (steinwedel) **ENHANCED**: Hide door-contact fields while Rolladensperre is disabled

## 0.0.40 (2026-08-16)

* (steinwedel) **FIXED**: Complete JSDoc documentation required by the project linter

## 0.0.39 (2026-08-16)

* (steinwedel) **ENHANCED**: Place the Stop-State beside System and keep the System label visible

## 0.0.38 (2026-08-16)

* (steinwedel) **ENHANCED**: Align the Coverings system selector and reorder linked position fields

## 0.0.37 (2026-08-16)

* (steinwedel) **ENHANCED**: Move the Coverings system selector into the linked hardware section

## 0.0.36 (2026-08-16)

* (steinwedel) **ENHANCED**: Position door-contact settings beside the Rolladensperre option

## 0.0.35 (2026-08-16)

* (steinwedel) **NEW**: Add a per-covering Rolladensperre switch to enable or disable door-contact protection

## 0.0.34 (2026-08-16)

* (steinwedel) **ENHANCED**: Position the Coverings plan selector beside the schedule automation option

## 0.0.33 (2026-08-16)

* (steinwedel) **ENHANCED**: Move the Coverings plan selector into the automation functions section

## 0.0.32 (2026-08-16)

* (steinwedel) **FIXED**: Force Coverings automation checkboxes to the left edge

## 0.0.31 (2026-08-16)

* (steinwedel) **ENHANCED**: Display Coverings automation functions vertically and left-aligned

## 0.0.30 (2026-08-16)

* (steinwedel) **ENHANCED**: Reorder the primary fields in each Coverings card

## 0.0.29 (2026-08-16)

* (steinwedel) **FIXED**: Align the standalone Coverings ID field to the left

## 0.0.28 (2026-08-16)

* (steinwedel) **ENHANCED**: Reorganize the Coverings card layout and clarify linked hardware terminology

## 0.0.27 (2026-08-16)

* (steinwedel) **ENHANCED**: Rename and move the per-covering schedule automation option into the automation functions section

## 0.0.26 (2026-08-16)

* (steinwedel) **ENHANCED**: Improve Coverings Admin UI terminology and update foreign position-state labels when position mapping is inverted

## 0.0.25 (2026-08-16)

* (steinwedel) **ENHANCED**: Rename the Admin UI Plan tab to Zeitpläne and improve the spacing in the Coverings form

## 0.0.24 (2026-08-16)

* (steinwedel) **FIXED**: Prevent long field labels in the Coverings and Weather Data Admin UI tabs from overlapping their input fields

## 0.0.23 (2026-08-15)

* (steinwedel) **NEW**: Add a per-covering `windOpenThreshold`/`windCloseAllowedThreshold` override (plan section 2a.5) for a covering more wind-sensitive than the rest - the admin UI shows and pre-fills a lower suggestion (20/10 km/h) for a markise, since its fabric/arms are far more vulnerable to wind than a closed rolladen panzer
* (steinwedel) **FIXED**: `rainProtectionEnabled` now defaults to disabled for a `lamellen` covering (typically indoor, no real weather exposure), matching the existing default for `windProtectionEnabled`/`frostProtectionEnabled` - previously rain protection defaulted to enabled regardless of covering type

## 0.0.22 (2026-08-15)

* (steinwedel) **NEW**: Add an optional per-covering wind-direction filter for rain protection (plan section 7): configure a wind-direction weather state, then optionally set a per-covering tolerance so rain protection only reacts to rain actually being blown toward that covering's window, based on its orientation - left unset, behavior is unchanged (protects on any rain)

## 0.0.21 (2026-08-15)

* (steinwedel) **FIXED**: `automation.ts` now also re-applies an unchanged target/reason if the covering has settled (no move in flight) but its actual reported position has since drifted away from that target - previously only a target/reason change triggered a fresh command, so a drift caused by e.g. an external system/script writing the same foreign state went unnoticed until something else changed or the adapter restarted
* (steinwedel) **NEW**: Add a per-covering `invertPosition` option (plan section 2a.6) to compensate for an individual actuator wired/configured with the opposite direction from its siblings on the same system (observed on a Homematic blind channel that closed fully instead of stopping at the configured 85%)

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
