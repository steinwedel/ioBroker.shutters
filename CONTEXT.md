# Context

## Current Task
- Extended autoscan (`shutter-scanner.ts`) to detect the 9 newly-added driver systems.

## Key Decisions
- HmIP/EnOcean/Velbus/Velux/KLF200/Somfy(tahoma): added to `ADAPTER_TO_DRIVER_TYPE`, reusing the existing `level.blind`-role scan (assumes they follow that convention like Homematic/KNX/Shelly/Zigbee - unverified against real systems, but low-risk since it only extends already-working infrastructure).
- Broadened `findStopSibling()` to also match a lowercase `.stop` suffix (not just `.STOP`/`button.stop`), matching HmIP/Velbus's typical naming.
- Tuya/Loxone/Homey don't use the `level.blind` role, so they get dedicated name-suffix detection passes instead (`scanTuyaCandidates`/`scanLoxoneCandidates`/`scanHomeyCandidates`); Tuya/Loxone are namespace-scoped (`tuya.*`/`loxone.*`) to avoid false positives, Homey is namespace-independent since bridge integrations vary. Tuya's suffix matching tolerates a DP-number prefix (e.g. `1_percent_control`), a real-world Tuya naming detail found while writing the test.
- Generic MQTT is deliberately NOT auto-discovered - the plan itself states its topics have no fixed naming convention, so pattern-matching would be unreliable.
- Also fixed `homey-driver.ts`'s doc comment: Homey's real `windowcoverings_state` capability is a string status enum, not a numeric position readback as previously (incorrectly) documented.

## Next Steps
- None outstanding for this change.
