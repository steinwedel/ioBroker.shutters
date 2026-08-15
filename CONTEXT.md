# Context

## Current Task
- Added a cloud-cover weather metric plus a global opt-in switch that triggers sun protection purely by cloud cover (clear/mostly clear sky), independent of the solar-radiation threshold (plan section 6.3).

## Key Decisions
- New `IWeatherConfig.cloudCoverStateId` + `WeatherSource.getCloudCover()` follow the exact same pattern as `humidityStateId`/`outdoorTempStateId` (optional, undefined disables the feature).
- New global options `sunProtectionCloudCoverTriggerEnabled` (default `false`) and `sunProtectionClearSkyCloudCoverMaxPercent` (default 40) - opt-in, no behavior change unless explicitly enabled.
- Wired as a plain OR with the existing 6.1 radiation/hysteresis result in `automation.ts` (`sunActive = radiationActive || cloudCoverActive`); the cloud-cover path itself has no hysteresis of its own, unlike 6.1/7a.
- Also fixed two stale ❌ statuses in the plan's 5a.1 table (humidity/dew-point) that were already implemented (`humidityStateId` was added in an earlier, undocumented change) - only the plan text was wrong, not the code.

## Next Steps
- None outstanding for this change. Remaining open item from 5a.1/section 11: wind direction for rain protection is still not implemented.

