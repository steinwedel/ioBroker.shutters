/* eslint-disable */
// Logic for the custom (non-JSONConfig) admin settings page of the shutters adapter.
// Contract: index_m.html calls shuttersInitAdmin(settings, onChange) from load(),
// and shuttersGetNativeConfig() from save().

var shuttersConfig = null; // working copy of native config, mutated in place
var shuttersOnChange = null;
// Preview state for the auto-discovery scan (plan section 2b.3): [{ candidate, selected, name }], one
// entry per candidate returned by the last `scanForShutters` call, until the user applies/discards it.
var scanPreviewState = [];
// State ID/listener currently subscribed to for live scan-progress updates (`info.scanProgress`), if
// any - see `subscribeScanProgress()`/`unsubscribeScanProgress()`.
var scanProgressStateId = null;
var scanProgressListener = null;

// Collapse state for the accordion-style cards (coverings/areas/groups/scenes), keyed by list name and
// index. Missing entries default to collapsed (closed), as required: every card can be expanded/collapsed
// and is closed by default. Kept outside shuttersConfig so it never gets persisted to native.
var shuttersCollapsed = { coverings: [], areas: [], groups: [], scenes: [] };

function isCardCollapsed(listName, index) {
    if (shuttersCollapsed[listName][index] === undefined) {
        shuttersCollapsed[listName][index] = true;
    }
    return shuttersCollapsed[listName][index];
}

function setCardCollapsed(listName, index, collapsed) {
    shuttersCollapsed[listName][index] = collapsed;
}

function removeCardCollapsed(listName, index) {
    shuttersCollapsed[listName].splice(index, 1);
}

// Builds a card with a clickable header (toggle) and a collapsible body. `collapsed` is the initial state;
// the body's actual visibility is toggled in the DOM directly so re-renders triggered by other cards don't
// need to touch this card at all.
function buildAccordionCard(titleText, collapsed, onToggle, onRemove) {
    var card = document.createElement('div');
    card.className = 'shutters-card';

    var header = document.createElement('div');
    header.className = 'shutters-card-header';

    var toggleArea = document.createElement('div');
    toggleArea.className = 'shutters-card-header-toggle';
    var icon = document.createElement('span');
    icon.className = 'shutters-toggle-icon';
    icon.innerText = collapsed ? '\u25B6' : '\u25BC';
    var title = document.createElement('h6');
    title.innerText = titleText;
    toggleArea.appendChild(icon);
    toggleArea.appendChild(title);

    var body = document.createElement('div');
    body.className = 'shutters-card-body';
    body.style.display = collapsed ? 'none' : '';

    toggleArea.onclick = function () {
        var nowCollapsed = body.style.display !== 'none';
        body.style.display = nowCollapsed ? 'none' : '';
        icon.innerText = nowCollapsed ? '\u25B6' : '\u25BC';
        onToggle(nowCollapsed);
    };

    var removeBtn = document.createElement('a');
    removeBtn.className = 'btn-flat shutters-remove-btn';
    removeBtn.innerText = _('removeButton');
    removeBtn.href = '#';
    removeBtn.onclick = function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        onRemove();
    };

    header.appendChild(toggleArea);
    header.appendChild(removeBtn);
    card.appendChild(header);
    card.appendChild(body);

    return { card: card, body: body, title: title };
}

var SCHEDULE_MODES = [
    ['uniform', 'scheduleModeUniform'],
    ['weekdayWeekend', 'scheduleModeWeekdayWeekend'],
    ['perWeekday', 'scheduleModePerWeekday'],
];

var WEEKDAYS = [
    ['monday', 'weekdayMonday'],
    ['tuesday', 'weekdayTuesday'],
    ['wednesday', 'weekdayWednesday'],
    ['thursday', 'weekdayThursday'],
    ['friday', 'weekdayFriday'],
    ['saturday', 'weekdaySaturday'],
    ['sunday', 'weekdaySunday'],
];

var COVERING_TYPES = [
    ['rolladen', 'coveringTypeRolladen'],
    ['raffstore', 'coveringTypeRaffstore'],
    ['markise', 'coveringTypeMarkise'],
    ['lamellen', 'coveringTypeLamellen'],
];

var DRIVER_TYPES = [
    ['homematic', 'driverTypeHomematic'],
    ['hmip', 'driverTypeHmip'],
    ['knx', 'driverTypeKnx'],
    ['shelly', 'driverTypeShelly'],
    ['zigbee', 'driverTypeZigbee'],
    ['zigbee2mqtt', 'driverTypeZigbee2Mqtt'],
    ['tuya', 'driverTypeTuya'],
    ['somfy', 'driverTypeSomfy'],
    ['velux', 'driverTypeVelux'],
    ['enocean', 'driverTypeEnocean'],
    ['velbus', 'driverTypeVelbus'],
    ['loxone', 'driverTypeLoxone'],
    ['homey', 'driverTypeHomey'],
    ['mqtt', 'driverTypeMqtt'],
    ['generic-position', 'driverTypeGenericPosition'],
    ['generic-relay', 'driverTypeGenericRelay'],
];

// Which `states.*` keys (matching IShutterConfig.states/driver-factory.ts - "position", "positionActual",
// "stop", "open", "close", "control", "up", "down", NOT prefixed with "state") are relevant per
// driverType, paired with their admin label translation key.
// - generic-relay: separate open/close/stop relays, no position feedback.
// - tuya: percent_control/percent_state position DPs plus an open/close/stop "control" DP; either may
//   be omitted if the device only supports the other.
// - mqtt: a single command topic (shared for position writes and OPEN/CLOSE/STOP) plus an optional
//   separate status topic.
// - loxone: up/down impulses (and stop, which pulses both together - no separate stop field needed),
//   plus optional direct position control for configurations that support it.
// - everything else (homematic, hmip, knx, shelly, zigbee, zigbee2mqtt, somfy, velux, enocean, velbus,
//   homey, generic-position): a position state plus an optional stop state and actual-position feedback.
function getRelevantStateFields(driverType, invertPosition) {
    var supportsPositionInversion = [
        'homematic',
        'hmip',
        'knx',
        'shelly',
        'zigbee',
        'zigbee2mqtt',
        'somfy',
        'velux',
        'enocean',
        'velbus',
        'homey',
    ].indexOf(driverType) !== -1;
    var positionLabel = invertPosition && supportsPositionInversion ? 'statePositionInverted' : 'statePosition';
    var positionActualLabel = invertPosition && supportsPositionInversion ? 'statePositionActualInverted' : 'statePositionActual';
    if (driverType === 'generic-relay') {
        return [
            ['open', 'stateOpen'],
            ['close', 'stateClose'],
            ['stop', 'stateStop'],
        ];
    }
    if (driverType === 'tuya') {
        return [
            ['position', positionLabel],
            ['positionActual', positionActualLabel],
            ['control', 'stateControl'],
        ];
    }
    if (driverType === 'mqtt') {
        return [
            ['position', positionLabel],
            ['positionActual', positionActualLabel],
        ];
    }
    if (driverType === 'loxone') {
        return [
            ['up', 'stateUp'],
            ['down', 'stateDown'],
            ['position', positionLabel],
            ['positionActual', positionActualLabel],
        ];
    }
    return [
        ['position', positionLabel],
        ['positionActual', positionActualLabel],
        ['stop', 'stateStop'],
    ];
}

function _(word) {
    if (typeof translateWord === 'function') {
        return translateWord(word, systemLang, systemDictionary);
    }
    return (systemDictionary[word] && systemDictionary[word][systemLang]) || word;
}

function shuttersEnsureDefaults(settings) {
    settings.shutters = settings.shutters || [];
    settings.areas = settings.areas || [];
    settings.groups = settings.groups || [];
    settings.scenes = settings.scenes || [];
    settings.weather = settings.weather || {};
    settings.holidayStateId = settings.holidayStateId || '';
    settings.icalAdapterInstance = settings.icalAdapterInstance || '';
    settings.icalTitlePrefix = settings.icalTitlePrefix || 'Rolläden';
    settings.pushoverInstance = settings.pushoverInstance || '';
    settings.telegramInstance = settings.telegramInstance || '';
    settings.sunCloseThreshold = settings.sunCloseThreshold != null ? settings.sunCloseThreshold : 200;
    if (settings.sunProtectionGlobalEnabled === undefined) settings.sunProtectionGlobalEnabled = true;
    settings.sunOpenThreshold = settings.sunOpenThreshold != null ? settings.sunOpenThreshold : 150;
    if (settings.sunProtectionCloudCoverTriggerEnabled === undefined) settings.sunProtectionCloudCoverTriggerEnabled = false;
    settings.sunProtectionClearSkyCloudCoverMaxPercent =
        settings.sunProtectionClearSkyCloudCoverMaxPercent != null ? settings.sunProtectionClearSkyCloudCoverMaxPercent : 40;
    settings.windOpenThreshold = settings.windOpenThreshold != null ? settings.windOpenThreshold : 40;
    settings.windCloseAllowedThreshold =
        settings.windCloseAllowedThreshold != null ? settings.windCloseAllowedThreshold : 25;
    settings.frostThreshold = settings.frostThreshold != null ? settings.frostThreshold : 2;

    var usedAreaIds = {};
    settings.areas.forEach(function (area) {
        if (!area.id || usedAreaIds[area.id]) {
            area.id = nextAvailableAreaId(usedAreaIds);
        }
        usedAreaIds[area.id] = true;
    });
    settings.shutters.forEach(function (s) {
        s.states = s.states || {};
        if (s.automationEnabled === undefined) s.automationEnabled = true;
        if (s.doorProtectionEnabled === undefined) s.doorProtectionEnabled = true;
        if (s.orientation === undefined) {
            s.sunProtectionEnabled = false;
            s.rainProtectionEnabled = false;
        }
    });
}

// Builds this adapter instance's ID (e.g. "shutters.0") for sendTo(), using the globals the ioBroker
// admin page provides.
function getInstanceId() {
    return (typeof adapter !== 'undefined' ? adapter : 'shutters') + '.' + (typeof instance !== 'undefined' ? instance : 0);
}

function shuttersInitAdmin(settings, onChange) {
    shuttersConfig = settings;
    shuttersOnChange = onChange;
    shuttersEnsureDefaults(shuttersConfig);

    renderCoverings();
    renderAreas();
    renderWeather();
    renderThresholds();
    renderGroups();
    renderScenes();

    initHolidayStateIdField();
    initIcalFields();

    document.getElementById('shutters-add-covering-btn').onclick = function () {
        shuttersConfig.shutters.push({
            id: nextAvailableCoveringId(),
            name: '',
            driverType: 'generic-position',
            coveringType: 'rolladen',
            automationEnabled: true,
            doorProtectionEnabled: true,
            states: {},
        });
        setCardCollapsed('coverings', shuttersConfig.shutters.length - 1, false);
        renderCoverings();
        onChangeFired();
    };
    document.getElementById('shutters-add-area-btn').onclick = function () {
        shuttersConfig.areas.push({ id: nextAvailableAreaId(), name: '', weekday: {}, weekend: {} });
        setCardCollapsed('areas', shuttersConfig.areas.length - 1, false);
        renderAreas();
        onChangeFired();
    };
    document.getElementById('shutters-add-group-btn').onclick = function () {
        shuttersConfig.groups.push({ id: 'group' + Date.now(), name: '', memberIds: [] });
        setCardCollapsed('groups', shuttersConfig.groups.length - 1, false);
        renderGroups();
        onChangeFired();
    };
    document.getElementById('shutters-add-scene-btn').onclick = function () {
        shuttersConfig.scenes.push({ id: 'scene' + Date.now(), name: '', targets: [] });
        setCardCollapsed('scenes', shuttersConfig.scenes.length - 1, false);
        renderScenes();
        onChangeFired();
    };
    document.getElementById('shutters-scan-btn').onclick = onScanClicked;

    if (typeof M !== 'undefined' && M.Tabs) {
        M.Tabs.init(document.querySelectorAll('.tabs'));
    } else if (typeof $ !== 'undefined' && $.fn.tabs) {
        $('.tabs').tabs();
    }
    if (typeof translateAll === 'function') translateAll();
}

// (Re-)initializes Materialize's custom select widget for the given elements (or every <select> on the
// page if omitted), so it picks up options/selection that were added/changed dynamically after the
// initial page render (e.g. via sendTo). Supports both Materialize 1.x/2.x (M.FormSelect, used by this
// admin) and the older jQuery plugin API, in case a different admin version loads a different build.
function refreshSelects(elements) {
    var targets = elements || document.querySelectorAll('select');
    if (typeof M !== 'undefined' && M.FormSelect) {
        // Materialize caches a FormSelect instance per <select> and does NOT rebuild its custom
        // dropdown list/display on a second init() call if one already exists - it silently no-ops,
        // leaving the previously rendered (now stale) list/selection in place. Since these selects get
        // their options populated dynamically after the initial page render (e.g. via sendTo), any
        // existing instance must be torn down first so the list is rebuilt from the select's current
        // options.
        Array.prototype.forEach.call(targets, function (el) {
            var existing = M.FormSelect.getInstance ? M.FormSelect.getInstance(el) : el.M_FormSelect;
            if (existing) existing.destroy();
        });
        M.FormSelect.init(targets);
    } else if (typeof $ !== 'undefined' && $.fn.material_select) {
        $(targets).material_select();
    }
}

function onChangeFired() {
    if (typeof shuttersOnChange === 'function') shuttersOnChange();
    refreshSelects();
}

// Wires the single "holiday state" text field: it holds the ID of an existing boolean state (own or
// foreign, e.g. from a calendar/iCal adapter) whose current value decides whether "today" counts as a
// public holiday for every plan's schedule. The adapter only reads that state's value; this admin page
// does not compute or look up holidays itself.
function initHolidayStateIdField() {
    var input = document.getElementById('shutters-holiday-state-id');
    input.value = shuttersConfig.holidayStateId || '';
    input.oninput = function () {
        shuttersConfig.holidayStateId = input.value || undefined;
        onChangeFired();
    };

    document.getElementById('shutters-holiday-state-id-browse').onclick = function () {
        openStatePicker(
            input.value,
            function (newId) {
                input.value = newId;
                shuttersConfig.holidayStateId = newId || undefined;
                onChangeFired();
            },
            true,
        );
    };
}

// Wires the two global iCal-integration fields (plan section 5.1): `icalAdapterInstance` (e.g.
// "ical.0") is the `ioBroker.ical` instance whose `data.table` state is polled for day-level
// schedule overrides, and `icalTitlePrefix` is the event-title prefix that identifies a relevant
// event (see `ical.ts`). The actual calendar URL/file is configured on that `ical` instance itself,
// not here. Leaving `icalAdapterInstance` empty disables iCal overrides entirely.
function initIcalFields() {
    var instanceInput = document.getElementById('shutters-ical-adapter-instance');
    instanceInput.value = shuttersConfig.icalAdapterInstance || '';
    instanceInput.oninput = function () {
        shuttersConfig.icalAdapterInstance = instanceInput.value || undefined;
        onChangeFired();
    };

    var prefixInput = document.getElementById('shutters-ical-title-prefix');
    prefixInput.value = shuttersConfig.icalTitlePrefix || '';
    prefixInput.oninput = function () {
        shuttersConfig.icalTitlePrefix = prefixInput.value || undefined;
        onChangeFired();
    };
}

// `common.name` may be a plain string or a localized object like {en: '...', de: '...'} - normalize to a
// single display string, preferring the current admin language, then English, then any other value.
function objectDisplayName(name) {
    if (!name) {
        return '';
    }
    if (typeof name === 'string') {
        return name;
    }
    if (typeof name === 'object') {
        var lang = typeof systemLang !== 'undefined' ? systemLang : 'en';
        if (name[lang]) return name[lang];
        if (name.en) return name.en;
        var firstKey = Object.keys(name)[0];
        return firstKey ? name[firstKey] : '';
    }
    return String(name);
}

// Lazily fetches every known object once (cached afterwards) and keeps only states, for the state-ID
// picker below. `socket` is a global provided by adapter-settings.js (the admin page's own socket.io
// connection).
var stateObjectsCache = null;
function ensureStateObjectsCache(cb) {
    if (stateObjectsCache) {
        cb(stateObjectsCache);
        return;
    }
    socket.emit('getObjects', function (err, objects) {
        stateObjectsCache = [];
        if (!err && objects) {
            Object.keys(objects).forEach(function (id) {
                var obj = objects[id];
                if (obj && obj.type === 'state') {
                    stateObjectsCache.push({
                        id: id,
                        name: objectDisplayName(obj.common && obj.common.name),
                        role: (obj.common && obj.common.role) || '',
                        dataType: (obj.common && obj.common.type) || '',
                    });
                }
            });
            stateObjectsCache.sort(function (a, b) {
                return a.id.localeCompare(b.id);
            });
        }
        fetchStateValues(function () {
            cb(stateObjectsCache);
        });
    });
}

// Fetches the current value of every state once (cached afterwards), so the picker can show a live
// preview (with true/false coloring for booleans, like the classic ioBroker object browser) to help
// confirm the right state was picked.
var stateValuesCache = null;
function fetchStateValues(cb) {
    if (stateValuesCache) {
        cb();
        return;
    }
    socket.emit('getStates', function (err, states) {
        stateValuesCache = states || {};
        cb();
    });
}

// ---- Location (needed for the sun-protection tolerance clock-time preview below) ----

// Mirrors `resolveLocation()` in main.ts: prefers `native.latitude`/`native.longitude` if set, otherwise
// falls back to the global ioBroker location in `system.config`. Cached after the first (async) lookup;
// `shuttersLocationLoaded` distinguishes "not asked yet" from "asked, but no location is available".
var shuttersLocationCache = null;
var shuttersLocationLoaded = false;
function ensureShuttersLocation(cb) {
    if (shuttersConfig.latitude !== undefined && shuttersConfig.longitude !== undefined) {
        cb({ latitude: shuttersConfig.latitude, longitude: shuttersConfig.longitude });
        return;
    }
    if (shuttersLocationLoaded) {
        cb(shuttersLocationCache);
        return;
    }
    socket.emit('getObject', 'system.config', function (err, obj) {
        shuttersLocationLoaded = true;
        var common = (obj && obj.common) || {};
        shuttersLocationCache =
            !err && common.latitude !== undefined && common.longitude !== undefined
                ? { latitude: common.latitude, longitude: common.longitude }
                : null;
        cb(shuttersLocationCache);
    });
}

// ---- Sun azimuth (needed for the sun-protection tolerance clock-time preview below) ----
// Minimal azimuth-only port of the position calculation in SunCalc (https://github.com/mourner/suncalc,
// (c) Vladimir Agafonkin, MIT licensed) - the same library `twilight.ts` uses on the backend. Kept as a
// small, self-contained copy here since this admin settings page is plain, dependency-free browser JS
// with no build/bundling step (see index_m.html). Ignores SunCalc's own sub-minute deltaT correction,
// which is irrelevant at the "which clock time roughly" precision this preview needs.
var SHUTTERS_RAD = Math.PI / 180;
var SHUTTERS_DAY_MS = 1000 * 60 * 60 * 24;
var SHUTTERS_J1970 = 2440588;
var SHUTTERS_J2000 = 2451545;

function shuttersToDays(date) {
    return date.valueOf() / SHUTTERS_DAY_MS - 0.5 + SHUTTERS_J1970 - SHUTTERS_J2000;
}

function shuttersSunCoords(d) {
    var t = d / 36525;
    var L0 = SHUTTERS_RAD * (280.46646 + t * (36000.76983 + t * 0.0003032));
    var M = SHUTTERS_RAD * (357.52911 + t * (35999.05029 - t * 0.0001537));
    var sinM = Math.sin(M);
    var cosM = Math.cos(M);
    var C =
        SHUTTERS_RAD *
        ((1.914602 - t * (0.004817 + t * 0.000014)) * sinM +
            (0.019993 - 0.000101 * t) * 2 * sinM * cosM +
            0.000289 * sinM * (3 - 4 * sinM * sinM));
    var Om = SHUTTERS_RAD * (125.04 - 1934.136 * t);
    var L = L0 + C - SHUTTERS_RAD * (0.00569 + 0.00478 * Math.sin(Om));
    var e =
        SHUTTERS_RAD * (23.439291 - t * (0.0130042 + t * (0.00000016 - t * 0.000000504))) +
        SHUTTERS_RAD * 0.00256 * Math.cos(Om);
    return {
        ra: Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)),
        dec: Math.asin(Math.sin(e) * Math.sin(L)),
    };
}

function shuttersSiderealTime(d, lw) {
    return SHUTTERS_RAD * (280.46061837 + 360.98564736629 * d) - lw;
}

// Sun azimuth in compass degrees (0=N/90=E/180=S/270=W, clockwise from North), matching
// `SunCalc.getPosition().azimuth` / `getSunPosition()` in twilight.ts.
function shuttersSunAzimuthDeg(date, latitude, longitude) {
    var lw = SHUTTERS_RAD * -longitude;
    var phi = SHUTTERS_RAD * latitude;
    var d = shuttersToDays(date);
    var c = shuttersSunCoords(d);
    var H = shuttersSiderealTime(d, lw) - c.ra;
    return (Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(c.dec) * Math.cos(phi)) / SHUTTERS_RAD + 540) % 360;
}

// If `target` (compass degrees) lies between the azimuths at `prevTime`/`curTime`, linearly interpolates
// the crossing time between them; otherwise returns undefined. Skips crossings that would require
// wrapping past 0°/360° (the azimuth's own discontinuity, only relevant right around midnight) - the
// sun's azimuth does not actually wrap during the day at the latitudes this adapter targets.
function shuttersInterpolateCrossing(prevTime, prevAz, curTime, curAz, target) {
    if (curAz === prevAz) {
        return undefined;
    }
    var lo = Math.min(prevAz, curAz);
    var hi = Math.max(prevAz, curAz);
    if (hi - lo > 180 || target < lo || target > hi) {
        return undefined;
    }
    var fraction = (target - prevAz) / (curAz - prevAz);
    return new Date(prevTime.getTime() + fraction * (curTime.getTime() - prevTime.getTime()));
}

// Finds the local time on `date` at which the sun's azimuth first reaches `targetAzimuthDeg`, by
// sampling every two minutes from local midnight and interpolating across the sample where the azimuth
// crosses the target (see `shuttersInterpolateCrossing`). Returns undefined if the sun's azimuth never
// reaches that value on that day (e.g. a tolerance bound facing away from where the sun ever gets to).
function shuttersFindAzimuthTime(date, latitude, longitude, targetAzimuthDeg) {
    var target = ((targetAzimuthDeg % 360) + 360) % 360;
    var dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    var stepMinutes = 2;
    var stepsPerDay = Math.floor((24 * 60) / stepMinutes);
    var prevTime = dayStart;
    var prevAz = shuttersSunAzimuthDeg(prevTime, latitude, longitude);
    for (var i = 1; i <= stepsPerDay; i++) {
        var curTime = new Date(dayStart.getTime() + i * stepMinutes * 60000);
        var curAz = shuttersSunAzimuthDeg(curTime, latitude, longitude);
        var crossing = shuttersInterpolateCrossing(prevTime, prevAz, curTime, curAz, target);
        if (crossing) {
            return crossing;
        }
        prevTime = curTime;
        prevAz = curAz;
    }
    return undefined;
}

function shuttersFormatTime(date) {
    if (!date) {
        return undefined;
    }
    var hh = ('0' + date.getHours()).slice(-2);
    var mm = ('0' + date.getMinutes()).slice(-2);
    return hh + ':' + mm;
}

// DOM element per covering index showing the tolerance clock-time hint, rebuilt on every
// renderCoverings() call; used so a later tolerance/orientation field edit can update the hint text in
// place without a full re-render.
var shuttersToleranceHintElements = {};

// Caches the last computed hint text per covering index, keyed by every input that affects it
// (orientation/bounds/location). Deliberately NOT cleared on re-render (unlike
// shuttersToleranceHintElements above): a full renderCoverings() re-render calls
// updateOrientationToleranceHint() again for every covering with sun protection + orientation set, and
// without this cache that would redo the ~1440-sample azimuth search for every one of them even though
// nothing relevant actually changed. A mismatched key (e.g. after coverings were reordered/removed)
// simply misses the cache and recomputes correctly.
var shuttersToleranceHintCache = {};

// Debounce timers for the tolerance-bound fields' oninput handlers (keyed by covering index), so typing
// in `orientationToleranceMinusDeg`/`orientationTolerancePlusDeg` doesn't re-run the azimuth search on
// every single keystroke.
var shuttersToleranceHintTimers = {};
function scheduleOrientationToleranceHintUpdate(index) {
    if (shuttersToleranceHintTimers[index]) {
        clearTimeout(shuttersToleranceHintTimers[index]);
    }
    shuttersToleranceHintTimers[index] = setTimeout(function () {
        delete shuttersToleranceHintTimers[index];
        updateOrientationToleranceHint(index);
    }, 300);
}

// Updates the "corresponds to about HH:MM and HH:MM" hint below a covering's sun-protection tolerance
// fields (see renderCoverings()), based on its current orientation/tolerance values and the resolved
// location. Runs asynchronously (location lookup); bails out if the element is no longer the current one
// for this index (covering removed/re-rendered in the meantime).
function updateOrientationToleranceHint(index) {
    var el = shuttersToleranceHintElements[index];
    if (!el) {
        return;
    }
    var covering = shuttersConfig.shutters[index];
    if (!covering || covering.orientation === undefined) {
        el.innerText = '';
        delete shuttersToleranceHintCache[index];
        return;
    }
    var minus = covering.orientationToleranceMinusDeg === undefined ? -60 : covering.orientationToleranceMinusDeg;
    var plus = covering.orientationTolerancePlusDeg === undefined ? 60 : covering.orientationTolerancePlusDeg;
    ensureShuttersLocation(function (location) {
        if (shuttersToleranceHintElements[index] !== el) {
            return; // Re-rendered/removed in the meantime.
        }
        var cacheKey =
            covering.orientation + '|' + minus + '|' + plus + '|' + (location ? location.latitude + ',' + location.longitude : 'none');
        var cached = shuttersToleranceHintCache[index];
        if (cached && cached.key === cacheKey) {
            el.innerText = cached.text;
            return;
        }
        var text;
        if (!location) {
            text = _('orientationToleranceNoLocationHint');
        } else {
            var now = new Date();
            var startTime = shuttersFindAzimuthTime(now, location.latitude, location.longitude, covering.orientation + minus);
            var endTime = shuttersFindAzimuthTime(now, location.latitude, location.longitude, covering.orientation + plus);
            text =
                !startTime && !endTime
                    ? _('orientationToleranceNoTimeHint')
                    : _('orientationToleranceTimeHintLabel') +
                      ' ' +
                      (shuttersFormatTime(startTime) || '?') +
                      ' \u2013 ' +
                      (shuttersFormatTime(endTime) || '?');
        }
        shuttersToleranceHintCache[index] = { key: cacheKey, text: text };
        el.innerText = text;
    });
}

// Builds a nested tree from the flat, dot-separated state ID list, e.g. "shutters.0.info.connection"
// becomes root -> shutters -> 0 -> info -> connection (a leaf holding the full entry). Folders (non-leaf
// nodes) are plain grouping nodes with no entry of their own.
function buildStateTree(entries) {
    var root = { id: '', children: {}, isLeaf: false };
    entries.forEach(function (entry) {
        var parts = entry.id.split('.');
        var node = root;
        var prefix = '';
        for (var i = 0; i < parts.length; i++) {
            prefix = prefix ? prefix + '.' + parts[i] : parts[i];
            if (!node.children[parts[i]]) {
                node.children[parts[i]] = { id: prefix, name: parts[i], children: {}, isLeaf: false };
            }
            node = node.children[parts[i]];
        }
        node.isLeaf = true;
        node.entry = entry;
    });
    return root;
}

// A hierarchical, self-contained state-ID picker overlay (folder tree + search), similar in spirit to
// ioBroker Admin's own object browser but built entirely from plain DOM/CSS already used on this page -
// no jQuery UI/fancytree/selectID.js dependency (that legacy widget's modal positioning turned out to
// conflict with Materialize in this admin build and could never actually be clicked into).
var MAX_PICKER_RESULTS = 200;
var stateTreeCache = null;
var pickerOnlyBoolean = true;

function formatStateValue(id) {
    var state = stateValuesCache && stateValuesCache[id];
    if (!state || state.val === null || state.val === undefined) {
        return null;
    }
    return { text: String(state.val), isTrue: state.val === true, isFalse: state.val === false };
}

function matchesTypeFilter(entry) {
    return !pickerOnlyBoolean || entry.dataType === 'boolean';
}

function appendValueSpan(row, entry) {
    var value = formatStateValue(entry.id);
    if (!value) {
        return;
    }
    var valueSpan = document.createElement('span');
    valueSpan.className = 'shutters-picker-value' + (value.isTrue ? ' is-true' : value.isFalse ? ' is-false' : '');
    valueSpan.innerText = value.text;
    row.appendChild(valueSpan);
}

// Renders one leaf (selectable state) row.
function renderLeafRow(node, depth, onSelect) {
    var row = document.createElement('div');
    row.className = 'shutters-picker-row shutters-picker-leaf';
    row.style.paddingLeft = 16 + depth * 18 + 'px';

    var idSpan = document.createElement('span');
    idSpan.className = 'shutters-picker-id';
    idSpan.innerText = node.name;
    row.appendChild(idSpan);

    if (node.entry.role) {
        var roleSpan = document.createElement('span');
        roleSpan.className = 'shutters-picker-role';
        roleSpan.innerText = node.entry.role;
        row.appendChild(roleSpan);
    }
    if (node.entry.name) {
        var nameSpan = document.createElement('span');
        nameSpan.className = 'shutters-picker-name';
        nameSpan.innerText = node.entry.name;
        row.appendChild(nameSpan);
    }
    appendValueSpan(row, node.entry);

    row.onclick = function () {
        closeStatePicker();
        onSelect(node.entry.id);
    };
    return row;
}

// Renders one folder row plus its (lazily created) children container, initially collapsed.
function renderFolderRow(node, depth, onSelect, container) {
    var row = document.createElement('div');
    row.className = 'shutters-picker-row shutters-picker-folder';
    row.style.paddingLeft = 16 + depth * 18 + 'px';

    var icon = document.createElement('span');
    icon.className = 'shutters-toggle-icon';
    icon.innerText = '\u25B6';
    row.appendChild(icon);

    var idSpan = document.createElement('span');
    idSpan.className = 'shutters-picker-id';
    idSpan.innerText = node.name;
    row.appendChild(idSpan);

    var childrenContainer = document.createElement('div');
    childrenContainer.style.display = 'none';

    var expanded = false;
    row.onclick = function () {
        expanded = !expanded;
        icon.innerText = expanded ? '\u25BC' : '\u25B6';
        childrenContainer.style.display = expanded ? '' : 'none';
        if (expanded && !childrenContainer.dataset.built) {
            childrenContainer.dataset.built = 'true';
            renderTreeNodes(node, depth + 1, onSelect, childrenContainer);
        }
    };

    container.appendChild(row);
    container.appendChild(childrenContainer);
}

// Renders the direct children of `node` (folders before leaves, alphabetically), skipping folders/leaves
// that have no descendants matching the current type filter.
function renderTreeNodes(node, depth, onSelect, container) {
    var childKeys = Object.keys(node.children).sort(function (a, b) {
        return a.localeCompare(b);
    });

    childKeys.forEach(function (key) {
        var child = node.children[key];
        if (!subtreeHasMatch(child)) {
            return;
        }
        if (child.isLeaf && Object.keys(child.children).length === 0) {
            container.appendChild(renderLeafRow(child, depth, onSelect));
        } else {
            renderFolderRow(child, depth, onSelect, container);
        }
    });
}

// Whether `node` itself (if a leaf) or any of its descendants match the current type filter - used to
// hide folders that would otherwise expand into an empty list.
function subtreeHasMatch(node) {
    if (node.isLeaf && Object.keys(node.children).length === 0) {
        return matchesTypeFilter(node.entry);
    }
    return Object.keys(node.children).some(function (key) {
        return subtreeHasMatch(node.children[key]);
    });
}

// Renders a flat, filtered list for the search box (used once the user has typed at least 2 characters),
// instead of the tree view.
function renderFilteredList(query, onSelect) {
    var list = document.getElementById('shutters-picker-list');
    list.innerHTML = '';

    var trimmed = query.trim().toLowerCase();
    var matches = stateObjectsCache.filter(function (entry) {
        if (!matchesTypeFilter(entry)) {
            return false;
        }
        return entry.id.toLowerCase().indexOf(trimmed) !== -1 || entry.name.toLowerCase().indexOf(trimmed) !== -1;
    });

    if (matches.length === 0) {
        var hint = document.createElement('div');
        hint.className = 'shutters-picker-hint';
        hint.innerText = _('pickerNoResultsText');
        list.appendChild(hint);
        return;
    }

    matches.slice(0, MAX_PICKER_RESULTS).forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'shutters-picker-row shutters-picker-leaf';
        var idSpan = document.createElement('span');
        idSpan.className = 'shutters-picker-id';
        idSpan.innerText = entry.id;
        row.appendChild(idSpan);
        if (entry.role) {
            var roleSpan = document.createElement('span');
            roleSpan.className = 'shutters-picker-role';
            roleSpan.innerText = entry.role;
            row.appendChild(roleSpan);
        }
        if (entry.name) {
            var nameSpan = document.createElement('span');
            nameSpan.className = 'shutters-picker-name';
            nameSpan.innerText = entry.name;
            row.appendChild(nameSpan);
        }
        appendValueSpan(row, entry);
        row.onclick = function () {
            closeStatePicker();
            onSelect(entry.id);
        };
        list.appendChild(row);
    });
    if (matches.length > MAX_PICKER_RESULTS) {
        var more = document.createElement('div');
        more.className = 'shutters-picker-hint';
        more.innerText = _('pickerMoreResultsText').replace('%d', matches.length - MAX_PICKER_RESULTS);
        list.appendChild(more);
    }
}

// Renders either the root of the tree (empty search) or a flat filtered list (search text entered).
function renderPicker(query, onSelect) {
    var trimmed = query.trim();
    if (trimmed.length >= 2) {
        renderFilteredList(trimmed, onSelect);
        return;
    }

    // 0 or 1 characters: browse the folder tree instead of requiring a search.
    var list = document.getElementById('shutters-picker-list');
    list.innerHTML = '';

    if (!stateTreeCache) {
        stateTreeCache = buildStateTree(stateObjectsCache);
    }
    renderTreeNodes(stateTreeCache, 0, onSelect, list);
}

function closeStatePicker() {
    document.getElementById('shutters-picker-overlay').classList.remove('open');
}

// Opens the picker overlay (tree view by default, or a flat filtered list once `currentValue`/typed text
// is at least 2 characters), calling `onSelect(newId)` if the user clicks a result. Cancel/clicking
// outside the box closes it without calling `onSelect`.
// Opens the picker overlay (tree view by default, or a flat filtered list once `currentValue`/typed text
// is at least 2 characters), calling `onSelect(newId)` if the user clicks a result. Cancel/clicking
// outside the box closes it without calling `onSelect`. `defaultBooleanOnly`, if given, sets the
// "Boolean states only" checkbox for this field (e.g. true for a strictly boolean field like the public
// holiday indicator, false for covering state fields that are just as often numeric).
function openStatePicker(currentValue, onSelect, defaultBooleanOnly) {
    if (defaultBooleanOnly !== undefined) {
        pickerOnlyBoolean = defaultBooleanOnly;
    }
    ensureStateObjectsCache(function () {
        var overlay = document.getElementById('shutters-picker-overlay');
        var searchInput = document.getElementById('shutters-picker-search-input');
        var typeFilterCheckbox = document.getElementById('shutters-picker-boolean-only');
        searchInput.value = currentValue || '';
        searchInput.placeholder = _('pickerHintText');
        typeFilterCheckbox.checked = pickerOnlyBoolean;

        renderPicker(searchInput.value, onSelect);

        searchInput.oninput = function () {
            renderPicker(searchInput.value, onSelect);
        };
        typeFilterCheckbox.onchange = function () {
            pickerOnlyBoolean = typeFilterCheckbox.checked;
            renderPicker(searchInput.value, onSelect);
        };

        document.getElementById('shutters-picker-cancel').onclick = closeStatePicker;
        overlay.onclick = function (ev) {
            if (ev.target === overlay) {
                closeStatePicker();
            }
        };

        overlay.classList.add('open');
        searchInput.focus();
    });
}

function makeSelect(id, label, value, options, onChangeCb) {
    var wrap = document.createElement('div');
    wrap.className = 'input-field col s3';
    var select = document.createElement('select');
    select.id = id;
    options.forEach(function (entry) {
        var opt = document.createElement('option');
        opt.value = entry[0];
        opt.text = _(entry[1]);
        if (entry[0] === value) opt.selected = true;
        select.appendChild(opt);
    });
    select.onchange = function () {
        onChangeCb(select.value);
    };
    var labelEl = document.createElement('label');
    labelEl.setAttribute('for', id);
    labelEl.className = 'active';
    labelEl.innerText = _(label);
    wrap.appendChild(select);
    wrap.appendChild(labelEl);
    return wrap;
}

// Like makeSelect, but the option values themselves are the display text (raw user data, e.g. plan
// names) instead of translation keys. Always includes an empty "none" option, and keeps the current
// value selectable even if it is no longer part of `optionValues` (e.g. a renamed/removed plan), so no
// data is silently lost.
function makeSelectPlain(id, label, value, optionValues, colWidth, onChangeCb) {
    var wrap = document.createElement('div');
    wrap.className = 'input-field col s' + (colWidth || 3);
    var select = document.createElement('select');
    select.id = id;

    var values = optionValues.slice();
    if (value && !values.some(function (option) { return option.value === value; })) {
        values.push({ value: value, text: value });
    }

    var emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.text = '-';
    if (!value) emptyOpt.selected = true;
    select.appendChild(emptyOpt);

    values.forEach(function (option) {
        var opt = document.createElement('option');
        opt.value = option.value;
        opt.text = option.text;
        if (option.value === value) opt.selected = true;
        select.appendChild(opt);
    });
    select.onchange = function () {
        onChangeCb(select.value === '' ? undefined : select.value);
    };
    var labelEl = document.createElement('label');
    labelEl.setAttribute('for', id);
    labelEl.className = 'active';
    labelEl.innerText = _(label);
    wrap.appendChild(select);
    wrap.appendChild(labelEl);
    return wrap;
}

// Builds one labeled open/close schedule row (label column + Open field + Close field), used
// consistently for every row across all three schedule modes (uniform/weekday/weekend/per-weekday/
// public holiday), so they all look the same.
function buildScheduleRow(labelText, idPrefix, daySchedule, onOpenChange, onCloseChange) {
    var row = document.createElement('div');
    row.className = 'shutters-row row';

    var labelDiv = document.createElement('div');
    labelDiv.className = 'col s2 shutters-weekday-label';
    labelDiv.innerText = labelText;
    row.appendChild(labelDiv);

    row.appendChild(makeText(idPrefix + '-open', 'weekdayOverrideOpen', daySchedule.open, 5, onOpenChange));
    row.appendChild(makeText(idPrefix + '-close', 'weekdayOverrideClose', daySchedule.close, 5, onCloseChange));
    return row;
}

// Generates the next unused sequential covering ID ("shutter1", "shutter2", ...), mirroring
// nextAvailableCoveringId() in src/lib/id-generator.ts (used server-side for scanner-discovered
// coverings). Covering IDs are the ioBroker object ID namespace segment for all of that covering's own
// states, so they must stay stable once assigned - which is also why the ID field is shown but not
// editable, see renderCoveringCard().
function nextAvailableCoveringId() {
    var used = {};
    shuttersConfig.shutters.forEach(function (s) {
        if (s.id) used[s.id] = true;
    });
    return nextAvailableAreaId(used, 'shutter');
}

function nextAvailableAreaId(used, prefix) {
    var areaIds = used || {};
    if (!used) {
        shuttersConfig.areas.forEach(function (area) {
            if (area.id) areaIds[area.id] = true;
        });
    }
    var idPrefix = prefix || 'area';
    var n = 1;
    while (areaIds[idPrefix + n]) {
        n++;
    }
    return idPrefix + n;
}

function getPlanOptions() {
    return shuttersConfig.areas
        .filter(function (area) {
            return !!area.id && !!area.name;
        })
        .map(function (area) {
            return { value: area.id, text: area.name };
        });
}

function getCoveringOptions() {
    var ids = {};
    return shuttersConfig.shutters
        .filter(function (covering) {
            if (!covering.id || ids[covering.id]) return false;
            ids[covering.id] = true;
            return true;
        })
        .map(function (covering) {
            return { value: covering.id, text: (covering.name || covering.id) + ' (' + covering.id + ')' };
        });
}

function clampSceneTargetPercent(value) {
    var number = Number(value);
    if (!isFinite(number)) return 0;
    return Math.max(0, Math.min(100, number));
}

function makeText(id, label, value, colWidth, onChangeCb, type) {
    var wrap = document.createElement('div');
    wrap.className = 'input-field col s' + (colWidth || 3);
    var input = document.createElement('input');
    input.id = id;
    input.type = type || 'text';
    input.value = value === undefined || value === null ? '' : value;
    input.oninput = function () {
        if (type === 'number') {
            onChangeCb(input.value.trim() === '' ? undefined : Number(input.value));
        } else {
            onChangeCb(input.value);
        }
    };
    var labelEl = document.createElement('label');
    labelEl.setAttribute('for', id);
    labelEl.className = 'active';
    labelEl.innerText = _(label);
    wrap.appendChild(input);
    wrap.appendChild(labelEl);
    return wrap;
}

// Like makeText, but for a field that holds a state ID: adds a small "..." browse button next to the
// text field that opens the same tree/search state picker used for the holiday state field, so the
// object tree browser is available everywhere a state ID can be entered, not just typed by hand.
function makeStateIdField(id, label, value, colWidth, onChangeCb) {
    var outer = document.createElement('div');
    outer.className = 'col s' + (colWidth || 4);
    outer.style.display = 'flex';
    outer.style.alignItems = 'flex-end';
    outer.style.gap = '4px';

    var textWrap = makeText(id, label, value, 12, onChangeCb);
    textWrap.className = 'input-field';
    textWrap.style.flex = '1';
    textWrap.style.margin = '0';

    var input = textWrap.querySelector('input');

    var browseBtn = document.createElement('button');
    browseBtn.type = 'button';
    browseBtn.className = 'btn-flat shutters-state-browse-btn';
    browseBtn.title = _('browseButton');
    browseBtn.innerText = '...';
    browseBtn.onclick = function () {
        openStatePicker(
            input.value,
            function (newId) {
                input.value = newId;
                onChangeCb(newId);
            },
            false,
        );
    };

    outer.appendChild(textWrap);
    outer.appendChild(browseBtn);
    return outer;
}

function makeCheckbox(id, label, checked, onChangeCb, disabled) {
    var wrap = document.createElement('div');
    wrap.className = 'col s3';
    wrap.style.marginTop = '18px';
    var p = document.createElement('p');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;
    input.disabled = !!disabled;
    input.onchange = function () {
        onChangeCb(input.checked);
    };
    var labelEl = document.createElement('label');
    var labelText = document.createElement('span');
    labelText.innerText = _(label);
    labelEl.appendChild(input);
    labelEl.appendChild(labelText);
    p.appendChild(labelEl);
    wrap.appendChild(p);
    return wrap;
}

// ---- Coverings ----

function renderCoverings() {
    var container = document.getElementById('shutters-coverings-container');
    container.innerHTML = '';
    // Rebuilt below for every card that still shows a tolerance hint; stale entries from cards removed
    // or no longer showing the hint (e.g. orientation cleared) must not linger.
    shuttersToleranceHintElements = {};

    // Render the cards alphabetically (by name, falling back to id), while every callback/collapse-state
    // lookup still uses the covering's actual index in shuttersConfig.shutters, so editing/removing keeps
    // working correctly regardless of display order.
    var order = shuttersConfig.shutters.map(function (covering, index) {
        return index;
    });
    order.sort(function (indexA, indexB) {
        var nameA = (shuttersConfig.shutters[indexA].name || shuttersConfig.shutters[indexA].id || '').toLowerCase();
        var nameB = (shuttersConfig.shutters[indexB].name || shuttersConfig.shutters[indexB].id || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });

    order.forEach(function (index) {
        container.appendChild(renderCoveringCard(shuttersConfig.shutters[index], index));
    });
    if (typeof translateAll === 'function') translateAll();
    refreshSelects();
}

function renderCoveringCard(covering, index) {
    var built = buildAccordionCard(
        covering.name || covering.id || '(' + _('name') + ')',
        isCardCollapsed('coverings', index),
        function (collapsed) {
            setCardCollapsed('coverings', index, collapsed);
        },
        function () {
            shuttersConfig.shutters.splice(index, 1);
            removeCardCollapsed('coverings', index);
            renderCoverings();
            onChangeFired();
        },
    );
    var card = built.body;
    var title = built.title;

    var row1 = document.createElement('div');
    row1.className = 'shutters-row row';
    var idField = makeText('cov-' + index + '-id', 'id', covering.id, 3, function () {
        // Intentionally a no-op: the ID must not change after creation, see nextAvailableCoveringId()
        // doc comment. The field stays visible (for reference/debugging) but disabled below, so this
        // callback never actually fires from user input.
    });
    idField.querySelector('input').disabled = true;
    idField.style.marginLeft = '0';
    row1.appendChild(idField);
    card.appendChild(row1);

    var row2 = document.createElement('div');
    row2.className = 'shutters-row row shutters-covering-primary-row';
    row2.appendChild(
        makeText('cov-' + index + '-name', 'coveringName', covering.name, 3, function (v) {
            covering.name = v;
            title.innerText = v || covering.id;
            onChangeFired();
        }),
    );
    row2.appendChild(
        makeSelect('cov-' + index + '-coveringType', 'coveringType', covering.coveringType, COVERING_TYPES, function (v) {
            covering.coveringType = v;
            renderCoverings();
            onChangeFired();
        }),
    );
    row2.appendChild(
        makeText(
            'cov-' + index + '-orientation',
            'orientation',
            covering.orientation,
            3,
            function (v) {
                covering.orientation = v;
                if (v === undefined) {
                    covering.sunProtectionEnabled = false;
                    covering.rainProtectionEnabled = false;
                }
                renderCoverings();
                onChangeFired();
            },
            'number',
        ),
    );
    card.appendChild(row2);

    var statesTitle = document.createElement('div');
    statesTitle.className = 'shutters-section-title shutters-states-section-title';
    statesTitle.innerText = _('statesSectionTitle');
    card.appendChild(statesTitle);

    var relevantStateFields = getRelevantStateFields(covering.driverType, covering.invertPosition);
    var systemRow = document.createElement('div');
    systemRow.className = 'shutters-row row shutters-system-row';
    var systemTitle = document.createElement('div');
    systemTitle.className = 'shutters-system-title';
    systemTitle.innerText = _('driverType');
    systemRow.appendChild(systemTitle);
    var systemField = makeSelect('cov-' + index + '-driverType', 'driverType', covering.driverType, DRIVER_TYPES, function (v) {
        covering.driverType = v;
        renderCoverings();
        onChangeFired();
    });
    systemField.className += ' shutters-system-selector';
    systemRow.appendChild(systemField);
    var stopStateField = relevantStateFields.filter(function (field) { return field[0] === 'stop'; })[0];
    if (stopStateField) {
        systemRow.appendChild(
            makeStateIdField('cov-' + index + '-state-stop', stopStateField[1], covering.states.stop, 4, function (v) {
                covering.states.stop = v;
                onChangeFired();
            }),
        );
    }
    card.appendChild(systemRow);

    var statesRow = document.createElement('div');
    statesRow.className = 'shutters-row row shutters-position-state-row';
    var positionMappingField = makeCheckbox(
        'cov-' + index + '-invertPosition',
        'invertPosition',
        covering.invertPosition,
        function (v) {
            covering.invertPosition = v;
            renderCoverings();
            onChangeFired();
        },
    );
    var positionMappingInserted = false;
    relevantStateFields.forEach(function (field) {
        var dataKey = field[0];
        if (dataKey === 'stop') {
            return;
        }
        var labelKey = field[1];
        statesRow.appendChild(
            makeStateIdField('cov-' + index + '-state-' + dataKey, labelKey, covering.states[dataKey], 4, function (v) {
                covering.states[dataKey] = v;
                onChangeFired();
            }),
        );
        if (dataKey === 'positionActual') {
            statesRow.appendChild(positionMappingField);
            positionMappingInserted = true;
        }
    });
    if (!positionMappingInserted) {
        statesRow.appendChild(positionMappingField);
    }
    // Slat tilt (plan section 2a.5): only relevant for raffstore/lamellen, and entirely optional even
    // then (many raffstore/lamellen installations have no separate tilt control at all).
    if (covering.coveringType === 'raffstore' || covering.coveringType === 'lamellen') {
        statesRow.appendChild(
            makeStateIdField('cov-' + index + '-state-tilt', 'stateTilt', covering.states.tilt, 4, function (v) {
                covering.states.tilt = v;
                renderCoverings(); // re-render: tiltActual is only relevant once a tilt state is configured
                onChangeFired();
            }),
        );
        if (covering.states.tilt) {
            statesRow.appendChild(
                makeStateIdField(
                    'cov-' + index + '-state-tiltActual',
                    'stateTiltActual',
                    covering.states.tiltActual,
                    4,
                    function (v) {
                        covering.states.tiltActual = v;
                        onChangeFired();
                    },
                ),
            );
        }
    }
    card.appendChild(statesRow);

    if (covering.driverType === 'generic-relay') {
        var relayRuntimeRow = document.createElement('div');
        relayRuntimeRow.className = 'shutters-row row';
        relayRuntimeRow.appendChild(
            makeText('cov-' + index + '-relayOpenRuntimeSecs', 'relayOpenRuntimeSecs', covering.relayOpenRuntimeSecs, 3, function (v) {
                covering.relayOpenRuntimeSecs = v;
                onChangeFired();
            }, 'number'),
        );
        relayRuntimeRow.appendChild(
            makeText('cov-' + index + '-relayCloseRuntimeSecs', 'relayCloseRuntimeSecs', covering.relayCloseRuntimeSecs, 3, function (v) {
                covering.relayCloseRuntimeSecs = v;
                onChangeFired();
            }, 'number'),
        );
        card.appendChild(relayRuntimeRow);
    }

    var protectionTitle = document.createElement('div');
    protectionTitle.className = 'shutters-section-title';
    protectionTitle.innerText = _('protectionSectionTitle');
    card.appendChild(protectionTitle);

    var sunHint = document.createElement('p');
    sunHint.className = 'shutters-hint translate';
    sunHint.innerText = _('sunProtectionHintText');
    card.appendChild(sunHint);

    var protectionRow1 = document.createElement('div');
    protectionRow1.className = 'shutters-row row shutters-automation-functions';
    var scheduleRow = document.createElement('div');
    scheduleRow.className = 'shutters-automation-schedule';
    scheduleRow.appendChild(
        makeCheckbox('cov-' + index + '-automationEnabled', 'automationEnabled', covering.automationEnabled, function (v) {
            covering.automationEnabled = v;
            onChangeFired();
        }),
    );
    var schedulePlanTitle = document.createElement('div');
    schedulePlanTitle.className = 'shutters-schedule-plan-title';
    schedulePlanTitle.innerText = _('schedulePlan');
    scheduleRow.appendChild(schedulePlanTitle);
    var schedulePlanField = makeSelectPlain('cov-' + index + '-area', 'area', covering.areaId, getPlanOptions(), 3, function (v) {
        covering.areaId = v;
        onChangeFired();
    });
    schedulePlanField.className += ' shutters-schedule-plan-field';
    scheduleRow.appendChild(schedulePlanField);
    protectionRow1.appendChild(scheduleRow);
    var orientationConfigured = typeof covering.orientation === 'number' && isFinite(covering.orientation);
    var sunProtectionGroup = document.createElement('div');
    sunProtectionGroup.className = 'shutters-sun-protection-group';
    sunProtectionGroup.appendChild(
        makeCheckbox('cov-' + index + '-sunProtectionEnabled', 'sunProtectionEnabled', covering.sunProtectionEnabled, function (v) {
            covering.sunProtectionEnabled = v;
            renderCoverings(); // re-render: sun window fields only relevant when enabled
            onChangeFired();
        }, !orientationConfigured),
    );
    protectionRow1.appendChild(sunProtectionGroup);
    protectionRow1.appendChild(
        makeCheckbox('cov-' + index + '-rainProtectionEnabled', 'rainProtectionEnabled', covering.rainProtectionEnabled, function (v) {
            covering.rainProtectionEnabled = v;
            renderCoverings(); // re-render: the wind-direction tolerance field only shows while enabled
            onChangeFired();
        }, !orientationConfigured),
    );
    protectionRow1.appendChild(
        makeCheckbox('cov-' + index + '-windProtectionEnabled', 'windProtectionEnabled', covering.windProtectionEnabled, function (v) {
            covering.windProtectionEnabled = v;
            onChangeFired();
        }),
    );
    protectionRow1.appendChild(
        makeCheckbox('cov-' + index + '-frostProtectionEnabled', 'frostProtectionEnabled', covering.frostProtectionEnabled, function (v) {
            covering.frostProtectionEnabled = v;
            onChangeFired();
        }),
    );
    protectionRow1.appendChild(
        makeCheckbox('cov-' + index + '-nightCoolingEnabled', 'nightCoolingEnabled', covering.nightCoolingEnabled, function (v) {
            covering.nightCoolingEnabled = v;
            renderCoverings(); // re-render: indoor-temperature field only relevant when enabled
            onChangeFired();
        }),
    );
    var doorProtectionRow = document.createElement('div');
    doorProtectionRow.className = 'shutters-door-protection';
    doorProtectionRow.appendChild(
        makeCheckbox('cov-' + index + '-doorProtectionEnabled', 'doorProtectionEnabled', covering.doorProtectionEnabled, function (v) {
            covering.doorProtectionEnabled = v;
            renderCoverings();
            onChangeFired();
        }),
    );
    if (covering.doorProtectionEnabled) {
        var doorContactField = makeStateIdField(
            'cov-' + index + '-doorContactStateId',
            'doorContactStateId',
            covering.doorContactStateId,
            6,
            function (v) {
                covering.doorContactStateId = v;
                onChangeFired();
            },
        );
        doorContactField.className += ' shutters-door-contact-field';
        doorProtectionRow.appendChild(doorContactField);
        doorProtectionRow.appendChild(
            makeCheckbox('cov-' + index + '-invertDoorContact', 'invertDoorContact', covering.invertDoorContact, function (v) {
                covering.invertDoorContact = v;
                onChangeFired();
            }),
        );
    }
    protectionRow1.appendChild(doorProtectionRow);
    card.appendChild(protectionRow1);

    // Wind-threshold override (plan section 2a.5): shown for a markise (auto-filled with a lower
    // suggestion below, since markise fabric/arms are far more wind-sensitive than a closed rolladen)
    // or whenever an override was already explicitly set for this covering, so switching away from
    // markise later does not silently hide a still-active override.
    if (
        covering.coveringType === 'markise' ||
        covering.windOpenThreshold !== undefined ||
        covering.windCloseAllowedThreshold !== undefined
    ) {
        if (covering.coveringType === 'markise') {
            if (covering.windOpenThreshold === undefined) {
                covering.windOpenThreshold = 20;
            }
            if (covering.windCloseAllowedThreshold === undefined) {
                covering.windCloseAllowedThreshold = 10;
            }
        }

        var windThresholdRow = document.createElement('div');
        windThresholdRow.className = 'shutters-row row';
        windThresholdRow.appendChild(
            makeText(
                'cov-' + index + '-windOpenThreshold',
                'windOpenThreshold',
                covering.windOpenThreshold,
                3,
                function (v) {
                    covering.windOpenThreshold = v;
                    onChangeFired();
                },
                'number',
            ),
        );
        windThresholdRow.appendChild(
            makeText(
                'cov-' + index + '-windCloseAllowedThreshold',
                'windCloseAllowedThreshold',
                covering.windCloseAllowedThreshold,
                3,
                function (v) {
                    covering.windCloseAllowedThreshold = v;
                    onChangeFired();
                },
                'number',
            ),
        );
        card.appendChild(windThresholdRow);
    }

    // Only show the wind-direction tolerance field when rain protection is enabled and an orientation
    // is configured (plan section 7) - without an orientation there is no window-facing reference to
    // compare the wind direction against, so the field would have no effect.
    if (covering.rainProtectionEnabled && covering.orientation !== undefined && covering.orientation !== '') {
        var rainWindDirectionRow = document.createElement('div');
        rainWindDirectionRow.className = 'shutters-row row';
        rainWindDirectionRow.appendChild(
            makeText(
                'cov-' + index + '-rainProtectionWindDirectionToleranceDeg',
                'rainProtectionWindDirectionToleranceDeg',
                covering.rainProtectionWindDirectionToleranceDeg,
                3,
                function (v) {
                    covering.rainProtectionWindDirectionToleranceDeg = v;
                    onChangeFired();
                },
                'number',
            ),
        );
        card.appendChild(rainWindDirectionRow);
    }

    // Only show the indoor-temperature field when night cooling is actually enabled for this covering
    // (plan section 7c) - it stays fully inactive without both this being enabled and a sensor configured.
    if (covering.nightCoolingEnabled) {
        var nightCoolingRow = document.createElement('div');
        nightCoolingRow.className = 'shutters-row row';
        nightCoolingRow.appendChild(
            makeStateIdField(
                'cov-' + index + '-nightCoolingIndoorTempStateId',
                'nightCoolingIndoorTempStateId',
                covering.nightCoolingIndoorTempStateId,
                6,
                function (v) {
                    covering.nightCoolingIndoorTempStateId = v;
                    onChangeFired();
                },
            ),
        );
        card.appendChild(nightCoolingRow);
    }

    // Only show sun-window fields when sun protection is actually enabled for this covering.
    if (covering.sunProtectionEnabled) {
        var sunProtectionFields = document.createElement('div');
        sunProtectionFields.className = 'shutters-sun-protection-fields';
        sunProtectionGroup.appendChild(sunProtectionFields);
        // Auto-fill the tolerance bounds the moment sun protection is shown as enabled, so every saved
        // covering always has an explicit value and no separate runtime default is needed to interpret
        // an unset field.
        if (covering.orientationToleranceMinusDeg === undefined) {
            covering.orientationToleranceMinusDeg = -60;
        }
        if (covering.orientationTolerancePlusDeg === undefined) {
            covering.orientationTolerancePlusDeg = 60;
        }

        var sunRow = document.createElement('div');
        sunRow.className = 'shutters-row row shutters-sun-target-row';
        sunRow.appendChild(
            makeText(
                'cov-' + index + '-sunTargetPercent',
                'sunTargetPercent',
                covering.sunTargetPercent,
                3,
                function (v) {
                    covering.sunTargetPercent = v;
                    onChangeFired();
                },
                'number',
            ),
        );
        var sunMinTempRow = document.createElement('div');
        sunMinTempRow.className = 'shutters-row row shutters-sun-min-temp-row';
        sunMinTempRow.appendChild(
            makeText(
                'cov-' + index + '-sunProtectionMinTemp',
                'sunProtectionMinTemp',
                covering.sunProtectionMinTemp,
                3,
                function (v) {
                    covering.sunProtectionMinTemp = v;
                    onChangeFired();
                },
                'number',
            ),
        );
        var sunDetailsRow = document.createElement('div');
        sunDetailsRow.className = 'shutters-row row shutters-sun-tolerance-row';
        sunDetailsRow.appendChild(
            makeText(
                'cov-' + index + '-orientationToleranceMinusDeg',
                'orientationToleranceMinusDeg',
                covering.orientationToleranceMinusDeg,
                3,
                function (v) {
                    covering.orientationToleranceMinusDeg = v === undefined ? -60 : v;
                    scheduleOrientationToleranceHintUpdate(index);
                    onChangeFired();
                },
                'number',
            ),
        );
        sunDetailsRow.appendChild(
            makeText(
                'cov-' + index + '-orientationTolerancePlusDeg',
                'orientationTolerancePlusDeg',
                covering.orientationTolerancePlusDeg,
                3,
                function (v) {
                    covering.orientationTolerancePlusDeg = v === undefined ? 60 : v;
                    scheduleOrientationToleranceHintUpdate(index);
                    onChangeFired();
                },
                'number',
            ),
        );
        if (!covering.orientation) {
            sunDetailsRow.appendChild(
                makeText('cov-' + index + '-sunWindowStart', 'sunWindowStart', covering.sunWindowStart, 3, function (v) {
                    covering.sunWindowStart = v;
                    onChangeFired();
                }),
            );
            sunDetailsRow.appendChild(
                makeText('cov-' + index + '-sunWindowEnd', 'sunWindowEnd', covering.sunWindowEnd, 3, function (v) {
                    covering.sunWindowEnd = v;
                    onChangeFired();
                }),
            );
        }
        sunProtectionFields.appendChild(sunRow);
        sunProtectionFields.appendChild(sunMinTempRow);
        sunProtectionFields.appendChild(sunDetailsRow);

        // 6.2-specific fields (elevation minimum, cloud-cover ceiling): only meaningful once an
        // orientation is actually set, since they refine the orientation-based window, not the plain
        // time-window fallback above.
        if (covering.orientation !== undefined) {
            var sunOrientationRow = document.createElement('div');
            sunOrientationRow.className = 'shutters-row row shutters-sun-min-elevation-row';
            sunOrientationRow.appendChild(
                makeText(
                    'cov-' + index + '-sunProtectionMinElevationDeg',
                    'sunProtectionMinElevationDeg',
                    covering.sunProtectionMinElevationDeg,
                    3,
                    function (v) {
                        covering.sunProtectionMinElevationDeg = v;
                        onChangeFired();
                    },
                    'number',
                ),
            );
            sunMinTempRow.appendChild(
                makeText(
                    'cov-' + index + '-sunProtectionMaxCloudCoverPercent',
                    'sunProtectionMaxCloudCoverPercent',
                    covering.sunProtectionMaxCloudCoverPercent,
                    3,
                    function (v) {
                        covering.sunProtectionMaxCloudCoverPercent = v;
                        onChangeFired();
                    },
                    'number',
                ),
            );
            sunProtectionFields.appendChild(sunOrientationRow);
        }

        // Live preview of which clock time the two tolerance bounds correspond to today, given the
        // covering's orientation and the resolved location (plan section 6.2) - only meaningful once an
        // orientation is actually set.
        if (covering.orientation !== undefined) {
            var toleranceHint = document.createElement('p');
            toleranceHint.className = 'shutters-hint shutters-sun-tolerance-hint';
            sunDetailsRow.appendChild(toleranceHint);
            shuttersToleranceHintElements[index] = toleranceHint;
            updateOrientationToleranceHint(index);
        }
    }

    return built.card;
}

// Subscribes to this instance's `info.scanProgress` state via the admin page's socket.io connection
// (plan section 2b.3), so `onScanClicked()` can show live progress while the scan is running - a
// single `sendTo` round trip has no built-in mechanism for intermediate updates, but a regular state
// change pushed over the same already-open socket does. Best-effort: if the classic admin socket API
// ever differs from what is used elsewhere in this file (see `ensureStateObjectsCache()`), this simply
// has no visible effect rather than breaking the scan itself.
function subscribeScanProgress(instanceId, statusEl) {
    scanProgressStateId = instanceId + '.info.scanProgress';
    scanProgressListener = function (id, state) {
        if (id === scanProgressStateId && state && state.val) {
            statusEl.innerText = state.val;
        }
    };
    try {
        socket.on('stateChange', scanProgressListener);
        socket.emit('subscribe', scanProgressStateId);
    } catch (e) {
        // Live progress is a nice-to-have; see function doc.
    }
}

function unsubscribeScanProgress() {
    if (!scanProgressStateId) {
        return;
    }
    try {
        socket.emit('unsubscribe', scanProgressStateId);
        socket.off('stateChange', scanProgressListener);
    } catch (e) {
        // see subscribeScanProgress()
    }
    scanProgressStateId = null;
    scanProgressListener = null;
}

function onScanClicked() {
    var statusEl = document.getElementById('shutters-scan-status');
    statusEl.innerText = '...';
    var instanceId = getInstanceId();
    subscribeScanProgress(instanceId, statusEl);
    sendTo(instanceId, 'scanForShutters', {}, function (result) {
        unsubscribeScanProgress();
        if (result && result.error) {
            statusEl.innerText = result.error;
            return;
        }
        var candidates = (result && result.candidates) || [];
        var errors = (result && result.errors) || [];
        statusEl.innerText = candidates.length > 0 ? candidates.length + ' candidate(s) found - review below.' : 'No new coverings found.';
        renderScanPreview(candidates, errors);
    });
}

// @param driverType - `IShutterConfig.driverType` value, e.g. "generic-position".
function driverTypeLabel(driverType) {
    var found = DRIVER_TYPES.filter(function (pair) {
        return pair[0] === driverType;
    })[0];
    return found ? _(found[1]) : driverType;
}

// Renders the result of the last `scanForShutters` call as a checkbox+editable-name list the user
// must explicitly confirm (plan section 2b.3) - nothing here is written to the configuration until
// `onApplyScannedClicked()` runs; every candidate is preselected (checked) since that is the common
// case (review/deselect the exceptions), but nothing is ever added silently.
//
// @param candidates - Candidates returned by the backend's `scanForShutters` message handler.
// @param errors - Non-fatal scan errors to display alongside the preview, if any.
function renderScanPreview(candidates, errors) {
    scanPreviewState = candidates.map(function (candidate) {
        return { candidate: candidate, selected: true, name: candidate.name };
    });

    var container = document.getElementById('shutters-scan-preview-container');
    container.innerHTML = '';

    (errors || []).forEach(function (err) {
        var p = document.createElement('p');
        p.className = 'shutters-hint';
        p.style.color = '#c62828';
        p.innerText = err;
        container.appendChild(p);
    });

    if (scanPreviewState.length === 0) {
        return;
    }

    var card = document.createElement('div');
    card.className = 'card-panel';

    scanPreviewState.forEach(function (entry, index) {
        var row = document.createElement('div');
        row.className = 'shutters-row row';

        var checkboxWrap = document.createElement('div');
        checkboxWrap.className = 'col s1';
        checkboxWrap.style.marginTop = '18px';
        var checkboxLabel = document.createElement('label');
        var checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = 'scan-preview-selected-' + index;
        checkbox.checked = true;
        checkbox.onchange = function () {
            entry.selected = checkbox.checked;
        };
        checkboxLabel.appendChild(checkbox);
        checkboxLabel.appendChild(document.createElement('span'));
        checkboxWrap.appendChild(checkboxLabel);
        row.appendChild(checkboxWrap);

        var nameWrap = document.createElement('div');
        nameWrap.className = 'input-field col s4';
        var nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.id = 'scan-preview-name-' + index;
        nameInput.value = entry.name;
        nameInput.oninput = function () {
            entry.name = nameInput.value;
        };
        var nameLabel = document.createElement('label');
        nameLabel.setAttribute('for', nameInput.id);
        nameLabel.className = 'active';
        nameLabel.innerText = _('name');
        nameWrap.appendChild(nameInput);
        nameWrap.appendChild(nameLabel);
        row.appendChild(nameWrap);

        var driverWrap = document.createElement('div');
        driverWrap.className = 'col s3';
        driverWrap.style.marginTop = '18px';
        driverWrap.innerText = driverTypeLabel(entry.candidate.driverType);
        row.appendChild(driverWrap);

        var statesWrap = document.createElement('div');
        statesWrap.className = 'col s4';
        statesWrap.style.marginTop = '18px';
        statesWrap.style.fontSize = '12px';
        statesWrap.style.wordBreak = 'break-all';
        statesWrap.innerText = Object.keys(entry.candidate.states)
            .map(function (key) {
                return entry.candidate.states[key];
            })
            .join(', ');
        row.appendChild(statesWrap);

        card.appendChild(row);
    });

    container.appendChild(card);

    var actionsRow = document.createElement('p');
    var applyBtn = document.createElement('button');
    applyBtn.className = 'btn waves-effect';
    applyBtn.type = 'button';
    applyBtn.innerText = _('applyScannedButton');
    applyBtn.onclick = onApplyScannedClicked;
    var discardBtn = document.createElement('button');
    discardBtn.className = 'btn-flat waves-effect';
    discardBtn.type = 'button';
    discardBtn.style.marginLeft = '10px';
    discardBtn.innerText = _('discardScanButton');
    discardBtn.onclick = function () {
        scanPreviewState = [];
        container.innerHTML = '';
    };
    actionsRow.appendChild(applyBtn);
    actionsRow.appendChild(discardBtn);
    container.appendChild(actionsRow);

    if (typeof translateAll === 'function') translateAll();
}

// Sends exactly the checked (and possibly renamed) candidates to the backend's `applyScannedShutters`
// message handler (plan section 2b.3) - the only point at which a scan result actually changes
// `native.shutters[]`, which then restarts the adapter instance like any other config change.
function onApplyScannedClicked() {
    var statusEl = document.getElementById('shutters-scan-status');
    var selected = scanPreviewState
        .filter(function (entry) {
            return entry.selected;
        })
        .map(function (entry) {
            var candidate = {};
            Object.keys(entry.candidate).forEach(function (key) {
                candidate[key] = entry.candidate[key];
            });
            candidate.name = entry.name;
            return candidate;
        });

    if (selected.length === 0) {
        statusEl.innerText = 'Nothing selected.';
        return;
    }

    statusEl.innerText = '...';
    sendTo(getInstanceId(), 'applyScannedShutters', { candidates: selected }, function (result) {
        if (result && result.added > 0) {
            statusEl.innerText = result.added + ' added, adapter restarting - reload this page afterwards.';
            document.getElementById('shutters-scan-preview-container').innerHTML = '';
            scanPreviewState = [];
        } else if (result && result.error) {
            statusEl.innerText = result.error;
        } else {
            statusEl.innerText = 'Nothing added.';
        }
    });
}

// ---- Areas ----

function renderAreas() {
    var container = document.getElementById('shutters-areas-container');
    container.innerHTML = '';
    shuttersConfig.areas.forEach(function (area, index) {
        area.scheduleMode = area.scheduleMode || 'weekdayWeekend';
        area.weekday = area.weekday || {};
        area.weekend = area.weekend || {};
        area.holiday = area.holiday || {};
        area.days = area.days || {};
        var built = buildAccordionCard(
            area.name || '(' + _('areaName') + ')',
            isCardCollapsed('areas', index),
            function (collapsed) {
                setCardCollapsed('areas', index, collapsed);
            },
            function () {
                shuttersConfig.areas.splice(index, 1);
                removeCardCollapsed('areas', index);
                renderAreas();
                renderCoverings(); // refresh the plan dropdown on covering cards
                onChangeFired();
            },
        );
        var card = built.body;
        var title = built.title;

        var row0 = document.createElement('div');
        row0.className = 'shutters-row row';
        row0.appendChild(
            makeText('area-' + index + '-name', 'areaName', area.name, 4, function (v) {
                area.name = v;
                title.innerText = v;
                renderCoverings(); // refresh the plan dropdown on covering cards
                onChangeFired();
            }),
        );
        row0.appendChild(
            makeSelect('area-' + index + '-scheduleMode', 'scheduleMode', area.scheduleMode, SCHEDULE_MODES, function (v) {
                area.scheduleMode = v;
                renderAreas(); // re-render: which fields are shown depends on the mode
                onChangeFired();
            }),
        );
        card.appendChild(row0);

        if (area.scheduleMode === 'uniform') {
            card.appendChild(
                buildScheduleRow(
                    _('allDaysLabel'),
                    'area-' + index + '-uniform',
                    area.weekday,
                    function (v) {
                        area.weekday.open = v;
                        onChangeFired();
                    },
                    function (v) {
                        area.weekday.close = v;
                        onChangeFired();
                    },
                ),
            );
        } else if (area.scheduleMode === 'perWeekday') {
            var weekdaysHint = document.createElement('div');
            weekdaysHint.className = 'shutters-hint';
            weekdaysHint.innerText = _('perWeekdayHintText');
            card.appendChild(weekdaysHint);

            WEEKDAYS.forEach(function (weekday) {
                var key = weekday[0];
                area.days[key] = area.days[key] || {};
                card.appendChild(
                    buildScheduleRow(
                        _(weekday[1]),
                        'area-' + index + '-day-' + key,
                        area.days[key],
                        function (v) {
                            area.days[key].open = v;
                            onChangeFired();
                        },
                        function (v) {
                            area.days[key].close = v;
                            onChangeFired();
                        },
                    ),
                );
            });

            card.appendChild(
                buildScheduleRow(
                    _('weekdayHoliday'),
                    'area-' + index + '-holiday',
                    area.holiday,
                    function (v) {
                        area.holiday.open = v;
                        onChangeFired();
                    },
                    function (v) {
                        area.holiday.close = v;
                        onChangeFired();
                    },
                ),
            );
        } else {
            // 'weekdayWeekend'
            card.appendChild(
                buildScheduleRow(
                    _('weekdayLabel'),
                    'area-' + index + '-weekday',
                    area.weekday,
                    function (v) {
                        area.weekday.open = v;
                        onChangeFired();
                    },
                    function (v) {
                        area.weekday.close = v;
                        onChangeFired();
                    },
                ),
            );
            card.appendChild(
                buildScheduleRow(
                    _('weekendLabel'),
                    'area-' + index + '-weekend',
                    area.weekend,
                    function (v) {
                        area.weekend.open = v;
                        onChangeFired();
                    },
                    function (v) {
                        area.weekend.close = v;
                        onChangeFired();
                    },
                ),
            );
            card.appendChild(
                buildScheduleRow(
                    _('weekdayHoliday'),
                    'area-' + index + '-holiday',
                    area.holiday,
                    function (v) {
                        area.holiday.open = v;
                        onChangeFired();
                    },
                    function (v) {
                        area.holiday.close = v;
                        onChangeFired();
                    },
                ),
            );
        }

        container.appendChild(built.card);
    });
    if (typeof translateAll === 'function') translateAll();
    refreshSelects();
}

// ---- Weather ----

function renderWeather() {
    var container = document.getElementById('shutters-weather-container');
    container.innerHTML = '';
    var w = shuttersConfig.weather;
    var fields = [
        ['solarRadiationStateId', 'weatherSolarRadiation'],
        ['windSpeedStateId', 'weatherWindSpeed'],
        ['rainStateId', 'weatherRain'],
        ['outdoorTempStateId', 'weatherOutdoorTemp'],
        ['humidityStateId', 'weatherHumidity'],
        ['isSummerStateId', 'weatherIsSummer'],
        ['cloudCoverStateId', 'weatherCloudCover'],
        ['windDirectionStateId', 'weatherWindDirection'],
    ];
    var row = document.createElement('div');
    row.className = 'shutters-row row';
    fields.forEach(function (f) {
        row.appendChild(
            makeStateIdField('weather-' + f[0], f[1], w[f[0]], 6, function (v) {
                w[f[0]] = v;
                onChangeFired();
            }),
        );
    });
    container.appendChild(row);

    // Calendar-based heating-period fallback (plan section 6.2/2), only relevant while isSummerStateId
    // above is left empty - shown as plain "MM-DD" text fields, not foreign-state pickers.
    var heatingPeriodRow = document.createElement('div');
    heatingPeriodRow.className = 'shutters-row row';
    heatingPeriodRow.appendChild(
        makeText('weather-heatingPeriodStart', 'heatingPeriodStart', w.heatingPeriodStart, 3, function (v) {
            w.heatingPeriodStart = v;
            onChangeFired();
        }),
    );
    heatingPeriodRow.appendChild(
        makeText('weather-heatingPeriodEnd', 'heatingPeriodEnd', w.heatingPeriodEnd, 3, function (v) {
            w.heatingPeriodEnd = v;
            onChangeFired();
        }),
    );
    container.appendChild(heatingPeriodRow);
    if (typeof translateAll === 'function') translateAll();
}

// ---- Thresholds ----

function renderThresholds() {
    var container = document.getElementById('shutters-thresholds-container');
    container.innerHTML = '';
    var fields = [
        ['sunCloseThreshold', 'sunCloseThreshold'],
        ['sunOpenThreshold', 'sunOpenThreshold'],
        ['sunProtectionClearSkyCloudCoverMaxPercent', 'sunProtectionClearSkyCloudCoverMaxPercent'],
        ['windOpenThreshold', 'windOpenThreshold'],
        ['windCloseAllowedThreshold', 'windCloseAllowedThreshold'],
        ['frostThreshold', 'frostThreshold'],
        ['nightCoolingIndoorMinTemp', 'nightCoolingIndoorMinTemp'],
        ['nightCoolingMinDelta', 'nightCoolingMinDelta'],
    ];
    var row = document.createElement('div');
    row.className = 'shutters-row row';
    fields.forEach(function (f) {
        row.appendChild(
            makeText(
                'threshold-' + f[0],
                f[1],
                shuttersConfig[f[0]],
                3,
                function (v) {
                    shuttersConfig[f[0]] = v;
                    onChangeFired();
                },
                'number',
            ),
        );
    });
    row.appendChild(
        makeCheckbox('threshold-sunProtectionGlobalEnabled', 'sunProtectionGlobalEnabled', shuttersConfig.sunProtectionGlobalEnabled, function (v) {
            shuttersConfig.sunProtectionGlobalEnabled = v;
            onChangeFired();
        }),
    );
    row.appendChild(
        makeCheckbox(
            'threshold-sunProtectionCloudCoverTriggerEnabled',
            'sunProtectionCloudCoverTriggerEnabled',
            shuttersConfig.sunProtectionCloudCoverTriggerEnabled,
            function (v) {
                shuttersConfig.sunProtectionCloudCoverTriggerEnabled = v;
                onChangeFired();
            },
        ),
    );
    container.appendChild(row);
    if (typeof translateAll === 'function') translateAll();

    var notifyContainer = document.getElementById('shutters-notify-container');
    notifyContainer.innerHTML = '';
    var notifyRow = document.createElement('div');
    notifyRow.className = 'shutters-row row';
    notifyRow.appendChild(
        makeText('notify-pushoverInstance', 'pushoverInstance', shuttersConfig.pushoverInstance, 3, function (v) {
            shuttersConfig.pushoverInstance = v || undefined;
            onChangeFired();
        }),
    );
    notifyRow.appendChild(
        makeText('notify-telegramInstance', 'telegramInstance', shuttersConfig.telegramInstance, 3, function (v) {
            shuttersConfig.telegramInstance = v || undefined;
            onChangeFired();
        }),
    );
    notifyContainer.appendChild(notifyRow);
    if (typeof translateAll === 'function') translateAll();
}

// ---- Groups ----

function renderGroups() {
    var container = document.getElementById('shutters-groups-container');
    container.innerHTML = '';
    shuttersConfig.groups.forEach(function (group, index) {
        var built = buildAccordionCard(
            group.name || group.id || '(' + _('name') + ')',
            isCardCollapsed('groups', index),
            function (collapsed) {
                setCardCollapsed('groups', index, collapsed);
            },
            function () {
                shuttersConfig.groups.splice(index, 1);
                removeCardCollapsed('groups', index);
                renderGroups();
                onChangeFired();
            },
        );
        var card = built.body;
        var title = built.title;

        var row = document.createElement('div');
        row.className = 'shutters-row row';
        row.appendChild(
            makeText('group-' + index + '-id', 'id', group.id, 3, function (v) {
                group.id = v;
                onChangeFired();
            }),
        );
        row.appendChild(
            makeText('group-' + index + '-name', 'name', group.name, 3, function (v) {
                group.name = v;
                title.innerText = v;
                onChangeFired();
            }),
        );
        var memberWrap = document.createElement('div');
        memberWrap.className = 'input-field col s6';
        var memberSelect = document.createElement('select');
        memberSelect.id = 'group-' + index + '-members';
        memberSelect.multiple = true;
        var memberIds = group.memberIds || [];
        var knownMemberIds = {};
        getCoveringOptions().forEach(function (option) {
            knownMemberIds[option.value] = true;
            var opt = document.createElement('option');
            opt.value = option.value;
            opt.text = option.text;
            opt.selected = memberIds.indexOf(option.value) !== -1;
            memberSelect.appendChild(opt);
        });
        memberIds.forEach(function (memberId) {
            if (!knownMemberIds[memberId]) {
                var missingOpt = document.createElement('option');
                missingOpt.value = memberId;
                missingOpt.text = _('missingCovering') + ': ' + memberId;
                missingOpt.selected = true;
                missingOpt.disabled = true;
                memberSelect.appendChild(missingOpt);
            }
        });
        memberSelect.onchange = function () {
            group.memberIds = Array.prototype.map.call(memberSelect.selectedOptions, function (option) {
                return option.value;
            });
            onChangeFired();
        };
        var memberLabel = document.createElement('label');
        memberLabel.setAttribute('for', memberSelect.id);
        memberLabel.className = 'active';
        memberLabel.innerText = _('groupMemberIds');
        memberWrap.appendChild(memberSelect);
        memberWrap.appendChild(memberLabel);
        row.appendChild(memberWrap);
        card.appendChild(row);

        container.appendChild(built.card);
    });
    if (typeof translateAll === 'function') translateAll();
    refreshSelects();
}

function makeSceneTargetSelect(scene, sceneIndex, target, targetIndex) {
    var wrap = document.createElement('div');
    wrap.className = 'input-field col s5';
    var select = document.createElement('select');
    select.id = 'scene-' + sceneIndex + '-target-' + targetIndex + '-covering';
    var targetIds = {};
    scene.targets.forEach(function (sceneTarget) {
        targetIds[sceneTarget.coveringId] = true;
    });
    var knownIds = {};
    getCoveringOptions().forEach(function (option) {
        knownIds[option.value] = true;
        var opt = document.createElement('option');
        opt.value = option.value;
        opt.text = option.text;
        opt.selected = option.value === target.coveringId;
        opt.disabled = option.value !== target.coveringId && targetIds[option.value];
        select.appendChild(opt);
    });
    if (!knownIds[target.coveringId]) {
        var missingOpt = document.createElement('option');
        missingOpt.value = target.coveringId;
        missingOpt.text = _('missingCovering') + ': ' + target.coveringId;
        missingOpt.selected = true;
        missingOpt.disabled = true;
        select.appendChild(missingOpt);
    }
    select.onchange = function () {
        target.coveringId = select.value;
        renderScenes();
        onChangeFired();
    };
    var label = document.createElement('label');
    label.setAttribute('for', select.id);
    label.className = 'active';
    label.innerText = _('sceneTargetCovering');
    wrap.appendChild(select);
    wrap.appendChild(label);
    return wrap;
}

function makeSceneTargetPosition(sceneIndex, target, targetIndex) {
    var wrap = document.createElement('div');
    wrap.className = 'input-field col s4';
    var input = document.createElement('input');
    input.id = 'scene-' + sceneIndex + '-target-' + targetIndex + '-position';
    input.type = 'number';
    input.min = '0';
    input.max = '100';
    input.step = '1';
    input.value = clampSceneTargetPercent(target.percent);
    input.oninput = function () {
        if (input.value.trim() === '' || !isFinite(Number(input.value))) return;
        target.percent = clampSceneTargetPercent(input.value);
        input.value = target.percent;
        onChangeFired();
    };
    input.onchange = function () {
        input.value = clampSceneTargetPercent(target.percent);
    };
    var label = document.createElement('label');
    label.setAttribute('for', input.id);
    label.className = 'active';
    label.innerText = _('sceneTargetPosition');
    wrap.appendChild(input);
    wrap.appendChild(label);
    return wrap;
}

function renderScenes() {
    var container = document.getElementById('shutters-scenes-container');
    container.innerHTML = '';
    shuttersConfig.scenes.forEach(function (scene, index) {
        scene.targets = scene.targets || [];
        var built = buildAccordionCard(
            scene.name || scene.id || '(' + _('name') + ')',
            isCardCollapsed('scenes', index),
            function (collapsed) {
                setCardCollapsed('scenes', index, collapsed);
            },
            function () {
                shuttersConfig.scenes.splice(index, 1);
                removeCardCollapsed('scenes', index);
                renderScenes();
                onChangeFired();
            },
        );
        var card = built.body;
        var title = built.title;

        var row = document.createElement('div');
        row.className = 'shutters-row row';
        row.appendChild(
            makeText('scene-' + index + '-id', 'id', scene.id, 3, function (v) {
                scene.id = v;
                onChangeFired();
            }),
        );
        row.appendChild(
            makeText('scene-' + index + '-name', 'name', scene.name, 3, function (v) {
                scene.name = v;
                title.innerText = v;
                onChangeFired();
            }),
        );
        card.appendChild(row);

        scene.targets.forEach(function (target, targetIndex) {
            target.percent = clampSceneTargetPercent(target.percent);
            var targetRow = document.createElement('div');
            targetRow.className = 'shutters-row row';
            targetRow.appendChild(makeSceneTargetSelect(scene, index, target, targetIndex));
            targetRow.appendChild(makeSceneTargetPosition(index, target, targetIndex));
            var removeWrap = document.createElement('div');
            removeWrap.className = 'col s3';
            removeWrap.style.marginTop = '18px';
            var removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'btn-flat shutters-remove-btn';
            removeBtn.innerText = _('removeSceneTargetButton');
            removeBtn.onclick = function () {
                scene.targets.splice(targetIndex, 1);
                renderScenes();
                onChangeFired();
            };
            removeWrap.appendChild(removeBtn);
            targetRow.appendChild(removeWrap);
            card.appendChild(targetRow);
        });

        var addTargetBtn = document.createElement('button');
        addTargetBtn.type = 'button';
        addTargetBtn.className = 'btn waves-effect shutters-add-btn';
        addTargetBtn.innerText = _('addSceneTargetButton');
        var usedTargetIds = {};
        scene.targets.forEach(function (target) {
            usedTargetIds[target.coveringId] = true;
        });
        var availableCovering = getCoveringOptions().filter(function (option) {
            return !usedTargetIds[option.value];
        })[0];
        addTargetBtn.disabled = !availableCovering;
        addTargetBtn.onclick = function () {
            if (!availableCovering) return;
            scene.targets.push({ coveringId: availableCovering.value, percent: 0 });
            renderScenes();
            onChangeFired();
        };
        card.appendChild(addTargetBtn);

        container.appendChild(built.card);
    });
    if (typeof translateAll === 'function') translateAll();
    refreshSelects();
}

function shuttersGetNativeConfig() {
    return shuttersConfig;
}
