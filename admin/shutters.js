/* eslint-disable */
// Logic for the custom (non-JSONConfig) admin settings page of the shutters adapter.
// Contract: index_m.html calls shuttersInitAdmin(settings, onChange) from load(),
// and shuttersGetNativeConfig() from save().

var shuttersConfig = null; // working copy of native config, mutated in place
var shuttersOnChange = null;

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
    ['knx', 'driverTypeKnx'],
    ['shelly', 'driverTypeShelly'],
    ['zigbee', 'driverTypeZigbee'],
    ['zigbee2mqtt', 'driverTypeZigbee2Mqtt'],
    ['generic-position', 'driverTypeGenericPosition'],
    ['generic-relay', 'driverTypeGenericRelay'],
];

// Which `states.*` keys are relevant per driverType. Kern-set drivers (homematic/knx/shelly/zigbee/zigbee2mqtt)
// and generic-position all use a position state plus an optional stop state and actual-position feedback.
// generic-relay uses separate open/close/stop relays instead.
// Which `states.*` keys (matching IShutterConfig.states/driver-factory.ts - "position", "positionActual",
// "stop", "open", "close", NOT prefixed with "state") are relevant per driverType, paired with their
// admin label translation key. Kern-set drivers (homematic/knx/shelly/zigbee/zigbee2mqtt) and
// generic-position all use a position state plus an optional stop state and actual-position feedback.
// generic-relay uses separate open/close relays instead.
function getRelevantStateFields(driverType) {
    if (driverType === 'generic-relay') {
        return [
            ['open', 'stateOpen'],
            ['close', 'stateClose'],
            ['stop', 'stateStop'],
        ];
    }
    // homematic, knx, shelly, zigbee, zigbee2mqtt, generic-position
    return [
        ['position', 'statePosition'],
        ['positionActual', 'statePositionActual'],
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
    settings.sunCloseThreshold = settings.sunCloseThreshold != null ? settings.sunCloseThreshold : 200;
    if (settings.sunProtectionGlobalEnabled === undefined) settings.sunProtectionGlobalEnabled = true;
    settings.sunOpenThreshold = settings.sunOpenThreshold != null ? settings.sunOpenThreshold : 150;
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
        if (!s.areaId && s.area) {
            var matchingAreas = settings.areas.filter(function (area) {
                return area.name === s.area;
            });
            var targetArea = matchingAreas.length === 1 ? matchingAreas[0] : settings.areas.length === 1 ? settings.areas[0] : undefined;
            if (targetArea) {
                s.areaId = targetArea.id;
                delete s.area;
            }
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

    document.getElementById('shutters-add-covering-btn').onclick = function () {
        shuttersConfig.shutters.push({
            id: nextAvailableCoveringId(),
            name: '',
            driverType: 'generic-position',
            coveringType: 'rolladen',
            automationEnabled: true,
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

function makeCheckbox(id, label, checked, onChangeCb) {
    var wrap = document.createElement('div');
    wrap.className = 'col s3';
    wrap.style.marginTop = '18px';
    var p = document.createElement('p');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = !!checked;
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
    row1.appendChild(idField);
    row1.appendChild(
        makeText('cov-' + index + '-name', 'name', covering.name, 3, function (v) {
            covering.name = v;
            title.innerText = v || covering.id;
            onChangeFired();
        }),
    );
    row1.appendChild(
        makeSelect('cov-' + index + '-coveringType', 'coveringType', covering.coveringType, COVERING_TYPES, function (v) {
            covering.coveringType = v;
            onChangeFired();
        }),
    );
    row1.appendChild(
        makeSelect('cov-' + index + '-driverType', 'driverType', covering.driverType, DRIVER_TYPES, function (v) {
            covering.driverType = v;
            renderCoverings(); // re-render: relevant state fields depend on driverType
            onChangeFired();
        }),
    );
    card.appendChild(row1);

    var row2 = document.createElement('div');
    row2.className = 'shutters-row row';
    row2.appendChild(
            makeSelectPlain('cov-' + index + '-area', 'area', covering.areaId, getPlanOptions(), 3, function (v) {
                covering.areaId = v;
                delete covering.area;
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
                onChangeFired();
            },
            'number',
        ),
    );
    row2.appendChild(
        makeCheckbox('cov-' + index + '-automationEnabled', 'automationEnabled', covering.automationEnabled, function (v) {
            covering.automationEnabled = v;
            onChangeFired();
        }),
    );
    card.appendChild(row2);

    var statesTitle = document.createElement('div');
    statesTitle.className = 'shutters-section-title';
    statesTitle.innerText = _('statesSectionTitle');
    card.appendChild(statesTitle);

    var statesRow = document.createElement('div');
    statesRow.className = 'shutters-row row';
    getRelevantStateFields(covering.driverType).forEach(function (field) {
        var dataKey = field[0];
        var labelKey = field[1];
        statesRow.appendChild(
            makeStateIdField('cov-' + index + '-state-' + dataKey, labelKey, covering.states[dataKey], 4, function (v) {
                covering.states[dataKey] = v;
                onChangeFired();
            }),
        );
    });
    card.appendChild(statesRow);

    var protectionTitle = document.createElement('div');
    protectionTitle.className = 'shutters-section-title';
    protectionTitle.innerText = _('protectionSectionTitle');
    card.appendChild(protectionTitle);

    var protectionRow1 = document.createElement('div');
    protectionRow1.className = 'shutters-row row';
    protectionRow1.appendChild(
        makeCheckbox('cov-' + index + '-sunProtectionEnabled', 'sunProtectionEnabled', covering.sunProtectionEnabled, function (v) {
            covering.sunProtectionEnabled = v;
            renderCoverings(); // re-render: sun window fields only relevant when enabled
            onChangeFired();
        }),
    );
    protectionRow1.appendChild(
        makeCheckbox('cov-' + index + '-rainProtectionEnabled', 'rainProtectionEnabled', covering.rainProtectionEnabled, function (v) {
            covering.rainProtectionEnabled = v;
            onChangeFired();
        }),
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
    card.appendChild(protectionRow1);

    // Only show sun-window fields when sun protection is actually enabled for this covering.
    if (covering.sunProtectionEnabled) {
        var sunRow = document.createElement('div');
        sunRow.className = 'shutters-row row';
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
        sunRow.appendChild(
            makeText('cov-' + index + '-sunWindowStart', 'sunWindowStart', covering.sunWindowStart, 3, function (v) {
                covering.sunWindowStart = v;
                onChangeFired();
            }),
        );
        sunRow.appendChild(
            makeText('cov-' + index + '-sunWindowEnd', 'sunWindowEnd', covering.sunWindowEnd, 3, function (v) {
                covering.sunWindowEnd = v;
                onChangeFired();
            }),
        );
        card.appendChild(sunRow);
    }

    var doorRow = document.createElement('div');
    doorRow.className = 'shutters-row row';
    doorRow.appendChild(
        makeStateIdField('cov-' + index + '-doorContactStateId', 'doorContactStateId', covering.doorContactStateId, 6, function (v) {
            covering.doorContactStateId = v;
            onChangeFired();
        }),
    );
    card.appendChild(doorRow);

    return built.card;
}

function onScanClicked() {
    var statusEl = document.getElementById('shutters-scan-status');
    statusEl.innerText = '...';
    var instanceId = getInstanceId();
    sendTo(instanceId, 'scanForShutters', {}, function (result) {
        if (result && result.added && result.added > 0) {
            statusEl.innerText = result.added + ' added, adapter restarting - reload this page afterwards.';
        } else {
            statusEl.innerText = result && result.error ? result.error : 'No new coverings found.';
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
    if (typeof translateAll === 'function') translateAll();
}

// ---- Thresholds ----

function renderThresholds() {
    var container = document.getElementById('shutters-thresholds-container');
    container.innerHTML = '';
    var fields = [
        ['sunCloseThreshold', 'sunCloseThreshold'],
        ['sunOpenThreshold', 'sunOpenThreshold'],
        ['windOpenThreshold', 'windOpenThreshold'],
        ['windCloseAllowedThreshold', 'windCloseAllowedThreshold'],
        ['frostThreshold', 'frostThreshold'],
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
    container.appendChild(row);
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
        row.appendChild(
            makeText(
                'group-' + index + '-members',
                'groupMemberIds',
                (group.memberIds || []).join(', '),
                6,
                function (v) {
                    group.memberIds = v
                        .split(',')
                        .map(function (s) {
                            return s.trim();
                        })
                        .filter(function (s) {
                            return s.length > 0;
                        });
                    onChangeFired();
                },
            ),
        );
        card.appendChild(row);

        container.appendChild(built.card);
    });
    if (typeof translateAll === 'function') translateAll();
}

// ---- Scenes ----

function renderScenes() {
    var container = document.getElementById('shutters-scenes-container');
    container.innerHTML = '';
    shuttersConfig.scenes.forEach(function (scene, index) {
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
        row.appendChild(
            makeText(
                'scene-' + index + '-targets',
                'sceneTargets',
                (scene.targets || [])
                    .map(function (t) {
                        return t.coveringId + ':' + t.percent;
                    })
                    .join(', '),
                6,
                function (v) {
                    scene.targets = v
                        .split(',')
                        .map(function (s) {
                            return s.trim();
                        })
                        .filter(function (s) {
                            return s.length > 0;
                        })
                        .map(function (pair) {
                            var parts = pair.split(':');
                            return { coveringId: parts[0].trim(), percent: Number(parts[1]) };
                        });
                    onChangeFired();
                },
            ),
        );
        card.appendChild(row);

        container.appendChild(built.card);
    });
    if (typeof translateAll === 'function') translateAll();
}

function shuttersGetNativeConfig() {
    return shuttersConfig;
}
