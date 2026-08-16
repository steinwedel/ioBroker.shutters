# ioBroker.shutters

[![NPM version](https://img.shields.io/npm/v/iobroker.shutters.svg)](https://www.npmjs.com/package/iobroker.shutters)
[![Downloads](https://img.shields.io/npm/dm/iobroker.shutters.svg)](https://www.npmjs.com/package/iobroker.shutters)
![Number of Installations](https://iobroker.live/badges/shutters-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/shutters-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.shutters.png?downloads=true)](https://nodei.co/npm/iobroker.shutters/)

**Tests:** ![Test and Release](https://github.com/steinwedel/ioBroker.shutters/workflows/Test%20and%20Release/badge.svg)

## shutters adapter for ioBroker

Unified control and automation for roller shutters, external venetian blinds, awnings and vertical lamella blinds, across multiple smart home systems.

### Features

- **One control interface for many systems** — Homematic (CCU and Homematic IP Cloud), KNX, Shelly, Zigbee (`ioBroker.zigbee` and `ioBroker.zigbee2mqtt`), Tuya, Somfy (TaHoma/Connexoon), Velux (KLF200), EnOcean, Velbus, Loxone, Homey, generic MQTT covers and generic relay/position outputs are all controlled through the same set of states — mix and match systems freely, even within the same group.
- **Auto-discovery** — scans the object tree of connected adapter instances to find existing shutters/blinds/awnings automatically and shows them as a preview list (with a live progress indicator while the scan runs) - review, rename or uncheck any of them, then confirm to add exactly the ones you want, instead of entering every state ID by hand.
- **Multiple covering types** — Roller shutter, external venetian blind (with slat tilt), awning and vertical lamella blind are each handled with the correct movement/safety logic for that type (e.g. an awning must retract in wind, not extend, unlike a roller shutter).
- **Height-to-runtime calibration** — a configurable calibration curve compensates for coverings where covering height is not proportional to motor runtime; generic relay coverings offer a guided close/open measurement run with explicit end-stop confirmation.
- **Daily schedule** — automatic opening/closing per plan, in one of three schedule modes ("all days the same", "weekday / weekend / public holiday", or "individual weekday + public holiday"), only showing the fields relevant to the selected mode; sunrise/sunset/dawn/dusk-relative timing: each open/close field accepts a plain "HH:MM" clock time, an offset from sunrise/sunset (or civil dawn/dusk, with a trailing `d`) prefixed with `+`/`-` in plain minutes (e.g. `-30`, `-30d`) or an "HH:MM" duration (e.g. `+01:30`), or that offset combined with a "!HH:MM" cap (e.g. `+30!19:00` = 30 minutes after sunset, but never later than 19:00; analogous for opening/sunrise). An optional calendar (iCal) integration can override a single day's opening/closing time via an `ioBroker.ical` instance.
- **Sun protection** — automatically lowers coverings to a configurable intermediate position on hot, sunny days within a configurable time window, with flicker-free behavior when clouds pass by. An optional geometry-based mode (window orientation and sun position) is available for coverings without a fixed sun-facing time window. An optional minimum-temperature filter avoids shading on bright but cool days when there is no actual overheating risk. Once per calendar year, a notification reminds you that sun protection is active again for the season, in case last year's settings need a second look.
- **Rain protection** — closes coverings automatically when rain is detected.
- **Storm/wind protection** — immediately moves coverings to their safe position when wind speed exceeds a configurable limit, overriding every other rule; can be enabled/disabled per covering since wind relevance depends heavily on the covering type.
- **Frost protection** — pauses automated movement during freezing, damp conditions to avoid ice damage, can be enabled/disabled per covering.
- **Night cooling** — on a hot summer night, keeps a covering open (or opens it) instead of closing it on schedule, when it is warm enough inside and meaningfully cooler outside; disabled by default and only for coverings with an indoor-temperature sensor configured, since it is a comfort feature (not a safety one) that needs one to work.
- **Door contact protection** — prevents a shutter above a terrace/balcony door from closing automatically while the door is open; manual commands are never blocked.
- **Motor protection** — enforces a minimum pause between movement commands regardless of what triggered them (schedule, protection, or a manual command); storm protection always bypasses it so a safety reaction is never delayed.
- **Manual override awareness** — a manual command issued while sun protection is active suspends sun protection for that covering until midnight, so it does not immediately re-close after you open it; this suspension survives an adapter restart.
- **Watchdog & restart recovery** — detects a covering that does not reach its target position in time; a move still in progress when the adapter restarts is not forgotten, so a genuinely stuck covering is still reported instead of silently looking idle.
- **Notifications** — optionally send a Pushover/Telegram message when a covering's watchdog reports it is not responding, or when storm/frost protection engages or clears (one combined message across all affected coverings, not one per covering).
- **Weather data** — uses your own weather station states (solar radiation, wind, rain, temperature, humidity); there is no built-in fallback to an external weather service, but any adapter that exposes weather values as regular states (e.g. `ioBroker.multiweather`) can be configured the same way as a physical weather station.
- **Groups** — combine any number of coverings, even from different systems, into a group with combined open/close/position control.
- **Quick actions** — global "open all"/"close all" buttons (`quickActions.allOpen`/`allClose`) affect every configured covering at once, regardless of group membership.
- **Human-readable status per covering** — always shows in plain language why a covering is in its current position (schedule, sun protection, wind protection, etc.), plus a short rolling history of its last 10 automated actions (`activityLog`) for "what did it do today and why".

### Covering types

| Type | Typical use |
|---|---|
| Roller shutter | Standard exterior roller shutter |
| External venetian blind (Raffstore) | Height + slat tilt |
| Awning | Extension length instead of height; safe direction is retracted, not extended |
| Vertical lamella blind | Horizontal travel + slat rotation, usually indoor, wind/rain protection typically not applicable |

External venetian blinds and vertical lamella blinds can optionally have a separate slat-tilt state ID configured (in addition to the main height/travel state), if the underlying system exposes one - entirely optional, and independent of which driver/system is used.

---

## Quick Start

1. **Add your coverings** — open the covering configuration and click **Scan** to auto-discover connected shutters/blinds/awnings; review the preview list, then confirm to add the ones you want - or add one manually by entering its covering type and the relevant state IDs.
2. **Set a schedule** — configure opening and closing times per plan (or accept the defaults).
3. Save. The adapter immediately opens/closes coverings on schedule; sun, rain, wind and frost protection use sensible default thresholds and can be fine-tuned later.

Advanced settings (calibration, sun/wind/frost protection thresholds, groups, scenes) are optional and can be configured later — the adapter works with sensible defaults right after the initial scan.

---

## Configuration Overview

### Coverings

Each covering is assigned a stable, sequential ID (e.g. `shutter1`, `shutter2`, ...) when added, shown for reference but not editable - it is the ioBroker object ID for that covering's own states (`shutters.<instance>.<id>.*`), so changing it later would orphan those states and break any automation/VIS binding that references them. It is configured with:

- A display name and an assigned plan, selected from a dropdown of the plans configured on the Plans tab. The assignment uses a stable internal plan ID, so renaming a plan does not change its assigned coverings.
- A covering type (roller shutter, external venetian blind, awning, vertical lamella blind).
- The connected system (driver) and the relevant state IDs — filled in automatically by the scan, or entered manually.
- Optional window orientation, used by sun protection.
- Optional calibration curve mapping the requested covering height to the required motor-runtime percentage when height is not proportional to runtime.
- Generic-relay coverings support a guided calibration run: close/open the covering, confirm each end stop, then copy the measured `calibrationOpenRuntimeSecs` and `calibrationCloseRuntimeSecs` values into the relay runtime configuration.
- Optional protection toggles (wind, frost), each enabled/disabled per covering with sensible defaults based on the covering type.
- Optional minimum pause between movement commands (motor protection), with a sensible default.

### Plans

Each plan has a schedule mode, selected from a dropdown, which determines which fields are shown:

- **All days the same** — a single open/close pair applies every day, including public holidays.
- **Weekday / weekend / public holiday** — the classic three-field schedule: separate weekday and weekend open/close pairs, plus an optional public holiday override (falling back to the weekend pair if left empty).
- **Individual weekday + public holiday** — a separate open/close pair for each of the seven weekdays, plus an optional public holiday override (falling back to the current weekday's own pair if left empty).

Every open/close field is either a plain "HH:MM" clock time, an offset from sunrise/sunset - or, with a trailing `d`, civil dawn/dusk - written with a leading `+` (after) or `-` (before) sign as plain minutes (e.g. `-30`, `-30d`) or an "HH:MM" duration (e.g. `+01:30`), or that offset combined with a "!HH:MM" cap, e.g. `+30!19:00` (30 minutes after sunset, but never later than 19:00; analogous for opening). Each covering is assigned to a plan via a dropdown on the Coverings tab.

Public holiday detection is not built in. Instead, configure the ID of an existing boolean state (own or foreign, e.g. from a calendar/iCal adapter such as one that computes public holidays) whose current value decides whether "today" counts as a public holiday for every plan above: `true` = public holiday, `false`/empty = not a public holiday. Leave the field empty to disable holiday-specific schedules entirely.

Optionally, an `ioBroker.ical` instance can override a single day's opening/closing time for one or every plan: configure the instance (e.g. `ical.0`) and an event title prefix (default `"Rolläden"`), then add a calendar event whose title starts with that prefix, e.g. `"Rolläden auf 07:00"` (overrides today's opening time for every plan) or `"Rolläden: Kinderzimmer auf 07:00"` (only for the plan named "Kinderzimmer"); use `"zu"` instead of `"auf"` to override the closing time. The actual calendar URL/file (Google, Nextcloud, a local `.ics` file, ...) is configured on the `ical` instance itself, not here.

### Sun / Rain / Wind / Frost Protection

Global and per-covering thresholds control when each protection function activates. All protections work with sensible built-in defaults; no configuration is required to get useful behavior out of the box.

### Groups

Group multiple coverings — even from different connected systems — for combined control (e.g. "all shutters downstairs").

### Weather Data

Configure your own weather station states (solar radiation, wind, rain, temperature, humidity) where available; protection functions that need a value you have not configured simply stay inactive. There is no built-in fallback to an external weather service - if you do not have your own weather station, an adapter such as `ioBroker.multiweather` can provide the same values as regular states, configured the same way as a physical sensor.

### Notifications

Optionally configure an existing `pushover`/`telegram` adapter instance (e.g. "pushover.0"/"telegram.0") to receive a message when a covering's watchdog reports it is not responding, or when storm/wind or frost protection engages or clears for at least one covering (one combined message, not one per covering). Configure the recipient/chat directly on that instance, not here. Either, both, or neither can be set; leaving both empty disables notifications entirely.

---

## Dashboard widgets

For a vis/vis-2 dashboard, these states are the most useful to show:

- `shutters.<id>.status.positionActual` — current covering position (0-100), e.g. as a slider widget.
- `shutters.<id>.status.statusText` — human-readable reason for the covering's current behavior.
- `shutters.<id>.diagnostics.watchdogLastIssue` — last "not responding" message, useful for a fault-overview widget across all coverings.
- `groups.<id>.openAll` / `groups.<id>.closeAll` and `quickActions.allOpen` / `quickActions.allClose` — one-tap buttons for whole rooms or the entire home.

`sunProtectionActive`/`windProtectionActive`/`rainProtectionActive`/`frostProtectionActive` are internal automation state, not separate ioBroker states - `statusText` already reflects whichever of them is currently in effect.

---

## Known limitations

- Auto-discovery is best-effort and depends on the connected adapter using standard object roles (or, for Tuya/Loxone/Homey, a recognized state-naming convention); unusual third-party device setups, or a system that does not follow the assumed convention, may need to be added manually.
- Systems without a position feedback (e.g. simple open/close/stop relays) estimate the current position from runtime rather than a real sensor value.

## Planned, not yet implemented

- Auto-discovery for generic MQTT covers - not applicable by design, since their command/status topics have no fixed naming convention to detect; these always need to be added manually with the matching state IDs.

## Changelog
See [CHANGELOG.md](CHANGELOG.md)

## License
MIT License

Copyright (c) 2026 Gerhard Steinwedel <dev@steinwedel.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
