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

var FEDERAL_STATES = [
    ['', 'publicHolidayFederalStateNone'],
    ['BW', 'publicHolidayFederalStateBW'],
    ['BY', 'publicHolidayFederalStateBY'],
    ['BE', 'publicHolidayFederalStateBE'],
    ['BB', 'publicHolidayFederalStateBB'],
    ['HB', 'publicHolidayFederalStateHB'],
    ['HH', 'publicHolidayFederalStateHH'],
    ['HE', 'publicHolidayFederalStateHE'],
    ['MV', 'publicHolidayFederalStateMV'],
    ['NI', 'publicHolidayFederalStateNI'],
    ['NW', 'publicHolidayFederalStateNW'],
    ['RP', 'publicHolidayFederalStateRP'],
    ['SL', 'publicHolidayFederalStateSL'],
    ['SN', 'publicHolidayFederalStateSN'],
    ['ST', 'publicHolidayFederalStateST'],
    ['SH', 'publicHolidayFederalStateSH'],
    ['TH', 'publicHolidayFederalStateTH'],
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
function getRelevantStateFields(driverType) {
    if (driverType === 'generic-relay') {
        return ['stateOpen', 'stateClose', 'stateStop'];
    }
    // homematic, knx, shelly, zigbee, zigbee2mqtt, generic-position
    return ['statePosition', 'statePositionActual', 'stateStop'];
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
    settings.publicHolidayFederalState = settings.publicHolidayFederalState || '';
    settings.sunCloseThreshold = settings.sunCloseThreshold != null ? settings.sunCloseThreshold : 200;
    settings.sunOpenThreshold = settings.sunOpenThreshold != null ? settings.sunOpenThreshold : 150;
    settings.windOpenThreshold = settings.windOpenThreshold != null ? settings.windOpenThreshold : 40;
    settings.windCloseAllowedThreshold =
        settings.windCloseAllowedThreshold != null ? settings.windCloseAllowedThreshold : 25;
    settings.frostThreshold = settings.frostThreshold != null ? settings.frostThreshold : 2;

    settings.shutters.forEach(function (s) {
        s.states = s.states || {};
        if (s.automationEnabled === undefined) s.automationEnabled = true;
    });
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

    fillFederalStateSelect();

    document.getElementById('shutters-add-covering-btn').onclick = function () {
        shuttersConfig.shutters.push({
            id: 'covering' + Date.now(),
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
        shuttersConfig.areas.push({ name: '', weekday: {}, weekend: {} });
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

function onChangeFired() {
    if (typeof shuttersOnChange === 'function') shuttersOnChange();
    if (typeof M !== 'undefined' && M.FormSelect) {
        M.FormSelect.init(document.querySelectorAll('select'));
    } else if (typeof $ !== 'undefined' && $.fn.material_select) {
        $('select').material_select();
    }
}

function fillFederalStateSelect() {
    var select = document.getElementById('shutters-holiday-state');
    select.innerHTML = '';
    FEDERAL_STATES.forEach(function (entry) {
        var opt = document.createElement('option');
        opt.value = entry[0];
        opt.text = _(entry[1]);
        if (entry[0] === shuttersConfig.publicHolidayFederalState) opt.selected = true;
        select.appendChild(opt);
    });
    select.onchange = function () {
        shuttersConfig.publicHolidayFederalState = select.value;
        onChangeFired();
    };
    if (typeof $ !== 'undefined' && $.fn.material_select) $('#shutters-holiday-state').material_select();
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

function makeText(id, label, value, colWidth, onChangeCb, type) {
    var wrap = document.createElement('div');
    wrap.className = 'input-field col s' + (colWidth || 3);
    var input = document.createElement('input');
    input.id = id;
    input.type = type || 'text';
    input.value = value === undefined || value === null ? '' : value;
    input.oninput = function () {
        onChangeCb(type === 'number' ? Number(input.value) : input.value);
    };
    var labelEl = document.createElement('label');
    labelEl.setAttribute('for', id);
    labelEl.className = 'active';
    labelEl.innerText = _(label);
    wrap.appendChild(input);
    wrap.appendChild(labelEl);
    return wrap;
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
    labelEl.setAttribute('for', id);
    labelEl.innerText = _(label);
    p.appendChild(input);
    p.appendChild(labelEl);
    wrap.appendChild(p);
    return wrap;
}

// ---- Coverings ----

function renderCoverings() {
    var container = document.getElementById('shutters-coverings-container');
    container.innerHTML = '';
    shuttersConfig.shutters.forEach(function (covering, index) {
        container.appendChild(renderCoveringCard(covering, index));
    });
    if (typeof translateAll === 'function') translateAll();
    if (typeof $ !== 'undefined' && $.fn.material_select) $('select').material_select();
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
    row1.appendChild(
        makeText('cov-' + index + '-id', 'id', covering.id, 3, function (v) {
            covering.id = v;
            onChangeFired();
        }),
    );
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
        makeText('cov-' + index + '-area', 'area', covering.area, 3, function (v) {
            covering.area = v;
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
    getRelevantStateFields(covering.driverType).forEach(function (fieldKey) {
        statesRow.appendChild(
            makeText('cov-' + index + '-state-' + fieldKey, fieldKey, covering.states[fieldKey], 4, function (v) {
                covering.states[fieldKey] = v;
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
        makeText('cov-' + index + '-doorContactStateId', 'doorContactStateId', covering.doorContactStateId, 6, function (v) {
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
    var instanceId = (typeof adapter !== 'undefined' ? adapter : 'shutters') + '.' + (typeof instance !== 'undefined' ? instance : 0);
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
        area.weekday = area.weekday || {};
        area.weekend = area.weekend || {};
        area.holiday = area.holiday || {};
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
                onChangeFired();
            }),
        );
        card.appendChild(row0);

        var row1 = document.createElement('div');
        row1.className = 'shutters-row row';
        row1.appendChild(
            makeText('area-' + index + '-weekdayOpen', 'weekdayOpen', area.weekday.open, 3, function (v) {
                area.weekday.open = v;
                onChangeFired();
            }),
        );
        row1.appendChild(
            makeText('area-' + index + '-weekdayClose', 'weekdayClose', area.weekday.close, 3, function (v) {
                area.weekday.close = v;
                onChangeFired();
            }),
        );
        row1.appendChild(
            makeText('area-' + index + '-weekendOpen', 'weekendOpen', area.weekend.open, 3, function (v) {
                area.weekend.open = v;
                onChangeFired();
            }),
        );
        row1.appendChild(
            makeText('area-' + index + '-weekendClose', 'weekendClose', area.weekend.close, 3, function (v) {
                area.weekend.close = v;
                onChangeFired();
            }),
        );
        card.appendChild(row1);

        var row2 = document.createElement('div');
        row2.className = 'shutters-row row';
        row2.appendChild(
            makeText('area-' + index + '-holidayOpen', 'holidayOpen', area.holiday.open, 3, function (v) {
                area.holiday.open = v;
                onChangeFired();
            }),
        );
        row2.appendChild(
            makeText('area-' + index + '-holidayClose', 'holidayClose', area.holiday.close, 3, function (v) {
                area.holiday.close = v;
                onChangeFired();
            }),
        );
        card.appendChild(row2);

        container.appendChild(built.card);
    });
    if (typeof translateAll === 'function') translateAll();
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
    ];
    var row = document.createElement('div');
    row.className = 'shutters-row row';
    fields.forEach(function (f) {
        row.appendChild(
            makeText('weather-' + f[0], f[1], w[f[0]], 6, function (v) {
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
