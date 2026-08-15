# ioBroker.shutters — Adapter-Plan

**Status-Legende** (zuletzt geprüft: 2026-08-15, Abgleich Plan ↔ Code):
✅ erledigt · ⚠️ teilweise umgesetzt (siehe Anmerkung) · ❌ offen/nicht begonnen

## 0. Kontext & Referenzen

- Analoger Adapter mit ähnlicher Architektur: `../ioBroker.irrigation` (State-Hierarchie, Scheduler, Sensor-Handling, Admin-JSONConfig, Release-Workflow). Als Bauplan/Vorlage für Coding-Stil und Modulaufteilung verwenden — **nicht kopieren**, sondern mit `create-adapter` neu aufsetzen.
- Inspirationsquelle: JavaScript-Script "Shutters" auf `haus20a.steinwedel.de` (bestehende Rolladen-Logik als fachliche Referenz für Behanghöhen-Mapping, Dämmerungs- und Sonnenschutzlogik).
- Zielverzeichnis/Repo-Name: `ioBroker.shutters`, npm-Paket `iobroker.shutters`.

## 1. Projekt-Setup ✅

1. `npx @iobroker/create-adapter@latest` im aktuellen Verzeichnis ausführen (TypeScript, klassisches Materialize-Admin statt JSONConfig — bewusste Wahl, siehe Abschnitt 9, ESLint `@iobroker/eslint-config`, Testing-Framework, GitHub Actions).
2. `.releaseconfig.json`, `.env`, `eslint.config.mjs` bereits vorhanden — beibehalten/mergen statt überschreiben.
3. `io-package.json` Pflichtfelder setzen:
   - `dataSource: "poll"`, `mode: "daemon"`
   - `adminUI.config: "materialize"` (bewusste, endgültige Wahl — siehe Abschnitt 9; **kein** JSONConfig)
   - `type: "climate-control"`
   - `connectionType: "local"`
   - `supportedMessages: { "custom": true }`
   - `titleLang: { en: "Shutters", de: "Rolläden" }`
4. `CONTEXT.md` anlegen (max. 20 Zeilen, Current Task / Key Decisions / Next Steps).

## 2. Fachliche Anforderungen → Module ⚠️ (siehe Status-Spalte je Zeile)

| # | Anforderung | Modul (`src/lib/...`) | Status |
|---|---|---|---|
| 1 | Einheitliche Alias-Steuerung aller Rolläden **über verschiedene Fremd-Adapter/Systeme hinweg** | `drivers/*.ts` + `shutter-controller.ts` | ✅ alle 16 Driver (siehe 2a.2) |
| 2 | Behanghöhe ≠ lineare Laufzeit (Kalibrierungskurve) | `position-mapping.ts` | ✅ |
| 3 | Tägliches Auf/Zu, abhängig von Wochentag/Wochenende/Feiertag/iCal, pro Zonen/Bereich | `scheduler.ts`, `ical.ts` | ✅ |
| 4 | Dämmerungsabhängige Steuerung (z. B. 30 min nach Ende der Dämmerung) | `twilight.ts` | ✅ |
| 5 | Sonnenschutz nach Fensterausrichtung, Heizperioden-Ausnahme, Wolkenfilter | `sun-protection.ts` | ⚠️ siehe Abschnitt 6 (6.2 optional, nicht Standardpfad) |
| 6 | Regenschutz, ggf. windrichtungsabhängig | `rain-protection.ts` | ✅ |
| 7 | Windschutz (Sturmwarnung) — Rolläden bei hoher Windgeschwindigkeit hochfahren, um Mechanik/Behang zu schützen | `wind-protection.ts` | ✅ |
| 8 | Frostschutz — Fahrbefehle bei Vereisungsgefahr unterdrücken/verzögern | `frost-protection.ts` | ✅ |
| 8b | Türkontakt-Schutz — kein Zufahren bei geöffneter Terrassen-/Balkontür | `door-protection.ts` | ✅ |
| 9 | Watchdog (hängender Antrieb erkennen) + Zustands-Recovery nach Adapter-Neustart | `watchdog.ts`, persistierte States | ⚠️ Watchdog inline in `shutter-controller.ts` (kein eigenes Modul); `sunProtectionOverrideUntil` und der aktuell laufende Fahrbefehl (`pendingMoveTargetPercent`/`pendingMoveIssuedAt`) persistiert und beim Start wiederhergestellt; `windProtectionActive`/`frostProtectionActive` weiterhin nicht persistiert (siehe 9a.2) |
| 10 | Sommer-Nachtauskühlung (abendliches Schließen zonenweise aussetzen/umkehren) | `night-cooling.ts` | ✅ |
| 11 | Motorschutz (Mindestpause zwischen Fahrten) | `shutter-controller.ts` | ✅ (siehe 7d) |
| 12 | Szenen/Vorgabepositionen | `scenes.ts` | ✅ (als `scene-manager.ts`) |

## 2a. Treiber-Abstraktion für Fremdsysteme (Punkt 1 vertieft) ✅ (alle 16 Driver fertig, siehe 2a.1-2a.5 für Details/Einschränkungen)

Kernanforderung: der Adapter selbst spricht **nicht** direkt Homematic/KNX/Shelly/Zigbee etc., sondern nur eine einheitliche interne Schnittstelle. Jedes unterstützte Fremdsystem bekommt einen eigenen, austauschbaren "Driver", der ausschließlich über verlinkte ioBroker-States (fremder Adapter-Instanzen) kommuniziert — es gibt **keine** direkte Abhängigkeit zu Homematic-, KNX- oder Zigbee-Bibliotheken im Adapter.

### 2a.1 Gemeinsames Interface ✅

```typescript
// src/lib/drivers/types.ts
export interface IShutterDriver {
    readonly type: string; // z.B. "homematic", "knx", "shelly", "generic-relay", "generic-position"

    /** Fährt den Rolladen auf eine Laufzeit-Zielposition 0-100 (bereits gemappt, siehe position-mapping.ts) */
    setPosition(targetPercent: number): Promise<void>;

    /** Ganz auf / ganz zu / Stopp — nicht jedes System braucht das (z.B. reine Positionsantriebe) */
    open(): Promise<void>;
    close(): Promise<void>;
    stop(): Promise<void>;

    /** Aktuelle Ist-Position (0-100) bzw. undefined, wenn System keine Rückmeldung liefert */
    getCurrentPosition(): number | undefined;

    /** Bewegungsstatus, falls verfügbar */
    isMoving(): boolean | undefined;

    /** Aufräumen von subscribeForeignStates-Abos etc. */
    destroy(): void;
}
```

### 2a.2 Konkrete Driver-Implementierungen ✅ (alle 16 vorhanden)

| Driver | Datei | Verlinkte Fremd-States | Besonderheiten | Status |
|---|---|---|---|---|
| Homematic (CCU/HM-RPC/HmIP) | `drivers/homematic-driver.ts` | `LEVEL` (0-1 oder 0-100 je Kanal), `STOP`, ggf. `WORKING`/`DIRECTION` | Skalierung 0-1 ↔ 0-100 beachten | ✅ |
| Homematic IP Cloud/Access Point (`ioBroker.hmip`) | `drivers/hmip-driver.ts` | `ShutterActuator`-Channel: `shutterLevel` (0-1), `stop`, `selfCalibrationInProgress` | Eigene State-Struktur, unabhängig von `hm-rpc`; nicht mit CCU-Instanz verwechseln | ✅ |
| KNX (über `ioBroker.knx`) | `drivers/knx-driver.ts` | Positions-DPT (z. B. DPT 5.001 %), Stopp-GA, Status-GA | Getrennte Kommando-/Status-Objekte (KNX-typisch) | ✅ |
| Shelly 2.5/Plus (Cover-Mode) | `drivers/shelly-driver.ts` | `Cover.Pos`/`Position`, `Cover.Open`/`Close`/`Stop` | Meist direkte %-Positionsrückmeldung | ✅ |
| Zigbee (zigbee-herdsman/`ioBroker.zigbee`) | `drivers/zigbee-driver.ts` | `position`/`current_position`, `state` (OPEN/CLOSE/STOP) | Je Gerätehersteller (Tuya, IKEA) leicht abweichende State-Namen → pro Gerät konfigurierbar | ✅ |
| Zigbee2MQTT (`ioBroker.zigbee2mqtt`) | `drivers/zigbee2mqtt-driver.ts` | `position`/`state` unterhalb `zigbee2mqtt.*` (Topic-basierte States) | Eigenständiger Adapter neben `ioBroker.zigbee`, andere Objektpfad-Konvention, sonst gleiches Gerätesortiment | ✅ |
| Tuya Cloud/Local (`ioBroker.tuya`) | `drivers/tuya-driver.ts` | DP-States, meist `percent_control`/`percent_state` bzw. `control` (OPEN/CLOSE/STOP) | Weit verbreitete günstige WLAN-Rollladenmotoren; DP-Nummern variieren je Gerät → pro Gerät konfigurierbar | ✅ |
| Somfy (io-Homecontrol, TaHoma/Connexoon, `ioBroker.tahoma`) | `drivers/somfy-driver.ts` | Positions-State (`core:ClosureState`/`position`), Kommandos `open`/`close`/`stop`/`setPosition` | Sehr verbreitet bei Rolladenmotoren in DE/FR; Cloud-Anbindung, ggf. Rate-Limits beachten | ✅ (vereinfacht: `open`/`close` sind `setPosition(0)`/`setPosition(100)`, keine separaten TaHoma-Kommando-States) |
| Velux (KLF200/io-Homecontrol, `ioBroker.velux`/`ioBroker.klf200`) | `drivers/velux-driver.ts` | Positions-State (0-100 bzw. 0-1), `stop`, Produkt-Index | Häufig für Dachfenster, aber auch Rolläden derselben Gateways | ✅ (nur 0-100-Skala; 0-1-Gateways vorher per Alias/Skript umrechnen) |
| EnOcean (`ioBroker.enocean`) | `drivers/enocean-driver.ts` | Rollladenaktor-Kanal mit `LEVEL`/`position` bzw. Auf/Ab-Telegramme | Batterielose Aktoren/Taster, verbreitet in Bestandsbauten | ✅ (nur Positions-Variante; reine Auf/Ab-Telegramm-Aktoren ohne Positions-Feedback → `generic-relay` verwenden) |
| Velbus (`ioBroker.velbus`) | `drivers/velbus-driver.ts` | Blind-Kanal `position`/`status`, `up`/`down`/`stop` | Verbreitet in BE/NL-Installationen | ✅ (nur Module mit Positions-Unterstützung; einfache Auf/Ab/Stopp-Module ohne Position → `generic-relay` verwenden) |
| Loxone (über `ioBroker.loxone`) | `drivers/loxone-driver.ts` | Jalousie-Baustein-States: `position`/`up`/`down`/`shade`, ggf. `info` für Ist-Position | Loxone bildet Jalousie-Bausteine als eigene States mit `up`/`down` (impuls) + Positions-Rückmeldung ab; Stopp meist über gleichzeitiges Zurücknehmen von `up`/`down` | ✅ (`shade`/Lamellenwinkel noch nicht umgesetzt, siehe 2a.5) |
| Homey (über `ioBroker.homey` bzw. MQTT-Bridge) | `drivers/homey-driver.ts` | Capability-State `windowcoverings_state`/`windowcoverings_set` | Optionaler Nachtrag, gleiches Muster wie Shelly/Zigbee | ✅ |
| Generisches MQTT-Cover (z. B. Tasmota, ESPHome, Home Assistant über MQTT) | `drivers/mqtt-driver.ts` | Konfigurierbares Topic-Paar: Kommando-Topic (Position/OPEN/CLOSE/STOP) + Status-Topic, meist über `ioBroker.mqtt`/`ioBroker.mqtt-client` als States gespiegelt | State-IDs sind Topic-abhängig und daher frei konfigurierbar statt fest benannt | ✅ (ein gemeinsames Kommando-Topic für Position und OPEN/CLOSE/STOP, wie im Plan beschrieben) |
| Generisches Auf/Zu/Stopp-Relais | `drivers/generic-relay-driver.ts` | 3 boolesche States (auf/zu/stopp), keine Positionsrückmeldung | Position wird intern über Laufzeit-Timer geschätzt (`position-mapping.ts` + Zeitmessung) | ✅ |
| Generischer Positions-Antrieb | `drivers/generic-position-driver.ts` | 1 numerischer Ziel-State + 1 numerischer Ist-State | Fallback für alles, was schon 0-100 liefert und nimmt | ✅ |

### 2a.3 Driver-Factory & Konfiguration ✅

- `drivers/driver-factory.ts`: `createDriver(adapter, config: IShutterConfig): IShutterDriver` — wählt anhand `config.driverType` die passende Implementierung, injiziert die in der Admin-UI hinterlegten Fremd-State-IDs.
- Jeder Rolladen (`shutter_NNN`) bekommt in der nativen Config ein Feld `driverType` (Dropdown: homematic / hmip / knx / shelly / zigbee / zigbee2mqtt / tuya / somfy / velux / enocean / velbus / loxone / homey / mqtt / generic-relay / generic-position) + ein Set von State-ID-Feldern, die je nach gewähltem Typ im Admin-UI dynamisch ein-/ausgeblendet werden (per eigenem JS in `admin/shutters.js`, DOM-Sichtbarkeit statt JSONConfig `hidden`-Ausdruck, siehe Abschnitt 9).
- Alle States fremder Instanzen werden über `adapter.subscribeForeignStatesAsync(id)` abonniert; Schreibzugriffe über `adapter.setForeignStateAsync(id, value, false)`.
- `shutter-controller.ts` kennt nur `IShutterDriver`, nie die konkrete Fremdsystem-Logik — dadurch ist die Erweiterung um weitere Systeme später ein reiner Zusatz-Driver ohne Änderung an Scheduler/Sonnenschutz/Regenschutz/Automation.
- Neue Systeme lassen sich ohne Breaking Change ergänzen: neuer Driver + Eintrag in Dropdown + i18n-Label.

### 2a.4 Priorisierung der Driver-Implementierung (nach Verbreitung) ✅ (alle Sets fertig)

Reihenfolge für M1b (siehe Abschnitt 10), grob nach Verbreitung/Nachfrage in der ioBroker-Community gestaffelt:

1. **Kern-Set (hohe Priorität)**: `generic-position`, `generic-relay` (immer benötigter Fallback), `homematic`, `knx`, `shelly`, `zigbee`.
2. **Erweiterungs-Set (mittlere Priorität, hohe Verbreitung)**: `tuya`, `somfy`, `hmip`, `zigbee2mqtt`, `mqtt`.
3. **Nachtrag-Set (nachgefragt, aber kleinere Nutzerbasis)**: `velux`, `enocean`, `loxone`, `velbus`, `homey`.

Die eigentliche Reihenfolge richtet sich nach den vom Nutzer tatsächlich eingesetzten Systemen im eigenen Haus (siehe offene Fragen, Abschnitt 11).

### 2a.5 Behangtyp-Unterscheidung (Rolladen vs. sonstiger Behang) ✅ (`coveringType` als Config-Feld; `covering-types.ts` mit `safePosition()`/`protectedPosition()` für Wind-/Regenschutz, siehe 7a/7; `setTilt()`/`getCurrentTilt()` in `PositionStopDriverBase` für alle Position+Stop-Driver, Admin-UI-Feld für raffstore/lamellen)

Der Adapter unterscheidet pro Einheit einen konfigurierbaren **Behangtyp** (`coveringType`), da sich Sicherheitslogik und Zielsemantik zwischen den Typen teilweise unterscheiden oder sogar umkehren — "einfach alles wie einen Rolladen behandeln" führt bei anderen Behangtypen zu fachlich falschem Verhalten (z. B. Windschutz in die falsche Richtung).

**Positions-Konvention (ioBroker-Standard für `role: "level.blind"`)**: `0` = vollständig offen/eingefahren, `100` = vollständig geschlossen/ausgefahren, konsistent für alle Behangtypen. Diese Konvention gilt durchgängig im gesamten Plan; wo vorher "Windschutz fährt auf 100 % (ganz offen)" stand, ist das ein Fehler in der bisherigen Formulierung und wird hiermit korrigiert auf **0 % (ganz offen/eingefahren)** — siehe Korrektur in 7a.

| Behangtyp (`coveringType`) | Positionsbedeutung | Kippwinkel (`tilt`) | Sonnenschutz-Zielrichtung | Windschutz-Zielrichtung | Regenschutz-Zielrichtung |
|---|---|---|---|---|---|
| `rolladen` (Default) | 0 = hochgefahren, 100 = heruntergefahren | nicht vorhanden | Richtung 100 (herunterfahren auf Zwischenposition) | Richtung 0 (hochfahren — Behang unten ist im Sturm am anfälligsten) | Richtung 100 (schließen schützt vor Nässe am Fenster) |
| `raffstore` (außenliegender Raffstore, horizontale Lamellen, Höhenfahrt) | wie Rolladen (0/100 Höhe) | zusätzlich 0–100 (Lamellenwinkel), optional je Driver | Richtung 100 **und/oder** Lamellenwinkel anpassen (Lichtlenkung statt nur Höhe) | Richtung 0 **und** Lamellen waagerecht/geschlossen je Herstellerempfehlung (Lamellen sind im Sturm anfälliger als ein geschlossener Rolladenpanzer) | wie Rolladen |
| `markise` (Gelenkarm-/Kassettenmarkise) | 0 = eingefahren, 100 = ausgefahren (Ausfahrweite statt Höhe) | i. d. R. nicht vorhanden (Ausnahme: Neigungswinkel bei manchen Modellen, vorerst nicht im Scope) | Richtung 100 (ausfahren spendet Schatten) | **Richtung 0 (einfahren!)** — bei einer Markise ist die **ausgefahrene** Stellung im Wind gefährlich, nicht die eingefahrene; Windschutz-Schwellwerte müssen für Markisen deutlich niedriger angesetzt werden als für Rolläden, da Markisenstoff/-gestänge wesentlich windempfindlicher ist | **Richtung 0 (einfahren!)** — bei Regen/Hagel soll eine Markise ebenfalls eingefahren werden (Wasseransammlung/Materialschutz), nicht ausgefahren wie ein Rolladen |
| `lamellen` (Lamellenvorhang, vertikale Lamellen, horizontale Fahrbewegung — i. d. R. innenliegend) | 0 = zur Seite gefahren/offen, 100 = quer vor der Fläche zugezogen (horizontaler Fahrweg statt Höhe) | zusätzlich 0–180° Lamellen-Drehwinkel (Rotation der senkrechten Lamellen um die eigene Achse), meist eigener Antrieb/State getrennt vom Fahrweg | Richtung 100 **und/oder** Drehwinkel anpassen (Lichtlenkung); i. d. R. **kein** Windschutz-relevanter Außeneinsatz, da überwiegend innenliegend — Wind-/Regenschutz für diesen Typ meist deaktiviert/irrelevant | i. d. R. nicht relevant (innenliegend, kein Witterungseinfluss) — pro Einheit deaktivierbar statt erzwungen | i. d. R. nicht relevant (innenliegend) — pro Einheit deaktivierbar statt erzwungen |
| *(weitere Typen)* | — | — | — | — | — |

- Die Tabelle ist bewusst **erweiterbar** angelegt: ein weiterer Behangtyp (z. B. Senkrechtbehang außen, Fensterläden/Klappläden, Insektenschutz-Rollo) wird ausschließlich durch einen zusätzlichen Eintrag in `covering-types.ts` (Positionsbedeutung + drei Zielrichtungen + ob Tilt/Wind-/Regenschutz überhaupt zutreffen) ergänzt — kein Eingriff in `automation.ts`, `sun-protection.ts`, `wind-protection.ts` oder `rain-protection.ts` nötig, da diese ausschließlich die aufgelöste logische Zielposition verwenden (siehe unten). Neue Typen sind damit ein reiner Konfigurationsdaten-Zusatz, kein Architektur-Umbau.

- Konsequenz für die Prioritätslogik (Abschnitt 8) und die Schutzmodule (7a Windschutz, 7 Regenschutz): jedes Modul ermittelt intern nicht mehr "fahre auf 0 %"/"fahre auf 100 %" als Literal, sondern eine typabhängige **logische Zielrichtung** (`safePosition(coveringType)` bzw. `protectedPosition(coveringType)`), die je `coveringType` aus der obigen Tabelle aufgelöst wird — inklusive der Möglichkeit, dass ein Schutzmodul für einen Typ (z. B. Windschutz bei `lamellen`) komplett `null`/deaktiviert liefert. Die Regel-Module selbst bleiben unverändert, nur die Übersetzung "Sicherheitszustand → konkreter Prozentwert (oder: nicht anwendbar)" wird pro Behangtyp zentral in `covering-types.ts` hinterlegt. ✅ `safePosition()`/`protectedPosition()` sind implementiert und in `automation.ts` für Windschutz (7a) bzw. Regenschutz (7) eingebunden — behebt einen zuvor bestehenden Fehler, bei dem eine `markise` ohne explizit gesetzten `rainTargetPercent` vom Regenschutz auf 100 % (ausgefahren) statt 0 % (eingefahren) gefahren wurde. Die "deaktiviert für einen Typ"-Möglichkeit (z. B. Windschutz bei `lamellen`) ist weiterhin nur über `windProtectionEnabled`/`frostProtectionEnabled`-Defaults gelöst (`defaultOutdoorProtectionEnabled()` in `automation.ts`), nicht über einen `null`-Rückgabewert der Positions-Funktionen selbst.
- Kalibrierung (Abschnitt 4) gilt unverändert für `rolladen`, `raffstore` und `lamellen` (Fahrweg-Laufzeit-Kurve, bei `lamellen` horizontal statt vertikal); bei `markise` beschreibt die Kurve stattdessen Ausfahrweite statt Behanghöhe — Begriff im Admin-UI dafür kontextabhängig anpassen ("Behanghöhe" vs. "Ausfahrweite" vs. "Fahrweg").
- `IShutterDriver` (2a.1) wird um ein optionales `setTilt(anglePercent: number): Promise<void>`/`getCurrentTilt(): number | undefined` ergänzt (relevant für `coveringType: "raffstore"` und `"lamellen"`, bei letzterem mit größerem Wertebereich für die Drehwinkel-Skalierung); Default-Implementierung für alle anderen Driver: no-op bzw. `undefined`. Das Interface bleibt für `rolladen`/`markise` unverändert nutzbar (kein Breaking Change). ✅ Umgesetzt zentral in `PositionStopDriverBase` (siehe 2a.2) — jeder der elf darauf basierenden Driver (homematic/hmip/knx/shelly/zigbee/zigbee2mqtt/somfy/velux/enocean/velbus/homey) unterstützt Tilt automatisch über ein optionales zweites Fremd-State-Paar (`states.tilt`/`states.tiltActual`, per `driver-factory.ts` durchgereicht), ohne treiberspezifischen Zusatzcode. `generic-position`/`generic-relay`/`tuya`/`mqtt`/`loxone` implementieren `setTilt`/`getCurrentTilt` weiterhin nicht (bleiben `undefined` gemäß Interface-Vertrag) — für diese Systeme ist Tilt-Steuerung derzeit out of scope, da keiner davon in der Praxis mit Raffstore/Lamellenvorhang assoziiert ist. `ShutterController` legt `tilt`/`tiltActual`-States nur an, wenn `states.tilt` konfiguriert ist (`commandTilt()`, `refreshPosition()`), mit `max: 180`/Einheit `°` für `lamellen` statt `max: 100`/`%` für `raffstore`.
- Admin-UI: `coveringType`-Dropdown pro Einheit (Rolladen/Raffstore/Markise/Lamellenvorhang/…), das abhängig vom gewählten Typ passende Begriffe/Zusatzfelder ein-/ausblendet. ✅ Kippwinkel-State-ID-Feld (`stateTilt`/`stateTiltActual`) für Raffstore/Lamellenvorhang implementiert. ⚠️ Weiterhin offen: niedrigere Default-Windschwellwerte bei Markise, Wind-/Regenschutz-Panel standardmäßig ausgeblendet/deaktiviert bei Lamellenvorhang.
- Aus dem Objektbaum (Abschnitt 3) wird der Container künftig als "Behang"/"covering" statt ausschließlich "Rolladen" verstanden — die technischen State-IDs (`shutters.*`) bleiben aus Kompatibilitätsgründen wie geplant benannt, aber `common.name`/i18n-Labels sind je `coveringType` entsprechend zu beschriften ("Rolladen Wohnzimmer", "Markise Terrasse", "Lamellenvorhang Wintergarten").
- Vorhänge im klassischen Sinn (reine Faltenstoff-Gardinen ohne Lamellen) sind **explizit nicht Teil dieses Konzepts** und bleiben außerhalb des Scopes — die Tabelle deckt nur motorisierte Sonnenschutz-/Verdunklungssysteme mit definierter Prozent-Position (Höhe oder Fahrweg) ab, nicht reine Stoffbahnen ohne klar messbare Endposition.

## 2b. Autoscan / Auto-Discovery der Rolläden ✅ (Erkennung siehe 2b.2; UI-Integration mit Fortschritt + Vorschau/Bestätigung, siehe 2b.3)

Analog zu `scanForValves` im irrigation-Adapter (`src/lib/valvescanner.ts`): der Adapter soll vorhandene Rolläden in bekannten Fremdsystemen automatisch im Objektbaum finden und als Vorschlagsliste für die Admin-Tabelle liefern, statt dass der Nutzer jede State-ID manuell eintragen muss.

### 2b.1 Modul & Signatur ✅ (als `shutter-scanner.ts`, Signatur leicht abweichend)

- Neues Modul `src/lib/shutterscanner.ts`, Struktur/Signatur analog zum Vorbild:

```typescript
// src/lib/shutterscanner.ts
export type ShutterScanType =
    | 'Homematic'
    | 'HomematicIP'
    | 'KNX'
    | 'Shelly'
    | 'Zigbee'
    | 'Zigbee2MQTT'
    | 'Tuya'
    | 'Somfy'
    | 'Velux'
    | 'EnOcean'
    | 'Velbus'
    | 'Generic'
    | 'All';

export interface ScanResult {
    shutters: IShutterConfig[];
    errors: string[];
}

export type ScanProgressCallback = (message: string) => void;

export async function scanForShutters(
    adapter: ioBroker.Adapter,
    type: ShutterScanType,
    instance: string,
    locationId?: string,
    onProgress?: ScanProgressCallback,
): Promise<ScanResult>;
```

- `type: "All"` iteriert wie im Vorbild über alle spezialisierten Scans und hängt die Ergebnisse zusammen; ein per-Adapter-Instanz-Scan (`instance`) ist ebenfalls möglich, wenn der Nutzer z. B. nur eine bestimmte `hm-rpc.0`-Instanz durchsuchen will.
- Jeder gefundene Treffer liefert direkt ein passendes `IShutterConfig`-Fragment inkl. `driverType` und den erkannten State-IDs, das der Nutzer in der Admin-UI nur noch bestätigen/benennen muss (Name, Ausrichtung, Bereich sind danach händisch zu ergänzen, da sie nicht aus dem Objektbaum ableitbar sind).

### 2b.2 Erkennungsstrategie je System ✅ (10 von 11 Systemen erkannt; nur generisches MQTT bewusst ausgenommen, siehe Status-Spalte)

| System | Erkennungsmerkmal | Ableitung `driverType` | Status |
|---|---|---|---|
| Homematic (HM-RPC/HmIP über CCU) | Kanal-Rolle/`common.role` `"level.blind"` bzw. Funktions-Enum `enum.functions.*` mit "Rollladen"/"Blind"/"Shutter" im Namen; States `LEVEL` + `STOP` im selben Kanal | `homematic` | ✅ |
| Homematic IP Cloud (`ioBroker.hmip`) | `common.role` `"level.blind"` unter `hmip.*`, Channel-Typ `SHUTTER_CONTACT`/`ShutterActuator`, State `shutterLevel` | `hmip` | ✅ |
| KNX | `common.role` `"level.blind"` an KNX-Instanz-Objekten, oder DPT-Metadaten (`native.dpt` 5.001/1.008) an Positions-/Stopp-GAs | `knx` | ✅ |
| Shelly | Objektpfad `shelly.*.Cover` bzw. State-Namen `Cover.Pos`/`Cover.Open`/`Cover.Close` unterhalb einer Shelly-Instanz | `shelly` | ✅ |
| Zigbee (`ioBroker.zigbee`) | `common.role` `"level.blind"` unter `zigbee.*`, State-Namen `position`/`current_position` + `state` mit Werten OPEN/CLOSE/STOP | `zigbee` | ✅ |
| Zigbee2MQTT (`ioBroker.zigbee2mqtt`) | `common.role` `"level.blind"` unter `zigbee2mqtt.*`, gleiche State-Namenskonvention wie Zigbee | `zigbee2mqtt` | ✅ |
| Tuya (`ioBroker.tuya`) | Objektpfad `tuya.*`, DP-States `percent_control`/`percent_state`/`control` (dediziertere Namens-Endungs-Erkennung statt `common.role`, da Tuya-DPs meist ohne `level.blind`-Rolle sind; toleriert DP-Nummer-Präfixe wie `1_percent_control`) | `tuya` | ✅ |
| Somfy (`ioBroker.tahoma`) | `common.role` `"level.blind"` unter `tahoma.*` (Annahme, ungetestet gegen echtes System) | `somfy` | ✅ (nur Rollen-basiert; die im Plan genannte Gerätetyp-Zusatzprüfung "io:RollerShutter" nicht umgesetzt) |
| Velux (`ioBroker.velux`/`ioBroker.klf200`) | `common.role` `"level.blind"` unter `velux.*`/`klf200.*` (Annahme, ungetestet gegen echtes System) | `velux` | ✅ |
| EnOcean (`ioBroker.enocean`) | `common.role` `"level.blind"` unter `enocean.*` | `enocean` | ✅ (nur Rollen-basiert; die im Plan genannte EEP-Profil-Erkennung nicht umgesetzt) |
| Velbus (`ioBroker.velbus`) | `common.role` `"level.blind"` unter `velbus.*` (Annahme, ungetestet gegen echtes System) | `velbus` | ✅ |
| Loxone (`ioBroker.loxone`) | Namens-Endungen `up`/`down` (+ optional `position`/`info`) unter `loxone.*` | `loxone` | ✅ |
| Homey (Bridge-abhängig) | Namens-Endung `windowcoverings_set`, in beliebigem Namespace | `homey` | ✅ |
| Generisches MQTT-Cover | — | `mqtt` | ❌ bewusst nicht umgesetzt: Topic-Namen sind per Definition frei konfigurierbar, nicht musterbar (siehe `mqtt-driver.ts`) |
| Generic (Fallback) | Beliebige Instanz mit einem numerischen State `common.role` `"level.blind"` (Position) **oder** drei booleschen States mit Rollen `"button.open"`/`"button.close"`/`"button.stop"` im selben Channel | `generic-position` bzw. `generic-relay` | ✅ |

- Erkennung primär über `common.role` (robust, herstellerunabhängig) und ergänzend über Funktions-Enum `enum.functions.*` (z. B. "Rollladen", "Beschattung"), analog zur Homematic-Erkennung via `enum.functions.*` im irrigation-Vorbild.
- `FORBIDDEN_SCAN_ADAPTERS` (`admin`, `alias`, `linkeddevices`, `javascript`; die eigene Instanz wird zusätzlich per Namespace-Präfix ausgeschlossen) werden nie gescannt, um Duplikate/Rekursion zu vermeiden.
- Tuya/Loxone/Homey nutzen keine `common.role`-basierte Erkennung (siehe Tabelle), sondern dedizierte Namens-Endungs-Scans; Tuya/Loxone sind zusätzlich auf ihren jeweiligen Namespace (`tuya.*`/`loxone.*`) beschränkt, um Falschtreffer durch zufällig gleich benannte States anderer Systeme zu vermeiden — Homey läuft bewusst namespace-unabhängig, da Bridge-Integrationen stark variieren.
- Mehrfacherkennung (z. B. ein Kanal passt sowohl auf Rollen- als auch auf Enum-Kriterium) wird über die gefundene Covering-ID dedupliziert.
- Alle Annahmen zu Rollenkonventionen für hmip/somfy/velux/enocean/velbus konnten nicht gegen ein echtes System verifiziert werden (kein Testzugang); eine falsch erkannte oder nicht erkannte Abdeckung lässt sich jederzeit manuell in der Admin-UI korrigieren.

### 2b.3 Admin-UI-Integration ✅ (echter Fortschritts-Callback + Vorschau/Bestätigung; kein `type`-Filter/Ziel-Instanz-Auswahl — Scan läuft immer vollständig über alle Systeme)

- Button "Rolläden suchen" (Materialize-Button in `admin/index_m.html` + `sendTo()`-Aufruf in `admin/shutters.js`, siehe Abschnitt 9) startet `scanForShutters` **ohne** Parameter — es gibt bewusst keine `type`-Dropdown-/Ziel-Instanz-Auswahl (jeder Scan durchsucht immer alle Systeme/Instanzen gleichzeitig; eine frühere Planversion sah hier optional eine Eingrenzung vor, das wurde nicht umgesetzt und ist auch nicht als Lücke zu werten, da eine Vollscan ohnehin schnell ist).
- Fortschrittsmeldungen (`ScanProgressCallback`, `shutter-scanner.ts`) werden während des Scans live angezeigt: der Backend-Handler schreibt jede Phase (`"Fetching object list..."`, `"Scanning for coverings with a level.blind/button role..."`, `"Scanning Homematic \"Verschluss\" channels..."`, `"Resolving generic relay candidates..."`, `"Scanning Tuya/Loxone/Homey candidates..."`, `"Scan complete."`) in `info.scanProgress` (`ack=true`); die Admin-UI abonniert diesen State direkt über die admin-eigene Socket.io-Verbindung (`subscribeScanProgress()`, `admin/shutters.js`), unabhängig vom laufenden `sendTo`-Request, und zeigt die Meldungen live an.
- Ergebnisliste wird dem Nutzer als Vorschau präsentiert (`renderScanPreview()`, `admin/shutters.js`): pro Treffer eine vorausgewählte Checkbox, ein editierbares Namensfeld, der erkannte `driverType` und die gefundenen Fremd-State-IDs zur Kontrolle. Erst der Klick auf "Ausgewählte Rolläden hinzufügen" sendet die ausgewählten (ggf. umbenannten) Treffer per separatem `applyScannedShutters`-Kommando; nur das übernimmt sie tatsächlich in `native.shutters[]` (löst wie jede Config-Änderung den üblichen Adapter-Neustart aus). `scanForShutters` selbst verändert die Konfiguration nicht mehr.
- Scan-Fehler pro System (z. B. Instanz nicht erreichbar) werden gesammelt und im Ergebnis als `errors: string[]` an die UI zurückgegeben und in der Vorschau angezeigt, ohne den gesamten Scan abzubrechen.

## 3. Objekt-Hierarchie (Entwurf) ⚠️ (Kern-States vorhanden; viele Schutz-/Diagnose-States existieren nur intern, nicht als sichtbare ioBroker-States — siehe Markierungen)

```text
shutters.0
├── shutters
│   ├── shutter_000
│   │   ├── position           (number 0-100, ack=false → Kommando "Zielhöhe Behang %")                                    ✅
│   │   ├── positionActual     (number 0-100, ack=true, gemappte Ist-Behanghöhe)                                           ✅
│   │   ├── positionRaw        (number 0-100, ack=true, rohe Antriebsposition/Laufzeit%)                                   ✅
│   │   ├── state              (number, role=level.blind, ack=true; 0=open,1=closed,2=moving)                              ❌
│   │   ├── open                (boolean, ack=false, Button "ganz auf")                                                    ✅
│   │   ├── close                (boolean, ack=false, Button "ganz zu")                                                    ✅
│   │   ├── stop                (boolean, ack=false, Button)                                                               ✅
│   │   ├── calibrate            (boolean, ack=false, Button: Kalibrierungslauf)                                           ✅
│   │   ├── orientation         (number, ack=true, Fensterausrichtung in Grad, aus Config)                                 ❌ nur `native`-Config, kein State
│   │   ├── area                (string, ack=true, Bereichs-/Zonenname, z.B. "Kinderzimmer")                               ❌ nur `native`-Config, kein State
│   │   ├── driverType          (string, ack=true, z.B. "homematic"|"hmip"|"knx"|"shelly"|"zigbee"|"zigbee2mqtt"|"tuya"|"somfy"|"velux"|"enocean"|"velbus"|"loxone"|"homey"|"mqtt"|"generic-relay"|"generic-position") ❌ nur `native`-Config
│   │   ├── coveringType        (string, ack=true, z.B. "rolladen"|"raffstore"|"markise"|"lamellen"|weitere, siehe 2a.5)   ❌ nur `native`-Config
│   │   ├── tilt                (number 0-100 bzw. 0-180° bei "lamellen", ack=false, nur relevant bei coveringType "raffstore"/"lamellen", sonst nicht angelegt; unkalibriert, direkt an den Fremd-State durchgereicht — anders als `position` keine Kalibrierkurve, da ein Kippwinkel i. d. R. keine "Laufzeit ≠ Winkel"-Diskrepanz hat) ✅
│   │   ├── tiltActual          (number, ack=true, unkalibrierter Ist-Kippwinkel, nur relevant wie oben)                   ✅
│   │   ├── sunProtectionActive (boolean, ack=true)                                                                        ❌ nur interner Zustand in `automation.ts`
│   │   ├── sunProtectionOverrideUntil (string ISO / number ts, ack=true, gesetzt bei manueller Bedienung während aktivem Sonnenschutz; gültig bis lokal 24:00 desselben Tages) ✅ persistiert (number ts, ack=true) und beim Adapter-Start wiederhergestellt (siehe 9a.2)
│   │   ├── rainProtectionActive(boolean, ack=true)                                                                        ❌ nur lokale Variable
│   │   ├── windProtectionActive(boolean, ack=true, aktuell tatsächlich wirksam)                                           ❌ nur interner Zustand
│   │   ├── windProtectionEnabled(boolean, ack=false, Konfigurationsschalter — Default abhängig von coveringType, siehe 7a/2a.5) ❌ nur `native`-Config-Feld, kein State
│   │   ├── frostProtectionActive(boolean, ack=true, aktuell tatsächlich wirksam)                                          ❌ nur lokale Variable
│   │   ├── frostProtectionEnabled(boolean, ack=false, Konfigurationsschalter — Default abhängig von coveringType, siehe 7b/2a.5) ❌ nur `native`-Config-Feld
│   │   ├── doorProtectionActive(boolean, ack=true)                                                                        ❌
│   │   ├── nightCoolingActive (boolean, ack=true, aktuell tatsächlich wirksam)                                            ❌ nur interner Zustand (siehe 7c)
│   │   ├── nightCoolingEnabled(boolean, ack=false, Konfigurationsschalter, Default false)                                 ❌ nur `native`-Config-Feld, kein State (siehe 7c)
│   │   ├── automationEnabled   (boolean, ack=false, Zone/Rolladen aus Automatik nehmen)                                   ✅
│   │   ├── statusText          (string, ack=true, menschenlesbarer Grund für aktuellen Zustand, z.B. "Sonnenschutz aktiv (bis 18:30)"; expert:false — einziger für Endnutzer primär relevanter Diagnose-State, siehe 10a.1) ✅
│   │   ├── watchdogLastIssue   (string, ack=true, expert:true, letzte erkannte "Antrieb reagiert nicht"-Meldung)          ✅
│   │   ├── watchdogIssueCount  (number, ack=true, expert:true, fortlaufender Zähler)                                      ✅
│   │   ├── pendingMoveTargetPercent (number, ack=true, expert:true, -1 = kein laufender Fahrbefehl, siehe 9a.2)           ✅
│   │   └── pendingMoveIssuedAt (number, ack=true, expert:true, ms-Zeitstempel des laufenden Fahrbefehls, siehe 9a.2)      ✅
│   └── shutter_NNN ...
├── groups
│   ├── group_000
│   │   ├── name        (string, ack=true)                                ❌ nur `common.name` des Channel-Objekts
│   │   ├── members      (string/JSON-Array Shutter-IDs, ack=true)         ❌ nur Config (`memberIds`), kein State
│   │   ├── position     (number, ack=false, setzt alle Mitglieder)        ✅
│   │   └── openAll/closeAll (boolean, ack=false, Buttons)                 ✅
├── quickActions
│   ├── allOpen          (boolean, ack=false, Button "Alle auf")           ✅
│   └── allClose         (boolean, ack=false, Button "Alle zu")            ✅
├── astro
│   ├── twilightEnd      (string ISO, ack=true)                           ❌ nur intern in twilight.ts/scheduler.ts
│   ├── isHeatingPeriod  (boolean, ack=true)                               ❌
├── weather
│   ├── cloudCover       (number %, ack=true)                              ❌ WeatherSource liest nur Fremd-States, legt keine eigenen an
│   ├── rain              (boolean, ack=true)                              ❌
│   ├── windSpeed        (number km/h, ack=true)                          ❌
│   ├── windDirection    (number °, ack=true)                              ❌
│   └── sunElevation/Azimuth (number, ack=true)                           ❌
└── info
    └── connection (boolean, ack=true)                                    ✅
```

Zusätzlich vorhanden, aber im Plan nicht aufgeführt: `info.lastScanResult`/`info.scanProgress` (Autoscan-Ergebnis/-Fortschritt, siehe 2b.3), `info.lastSeasonalReminderYear` (siehe 10a.14), `shutters.<id>.activityLog` (siehe 10a.8), `scenes.<id>.activate` (siehe 9b).

- `device` = einzelner Rolladen (`shutter_NNN`) bzw. Gruppe; `channel` optional für `status`/`config`; `state` wie oben.
- Bereichs-/Feiertagslogik nicht als eigene Objekt-Ebene, sondern über `native`-Konfiguration (Admin-Tabelle) + abgeleitete States.

## 4. Kalibrierung Behanghöhe → Laufzeit (Punkt 2) ✅ (nur der geführte Kalibrierlauf per `calibrate`-Button ist noch nicht implementiert, siehe `shutter-controller.ts` — bislang nur Log-Warnhinweis)

- Pro Rolladen: konfigurierbare Kalibrierungskurve, mind. 2 Stützpunkte (z. B. "0–20 % Behang = 0–5 % Laufzeit", "20–100 % Behang = 5–100 % Laufzeit"), linear interpoliert zwischen Stützpunkten.
- Admin-Tabelle `curvePoints: { behangPercent, laufzeitPercent }[]`.
- `calibrate`-Button löst geführten Kalibrierlauf aus (Rolladen ganz zu → ganz auf, Zeitmessung), Ergebnis schlägt Stützpunkte vor (analog `calibrateFlow` im irrigation-Adapter).
- `position-mapping.ts`: reine Funktionen `behangToLaufzeit(pct, curve)` / `laufzeitToBehang(pct, curve)`, unit-testbar.

## 5. Zeitsteuerung (Punkt 3 & 4) ✅ (Wochentag/Wochenende/Feiertag + Dämmerungskopplung + iCal-Integration fertig)

- Basiskonfiguration pro Bereich (Zone): Öffnen-Zeit, Schließen-Zeit, je getrennt für Wochentag/Wochenende/Feiertag.
- iCal-Integration: siehe 5.1 (konkretisiert). ✅
- Dämmerungskopplung: Nutzung von `getAstroDate`/Suncalc (ioBroker Standard) für Sonnenuntergang/Ende-Dämmerung, Offset in Minuten konfigurierbar, pro Zone. ✅
- `scheduler.ts` verwendet ausschließlich `adapter.setTimeout`/`setInterval` (keine Node-Timer, kein `node-schedule`), tägliches Neuberechnen der nächsten Trigger-Zeiten um Mitternacht. ✅

### 5.1 iCal-Integration (konkretisiert) ✅

Übernimmt das Grundprinzip aus dem irrigation-Vorbild (`resolvePlanFromIcalTitle`, siehe `../ioBroker.irrigation/src/lib/scheduler.ts`), behebt aber dessen Schwachstelle, dass dort ein zusätzlicher, vom Nutzer selbst per Skript zu pflegender boolescher `icalTriggerState` nötig ist — `shutters` pollt die Kalenderdaten stattdessen selbst.

**Keine eigene .ics-Parsing-Bibliothek.** Wie im irrigation-Vorbild wird das Parsen von `.ics`-Quellen (URL, lokale Datei, Google/Nextcloud-Kalender) vollständig an den offiziellen, separat zu installierenden `ioBroker.ical`-Adapter delegiert. `shutters` liest nur dessen Standard-Output-State `<instance>.data.table` (JSON-Array von Terminen mit u. a. `event`, `_date`, `_end`) — keine neue npm-Abhängigkeit, kein eigenes RRULE-/Zeitzonen-Handling.

- **Konfiguration (global, nicht pro Zone):** ✅ `icalAdapterInstance`/`icalTitlePrefix` in `IShuttersNativeConfig` (`types.ts`), Admin-UI-Felder im Tab "Bereiche" (`index_m.html`/`shutters.js`).
  - `icalAdapterInstance` (Admin-UI-Feld) — als einfaches Text-Feld umgesetzt (z. B. `"ical.0"`), **nicht** als echter JSONConfig-`type: "instance"`-Auswahldialog, da die Admin-UI dieses Adapters bewusst klassisches Materialize statt JSONConfig ist (siehe Abschnitt 9) und daher keinen solchen Picker-Widget-Typ zur Verfügung hat.
  - `icalTitlePrefix` (Text, Default `"Rolläden"`).
  - **Kein** `icalTriggerState`-Feld nötig (Verbesserung ggü. Vorbild, siehe oben) — `shutters` abonniert `<instance>.data.table` selbst per `subscribeForeignStates` (`initIcalIntegration()`, `main.ts`) und liest den State zusätzlich beim Adapterstart aktiv aus.
  - Die eigentliche Kalender-URL/-Datei wird **nicht** im `shutters`-Adapter konfiguriert, sondern in der jeweiligen `ioBroker.ical`-Instanz selbst (das ist deren Aufgabe) — die zuvor in Abschnitt 9 genannte Tabellenspalte "iCal-URL optional" in `areas`/`zones` ist damit hinfällig (siehe Korrektur dort).
- **Titel-Konvention** (eigenständiges Modul `ical.ts`, reine Funktionen, unit-getestet in `ical.test.ts`): `"<Präfix>[: <Bereichsname>] <auf|zu> <HH:MM>"`, z. B.:
  - `"Rolläden auf 07:00"` — überschreibt die Öffnen-Zeit **aller** Bereiche für diesen Tag auf 07:00 Uhr (kein Bereichsname = global).
  - `"Rolläden: Kinderzimmer auf 07:00"` — überschreibt die Öffnen-Zeit **nur** des Bereichs "Kinderzimmer" (analog zum plan-Namen-Matching in `resolvePlanFromIcalTitle`: Bereichsname wird case-insensitive gegen die konfigurierten `areas[].name` gematcht; kein Treffer → Event wird ignoriert statt versehentlich global zu wirken).
  - `"Rolläden: Kinderzimmer zu 20:30"` — überschreibt analog die Schließen-Zeit dieses Bereichs.
  - Getrennte Events für `auf`/`zu` am selben Tag sind möglich (z. B. ein Kalendertermin für die morgendliche, einer für die abendliche Ausnahme); bei mehreren Overrides für dieselbe Bereich/Aktion-Kombination am selben Tag gewinnt der letzte (`applyIcalOverrides`).
  - Trennzeichen zwischen Präfix und Bereichsname wie im Vorbild `:`/`-`/`–`, case-insensitive Prefix- und Keyword-Vergleich (`auf`/`zu`), Zeit im Format `HH:MM` (24h, auch einstellige Stunde).
- **Tagesfilter:** anders als im Vorbild (dort Zeitfenster-Check `now >= start && now < end` für "gerade jetzt aktive" Events) wird hier auf **Kalendertag** gefiltert (`_date` fällt auf den lokalen Tag, für den der Scheduler gerade die Trigger-Zeiten berechnet — i. d. R. heute, beim Mitternachts-Neuberechnen), da diese Termine Tagesausnahmen ankündigen und nicht "gerade laufen" müssen. `resolveIcalOverridesForDay()` akzeptiert `_date` sowohl als ISO-String als auch als numerischen Epoch-Wert und überspringt nicht parsebare/fehlende Werte defensiv, statt abzustürzen. **Weiterhin ungeklärt** (siehe Abschnitt 11): wie `ioBroker.ical` **ganztägige** Termine in `_date`/`_end` exakt abbildet — mangels realer `ioBroker.ical`-Instanz zum Testen bislang nicht gegen echte Daten verifiziert (im irrigation-Vorbild ebenfalls ungetestet/ungeklärt).
- **Fehlerbehandlung:** analog Vorbild — `try/catch` um `JSON.parse` (`parseIcalTable()`, `main.ts`), `log.warn` bei Fehlern, Fallback ist der reguläre Wochentag/Wochenende/Feiertag-Tagesdefault (Abschnitt 5) ohne Override; kein zusätzlicher `info.icalError`-State, um die State-Oberfläche nicht unnötig zu vergrößern (10a.1-Prinzip).
- **Priorität ggü. anderen Ausnahmen:** ein iCal-Override ersetzt für den betroffenen Tag/Bereich ausschließlich den Zeitplan-Zieltermin (Abschnitt 8, Schritt 6) — Regenschutz, Sonnenschutz, Windschutz, Frostschutz und Türkontakt-Schutz greifen unverändert weiter und können den iCal-Zieltermin wie jeden anderen Zeitplan-Zielwert überstimmen/aussetzen.
- Tests analog Vorbild (`resolvePlanFromIcalTitle`-Testmuster), in `ical.test.ts`/`scheduler.test.ts`: Präfix-Match, alle drei Trennzeichen, Bereichsname-Erkennung/-Fallback bei Nicht-Treffer, `auf`/`zu`-Keyword-Parsing, Groß-/Kleinschreibung, ungültiges/fehlendes Zeitformat bzw. Datum → ignorieren statt Absturz, sowie die Anwendung mehrerer Overrides und deren Integration in `Scheduler.resolveCurrentAction()`.

## 5a. Zentrale Wetterdatenbeschaffung (eigener Sensor) ✅ (kein Wetterdienst-Fallback geplant — ggf. über `ioBroker.multiweather` als Fremd-State abgedeckt)

Sonnenschutz (6), Regenschutz (7), Windschutz (7a), Frostschutz (7b) und Nachtauskühlung (7c) hängen alle von Wetter-Messwerten ab. Statt dass jedes Schutzmodul die Fremd-State-Anbindung einzeln löst, wird die Wetterdatenbeschaffung in einem zentralen Modul `weather-source.ts` gebündelt, das die konfigurierten Fremd-States der eigenen Wetterstation (z. B. `ioBroker.davis`) einheitlich bereitstellt. Ein eigener externer Wetterdienst-Fallback ist nicht Teil dieses Adapters — sofern ein Nutzer keine eigene Wetterstation hat, kann er stattdessen z. B. `ioBroker.multiweather` einsetzen und dessen States wie jeden anderen Fremd-Sensor konfigurieren.

### 5a.1 Benötigte Messwerte (Übersicht) ⚠️ (siehe Status-Spalte je Zeile)

Eine Unterscheidung zwischen "eigenem Sensor" und "Wetterdienst" ist nicht nötig: `weather-source.ts` konsumiert für jeden Messwert ausschließlich eine konfigurierbare Fremd-State-ID, unabhängig davon, ob diese von einer physischen Wetterstation (z. B. `ioBroker.davis`) oder von `ioBroker.multiweather` stammt — Letzterer stellt die Werte wie eine lokale Wetterstation über gewöhnliche States bereit und ist damit für den Adapter nicht von einem eigenen Sensor zu unterscheiden.

| Messwert | Verwendet von | Status |
|---|---|---|
| Solarstrahlung (W/m²) | Sonnenschutz primär (6.1) | ✅ konfigurierbare Fremd-State-ID |
| Bewölkungsgrad (%) | Sonnenschutz-Zusatzkriterium (6.2), Sonnenschutz-alleiniger Auslöser (6.3) | ✅ konfigurierbare Fremd-State-ID (`cloudCoverStateId`) |
| Windgeschwindigkeit + Böenspitze (km/h) | Windschutz (7a) | ✅ konfigurierbare Fremd-State-ID |
| Windrichtung (°) | Regenschutz, optional (7) | ❌ nicht in `IWeatherConfig` |
| Niederschlag (Regen ja/nein bzw. mm) | Regenschutz (7) | ✅ konfigurierbare Fremd-State-ID |
| Außentemperatur (°C) | Frostschutz (7b), Hitzeschutz-Filter (6.5) | ✅ konfigurierbare Fremd-State-ID |
| Luftfeuchte (%) | Frostschutz-Kombikriterium (7b) | ✅ konfigurierbare Fremd-State-ID (`humidityStateId`) |
| Innentemperatur (°C, je Zone) | Nachtauskühlung (7c) — zwingend ein eigener Sensor je Zone, da keine zentrale Wetterquelle (auch nicht `multiweather`) Innenraumtemperaturen liefert | ✅ |

## 6. Sonnenschutz (Punkt 5) ✅ (6.1/6.2/6.3/6.4/6.5 fertig)

Abgleich mit dem realen Vorbild-Skript `Shutters.js` (haus20a): dort wird Sonnenschutz **nicht** über Azimut/Elevation-Berechnung gelöst, sondern pragmatisch über einen **Solarstrahlungs-Schwellwert** (W/m² von einer Wetterstation) plus einem festen, pro Rolladen konfigurierbaren **Tages-Zeitfenster** — das Zeitfenster übernimmt implizit die Funktion der "trifft Sonne aufs Fenster"-Prüfung, ohne Astronomie berechnen zu müssen. Dieser Ansatz ist deutlich einfacher zu konfigurieren und zu debuggen und wird als **primäre Umsetzung für M5** übernommen; die azimut-/elevationsbasierte Variante bleibt als optionale Erweiterung (M5b) bestehen, für Fälle ohne Solarstrahlungssensor oder mit wechselnden Fensterausrichtungen ohne feste Tageszeit-Korrelation.

### 6.1 Primärer Ansatz: Solarstrahlung + Zeitfenster + Hysterese (aus Shutters.js übernommen) ✅

- Eingangsgröße: ein globaler Solarstrahlungs-State (W/m², z. B. `davis.0.sensors.tx1.solarRad` oder Nachfolger — konfigurierbare State-ID, kein Fremdsystem-Zwang).
- Pro Rolladen konfigurierbar (analog `shutters[]` in `Shutters.js`): Zielposition während Sonnenschutz (`sunprotect`, 0–100 Behang-%), Zeitfenster `spStart`/`spEnd` ("HH:MM", inklusive Start/exklusive Ende). Der im Vorbild-Skript hier zusätzlich vorhandene `block`-Türkontakt-Mechanismus wurde zu einer eigenständigen, konsistenteren Schutzfunktion ausgebaut, die auch den Sonnenschutz selbst berücksichtigt — siehe Abschnitt 7e (Türkontakt-Schutz).
- Heizperioden-Ausnahme: statt eines intern berechneten Datumsbereichs wird primär ein **extern gesetzter Boolean-State** (`isSummer`/`isHeatingPeriod`, im Vorbild von einem separaten Skript `HeatingSommerWinter.js` gepflegt) unterstützt und laufend per `subscribeForeignStatesAsync` verfolgt (nicht nur einmal beim Start gelesen — Bugfix aus dem Vorbild explizit übernehmen). Ist kein externer State konfiguriert, ist der Default derzeit "immer Sommer" (`isSummer=true`) — kein interner Datumsbereich-Fallback vorgesehen.
- **Hysterese gegen Flackern** bei wechselnder Bewölkung: Schließen erfolgt sofort ab `sunCloseThreshold` (Default 200 W), Öffnen dagegen erst, wenn die Strahlung **durchgehend** seit `sunOpenMinDurationMs` (Default 10 Min) unter `sunOpenThreshold` (Default 150 W) liegt. Liegt der Wert dazwischen (zwischen Open- und Close-Schwelle, Sperrzeit noch nicht abgelaufen), bleibt der aktuelle Zustand unverändert. Ohne diese Hysterese pendelt der Rolladen bei kurzen Wolkenlücken ständig zwischen Auf/Zu (im Vorbild explizit als Bugfix dokumentiert).
- Außerhalb des konfigurierten Zeitfensters (oder wenn Sonnenschutz/Zeitplan-Automatik global deaktiviert oder `isSummer=false`) wird der Rolladen regulär geöffnet (Zeitplan-Zielwert), nicht in der Sonnenschutzposition gehalten.
- `sun-protection.ts`: zustandsbehaftete Bewertung (wegen der Hysterese **nicht** rein zustandslos wie ursprünglich geplant) — pro Rolladen wird der Zeitpunkt `belowOpenThresholdSince` verfolgt; Funktionssignatur z. B. `evaluateSunProtection(input, hysteresisState): { active: boolean; targetPercent?: number }`.
- Auslösung: sowohl per periodischem Timer-Tick (Fallback, z. B. alle 5 Min) als auch ereignisgetrieben bei Änderung des Solarstrahlungs-States, dort aber auf **eine Auswertung je `sunCheckIntervalMs`** gedrosselt (Default 10 Min, aus dem Vorbild übernommen — Solarstrahlung ändert sich zu häufig für eine ungedrosselte Auswertung pro Adapter-Instanz mit vielen Rolläden).

### 6.2 Optionale Erweiterung: Azimut-/Elevation-basierter Ansatz (M5b) ⚠️ (Azimut/Elevation-Logik fertig — siehe `orientationToleranceMinusDeg`/`orientationTolerancePlusDeg`)


- Für Rolläden ohne feste Tageszeit-Korrelation zur Sonnenscheindauer (z. B. wechselnde Verschattung durch Nachbarbebauung) oder wenn kein Solarstrahlungssensor vorhanden ist.
- Fensterausrichtung (Grad) + Toleranzbereich, Sonnenazimut/-elevation aus Astro-Lib, optional Wolkenbedeckung (Wetter-API/Sensor) als zusätzliches Kriterium statt der direkten Strahlungsmessung.
- Regel: aktiv, wenn (a) Sonne auf Fenster trifft (Azimut ± Toleranz UND Elevation > Schwellwert), (b) nicht Heizperiode, (c) Wolkenbedeckung < Schwellwert.
- Wolkenbedeckung: sofern verfügbar, direkt den bereits berechneten `cloudCover`-State aus `ioBroker.davis` (`lib/cloudcover.ts`, Modell A "solar" bei Tag, Fallback-Heuristik über Taupunkt-Depression bei Nacht/Dämmerung) als konfigurierbare Fremd-State-ID verwenden, statt selbst eine Klarhimmel-Referenz zu berechnen — spart Doppelarbeit, da dieser State genau dafür existiert. Ist keine `cloudCover`-Fremd-State-ID konfiguriert, bleibt dieses Zusatzkriterium inaktiv (keine eigene Berechnung als Fallback).
- **Bewusst nicht** als Ersatz für die Solarstrahlungs-Schwellwerte in 6.1: `cloudCover` normiert die Messung gegen die theoretische Klarhimmel-Strahlung beim aktuellen Sonnenstand und sagt damit "wie klar ist der Himmel relativ zum Möglichen", nicht "wie viel Strahlungsleistung trifft real aufs Fenster". Ein wolkenloser Himmel bei niedrigem Sonnenstand (z. B. früh morgens) hätte 0 % Bewölkung, aber kaum reale Heizwirkung — ein reiner Bewölkungs-Schwellwert würde dort fälschlich verschatten, wo die rohe W/m²-Schwelle aus 6.1 korrekt nicht auslöst. `cloudCover` ist daher nur als **Zusatzkriterium in 6.2** sinnvoll (dort ohnehin mit expliziter Elevation-Prüfung kombiniert), nicht als 1:1-Ersatz für 6.1.
- Pro Rolladen wählbar, welcher der beiden Ansätze (6.1 oder 6.2) genutzt wird; beide teilen sich dieselbe Hysterese- und Override-Logik (6.4) und liefern eine Zielposition an dieselbe Prioritätslogik (Abschnitt 8).

### 6.3 Bewölkungsgrad als alleiniger, globaler Auslöser (Ergänzung zu 6.1) ✅

Explizit auf Nutzerwunsch ergänzte dritte Option, unabhängig von 6.2: ein globaler Schalter `sunProtectionCloudCoverTriggerEnabled` (Default `false`), der bei Aktivierung den Sonnenschutz **unabhängig von der Solarstrahlungs-Schwelle aus 6.1** auslöst, sobald der Himmel klar oder überwiegend klar ist.

- Eingang: derselbe optionale `cloudCoverStateId` in `IWeatherConfig` (siehe 5a.1), den 6.2 bereits als Zusatzkriterium vorsah — hier aber als eigenständiger, globaler Auslöser statt als Zusatzkriterium zur Azimut-/Elevation-Prüfung.
- Regel: ist der Schalter aktiv und der aktuelle Bewölkungsgrad liegt bei/unter der konfigurierbaren Schwelle `sunProtectionClearSkyCloudCoverMaxPercent` (Default 40 %, "klar oder überwiegend klar"), wird der Sonnenschutz für eine Einheit aktiv **unabhängig vom aktuellen Strahlungswert/der 6.1-Hysterese** — vorausgesetzt, die übrige Eligibilität (globaler/Einheit-Schalter, Sommer, Zeitplan "offen", Zeit-/Orientierungsfenster, kein Tagessperre-Override, Hitzeschutz-Mindesttemperatur) ist weiterhin erfüllt (`isSunProtectionEligible()` bleibt unverändert Gate für beide Auslösewege).
- Verknüpfung mit 6.1: reines ODER — `sunActive = radiationBasedActive(6.1) || cloudCoverTriggered(6.3)`. Der Bewölkungsgrad-Auslöser hat bewusst **keine eigene Hysterese** (anders als 6.1/7a): Bewölkungsgrad ändert sich träger als eine Momentan-Strahlungsmessung, ein Flacker-Schutz wurde daher nicht für nötig befunden; sinkt der Bewölkungsgrad wieder unter die Schwelle, greift wieder ausschließlich die reguläre 6.1-Bewertung (inkl. deren Hysterese über `wasActive`).
- Deaktiviert (Default) verhält sich der Adapter exakt wie vor dieser Ergänzung — reine Erweiterung, kein Verhaltensunterschied ohne explizites Opt-in.
- Abgrenzung zu 6.2s ursprünglicher Anmerkung ("`cloudCover` bewusst nicht als 1:1-Ersatz für 6.1"): diese Warnung gilt weiterhin für den *unbedingten* Automatik-Fall; 6.3 ist ein explizites, vom Nutzer bewusst aktiviertes Opt-in mit eigener Schwelle, kein impliziter Ersatz.
- `sun-protection.ts`: `isSunProtectionTriggeredByCloudCover(enabled, cloudCoverPercent, clearSkyMaxPercent)`, reine zustandslose Funktion; Verknüpfung mit 6.1 in `automation.ts`, `evaluateCovering()`.
- Admin-UI: Bewölkungsgrad-State-ID im Wetterdaten-Panel (5a.1), Schalter + Schwellwert im Panel "Globale Schwellwerte" (Abschnitt 9), mit Hinweistext in `thresholdsHintText`.

### 6.4 Manueller Override während aktivem Sonnenschutz ("Tagessperre") ✅ (Logik in `automation.ts`; `sunProtectionOverrideUntil` persistiert, überlebt einen Adapter-Neustart — siehe 9a.2)

- Wenn ein Nutzer einen Rolladen manuell bedient (Kommando auf `position`/`open`/`close`/`stop` mit `ack=false`, nicht von der Automatik selbst gesetzt), **während** für diesen Rolladen `sunProtectionActive === true` ist, wird die Sonnenschutzfunktion für **genau diesen Rolladen** deaktiviert, bis lokal **24:00 Uhr desselben Tages**.
- Umsetzung: `automation.ts` setzt bei Erkennung dieses Falls `sunProtectionOverrideUntil` auf Mitternacht (lokale Zeit, `adapter.setTimeout`/tägliches Reset-Timing analog zum Scheduler-Mitternachtslauf) und `sunProtectionActive` sofort auf `false`.
- Solange `now < sunProtectionOverrideUntil`, überspringt `automation.ts` die Sonnenschutz-Prüfung für diesen Rolladen komplett (auch wenn `shouldActivateSunProtection()` weiterhin `true` liefern würde) — Zeitplan und Regenschutz bleiben davon unberührt und funktionieren normal weiter.
- Um Mitternacht (gemeinsamer Reset-Zeitpunkt mit dem täglichen Scheduler-Neuberechnen, siehe Abschnitt 5) wird `sunProtectionOverrideUntil` automatisch gelöscht/zurückgesetzt, Sonnenschutz ist am nächsten Tag wieder regulär aktiv.
- Abgrenzung zum allgemeinen manuellen Override (Abschnitt 8, Punkt 1): jener pausiert die **gesamte** Automatik nur kurzzeitig/bis zum nächsten Zeitplanpunkt; dieser Override betrifft **ausschließlich den Sonnenschutz** dieses einen Rolladens und gilt fest bis 24:00 — beide Mechanismen bestehen nebeneinander (siehe Reihenfolge unten).
- Ein erneutes manuelles Bedienen am selben Tag verlängert die Sperre nicht über 24:00 hinaus (Sperre ist immer "bis Tagesende", nicht "X Stunden ab jetzt").
- Regenschutz ist von dieser Sperre **nicht** betroffen — bei akutem Regen soll der Rolladen trotz aktiver Sonnenschutz-Tagessperre weiterhin vor Nässe geschützt werden.

### 6.5 Temperaturabhängige Steuerung (Hitzeschutz) ✅

Ergänzung gegenüber dem Vorbild-Skript (dort nur Solarstrahlung + Zeitfenster, keine Temperaturbetrachtung): ein Filter gegen unnötige Verschattung an hellen, aber kühlen Tagen.

- Optionaler Schwellwert `sunProtectionMinTemp` (pro Rolladen, z. B. 20 °C, Außentemperatur-Quelle wie bereits für Heizperioden-Erkennung genutzt, siehe 6.1). Sonnenschutz (6.1/6.2) wird nur aktiv, wenn **zusätzlich** zur Solarstrahlungs-/Azimut-Bedingung diese Temperaturschwelle erreicht ist — umgesetzt als `isHeatProtectionMinTempSatisfied()` (`sun-protection.ts`), zusätzliches Kriterium in `isSunProtectionEligible()`.
- Zweck: an einem klaren, aber kühlen Tag (hohe Strahlung, niedrige Temperatur — z. B. Frühling) besteht keine Überhitzungsgefahr; ohne dieses Kriterium würde rein nach W/m²-Schwellwert trotzdem unnötig verschattet werden, was für den Nutzer wie ein Fehlverhalten wirkt ("warum fährt der Rolladen runter, es ist doch angenehm draußen?").
- Standardmäßig deaktiviert (kein Schwellwert gesetzt = Verhalten wie bisher, nur Strahlung/Zeitfenster maßgeblich), da nicht jeder Nutzer eine zuverlässige Außentemperaturquelle hat. Ist ein Schwellwert gesetzt, aber die Außentemperatur aktuell nicht verfügbar, gilt der Filter bewusst als **nicht erfüllt** (kein Sonnenschutz) statt stillschweigend "warm genug" anzunehmen.

## 7. Regenschutz (Punkt 6) ✅

Hinweis: Im Vorbild-Skript `Shutters.js` ist Regenschutz **nicht** implementiert (nur Zeitplan + Sonnenschutz) — dieser Abschnitt ist eine Neuerung gegenüber dem Vorbild, kein übernommenes Muster.

- Eingang: Regen-Sensor-State-ID (extern verlinkt, `subscribeForeignStates`), optional Windrichtung.
- Regel: bei Regen + Windrichtung auf Fensterseite (± Toleranz wie bei Sonnenschutz) → Rolladen auf konfigurierte Schutzposition fahren (z. B. nicht ganz zu, damit Fensterbank/Rahmen nicht nass wird, oder ganz zu je Fenstertyp — konfigurierbar). Default-Zielposition, sofern `rainTargetPercent` nicht explizit gesetzt ist: `protectedPosition(coveringType)` aus `covering-types.ts` (siehe 2a.5) — 100 % für `rolladen`/`raffstore`/`lamellen`, aber 0 % (einfahren) für `markise`, da eine ausgefahrene Markise selbst die im Regen gefährdete Stellung ist.
- Priorität ggü. Sonnenschutz und Zeitplan: Regenschutz > Sonnenschutz > Zeitplan > manuelle Position (mit `automationEnabled=false` als Override-Escape).
- `rain-protection.ts`: analog Sonnenschutz-Modul, eigene Bewertungsfunktion.

## 7a. Windschutz / Sturmwarnung (Sicherheitsfunktion, höchste Priorität) ✅ (Kernlogik + Hysterese + `windProtectionEnabled` + typabhängige Zielposition über `safePosition()` fertig)

Neuerung gegenüber dem Vorbild-Skript (dort nicht vorhanden), aber fachlich die wichtigste Schutzfunktion, da anhaltender starker Wind Behang und Antrieb mechanisch beschädigen kann — wichtiger als Sonnenschutz oder Zeitplan.

- Eingang: Windgeschwindigkeit-State (z. B. `davis.0.sensors.tx1.windSpeedAvg`/`windGust` aus `ioBroker.davis`, konfigurierbare Fremd-State-ID), optional Windböen-Spitzenwert separat vom Mittelwert.
- Regel: überschreitet die Windgeschwindigkeit (oder Böenspitze) einen konfigurierbaren Schwellwert (`windOpenThreshold`, z. B. 40 km/h für `rolladen`, deutlich niedriger für `markise`, siehe 2a.5), werden alle betroffenen Einheiten **sofort in ihre typabhängige Sicherheitsposition (`safePosition`, siehe 2a.5-Tabelle)** gefahren — bei `rolladen`/`raffstore` ist das **0 % (hochgefahren)**, bei `markise` **ebenfalls 0 %, aber semantisch "eingefahren"** (Korrektur ggü. einer früheren Planversion, die hier fälschlich "100 %" nannte — nach ioBroker-Konvention ist 0 % durchgängig die offene/eingefahrene Stellung). Dies gilt unabhängig vom aktuellen Sonnenschutz-, Regenschutz- oder Zeitplan-Zielwert, da die ausgefahrene/heruntergelassene Stellung im Sturm am anfälligsten ist.
- Hysterese wie beim Sonnenschutz: erneutes Ausfahren/Herunterfahren (Rückkehr zu Sonnenschutz/Zeitplan) erst, wenn die Windgeschwindigkeit **durchgehend** seit `windCalmMinDurationMs` (Default 10–15 Min) unter einem niedrigeren `windCloseAllowedThreshold` liegt, um ständiges Auf/Ab bei böigem Wind zu vermeiden.
- **Explizit pro Einheit ein-/ausschaltbar** (`windProtectionEnabled`, boolean, eigener Konfigurationswert — nicht nur implizit über einen extrem hohen Schwellwert "wegkonfigurierbar"), da die Windrelevanz stark vom Behangtyp (`coveringType`, siehe 2a.5) abhängt:
  - `rolladen`/`raffstore`/`markise`: Default **aktiviert** (`true`) — hier besteht bei Außeneinsatz grundsätzlich ein Sturmrisiko.
  - `lamellen` (i. d. R. innenliegender Lamellenvorhang, siehe 2a.5): Default **deaktiviert** (`false`), da kein Witterungseinfluss besteht; in der Admin-UI entsprechend vorbelegt, aber weiterhin manuell aktivierbar für den seltenen Fall eines außenliegenden Lamellensystems.
  - Zusätzlich weiterhin ein eigener, niedrigerer Schwellwert je Einheit einstellbar (z. B. exponierte Fassadenseite, oder grundsätzlich niedriger bei `coveringType: "markise"`), unabhängig vom Ein/Aus-Schalter.
- Windschutz ist **nicht** manuell durch den 24:00-Override (6.4) unterdrückbar, **sofern aktiviert** — Sicherheitsfunktion hat Vorrang vor Nutzerkomfort; ein manuelles Ausfahren/Zufahren während aktivem Windschutz wird zwar ausgeführt (wie jedes manuelle Kommando), der Windschutz fährt die Einheit aber beim nächsten Tick erneut in die Sicherheitsposition, solange der Schwellwert überschritten ist. Ist `windProtectionEnabled = false`, greift dieser Mechanismus für die betroffene Einheit überhaupt nicht — dann zählt für diese Einheit ausschließlich die reguläre Prioritätslogik ab Schritt 2 (Abschnitt 8).
- Neuer State je Einheit: `windProtectionActive` (boolean, ack=true, tatsächlich aktuell wirksam) sowie `windProtectionEnabled` (boolean, ack=false, Konfigurationsschalter — separat von `windProtectionActive`, da "aktiviert" und "gerade aktiv wirksam" zwei unterschiedliche Dinge sind).
- `wind-protection.ts`: analog zu `sun-protection.ts` mit eigener Hysterese-Zustandsverfolgung; prüft `windProtectionEnabled` als ersten, einfachen Gate vor jeder weiteren Bewertung.

## 7b. Frostschutz ✅

Neuerung gegenüber dem Vorbild-Skript. Verhindert Motorschäden/Festfrieren durch Fahrbefehle bei Vereisungsgefahr.

- Eingang: Außentemperatur-State (z. B. bereits für Heizperioden-Erkennung genutzt, siehe 6.1) und optional Luftfeuchte/Niederschlag zur Erkennung akuter Vereisungsgefahr (Temperatur nahe/unter 0 °C **und** Feuchte/Niederschlag vorhanden — reine Kältetrockenheit ist unkritisch).
- Regel: unterhalb eines konfigurierbaren Schwellwerts (`frostThreshold`, Default 0–2 °C) **in Kombination mit** Feuchte/Regen werden reguläre Fahrbefehle (Zeitplan, Sonnenschutz) verzögert bzw. ausgesetzt, um ein Festfrieren des Behangs in einer Zwischenposition oder am Antrieb zu vermeiden. Bereits offene Rolläden werden nicht zwangsweise geschlossen, bereits geschlossene nicht zwangsweise geöffnet — die aktuelle Position bleibt einfach erhalten.
- Windschutz (7a) hat weiterhin Vorrang vor dem Frostschutz-Aussetzen, falls beide gleichzeitig zutreffen (Sturmschaden ist das größere Risiko als ein einzelner ausgesetzter Fahrbefehl).
- Manuelle Kommandos werden trotz Frostschutz ausgeführt (Nutzer trägt hier bewusst das Risiko), nur die automatisierten Fahrbefehle werden ausgesetzt.
- **Explizit pro Einheit ein-/ausschaltbar** (`frostProtectionEnabled`, boolean, eigener Konfigurationswert, analog zum Windschutz-Schalter in 7a), da Frostrelevanz ebenfalls vom Behangtyp und der Einbausituation abhängt: Default **aktiviert** für `rolladen`/`raffstore`/`markise` (Außeneinsatz, witterungsexponiert), Default **deaktiviert** für `lamellen` (i. d. R. innenliegend, keine Vereisungsgefahr, siehe 2a.5). Ist `frostProtectionEnabled = false`, wird für diese Einheit keine Frostbewertung durchgeführt — automatisierte Fahrbefehle laufen dann unverändert nach der übrigen Prioritätslogik (Abschnitt 8).
- Neuer State je Rolladen: `frostProtectionActive` (boolean, ack=true, aktuell tatsächlich wirksam) sowie `frostProtectionEnabled` (boolean, ack=false, Konfigurationsschalter).
- `frost-protection.ts`: einfache, zustandslose Bewertungsfunktion (kein Hysterese-Bedarf, da kein Flackerproblem wie bei Solarstrahlung/Wind); prüft `frostProtectionEnabled` als ersten, einfachen Gate vor jeder weiteren Bewertung (gleiches Muster wie `windProtectionEnabled` in 7a).

## 7c. Sommer-Nachtauskühlung ✅ (als `night-cooling.ts`)

Neuerung gegenüber dem Vorbild-Skript. Gegenteil des abendlichen Standard-Schließens: nachts gezielt offen lassen/öffnen, um Innentemperaturen abzukühlen.

- Eingang: Innentemperatur-State (raum- bzw. zonenweise, konfigurierbare Fremd-State-ID `nightCoolingIndoorTempStateId` je Rolladen) und Außentemperatur (bereits vorhanden, siehe 6.1/7b).
- Regel: ist die Innentemperatur einer Zone über einem konfigurierbaren Schwellwert (`nightCoolingIndoorMinTemp`, global, Default 24 °C) **und** die Außentemperatur spürbar niedriger (`nightCoolingMinDelta`, global, Default 3 °C kühler) **und** es ist Nacht, werden die betroffenen Rolläden geöffnet (statt das abendliche Schließen auszuführen). ✅ Umgesetzt als "es ist Nacht" = die Zeitplan-Schicht möchte gerade schließen (`scheduleTarget === 100`) — statt eines separat konfigurierten Nachtfensters wird dasselbe, bereits vorhandene Zeitplan-Signal wiederverwendet (`automation.ts`); dadurch entfällt ein zweites, potenziell aus dem Takt laufendes Zeitfenster.
- Nur relevant für Sommer (nutzt denselben `isSummer`-State wie Sonnenschutz, 6.1) und nur pro Zone/Rolladen aktivierbar (z. B. nicht für Schlafzimmer mit Verdunkelungswunsch).
- **Explizit pro Einheit/Zone ein-/ausschaltbar** (`nightCoolingEnabled`, boolean, eigener Konfigurationswert, analog zu `windProtectionEnabled`/`frostProtectionEnabled` in 7a/7b). Anders als Wind- und Frostschutz ist Nachtauskühlung eine reine **Komfortfunktion** ohne Sicherheitsbezug und setzt zusätzlich einen konfigurierten Innentemperatur-Sensor voraus — daher Default **deaktiviert** für **alle** Behangtypen (siehe 2a.5), unabhängig von `coveringType`; der Nutzer aktiviert sie bewusst nur für die Zonen/Rolläden, bei denen nächtliches Öffnen gewünscht und ein Innentemperatur-Sensor vorhanden ist. Ist `nightCoolingEnabled = false` (Default) oder kein Innentemperatur-Sensor konfiguriert, bleibt Schritt 7c für diese Einheit vollständig inaktiv.
- Priorität: niedriger als Windschutz/Regenschutz/Sonnenschutz **und** Frostschutz (Sicherheit/Sicherheitsmechanik geht vor eine reine Komfortfunktion), aber höher als der reguläre abendliche Zeitplan-Schließbefehl, da sie diesen gezielt aussetzt/umkehrt — konkret in `automation.ts`, `evaluateCovering()`, unmittelbar vor dem finalen Zeitplan-Fallback ausgewertet.
- `nightCoolingActive` ⚠️ **nur interner Automations-Zustand** (`ICoveringAutomationState.nightCoolingActive` in `automation.ts`), **kein** echter sichtbarer ioBroker-State — analog zu `windProtectionActive`/`frostProtectionActive`/`rainProtectionActive` (siehe Abschnitt 3) ist dies eine bewusste Vereinfachung ggü. der ursprünglichen Planung, keine separat zu pflegende Diagnose-Oberfläche für jeden internen Aktiv-Flag zu schaffen. `nightCoolingEnabled` ist wie geplant nur ein natives Config-Feld (kein State) — analog zu `windProtectionEnabled`/`frostProtectionEnabled`.
- `night-cooling.ts`: eigene, reine Bewertungsfunktion `evaluateNightCooling()`, unit-getestet in `night-cooling.test.ts`; Aufruf-/Gate-Logik (inkl. `nightCoolingEnabled`-Prüfung) sitzt in `automation.ts`, nicht im Modul selbst.

## 7d. Motorschutz: Mindestpause zwischen Fahrten ✅

Neuerung gegenüber dem Vorbild-Skript. Schützt den Antrieb vor zu häufigem Kurztakten, z. B. durch Grenzfälle in der Sonnenschutz-/Windschutz-Hysterese oder mehrfaches schnelles Nutzer-Tippen.

- Pro Rolladen konfigurierbarer Mindestabstand (`minCommandIntervalMs`, Default `DEFAULT_MIN_COMMAND_INTERVAL_MS` = 8 s) zwischen zwei tatsächlich ausgeführten Fahrbefehlen (Schreibzugriffen auf den Driver), unabhängig davon, welches Modul (Zeitplan, Sonnenschutz, manuell) den Befehl auslöst. Umgesetzt in `gatedDriverCommand()`, `shutter-controller.ts`.
- Befehle, die innerhalb der Sperrzeit eingehen, werden nicht verworfen, sondern der **letzte** angeforderte Zielwert wird gepuffert (`pendingBufferedCommand`) und nach Ablauf der Sperrzeit einmalig per `adapter.setTimeout` nachgeholt (verhindert sowohl Motorverschleiß als auch verlorene Befehle).
- **Ausnahme**: Windschutz (7a) umgeht die Mindestpause über den `bypassMotorProtection`-Parameter (`automation.ts`), da die Sicherheitsreaktion auf Sturm nicht durch einen Motorschutz-Timer verzögert werden darf.
- Umsetzung zentral in `shutter-controller.ts` (nicht in den einzelnen Regel-Modulen), da alle Zielpositions-Quellen über diesen Punkt laufen (siehe Abschnitt 8, letzter Absatz).
- Getestet in `shutter-controller.test.ts`.

## 7e. Türkontakt-Schutz (kein Zufahren bei geöffneter Terrassen-/Balkontür) ✅

Löst die bisher nur im Vorbild-Skript enthaltene, dort auf einen Spezialfall (`h20a_EG_Diele_DoorSensor`) beschränkte `block`-Idee aus 6.1 heraus in eine eigenständige, systematische Schutzfunktion — sinnvoll für jeden Rolladen an einer Terrassen-/Balkontür, nicht nur für einen fest verdrahteten Einzelfall.

- Pro Rolladen optional konfigurierbar: ein Türkontakt-/Fensterkontakt-State (`doorContactId`, boolean, "offen"/"geschlossen"), typischerweise an Terrassen-/Balkontüren, seltener an normalen Fenstern relevant.
- Regel: Solange der verlinkte Kontakt "offen" meldet, wird **jede Aktion, die den Rolladen weiter herunterfahren würde** (Zeitplan-Schließen, Sonnenschutz-Zufahren/Absenken, Regenschutz-Zufahren, ein manuelles Zu-Kommando ausgenommen — siehe unten) unterdrückt. **Öffnende** Aktionen (Zeitplan-Auf, Windschutz-Hochfahren, Nachtauskühlung) sind von der Sperre **nie** betroffen, da Hochfahren bei offener Tür immer unproblematisch ist.
- Ein **manuelles** Zu-Kommando des Nutzers wird trotz offener Tür ausgeführt (der Nutzer sieht ja, dass die Tür offen ist, und trägt hier bewusst die Verantwortung) — die Sperre gilt ausschließlich für automatisierte Fahrbefehle, analog zur Behandlung von Frostschutz (7b) und in Abgrenzung zu Windschutz (7a), das immer Vorrang hat.
- Priorität ggü. den übrigen Schutzfunktionen: **niedriger als Windschutz** (7a öffnet ohnehin nur, kein Konflikt), aber **höher als Regenschutz, Sonnenschutz und Zeitplan** — eine offene Tür ist der eindeutigere/unmittelbarere Sicherheitshinweis als drohender Regen. Praktisch bedeutet das: bei offener Tür bleibt der Rolladen in seiner aktuellen (oder einer zuvor erreichten, weiter offenen) Position stehen, auch wenn Regen- oder Sonnenschutz eigentlich ein Zufahren verlangen würden; sobald die Tür wieder geschlossen wird, wird die zu diesem Zeitpunkt eigentlich gültige Zielposition sofort nachgeholt (kein Warten auf den nächsten Automatik-Tick).
- Ersetzt/verallgemeinert den bisherigen, nur auf den Zeitplan wirkenden `block`-State aus 6.1: dort war die Wirkung auf "Zeitplan-Aktionen unterdrücken" beschränkt und wirkte **nicht** auf den Sonnenschutz (im Vorbild-Skript bewusst so, aber fachlich eine Lücke bei Terrassentüren mit aktivem Sonnenschutz-Zeitfenster). Diese Lücke wird hier geschlossen: der Türkontakt-Schutz gilt konsistent für **alle** automatisierten Zufahr-Aktionen.
- Neuer State je Rolladen: `doorProtectionActive` (boolean, ack=true) sowie in `statusText`/`activityLog` (10a.1/10a.8) sichtbar als eigener Grund, z. B. "Zufahren ausgesetzt: Terrassentür offen".
- `door-protection.ts`: einfache, zustandslose Bewertungsfunktion (kein Hysterese-Bedarf — Türkontakte liefern ein eindeutiges, nicht flackerndes Signal), liefert `blocked: boolean` für "würde diese Aktion den Rolladen weiter schließen".

## 8. Prioritäts-/Konfliktlogik ⚠️ (Reihenfolge im Kern korrekt umgesetzt, inkl. Nachtauskühlung als eigene Stufe vor dem Zeitplan-Fallback; manuelles Kommando läuft direkt im Controller statt als Tick-Schritt, Türkontaktschutz ist ein Clamp statt eigener Prioritätsstufe)

Zentrale `automation.ts` (analog `AutomationEngine` in irrigation), die pro Rolladen-Tick in fester Reihenfolge auswertet:

1. **Windschutz aktiv (7a)** → Einheit sofort in ihre typabhängige Sicherheitsposition fahren (siehe 2a.5; bei `rolladen`/`raffstore`/`markise` einheitlich 0 %, jeweils physisch "eingefahren/hochgefahren") — höchste Priorität, überstimmt jede andere Regel inkl. eines aktiven Sonnenschutz-Overrides.
2. Manuelles Kommando gerade jetzt erkannt (State mit `ack=false` auf `position`/`open`/`close`/`stop`) → Aktion sofort ausführen (sofern nicht durch Windschutz überstimmt; Türkontakt-Schutz aus 7e gilt hier **nicht** — ein manuelles Kommando wird immer ausgeführt); zusätzlich: falls `sunProtectionActive` zu diesem Zeitpunkt `true` war, `sunProtectionOverrideUntil` auf 24:00 Uhr desselben Tages setzen (siehe 6.4). Allgemein pausiert das manuelle Kommando die übrige Automatik zusätzlich für konfigurierbare Zeit oder bis zum nächsten Zeitplanpunkt.
3. **Türkontakt-Schutz aktiv (7e)** und die für Schritt 4/5 ermittelte Zielposition würde den Rolladen weiter schließen → Zielwert auf die aktuelle Ist-Position begrenzen (kein Zufahren); rein öffnende Zielwerte (z. B. aus Zeitplan-Auf) sind davon nicht betroffen und werden normal ausgeführt.
4. Regenschutz aktiv → Zielposition Regenschutz (unabhängig von einer aktiven Sonnenschutz-Tagessperre, siehe 6.4; unterliegt aber der Türkontakt-Begrenzung aus Schritt 3).
5. Sonnenschutz aktiv **und** `now >= sunProtectionOverrideUntil` (bzw. kein Override gesetzt) → Zielposition Sonnenschutz (unterliegt ebenfalls Schritt 3).
6. Zeitplan (inkl. Dämmerung/Feiertag/iCal) → Zielposition Zeitplan, **sofern nicht Frostschutz (7b) aktiv** (dann wird der Fahrbefehl ausgesetzt, aktuelle Position bleibt erhalten) und unterliegt bei einem Schließ-Zielwert ebenfalls Schritt 3.
7. Keine Regel aktiv → keine Aktion.

Jede Zielposition wird über `position-mapping.ts` in Laufzeit-% umgerechnet und an `shutter-controller.ts` (Antriebssteuerung, z. B. via verlinkter Fremd-States eines Rolladenaktors) übergeben. Wie im Vorbild (`setShutter()`) wird vor jedem Schreibzugriff der aktuelle Ist-Wert gelesen und nur bei tatsächlicher Abweichung geschrieben, um unnötige Aktor-Befehle zu vermeiden; Schreibfehler pro Rolladen werden abgefangen/geloggt, ohne die Verarbeitung der übrigen Rolläden im selben Tick zu blockieren (siehe Bugfix-Historie in `Shutters.js`).

## 9. Admin-UI (klassisches Materialize-HTML/JS, bewusst kein JSONConfig) ✅ (`io-package.json` setzt `adminUI.config: "materialize"` — dies ist die bewusste, endgültige Wahl für diesen Adapter, keine offene Migration; Kalibrierung/Sonnenschutz/Wind-/Frostschutz-Felder vorhanden)

`admin/index_m.html` + `admin/shutters.js` + `admin/words.js` sind die tatsächlich verwendete Oberfläche; dynamische Feld-Anzeige (z. B. je `driverType`/`coveringType` relevante State-ID-Felder), Buttons (Scan, Kalibrieren) und Instanz-/State-Auswahlfelder werden per eigenem JS (DOM-Sichtbarkeit, `sendTo()`-Aufrufe, `openStatePicker()`) statt über native JSONConfig-Feldtypen (`instance`, `hidden`-Ausdrücke, Custom-Buttons) umgesetzt. `admin/jsonConfig.json` existiert zusätzlich im Repo, wird aber **nicht** ausgeliefert/genutzt (totes Altlast-Artefakt aus der `create-adapter`-Ersteinrichtung, nur noch relevant für den `admin/jsonConfig.json`-Validierungstest in `test/package.js`) — nicht mit der Oberfläche verwechseln und nicht weiter pflegen.

- Tabelle `shutters`: Name, **`coveringType`-Dropdown** (Rolladen/Raffstore/Markise/Lamellenvorhang/…, siehe 2a.5) mit typabhängig angepassten Feld-Bezeichnungen, **`driverType`-Dropdown** (homematic/knx/shelly/zigbee/generic-relay/generic-position/…), abhängig davon dynamisch ein-/ausgeblendete Fremd-State-ID-Felder (auf/zu/stopp bzw. Position-State je Driver, plus Kippwinkel-State bei Raffstore/Lamellenvorhang), Ausrichtung, Bereich, Kalibrierkurve, Automatik an/aus.
- Tabelle `areas`/`zones`: Name, Öffnen-/Schließzeiten (Wochentag/Wochenende/Feiertag), Dämmerungs-Offset. Kein eigenes iCal-URL-Feld (die Kalenderquelle wird in der `ioBroker.ical`-Instanz konfiguriert, nicht im `shutters`-Adapter, siehe 5.1); global konfigurierbar sind lediglich `icalAdapterInstance` und `icalTitlePrefix` — beide als einfache Text-Felder (kein echter Instanz-Picker, siehe 5.1-Anmerkung).
- Panel `sunProtection`: globale/zonen-Schwellwerte (Elevation, Wolkenbedeckung, Heizperiode-Zeitraum oder Temperatur-Schwellwert), Zielposition.
- Panel `rainProtection`: Regen-Sensor-State-ID, Windrichtung-State-ID (optional), Toleranzen, Zielposition.
- Alle Labels über `admin/words.js` (systemDictionary, `translate`-CSS-Klasse + `translateWord`), keine Strings direkt im HTML; nach Änderungen `npm run translate`, um die Übersetzungen für alle Sprachen zu vervollständigen.

## 9a. Watchdog & Zustands-Recovery ✅

Übernommen aus `BW Automatik.js` (irrigation-Vorbild) — dort als bewährter, generischer Sicherheitsmechanismus dokumentiert, hier auf Rolladen-Antriebe übertragen.

### 9a.1 Watchdog: hängender Antrieb ✅ (inline in `shutter-controller.ts` statt eigenem `watchdog.ts`-Modul, funktional aber vorhanden)

- Bei jedem Fahrbefehl wird eine erwartete Fahrzeit (aus Kalibrierkurve/`position-mapping.ts` bzw. einer konfigurierbaren Maximaldauer je Rolladen) hinterlegt.
- Ist die erwartete Fahrzeit plus eine Toleranz (fest 30 s Grace-Periode, `WATCHDOG_GRACE_MS`) überschritten, aber der Antrieb meldet laut `getCurrentPosition()` weiterhin nicht die Zielposition, wird dies als hängender/nicht reagierender Antrieb gewertet.
- Meldung: `watchdogLastIssue`/`watchdogIssueCount`-States aktualisieren, Log-Eintrag, Notify-Versand über `onWatchdogIssue`-Callback (siehe 9a.3). Es wird nicht wiederholt für dieselbe Fahrt gemeldet (Dedupe wie im Vorbild `watchdogReported`).
- Rolladen-Systeme ohne Positions-/Bewegungsrückmeldung (z. B. `generic-relay`, manche EnOcean-Profile) können den Watchdog nur eingeschränkt nutzen (nur Zeitüberschreitung, keine Bewegungsbestätigung) — in der Admin-UI entsprechend kennzeichnen.

### 9a.2 Zustands-Recovery nach Adapter-Neustart ✅ (Watchdog-States, `sunProtectionOverrideUntil` und der aktuell laufende Fahrbefehl sind `ack=true` persistiert und werden beim Start wiederhergestellt; `windProtectionActive`/`frostProtectionActive` bleiben interne Variablen ohne Persistenz — siehe Begründung unten)

- `sunProtectionOverrideUntil` wird mit `ack=true` persistiert (`shutter-controller.ts`: `setSunProtectionOverrideUntil()`/`getPersistedSunProtectionOverrideUntil()`) und beim `AutomationEngine.start()` (aufgerufen aus `onReady()`, `main.ts`) für jeden Controller wiederhergestellt — überlebt damit einen Adapter-Neustart.
- Ein zum Zeitpunkt eines Neustarts noch laufender Fahrbefehl wird ebenfalls persistiert (`pendingMoveTargetPercent`/`pendingMoveIssuedAt`, `ack=true`, `shutter-controller.ts`) und beim nächsten `createObjects()` über `recoverPendingMove()` wiederhergestellt — der ursprüngliche `issuedAt`-Zeitstempel bleibt dabei erhalten (keine Rücksetzung der Watchdog-Gnadenzeit durch den Neustart selbst). Der anschließende `refreshPosition()`-Aufruf fragt sofort den realen Ist-Wert beim Driver ab (`getCurrentPosition()`) statt dem letzten internen Zustand zu vertrauen: hat der Antrieb das Ziel während der Downtime tatsächlich erreicht, löst sich der wiederhergestellte Zustand lautlos auf; ist er weiterhin hängen geblieben, meldet der Watchdog dies sofort statt erst nach einer neuen, vollen Gnadenzeit. **Dies funktionierte bis zum Fund im Integrationstest (siehe Testlücken-Absatz oben) tatsächlich nicht zuverlässig**: `ForeignNumberTracker` (von jedem Driver zur Positionsrückmeldung genutzt) las den Fremd-State nie proaktiv aus, sodass `getCurrentPosition()` direkt nach einem Neustart praktisch immer `undefined` blieb — der hier beschriebene Realitätscheck lief faktisch leer. Mit dem Tracker-Fix funktioniert die Beschreibung oben jetzt wie ursprünglich beabsichtigt.
- `windProtectionActive`/`frostProtectionActive` bleiben bewusst nur lokale Variablen in `automation.ts`, ohne Persistenz: beide werden ohnehin beim ersten Tick nach dem Neustart binnen Sekunden aus den aktuellen Wetterwerten neu berechnet (kein Datenverlust mit praktischer Relevanz, anders als bei einem bereits unterbrochenen Fahrbefehl).

### 9a.3 Notify-Integration (optional) ✅ (`notify.ts`, Pushover/Telegram, für Watchdog-Meldungen und aggregierte Wind-/Frostschutz-Eintritt/Ende-Ereignisse)

- Konfiguration global über `pushoverInstance`/`telegramInstance` (Text-Felder mit Instanz-ID, z. B. `"pushover.0"`/`"telegram.0"`, analog zum irrigation-Vorbild, aber als Materialize-Textfeld statt JSONConfig-`instance`-Picker, siehe Abschnitt 9); beide unabhängig voneinander konfigurierbar, `null`/leer deaktiviert den jeweiligen Kanal einzeln.
- `sendNotification(adapter, config, title, message)` (reine, async Funktion statt Klasse, konsistent mit dem übrigen Stil des Adapters) verschickt parallel an beide konfigurierten Kanäle (`Promise.allSettled`); Pushover erhält `{ title, message }`, Telegram einen zusammengesetzten `"<title>: <message>"`-String — beides per `sendToAsync(instance, 'send', message)`. Ist kein Kanal konfiguriert, wird nur ein Debug-Log geschrieben, kein Fehler.
- Fehler beim Versand (Ziel-Adapter nicht installiert/nicht online) werden pro Kanal abgefangen und geloggt (`log.warn`), ohne den anderen Kanal oder die aufrufende Stelle zu beeinträchtigen.
- Ausgelöst für: Watchdog-Meldungen (9a.1, je Rolladen über `ShutterController.onWatchdogIssue`) sowie **aggregiert über alle Rolläden** (nicht je Rolladen einzeln, um Benachrichtigungsmüdigkeit gemäß 10a.6 zu vermeiden) für Eintritt/Ende von Windschutz und Frostschutz (`AutomationEngine.onWindProtectionChange`/`onFrostProtectionChange`, Flankenerkennung über alle automatisierten Rolläden hinweg, einmal je Tick geprüft).

## 9b. Szenen/Vorgabepositionen ✅ (als `scene-manager.ts`)

- Benannte Presets (`scenes[]` in der Konfiguration), die für einen einzelnen Rolladen oder eine Gruppe mehrere Zielwerte gleichzeitig setzen (z. B. "Kino": Wohnzimmer-Rolläden auf 100 % zu; "Nachtruhe": Kinderzimmer auf 100 %, restliches EG auf 30 %).
- Auslösung per Button-State (`scenes.<name>.activate`, ack=false) oder programmatisch per `sendTo`, unabhängig vom Zeitplan — läuft in der Prioritätslogik (Abschnitt 8) auf derselben Stufe wie ein manuelles Kommando (setzt also ggf. ebenfalls den Sonnenschutz-Override, 6.4, falls betroffene Rolläden gerade in Sonnenschutz stehen).
- Szenen kennen keine eigene Fahrlogik, sondern rufen intern für jeden betroffenen Rolladen denselben `setPosition()`-Pfad wie ein manuelles Kommando auf.

## 9e. Dashboard-Hinweis (README, kein Adapter-Code) ✅

- README-Abschnitt "Dashboard widgets" mit Empfehlung, welche States sich für ein vis/vis-2-Dashboard-Widget eignen: `positionActual`, `statusText`, `watchdogLastIssue` für eine Fehler-Übersicht, sowie die Gruppen-/globalen Schnellaktions-Buttons (`groups.*.openAll`/`closeAll`, `quickActions.allOpen`/`allClose`, siehe 10a.4). `sunProtectionActive`/`windProtectionActive`/`rainProtectionActive`/`frostProtectionActive` existieren wie in Abschnitt 3 dokumentiert nicht als eigene States — README verweist stattdessen auf `statusText`. Keine Umsetzung im Adapter selbst, nur Dokumentationshinweis.

## 10. Umsetzungsreihenfolge (Milestones) ⚠️ (M1-M7/M7b/M6c/M6d fertig; M8 teilweise — siehe Status je Milestone)

1. **M1 — Grundgerüst** ✅: create-adapter, io-package.json, Objekt-Hierarchie für einzelne Rolläden, manuelle Steuerung (Position setzen/lesen), `info.connection`.
2. **M1b — Driver-Layer** ✅ (alle 16 Driver fertig): `IShutterDriver`-Interface, `driver-factory.ts`, mindestens `generic-position-driver` und `generic-relay-driver` fertig implementiert und getestet (unabhängig von konkretem Fremdsystem lauffähig, z. B. per Testadapter-Instanz simuliert); danach Kern-Set (`homematic`, `knx`, `shelly`, `zigbee`), dann Erweiterungs-Set (`tuya`, `somfy`, `hmip`, `zigbee2mqtt`, `mqtt`), dann Nachtrag-Set (`velux`, `enocean`, `loxone`, `velbus`, `homey`) iterativ ergänzt — siehe Priorisierung in 2a.4. Verifikation bislang nur per Unit-Test mit gemocktem Adapter, nicht gegen echte/simulierte Fremdsysteme.
3. **M2 — Behangkalibrierung** ✅: `position-mapping.ts` + Admin-Tabelle + Kalibrierlauf (Driver-unabhängig, arbeitet auf Laufzeit-% egal welcher Driver).
4. **M3 — Zeitplan** ✅: `scheduler.ts` inkl. Wochentag/Wochenende/Feiertag, ohne iCal/Dämmerung zunächst.
5. **M4 — Dämmerung & iCal** ✅: Erweiterung Scheduler.
6. **M5 — Sonnenschutz** ✅: primär Solarstrahlung + Zeitfenster + Hysterese (6.1); Astro-/Elevation-Variante (6.2) optional als Nachtrag.
7. **M6 — Regenschutz** ✅: Sensor-Anbindung + Regel-Engine + Prioritätslogik (`automation.ts`) inkl. Konflikt mit Sonnenschutz/Zeitplan.
8. **M6b — Windschutz, Frostschutz & Türkontakt-Schutz** ✅: `wind-protection.ts` (mit Hysterese, höchste Priorität in `automation.ts`), `frost-protection.ts` und `door-protection.ts` (7e); Erweiterung der Prioritätslogik aus Abschnitt 8.
9. **M6c — Watchdog & Zustands-Recovery** ✅: Watchdog inline in `shutter-controller.ts`, persistierte Override-/Fahrzustände (`sunProtectionOverrideUntil`, `pendingMoveTargetPercent`/`pendingMoveIssuedAt`) mit Wiederherstellung beim `ready`-Handler (siehe 9a), Notify-Integration (`notify.ts`, 9a.3).
10. **M6d — Nachtauskühlung & Motorschutz** ✅: Motorschutz (7d) in `shutter-controller.ts`, Nachtauskühlung als `night-cooling.ts` (7c) inkl. Integration in `automation.ts`; beide implementiert und getestet.
11. **M7 — Gruppen/Alias** ✅: `groups` Objekt-Ebene, Sammelsteuerung mehrerer Rolläden **über gemischte Driver-Typen hinweg** (eine Gruppe kann z. B. Homematic- und KNX-Rolläden gleichzeitig enthalten, da `shutter-controller.ts` nur das einheitliche Interface kennt).
12. **M7b — Szenen** ✅: Presets (9b).
13. **M8 — Tests & Release** ⚠️ (Lint-Workflow etabliert, alle Kernmodule/Driver-Klassen unit-getestet, ein echter Integrationstest gegen einen realen js-controller vorhanden, README-Dashboard-Hinweis (9e) vorhanden; kein Release; Adapter-Checker mangels GitHub-Remote nicht ausführbar): Unit-Tests für `position-mapping`, `sun-protection`, `rain-protection`, `wind-protection`, `frost-protection`, `night-cooling`, `scheduler`, `weather-source`, `group-controller`, `scene-manager`, `driver-factory` sowie jeden einzelnen Driver ✅ vorhanden; `test/integration.js` (`@iobroker/testing`) ✅ startet den Adapter gegen einen echten js-controller, konfiguriert einen `generic-position`-Rolladen und verifiziert `positionActual` sowie einen manuellen `open`-Befehl End-to-End. Weiterhin offen: **Adapter-Checker** (`@iobroker/repochecker`) benötigt zwingend eine öffentliche GitHub-Repository-URL zum Prüfen — dieses Projekt hat laut `../AGENTS.md` bewusst kein GitHub-Remote (nur lokales Repo, da `.env` keine `GITHUB_TOKEN`/`GITHUB_REPO_OWNER` enthält) und kann daher nicht automatisiert geprüft werden, ohne diese Repo-Policy zu verletzen; **erster Release** (`npm run release patch`) noch nicht durchgeführt (Release ist ein bewusster, vom Nutzer zu veranlassender Schritt).

**Testlücken (Stand 2026-08-15, aktualisiert)** — ⚠️ **wichtiger Infrastruktur-Fund**: `package.json`s `test:ts`-Skript verwendete ein ungeschütztes `src/**/*.test.ts`-Glob, das je nach Skript-Shell unterschiedlich aufgelöst wurde — unter `zsh` (rekursives `**` standardmäßig aktiv) wurden alle Unterordner erfasst, unter `sh`/`dash` (kein `zsh`-Globbing, wie es `npm run` typischerweise zum Ausführen von `scripts` verwendet) wurde `**` nur wie ein einfaches `*` behandelt und **der komplette Unterordner `src/lib/drivers/*.test.ts` lief nie mit** — betraf `driver-factory.test.ts`, `foreign-state-tracker.test.ts`, `generic-position-driver.test.ts`, `generic-relay-driver.test.ts`, `loxone-driver.test.ts`, `mqtt-driver.test.ts`, `position-stop-driver-base.test.ts`, `tuya-driver.test.ts`, `best-effort-position.test.ts` — je nachdem, mit welcher Shell `npm test`/`npm run test:ts` tatsächlich ausgeführt wurde (insbesondere in CI/`npm`-Standardkonfiguration). Behoben durch Anführungszeichen um das Glob (`"src/**/*.test.ts"`), sodass Mocha selbst (über die `glob`-Bibliothek, korrekt rekursiv) statt der aufrufenden Shell die Auflösung übernimmt — verifiziert durch expliziten Vergleich `sh -c` vs. `zsh` vor und nach dem Fix.

`automation.ts` und `shutter-controller.ts` sind inzwischen getestet (siehe M6c/M8-Historie), ebenso `weather-source.ts`, `group-controller.ts`, `scene-manager.ts` und `driver-factory.ts` (inkl. jedes Fehlerfalls je `driverType`, inkl. Kippwinkel-Wiring 2a.5) sowie `notify.ts`/`ical.ts`/`covering-types.ts`/`night-cooling.ts`. Von den einzelnen Driver-Klassen sind `homematic-driver.ts`/`hmip-driver.ts`/`homey-driver.ts`/`velux-driver.ts`/`enocean-driver.ts`/`velbus-driver.ts`/`somfy-driver.ts`/`knx-driver.ts`/`shelly-driver.ts`/`zigbee-driver.ts` (inkl. `Zigbee2MqttDriver`) über `position-stop-driver-base.test.ts` parametrisiert abgedeckt (alle sind reine, unveränderte Subklassen von `PositionStopDriverBase` bzw. teilen sich dessen Skalierungslogik, inkl. gemeinsamer Kippwinkel-Tests), zusätzlich `tuya-driver.ts`/`mqtt-driver.ts`/`loxone-driver.ts`/`generic-position-driver.ts`/`generic-relay-driver.ts` dediziert. Keine einzelne Driver-Klasse ist mehr ungetestet.

⚠️ **Zweiter wichtiger Fund, durch den neu geschriebenen Integrationstest aufgedeckt**: `foreign-state-tracker.ts` (`ForeignNumberTracker`, von allen `PositionStopDriverBase`-Drivern sowie `generic-position`/`tuya`/`mqtt`/`loxone` genutzt) las den **aktuellen** Wert eines Fremd-States nie proaktiv aus, sondern reagierte ausschließlich auf **zukünftige** `stateChange`-Ereignisse — nach jedem Adapter-(Neu-)Start blieb `getCurrentPosition()`/`getCurrentTilt()` also `undefined`, bis sich der jeweilige Fremd-State zufällig erneut änderte. Das betraf u. a. den in 9a.2 dokumentierten Realitätscheck nach einem Neustart (`refreshPosition()` konnte den echten Ist-Wert gar nicht abfragen, solange keine neue externe Änderung eintraf) und den initialen `positionActual`-Wert direkt nach dem Anlegen eines neuen Rolladens. Behoben durch einen zusätzlichen einmaligen `getForeignStateAsync()`-Aufruf direkt bei Konstruktion (parallel zum Abonnieren), race-sicher gegen eine zwischenzeitlich eintreffende echte Änderung (`this.value === undefined`-Guard) — siehe `foreign-state-tracker.ts` und die dort ergänzten Tests.

`test/integration.js` (`@iobroker/testing`) ist nicht mehr das unveränderte Scaffold: ein echter Testfall startet den Adapter gegen einen realen js-controller, konfiguriert einen `generic-position`-Rolladen mit einem Fremd-State und verifiziert sowohl den initial gelesenen `positionActual`-Wert als auch die Auswirkung eines manuellen `open`-Kommandos auf den Fremd-State — genau dieser Test deckte den obigen `ForeignNumberTracker`-Bug auf. Alle Driver sind weiterhin nur gegen einen gemockten Adapter per Unit-Test verifiziert, nicht gegen echte/simulierte Fremdsysteme (siehe M1b).

## 10a. Endnutzer-Bedienkonzept (Einfachheit als Designziel) ✅ (siehe Status je Unterabschnitt 10a.1-10a.14)

Der gesamte bisherige Plan ist bewusst technisch/vollständig gehalten (viele Driver, viele Schutzfunktionen, viele Konfigurationsfelder). Für den **täglichen Gebrauch** darf davon so wenig wie möglich sichtbar sein. Leitprinzip: Komplexität steckt in der Konfiguration (einmalig, durch einen technisch versierten Nutzer), nicht in der Bedienung (täglich, durch jedes Familienmitglied).

### 10a.1 Reduzierte State-Oberfläche für Endnutzer ✅ (`statusText` + `expert:true`-Flags vorhanden; `activityLog` aus 10a.8 ergänzt)

- Pro Rolladen/Gruppe nur eine **kleine, klar benannte Menge** an für Endnutzer relevanten States, mit sprechenden `common.name`: Position (Slider 0–100), Auf/Zu/Stopp-Buttons, ein einziger `automationEnabled`-Schalter ("Automatik an/aus" statt einzeln Sonnenschutz/Zeitplan/Nachtauskühlung an-/abschaltbar zu machen).
- Alle technischen/diagnostischen States (Driver-interne Rohwerte, `positionRaw`, Watchdog-Zähler, Kalibrierkurven-Rohdaten, Hysterese-Zeitstempel) erhalten `common.expert: true` bzw. werden in einem separaten `diagnostics`-Unterbaum abgelegt, damit sie in Standard-Dashboards (Admin "Objekte"-Ansicht mit Experten-Modus aus, vis-Widget-Auswahl) nicht auftauchen und den Nutzer nicht verwirren.
- Ein einziger, **menschenlesbarer Statustext** je Rolladen (`statusText`, analog `STATES.status` im Bewässerungs-Vorbild), der die aktuell wirksame Regel benennt, z. B. "Sonnenschutz aktiv (bis 18:30)" oder "Windschutz: hochgefahren (Sturmwarnung)" oder "Zeitplan: geschlossen bis 07:30" — beantwortet die häufigste Nutzerfrage ("Warum macht der Rolladen das gerade?") ohne dass der Nutzer die Prioritätslogik aus Abschnitt 8 verstehen muss.

### 10a.2 Physische Taster/Fernbedienungen bleiben die primäre Bedienung ✅ (architekturell durch manuellen Override in 6.4/Abschnitt 8 abgedeckt)

- Der Adapter greift **nicht** in vorhandene physische Wandtaster/Fernbedienungen ein — diese steuern weiterhin direkt den Aktor (Homematic/KNX/etc.), der Adapter erkennt die resultierende Zustandsänderung nur passiv über die verlinkten Fremd-States (genau das löst bereits der manuelle Override in 6.4/Abschnitt 8, Punkt 2). Für den Nutzer ändert sich an der gewohnten Bedienung also nichts — "es funktioniert einfach weiter wie bisher", die Automatik reagiert nur intelligent auf das, was ohnehin passiert.
- Kein Zwang, für die Grundbedienung eine App/ioBroker-Oberfläche zu öffnen — nur für Komfortfunktionen (Zeitplan ändern, Szenen) ist eine Oberfläche nötig.

### 10a.3 Einfache Voreinstellungen statt Pflichtkonfiguration ✅ (Defaults für Schwellwerte vorhanden, Autoscan mit Vorschau/Bestätigung fertig, siehe 2b.3; kein separater Einrichtungsassistent/Wizard-Screen geplant — der Autoscan-Dialog deckt diesen Bedarf bereits ab)

- Sinnvolle Defaults für praktisch alle Schwellwerte (Sonnenschutz-, Wind-, Frostschutz-Werte aus Abschnitt 6/7 sind bereits mit Default-Werten spezifiziert), sodass ein Rolladen nach dem Autoscan (2b) **ohne weitere Eingabe** sofort sinnvoll funktioniert (Zeitplan Auf/Zu, kein Sonnenschutz, keine Kalibrierkurve nötig — lineare 1:1-Zuordnung Behang=Laufzeit als Default, siehe Abschnitt 4, verfeinerbar aber optional).
- Zonen/Gruppen werden beim Autoscan, wo möglich, aus der Objekt-Struktur der Fremdinstanz vorbelegt (z. B. Raumname aus `enum.rooms.*`), damit der Nutzer nicht jeden Rolladen händisch einer Zone zuordnen muss.

### 10a.4 Zentrale Schnellaktionen statt Einzelsteuerung ✅ (Gruppen-Buttons `openAll`/`closeAll` pro Gruppe sowie globale `quickActions.allOpen`/`allClose` über alle Rolläden vorhanden)

- Wenige, prominente Sammel-Buttons statt vieler Einzel-Schalter: "Alle auf", "Alle zu". Diese decken die häufigsten Alltagssituationen ohne pro Rolladen einzeln etwas einstellen zu müssen.
- Gruppen (Abschnitt 3, `groups`) sind die primäre Bedienebene für den Alltag ("Rolläden EG", "Kinderzimmer"), einzelne Rolläden sind eher die Ausnahme (z. B. ein Fenster, das anders behandelt werden soll).

### 10a.5 Sprachsteuerung/Smart-Home-Integration ohne Zusatzaufwand ✅ (folgt automatisch aus korrekter `role`/`name`-Vergabe, keine Zusatzarbeit nötig)

- Korrekte `common.role: "level.blind"` und sinnvolle `common.name` je Rolladen/Gruppe reichen aus, damit gängige Alexa-/Google-Home-Kopplungsadapter (`ioBroker.iot`, `ioBroker.cloud`) die Rolläden automatisch als steuerbare Rolladen/Cover erkennen — keine Sonderintegration im `shutters`-Adapter selbst nötig, nur konsequente Einhaltung der Standard-Rollen/-Typen aus der ioBroker-Objekt-Schema-Konvention.
- Dadurch funktioniert z. B. "Alexa, schließe die Rolläden im Wohnzimmer" ohne jeden Zusatzaufwand im Adapter, sofern der Nutzer den entsprechenden Kopplungsadapter ohnehin einsetzt.

### 10a.6 Benachrichtigungen bewusst sparsam halten ✅

- Notify-Kanäle (9a.3) nur für Ereignisse, auf die der Nutzer **reagieren muss oder sollte** (Watchdog/hängender Antrieb, Sturmwarnung-Auslösung, Fremdsystem dauerhaft nicht erreichbar) — bewusst **keine** Benachrichtigung bei jedem normalen Sonnenschutz-/Zeitplan-Vorgang, um Benachrichtigungsmüdigkeit zu vermeiden, die dazu führt, dass wichtige Meldungen ignoriert werden. Wind-/Frostschutz-Meldungen sind zusätzlich über alle Rolläden aggregiert (eine Meldung statt einer je Rolladen, siehe 9a.3).

### 10a.8 Aktivitäts-Verlauf je Rolladen ✅

- Zusätzlich zum aktuellen `statusText` (10a.1) ein kurzes, rollierendes Log der letzten 10 automatischen Aktionen je Rolladen (`activityLog`, JSON-Array mit Zeitstempel + Grund + Zielposition, `pushActivityLogEntry()`, `shutter-controller.ts`), z. B. `{ts, reason: "Sun protection", percent: 70}`. Beantwortet nicht nur "was macht er jetzt", sondern auch "was hat er heute gemacht und warum" — reduziert Rückfragen und erleichtert die Fehlersuche bei unerwartetem Verhalten.
- Wird von derselben Stelle geschrieben wie `statusText` (`applyAutomatedPosition()`, `shutter-controller.ts`), sodass keine zusätzliche Logik zur Ermittlung des Auslösers nötig ist — manuelle Kommandos werden bewusst nicht geloggt, analog dazu, dass sie auch `statusText` nicht aktualisieren. Ein korrupter/nicht parsebarer bestehender Wert wird defensiv als leeres Log behandelt statt das Schreiben zukünftiger Einträge zu blockieren.

### 10a.12 Inline-Hilfetexte in der Admin-UI ✅ (systematischer Panel-Hinweistext `thresholdsHintText` für alle Schwellwerte; vereinzelt zusätzlich vorhanden, z. B. Scan-Hinweistext/`icalHintText`)

- Jedes technisch nicht selbsterklärende Feld (insbesondere die Solarstrahlungs-/Windgeschwindigkeits-Schwellwerte aus 6.1/7a) erhält einen kurzen Hilfetext in einfacher Sprache direkt unter dem Feld (analog dem bereits vorhandenen Muster `<p class="shutters-hint translate">…HintText</p>` in `admin/index_m.html`, siehe z. B. `holidayHintText`/`icalHintText`), z. B. "Höherer Wert = Verschattung reagiert erst bei stärkerer Sonneneinstrahlung" statt nur die Einheit (W/m²) anzuzeigen — richtet sich an Nutzer ohne technischen Hintergrund zur Solarstrahlung. Umgesetzt als ein zusammenhängender Erklärungstext (`thresholdsHintText`) oberhalb aller Schwellwertfelder im "Schwellwerte"-Tab, statt eines Tooltip-Icons je Einzelfeld (die Admin-UI hat kein Popover-/Tooltip-Widget, siehe Abschnitt 9) — deckt Sonnenschutz-, Windschutz-, Frostschutz- und Nachtauskühlungs-Schwellwerte ab.
- Konsistent mit der bestehenden Vorgabe, alle Labels/Hinweistexte über `admin/words.js` zu pflegen (Abschnitt 9).

### 10a.14 Saisonale Erinnerungen ✅

- Einmaliger (nicht wiederholter) Hinweis beim ersten tatsächlichen Aktivwerden des Sonnenschutzes in einer neuen Saison ("Der Sonnenschutz ist jetzt wieder aktiv — Zeitfenster und Zielposition weiterhin passend?"), über denselben Notify-Kanal wie andere wichtige Meldungen (9a.3). Umgesetzt über `AutomationEngine.onSunProtectionChange` (aggregierte Flanke über alle Rolläden, analog Wind-/Frostschutz-Notify) plus Jahres-Vergleich gegen den persistierten State `info.lastSeasonalReminderYear` (`main.ts`, `sendSeasonalReminderIfNewYear()`) — verhindert sowohl Mehrfachversand am selben Tag/derselben Saison als auch erneuten Versand nach einem Adapter-Neustart im selben Kalenderjahr.
- Verhindert, dass veraltete Konfiguration (z. B. Zeitfenster aus dem Vorjahr) erst durch tatsächliches Fehlverhalten auffällt, statt proaktiv in Erinnerung gerufen zu werden.

## 11. Offene Fragen für Nutzer (vor Umsetzung klären) ❌ (nie schriftlich beantwortet/dokumentiert, z. B. in `CONTEXT.md` oder Commit-Historie)

- iCal-Kalenderquelle (Google, Nextcloud, lokale .ics-Datei?).
- Windrichtung (°), Taupunkt bzw. Luftfeuchte (%): sind entsprechende Sensor-States vorhanden (z. B. über `ioBroker.davis`/`ioBroker.multiweather`), die als Fremd-State-ID für Regenschutz (7, Windrichtung) bzw. Frostschutz-Kombikriterium (7b, Taupunkt/Luftfeuchte) konfiguriert werden könnten? Beide Messwerte sind laut Tabelle 5a.1 aktuell noch nicht in `IWeatherConfig` abgebildet.
