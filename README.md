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

- **One control interface for many systems** — Homematic (CCU and Homematic IP), KNX, Shelly, Zigbee (`ioBroker.zigbee` and `ioBroker.zigbee2mqtt`), Tuya, Somfy, Velux, EnOcean, Velbus, Loxone, Homey, generic MQTT covers and generic relay/position outputs are all controlled through the same set of states — mix and match systems freely, even within the same group.
- **Auto-discovery** — scans the object tree of connected adapter instances to find existing shutters/blinds/awnings automatically and suggests them for import instead of requiring every state ID to be entered by hand.
- **Multiple covering types** — Roller shutter, external venetian blind (with slat tilt), awning and vertical lamella blind are each handled with the correct movement/safety logic for that type (e.g. an awning must retract in wind, not extend, unlike a roller shutter).
- **Height-to-runtime calibration** — a configurable calibration curve compensates for coverings where covering height is not proportional to motor runtime, with a guided calibration run.
- **Daily schedule** — automatic opening/closing per plan, in one of three schedule modes ("all days the same", "weekday / weekend / public holiday", or "individual weekday + public holiday"), only showing the fields relevant to the selected mode; optional calendar (iCal) override for individual days, and sunrise/sunset/dawn/dusk-relative timing: each open/close field accepts a plain "HH:MM" clock time, an offset from sunrise/sunset (or civil dawn/dusk, with a trailing `d`) prefixed with `+`/`-` in plain minutes (e.g. `-30`, `-30d`) or an "HH:MM" duration (e.g. `+01:30`), or that offset combined with a "!HH:MM" cap (e.g. `+30!19:00` = 30 minutes after sunset, but never later than 19:00; analogous for opening/sunrise).
- **Sun protection** — automatically lowers coverings to a configurable intermediate position on hot, sunny days within a configurable time window, with flicker-free behavior when clouds pass by. An optional geometry-based mode (window orientation and sun position) is available for coverings without a fixed sun-facing time window.
- **Rain protection** — closes coverings automatically when rain is detected.
- **Storm/wind protection** — immediately moves coverings to their safe position when wind speed exceeds a configurable limit, overriding every other rule; can be enabled/disabled per covering since wind relevance depends heavily on the covering type.
- **Frost protection** — pauses automated movement during freezing, damp conditions to avoid ice damage, can be enabled/disabled per covering.
- **Door contact protection** — prevents a shutter above a terrace/balcony door from closing automatically while the door is open; manual commands are never blocked.
- **Summer night cooling** — optionally keeps coverings open overnight when it is warm inside and cooler outside, to help rooms cool down (opt-in, disabled by default).
- **Manual override awareness** — a manual command issued while sun protection is active suspends sun protection for that covering until midnight, so it does not immediately re-close after you open it.
- **Weather data with fallback** — uses your own weather station if configured; any missing weather value (solar radiation, wind, rain, temperature, forecast) can optionally be fetched from a free external weather service, so the adapter works even without your own weather station.
- **Groups** — combine any number of coverings, even from different systems, into a group with combined open/close/position control.
- **Human-readable status per covering** — always shows in plain language why a covering is in its current position (schedule, sun protection, wind protection, etc.).
- **Notifications** — optional alerts (e.g. via Pushover/Telegram) for a covering that stops responding, or when storm protection activates.

### Covering types

| Type | Typical use |
|---|---|
| Roller shutter | Standard exterior roller shutter |
| External venetian blind (Raffstore) | Height + slat tilt |
| Awning | Extension length instead of height; safe direction is retracted, not extended |
| Vertical lamella blind | Horizontal travel + slat rotation, usually indoor, wind/rain protection typically not applicable |

---

## Quick Start

1. **Add your coverings** — open the covering configuration and click **Scan** to auto-discover connected shutters/blinds/awnings, or add one manually by entering its covering type and the relevant state IDs.
2. **Set a schedule** — configure opening and closing times per plan (or accept the defaults).
3. Save. The adapter immediately opens/closes coverings on schedule; sun, rain, wind and frost protection use sensible default thresholds and can be fine-tuned later.

Advanced settings (calibration, sun/wind/frost protection thresholds, groups, scenes) are optional and can be configured later — the adapter works with sensible defaults right after the initial scan.

---

## Configuration Overview

### Coverings

Each covering is automatically assigned a stable, sequential ID (e.g. `shutter1`, `shutter2`, ...) when added, shown for reference but not editable - it is the ioBroker object ID for that covering's own states (`shutters.<instance>.<id>.*`), so changing it later would orphan those states and break any automation/VIS binding that references them. Coverings still using an older, non-sequential ID (from before this scheme existed) are migrated to it automatically on the next adapter start, including updating any group/scene reference to the old ID; the old covering's state tree is deleted and recreated under the new ID as part of that. It is configured with:

- A display name and an assigned plan, selected from a dropdown of the plans configured on the Plans tab.
- A covering type (roller shutter, external venetian blind, awning, vertical lamella blind).
- The connected system (driver) and the relevant state IDs — filled in automatically by the scan, or entered manually.
- Optional window orientation, used by sun protection.
- Optional calibration curve, if covering height is not proportional to motor runtime.
- Optional protection toggles (wind, frost, night cooling), each enabled/disabled per covering with sensible defaults based on the covering type.

### Plans

Each plan has a schedule mode, selected from a dropdown, which determines which fields are shown:

- **All days the same** — a single open/close pair applies every day, including public holidays.
- **Weekday / weekend / public holiday** — the classic three-field schedule: separate weekday and weekend open/close pairs, plus an optional public holiday override (falling back to the weekend pair if left empty).
- **Individual weekday + public holiday** — a separate open/close pair for each of the seven weekdays, plus an optional public holiday override (falling back to the current weekday's own pair if left empty).

Every open/close field is either a plain "HH:MM" clock time, an offset from sunrise/sunset - or, with a trailing `d`, civil dawn/dusk - written with a leading `+` (after) or `-` (before) sign as plain minutes (e.g. `-30`, `-30d`) or an "HH:MM" duration (e.g. `+01:30`), or that offset combined with a "!HH:MM" cap, e.g. `+30!19:00` (30 minutes after sunset, but never later than 19:00; analogous for opening). An optional calendar (iCal) integration is also planned. Each covering is assigned to a plan via a dropdown on the Coverings tab.

Public holiday detection is not built in. Instead, configure the ID of an existing boolean state (own or foreign, e.g. from a calendar/iCal adapter such as one that computes public holidays) whose current value decides whether "today" counts as a public holiday for every plan above: `true` = public holiday, `false`/empty = not a public holiday. Leave the field empty to disable holiday-specific schedules entirely.

### Sun / Rain / Wind / Frost Protection

Global and per-covering thresholds control when each protection function activates. All protections work with sensible built-in defaults; no configuration is required to get useful behavior out of the box.

### Groups

Group multiple coverings — even from different connected systems — for combined control (e.g. "all shutters downstairs").

### Weather Data

Configure your own weather station states where available. Any weather value that is not configured can optionally be retrieved from a free external weather service instead, without requiring an API key.

---

## Known limitations

- Auto-discovery is best-effort and depends on the connected adapter using standard object roles; unusual third-party device setups may need to be added manually.
- Systems without a position feedback (e.g. simple open/close/stop relays) estimate the current position from runtime rather than a real sensor value.

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
