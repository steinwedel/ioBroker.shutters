# ioBroker.shutters — Adapter-Plan

**Status-Legende** (zuletzt geprüft: 2026-08-14, Abgleich Plan ↔ Code):
✅ erledigt · ⚠️ teilweise umgesetzt (siehe Anmerkung) · ❌ offen/nicht begonnen

## 0. Kontext & Referenzen

- Analoger Adapter mit ähnlicher Architektur: `../ioBroker.irrigation` (State-Hierarchie, Scheduler, Sensor-Handling, Admin-JSONConfig, Release-Workflow). Als Bauplan/Vorlage für Coding-Stil und Modulaufteilung verwenden — **nicht kopieren**, sondern mit `create-adapter` neu aufsetzen.
- Inspirationsquelle: JavaScript-Script "Shutters" auf `haus20a.steinwedel.de` (bestehende Rolladen-Logik als fachliche Referenz für Behanghöhen-Mapping, Dämmerungs- und Sonnenschutzlogik).
- Zielverzeichnis/Repo-Name: `ioBroker.shutters`, npm-Paket `iobroker.shutters`.

## 1. Projekt-Setup ✅

1. `npx @iobroker/create-adapter@latest` im aktuellen Verzeichnis ausführen (TypeScript, Admin JSONConfig, ESLint `@iobroker/eslint-config`, Testing-Framework, GitHub Actions).
2. `.releaseconfig.json`, `.env`, `eslint.config.mjs` bereits vorhanden — beibehalten/mergen statt überschreiben.
3. `io-package.json` Pflichtfelder setzen:
   - `dataSource: "poll"`, `mode: "daemon"`
   - `adminUI.config: "json"`
   - `type: "climate-control"`
   - `connectionType: "local"`
   - `supportedMessages: { "custom": true }`
   - `titleLang: { en: "Shutters", de: "Rolläden" }`
4. `CONTEXT.md` anlegen (max. 20 Zeilen, Current Task / Key Decisions / Next Steps).

## 2. Fachliche Anforderungen → Module ⚠️ (siehe Status-Spalte je Zeile)

| # | Anforderung | Modul (`src/lib/...`) | Status |
|---|---|---|---|
| 1 | Einheitliche Alias-Steuerung aller Rolläden **über verschiedene Fremd-Adapter/Systeme hinweg** | `drivers/*.ts` + `shutter-controller.ts` | ⚠️ nur 7 von 16 Drivern (siehe 2a.2) |
| 2 | Behanghöhe ≠ lineare Laufzeit (Kalibrierungskurve) | `position-mapping.ts` | ✅ |
| 3 | Tägliches Auf/Zu, abhängig von Wochentag/Wochenende/Feiertag/iCal, pro Zonen/Bereich | `scheduler.ts`, `holiday.ts`, `ical.ts` | ⚠️ Wochentag/Wochenende/Feiertag ja; iCal fehlt, kein `holiday.ts`/`ical.ts` |
| 4 | Dämmerungsabhängige Steuerung (z. B. 30 min nach Ende der Dämmerung) | `twilight.ts` | ✅ |
| 5 | Sonnenschutz nach Fensterausrichtung, Heizperioden-Ausnahme, Wolkenfilter | `sun-protection.ts` | ⚠️ siehe Abschnitt 6 (Wolkenfilter/Eigenberechnung offen) |
| 6 | Regenschutz, ggf. windrichtungsabhängig | `rain-protection.ts` | ✅ |
| 7 | Windschutz (Sturmwarnung) — Rolläden bei hoher Windgeschwindigkeit hochfahren, um Mechanik/Behang zu schützen | `wind-protection.ts` | ✅ |
| 8 | Frostschutz — Fahrbefehle bei Vereisungsgefahr unterdrücken/verzögern | `frost-protection.ts` | ✅ |
| 8b | Türkontakt-Schutz — kein Zufahren bei geöffneter Terrassen-/Balkontür | `door-protection.ts` | ✅ |
| 9 | Watchdog (hängender Antrieb erkennen) + Zustands-Recovery nach Adapter-Neustart | `watchdog.ts`, persistierte States | ⚠️ Watchdog inline in `shutter-controller.ts` (kein eigenes Modul); Recovery unvollständig (siehe 9a.2) |
| 10 | Sommer-Nachtauskühlung (abendliches Schließen zonenweise aussetzen/umkehren) | `night-cooling.ts` | ❌ Modul existiert nicht |
| 11 | Motorschutz (Mindestpause zwischen Fahrten) | `shutter-controller.ts` | ❌ nicht implementiert |
| 12 | Szenen/Vorgabepositionen | `scenes.ts` | ✅ (als `scene-manager.ts`) |
| 13 | Diagnose: Health-Check, Laufzeit-/Zyklen-Statistik, Simulationsmodus | `health-check.ts`, `runtime-stats.ts`, `drivers/simulation-driver.ts` | ❌ keine dieser Dateien existiert |

## 2a. Treiber-Abstraktion für Fremdsysteme (Punkt 1 vertieft) ⚠️ (Architektur/Interface fertig, siehe 2a.1-2a.5 für Details)

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

### 2a.2 Konkrete Driver-Implementierungen ⚠️ (nur 7 von 16 vorhanden — siehe Status-Spalte)

| Driver | Datei | Verlinkte Fremd-States | Besonderheiten | Status |
|---|---|---|---|---|
| Homematic (CCU/HM-RPC/HmIP) | `drivers/homematic-driver.ts` | `LEVEL` (0-1 oder 0-100 je Kanal), `STOP`, ggf. `WORKING`/`DIRECTION` | Skalierung 0-1 ↔ 0-100 beachten | ✅ |
| Homematic IP Cloud/Access Point (`ioBroker.hmip`) | `drivers/hmip-driver.ts` | `ShutterActuator`-Channel: `shutterLevel` (0-1), `stop`, `selfCalibrationInProgress` | Eigene State-Struktur, unabhängig von `hm-rpc`; nicht mit CCU-Instanz verwechseln | ❌ |
| KNX (über `ioBroker.knx`) | `drivers/knx-driver.ts` | Positions-DPT (z. B. DPT 5.001 %), Stopp-GA, Status-GA | Getrennte Kommando-/Status-Objekte (KNX-typisch) | ✅ |
| Shelly 2.5/Plus (Cover-Mode) | `drivers/shelly-driver.ts` | `Cover.Pos`/`Position`, `Cover.Open`/`Close`/`Stop` | Meist direkte %-Positionsrückmeldung | ✅ |
| Zigbee (zigbee-herdsman/`ioBroker.zigbee`) | `drivers/zigbee-driver.ts` | `position`/`current_position`, `state` (OPEN/CLOSE/STOP) | Je Gerätehersteller (Tuya, IKEA) leicht abweichende State-Namen → pro Gerät konfigurierbar | ✅ |
| Zigbee2MQTT (`ioBroker.zigbee2mqtt`) | `drivers/zigbee2mqtt-driver.ts` | `position`/`state` unterhalb `zigbee2mqtt.*` (Topic-basierte States) | Eigenständiger Adapter neben `ioBroker.zigbee`, andere Objektpfad-Konvention, sonst gleiches Gerätesortiment | ✅ |
| Tuya Cloud/Local (`ioBroker.tuya`) | `drivers/tuya-driver.ts` | DP-States, meist `percent_control`/`percent_state` bzw. `control` (OPEN/CLOSE/STOP) | Weit verbreitete günstige WLAN-Rollladenmotoren; DP-Nummern variieren je Gerät → pro Gerät konfigurierbar | ❌ |
| Somfy (io-Homecontrol, TaHoma/Connexoon, `ioBroker.tahoma`) | `drivers/somfy-driver.ts` | Positions-State (`core:ClosureState`/`position`), Kommandos `open`/`close`/`stop`/`setPosition` | Sehr verbreitet bei Rolladenmotoren in DE/FR; Cloud-Anbindung, ggf. Rate-Limits beachten | ❌ |
| Velux (KLF200/io-Homecontrol, `ioBroker.velux`/`ioBroker.klf200`) | `drivers/velux-driver.ts` | Positions-State (0-100 bzw. 0-1), `stop`, Produkt-Index | Häufig für Dachfenster, aber auch Rolläden derselben Gateways | ❌ |
| EnOcean (`ioBroker.enocean`) | `drivers/enocean-driver.ts` | Rollladenaktor-Kanal mit `LEVEL`/`position` bzw. Auf/Ab-Telegramme | Batterielose Aktoren/Taster, verbreitet in Bestandsbauten | ❌ |
| Velbus (`ioBroker.velbus`) | `drivers/velbus-driver.ts` | Blind-Kanal `position`/`status`, `up`/`down`/`stop` | Verbreitet in BE/NL-Installationen | ❌ |
| Loxone (über `ioBroker.loxone`) | `drivers/loxone-driver.ts` | Jalousie-Baustein-States: `position`/`up`/`down`/`shade`, ggf. `info` für Ist-Position | Loxone bildet Jalousie-Bausteine als eigene States mit `up`/`down` (impuls) + Positions-Rückmeldung ab; Stopp meist über gleichzeitiges Zurücknehmen von `up`/`down` | ❌ |
| Homey (über `ioBroker.homey` bzw. MQTT-Bridge) | `drivers/homey-driver.ts` | Capability-State `windowcoverings_state`/`windowcoverings_set` | Optionaler Nachtrag, gleiches Muster wie Shelly/Zigbee | ❌ |
| Generisches MQTT-Cover (z. B. Tasmota, ESPHome, Home Assistant über MQTT) | `drivers/mqtt-driver.ts` | Konfigurierbares Topic-Paar: Kommando-Topic (Position/OPEN/CLOSE/STOP) + Status-Topic, meist über `ioBroker.mqtt`/`ioBroker.mqtt-client` als States gespiegelt | State-IDs sind Topic-abhängig und daher frei konfigurierbar statt fest benannt | ❌ |
| Generisches Auf/Zu/Stopp-Relais | `drivers/generic-relay-driver.ts` | 3 boolesche States (auf/zu/stopp), keine Positionsrückmeldung | Position wird intern über Laufzeit-Timer geschätzt (`position-mapping.ts` + Zeitmessung) | ✅ |
| Generischer Positions-Antrieb | `drivers/generic-position-driver.ts` | 1 numerischer Ziel-State + 1 numerischer Ist-State | Fallback für alles, was schon 0-100 liefert und nimmt | ✅ |

### 2a.3 Driver-Factory & Konfiguration ✅

- `drivers/driver-factory.ts`: `createDriver(adapter, config: IShutterConfig): IShutterDriver` — wählt anhand `config.driverType` die passende Implementierung, injiziert die in der Admin-UI hinterlegten Fremd-State-IDs.
- Jeder Rolladen (`shutter_NNN`) bekommt in der nativen Config ein Feld `driverType` (Dropdown: homematic / hmip / knx / shelly / zigbee / zigbee2mqtt / tuya / somfy / velux / enocean / velbus / loxone / homey / mqtt / generic-relay / generic-position) + ein Set von State-ID-Feldern, die je nach gewähltem Typ im Admin-UI dynamisch ein-/ausgeblendet werden (JSONConfig `hidden`-Ausdruck abhängig von `driverType`).
- Alle States fremder Instanzen werden über `adapter.subscribeForeignStatesAsync(id)` abonniert; Schreibzugriffe über `adapter.setForeignStateAsync(id, value, false)`.
- `shutter-controller.ts` kennt nur `IShutterDriver`, nie die konkrete Fremdsystem-Logik — dadurch ist die Erweiterung um weitere Systeme später ein reiner Zusatz-Driver ohne Änderung an Scheduler/Sonnenschutz/Regenschutz/Automation.
- Neue Systeme lassen sich ohne Breaking Change ergänzen: neuer Driver + Eintrag in Dropdown + i18n-Label.

### 2a.4 Priorisierung der Driver-Implementierung (nach Verbreitung) ⚠️ (Kern-Set größtenteils fertig, Erweiterungs-/Nachtrag-Set offen)

Reihenfolge für M1b (siehe Abschnitt 10), grob nach Verbreitung/Nachfrage in der ioBroker-Community gestaffelt:

1. **Kern-Set (hohe Priorität)**: `generic-position`, `generic-relay` (immer benötigter Fallback), `homematic`, `knx`, `shelly`, `zigbee`.
2. **Erweiterungs-Set (mittlere Priorität, hohe Verbreitung)**: `tuya`, `somfy`, `hmip`, `zigbee2mqtt`, `mqtt`.
3. **Nachtrag-Set (nachgefragt, aber kleinere Nutzerbasis)**: `velux`, `enocean`, `loxone`, `velbus`, `homey`.

Die eigentliche Reihenfolge richtet sich nach den vom Nutzer tatsächlich eingesetzten Systemen im eigenen Haus (siehe offene Fragen, Abschnitt 11).

### 2a.5 Behangtyp-Unterscheidung (Rolladen vs. sonstiger Behang) ⚠️ (`coveringType` als Config-Feld vorhanden; keine zentrale `covering-types.ts` mit `safePosition()`/`protectedPosition()`, kein Driver setzt `tilt` um)

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

- Konsequenz für die Prioritätslogik (Abschnitt 8) und die Schutzmodule (7a Windschutz, 7 Regenschutz): jedes Modul ermittelt intern nicht mehr "fahre auf 0 %"/"fahre auf 100 %" als Literal, sondern eine typabhängige **logische Zielrichtung** (`safePosition(coveringType)` bzw. `protectedPosition(coveringType)`), die je `coveringType` aus der obigen Tabelle aufgelöst wird — inklusive der Möglichkeit, dass ein Schutzmodul für einen Typ (z. B. Windschutz bei `lamellen`) komplett `null`/deaktiviert liefert. Die Regel-Module selbst bleiben unverändert, nur die Übersetzung "Sicherheitszustand → konkreter Prozentwert (oder: nicht anwendbar)" wird pro Behangtyp zentral in `covering-types.ts` hinterlegt.
- Kalibrierung (Abschnitt 4) gilt unverändert für `rolladen`, `raffstore` und `lamellen` (Fahrweg-Laufzeit-Kurve, bei `lamellen` horizontal statt vertikal); bei `markise` beschreibt die Kurve stattdessen Ausfahrweite statt Behanghöhe — Begriff im Admin-UI dafür kontextabhängig anpassen ("Behanghöhe" vs. "Ausfahrweite" vs. "Fahrweg").
- `IShutterDriver` (2a.1) wird um ein optionales `setTilt(anglePercent: number): Promise<void>`/`getCurrentTilt(): number | undefined` ergänzt (relevant für `coveringType: "raffstore"` und `"lamellen"`, bei letzterem mit größerem Wertebereich für die Drehwinkel-Skalierung); Default-Implementierung für alle anderen Driver: no-op bzw. `undefined`. Das Interface bleibt für `rolladen`/`markise` unverändert nutzbar (kein Breaking Change).
- Admin-UI: `coveringType`-Dropdown pro Einheit (Rolladen/Raffstore/Markise/Lamellenvorhang/…), das abhängig vom gewählten Typ passende Begriffe/Zusatzfelder ein-/ausblendet (z. B. Lamellenwinkel-Feld bei Raffstore/Lamellenvorhang, niedrigere Default-Windschwellwerte bei Markise, Wind-/Regenschutz-Panel standardmäßig ausgeblendet/deaktiviert bei Lamellenvorhang).
- Aus dem Objektbaum (Abschnitt 3) wird der Container künftig als "Behang"/"covering" statt ausschließlich "Rolladen" verstanden — die technischen State-IDs (`shutters.*`) bleiben aus Kompatibilitätsgründen wie geplant benannt, aber `common.name`/i18n-Labels sind je `coveringType` entsprechend zu beschriften ("Rolladen Wohnzimmer", "Markise Terrasse", "Lamellenvorhang Wintergarten").
- Vorhänge im klassischen Sinn (reine Faltenstoff-Gardinen ohne Lamellen) sind **explizit nicht Teil dieses Konzepts** und bleiben außerhalb des Scopes — die Tabelle deckt nur motorisierte Sonnenschutz-/Verdunklungssysteme mit definierter Prozent-Position (Höhe oder Fahrweg) ab, nicht reine Stoffbahnen ohne klar messbare Endposition.

## 2b. Autoscan / Auto-Discovery der Rolläden ⚠️

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

### 2b.2 Erkennungsstrategie je System ⚠️ (nur 5 von 11 Systemen erkannt — siehe Status-Spalte)

| System | Erkennungsmerkmal | Ableitung `driverType` | Status |
|---|---|---|---|
| Homematic (HM-RPC/HmIP über CCU) | Kanal-Rolle/`common.role` `"level.blind"` bzw. Funktions-Enum `enum.functions.*` mit "Rollladen"/"Blind"/"Shutter" im Namen; States `LEVEL` + `STOP` im selben Kanal | `homematic` | ✅ |
| Homematic IP Cloud (`ioBroker.hmip`) | `common.role` `"level.blind"` unter `hmip.*`, Channel-Typ `SHUTTER_CONTACT`/`ShutterActuator`, State `shutterLevel` | `hmip` | ❌ |
| KNX | `common.role` `"level.blind"` an KNX-Instanz-Objekten, oder DPT-Metadaten (`native.dpt` 5.001/1.008) an Positions-/Stopp-GAs | `knx` | ✅ |
| Shelly | Objektpfad `shelly.*.Cover` bzw. State-Namen `Cover.Pos`/`Cover.Open`/`Cover.Close` unterhalb einer Shelly-Instanz | `shelly` | ✅ |
| Zigbee (`ioBroker.zigbee`) | `common.role` `"level.blind"` unter `zigbee.*`, State-Namen `position`/`current_position` + `state` mit Werten OPEN/CLOSE/STOP | `zigbee` | ✅ |
| Zigbee2MQTT (`ioBroker.zigbee2mqtt`) | `common.role` `"level.blind"` unter `zigbee2mqtt.*`, gleiche State-Namenskonvention wie Zigbee | `zigbee2mqtt` | ✅ |
| Tuya (`ioBroker.tuya`) | Objektpfad `tuya.*`, DP-States `percent_control`/`percent_state`/`control` | `tuya` | ❌ |
| Somfy (`ioBroker.tahoma`) | Objektpfad `tahoma.*`, State `core:ClosureState`/`position`, Gerätetyp "io:RollerShutter" o. ä. | `somfy` | ❌ |
| Velux (`ioBroker.velux`/`ioBroker.klf200`) | Objektpfad `velux.*`/`klf200.*`, numerischer Positions-State am Produkt-Kanal | `velux` | ❌ |
| EnOcean (`ioBroker.enocean`) | `common.role` `"level.blind"` unter `enocean.*`, oder Profil-Kennung (EEP) für Rollladenaktoren (z. B. D2-05) | `enocean` | ❌ |
| Velbus (`ioBroker.velbus`) | Objektpfad `velbus.*`, Blind-Kanal mit `position`/`status` + `up`/`down`/`stop` | `velbus` | ❌ |
| Generic (Fallback) | Beliebige Instanz mit einem numerischen State `common.role` `"level.blind"` (Position) **oder** drei booleschen States mit Rollen `"button.open"`/`"button.close"`/`"button.stop"` im selben Channel | `generic-position` bzw. `generic-relay` | ✅ |

- Erkennung primär über `common.role` (robust, herstellerunabhängig) und ergänzend über Funktions-Enum `enum.functions.*` (z. B. "Rollladen", "Beschattung"), analog zur Homematic-Erkennung via `enum.functions.*` im irrigation-Vorbild.
- `FORBIDDEN_SCAN_ADAPTERS` (analog: `admin`, `shutters` selbst, `alias`, `linkeddevices`, `javascript`) werden nie gescannt, um Duplikate/Rekursion zu vermeiden.
- `SPECIALIZED_SCAN_ADAPTERS` (`hm-rpc`, `hm-rega`, `hmip`, `knx`, `shelly`, `zigbee`, `zigbee2mqtt`, `tuya`, `tahoma`, `velux`, `klf200`, `enocean`, `velbus`) werden vom generischen Fallback-Scan übersprungen, da sie bereits durch ihren eigenen spezialisierten Scan abgedeckt sind.
- Mehrfacherkennung (z. B. ein Kanal passt sowohl auf Rollen- als auch auf Enum-Kriterium) wird über die gefundene State-ID dedupliziert.

### 2b.3 Admin-UI-Integration ⚠️ (Such-Button vorhanden; kein Fortschritts-Callback, keine Vorschau/Bestätigung — Treffer landen direkt in der Config)

- Button "Rolläden suchen" (Custom-Button in JSONConfig, `sendTo`-Message analog `_editPlan`-Mechanismus im Vorbild) startet `scanForShutters`, mit Auswahl `type` (Dropdown "Alle"/"Homematic"/"HomematicIP"/"KNX"/"Shelly"/"Zigbee"/"Zigbee2MQTT"/"Tuya"/"Somfy"/"Velux"/"EnOcean"/"Velbus"/"Generisch") und optional Ziel-Instanz.
- Fortschrittsmeldungen (`onProgress`) werden dem Nutzer während des Scans angezeigt (z. B. "Scanne Homematic...", "Scanne KNX...").
- Ergebnisliste wird dem Nutzer als Vorschau präsentiert (neu gefundene vs. bereits konfigurierte Rolläden anhand State-ID abgleichen, keine Duplikate anlegen); Nutzer wählt aus, welche Treffer in die `shutters`-Tabelle übernommen werden.
- Scan-Fehler pro System (z. B. Instanz nicht erreichbar) werden gesammelt und im Ergebnis als `errors: string[]` an die UI zurückgegeben, ohne den gesamten Scan abzubrechen.

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
│   │   ├── tilt                (number 0-100 bzw. 0-180° bei "lamellen", ack=false, nur relevant bei coveringType "raffstore"/"lamellen", sonst nicht angelegt) ❌
│   │   ├── tiltActual          (number, ack=true, gemappter Ist-Kippwinkel, nur relevant wie oben)                        ❌
│   │   ├── sunProtectionActive (boolean, ack=true)                                                                        ❌ nur interner Zustand in `automation.ts`
│   │   ├── sunProtectionOverrideUntil (string ISO / number ts, ack=true, gesetzt bei manueller Bedienung während aktivem Sonnenschutz; gültig bis lokal 24:00 desselben Tages) ❌ nur In-Memory, überlebt keinen Neustart (siehe 9a.2)
│   │   ├── rainProtectionActive(boolean, ack=true)                                                                        ❌ nur lokale Variable
│   │   ├── windProtectionActive(boolean, ack=true, aktuell tatsächlich wirksam)                                           ❌ nur interner Zustand
│   │   ├── windProtectionEnabled(boolean, ack=false, Konfigurationsschalter — Default abhängig von coveringType, siehe 7a/2a.5) ❌ nur `native`-Config-Feld, kein State
│   │   ├── frostProtectionActive(boolean, ack=true, aktuell tatsächlich wirksam)                                          ❌ nur lokale Variable
│   │   ├── frostProtectionEnabled(boolean, ack=false, Konfigurationsschalter — Default abhängig von coveringType, siehe 7b/2a.5) ❌ nur `native`-Config-Feld
│   │   ├── doorProtectionActive(boolean, ack=true)                                                                        ❌
│   │   ├── nightCoolingActive (boolean, ack=true, aktuell tatsächlich wirksam)                                            ❌ Feature nicht implementiert (siehe 7c)
│   │   ├── nightCoolingEnabled(boolean, ack=false, Konfigurationsschalter, Default false)                                 ❌ Feature nicht implementiert
│   │   ├── automationEnabled   (boolean, ack=false, Zone/Rolladen aus Automatik nehmen)                                   ✅
│   │   ├── statusText          (string, ack=true, menschenlesbarer Grund für aktuellen Zustand, z.B. "Sonnenschutz aktiv (bis 18:30)"; expert:false — einziger für Endnutzer primär relevanter Diagnose-State, siehe 10a.1) ✅
│   │   ├── watchdogLastIssue   (string, ack=true, expert:true, letzte erkannte "Antrieb reagiert nicht"-Meldung)          ✅
│   │   └── watchdogIssueCount  (number, ack=true, expert:true, fortlaufender Zähler)                                      ✅
│   └── shutter_NNN ...
├── groups
│   ├── group_000
│   │   ├── name        (string, ack=true)                                ❌ nur `common.name` des Channel-Objekts
│   │   ├── members      (string/JSON-Array Shutter-IDs, ack=true)         ❌ nur Config (`memberIds`), kein State
│   │   ├── position     (number, ack=false, setzt alle Mitglieder)        ✅
│   │   └── openAll/closeAll (boolean, ack=false, Buttons)                 ✅
├── quickActions
│   ├── allOpen          (boolean, ack=false, Button "Alle auf")           ❌
│   └── allClose         (boolean, ack=false, Button "Alle zu")            ❌
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

Zusätzlich vorhanden, aber im Plan nicht aufgeführt: `info.lastScanResult` (Autoscan-Ergebnis), `scenes.<id>.activate` (siehe 9b).

- `device` = einzelner Rolladen (`shutter_NNN`) bzw. Gruppe; `channel` optional für `status`/`config`; `state` wie oben.
- Bereichs-/Feiertagslogik nicht als eigene Objekt-Ebene, sondern über `native`-Konfiguration (Admin-Tabelle) + abgeleitete States.

## 4. Kalibrierung Behanghöhe → Laufzeit (Punkt 2) ✅ (nur der geführte Kalibrierlauf per `calibrate`-Button ist noch nicht implementiert, siehe `shutter-controller.ts` — bislang nur Log-Warnhinweis)

- Pro Rolladen: konfigurierbare Kalibrierungskurve, mind. 2 Stützpunkte (z. B. "0–20 % Behang = 0–5 % Laufzeit", "20–100 % Behang = 5–100 % Laufzeit"), linear interpoliert zwischen Stützpunkten.
- Admin-Tabelle `curvePoints: { behangPercent, laufzeitPercent }[]`.
- `calibrate`-Button löst geführten Kalibrierlauf aus (Rolladen ganz zu → ganz auf, Zeitmessung), Ergebnis schlägt Stützpunkte vor (analog `calibrateFlow` im irrigation-Adapter).
- `position-mapping.ts`: reine Funktionen `behangToLaufzeit(pct, curve)` / `laufzeitToBehang(pct, curve)`, unit-testbar.

## 5. Zeitsteuerung (Punkt 3 & 4) ⚠️ (Wochentag/Wochenende/Feiertag + Dämmerungskopplung fertig; iCal-Integration und Feiertags-Erkennung fehlen)

- Basiskonfiguration pro Bereich (Zone): Öffnen-Zeit, Schließen-Zeit, je getrennt für Wochentag/Wochenende/Feiertag.
- Feiertagserkennung: npm-Paket für DE-Feiertage (bundesland-abhängig) oder eigene iCal-Quelle. ❌ nicht implementiert (nur externer boolescher Feiertags-State wird konsumiert, keine eigene Erkennung)
- iCal-Integration: pro Ereignis-Titel-Konvention (analog `resolvePlanFromIcalTitle` in irrigation) z. B. "Rolläden auf 07:00" im Kalender überschreibt Tagesdefault für diesen Tag. ❌ nicht implementiert
- Dämmerungskopplung: Nutzung von `getAstroDate`/Suncalc (ioBroker Standard) für Sonnenuntergang/Ende-Dämmerung, Offset in Minuten konfigurierbar, pro Zone. ✅
- `scheduler.ts` verwendet ausschließlich `adapter.setTimeout`/`setInterval` (keine Node-Timer, kein `node-schedule`), tägliches Neuberechnen der nächsten Trigger-Zeiten um Mitternacht. ✅

## 5a. Zentrale Wetterdatenbeschaffung (mit Fallback auf externen Wetterdienst) ⚠️ (nur eigener Sensor umgesetzt, kein Wetterdienst-Fallback — Diskrepanz zu README.md)

Sonnenschutz (6), Regenschutz (7), Windschutz (7a), Frostschutz (7b), Nachtauskühlung (7c) und die Hitzeschutz-Vorabsenkung (6.5) hängen alle von Wetter-Messwerten ab. Bisher war je Modul nur "konfigurierbare Fremd-State-ID" vorgesehen — das setzt voraus, dass der Nutzer bereits eine eigene Wetterstation (z. B. `ioBroker.davis`) hat. Damit der Adapter **auch ohne eigene Wetterstation** sinnvoll funktioniert, wird die Wetterdatenbeschaffung in einem zentralen Modul `weather-source.ts` gebündelt, das pro benötigtem Messwert zwei Quellen unterstützt — eigener Sensor (bevorzugt) oder externer Wetterdienst (Fallback) — statt dass jedes Schutzmodul das einzeln lösen müsste.

### 5a.1 Benötigte Messwerte (Übersicht) ⚠️ (siehe Status-Spalte je Zeile)

| Messwert | Verwendet von | Nur mit eigenem Sensor sinnvoll? | Status |
|---|---|---|---|
| Solarstrahlung (W/m²) | Sonnenschutz primär (6.1), Bewölkungsgrad-Eigenberechnung (6.2) | Nein — auch per Wetterdienst-API verfügbar | ⚠️ nur eigener Sensor |
| Windgeschwindigkeit + Böenspitze (km/h) | Windschutz (7a) | Nein — auch per Wetterdienst-API verfügbar | ⚠️ nur eigener Sensor |
| Windrichtung (°) | Regenschutz, optional (7) | Nein | ❌ nicht in `IWeatherConfig` |
| Niederschlag (Regen ja/nein bzw. mm) | Regenschutz (7) | Nein | ⚠️ nur eigener Sensor |
| Außentemperatur (°C) | Frostschutz (7b), Hitzeschutz-Filter (6.5a), Heizperioden-Fallback (6.3) | Nein | ⚠️ nur eigener Sensor |
| Taupunkt bzw. Luftfeuchte (%) | Frostschutz-Kombikriterium (7b), Bewölkungsgrad-Eigenberechnung Modell B (6.2) | Nein | ❌ nicht in `IWeatherConfig` |
| Luftdrucktrend (hPa/3h) | Bewölkungsgrad-Eigenberechnung Modell B, optionale Verfeinerung (6.2) | Nein, aber optional entbehrlich | ❌ nicht in `IWeatherConfig` |
| Innentemperatur (°C, je Zone) | Nachtauskühlung (7c) | **Ja** — ein Wetterdienst kennt keine Innenraumtemperatur, hierfür ist zwingend ein eigener Sensor je Zone nötig; ohne eigenen Sensor ist Nachtauskühlung (7c) für die betroffene Zone deaktiviert | ❌ Feature (7c) nicht implementiert |
| Vorhersage-Tagesmaximaltemperatur (°C) | Hitzeschutz-Vorabsenkung (6.5b) | Nein — im Gegenteil, dies ist praktisch **nur** per Wetterdienst-Vorhersage sinnvoll verfügbar, eine eigene Wetterstation liefert nur Live-Messwerte, keine Vorhersage | ❌ nicht implementiert |

### 5a.2 Priorität je Messwert: eigener Sensor vor Wetterdienst ⚠️ (nur "eigener Sensor" implementiert, kein Wetterdienst zum Priorisieren)

- Für jeden Messwert (außer Innentemperatur, die es beim Wetterdienst prinzipbedingt nicht gibt) kann der Nutzer **entweder** eine eigene Fremd-State-ID (vorhandener Sensor/Adapter, z. B. `ioBroker.davis`) **oder** den zentralen Wetterdienst-Fallback (5a.3) wählen — konfigurierbar **pro Messwert einzeln**, nicht nur global pro Adapterinstanz. So kann z. B. die eigene Solarstrahlungsmessung genutzt werden, während Windgeschwindigkeit (falls kein eigenes Anemometer vorhanden) vom Wetterdienst kommt.
- Ist für einen Messwert keine eigene Fremd-State-ID konfiguriert, greift automatisch der Wetterdienst-Fallback, sofern in 5a.3 aktiviert — der Nutzer muss dafür nichts explizit umschalten (Default-Verhalten: "nimm was du hast, sonst frag den Wetterdienst").
- `weather-source.ts` liefert nach außen eine einheitliche, quellenunabhängige Schnittstelle (`getSolarRadiation(): number | undefined`, `getWindSpeed(): number | undefined`, usw.) — die Schutzmodule (6/7/7a/7b/7c) kennen nicht, ob ein Wert von einem eigenen Sensor oder vom Wetterdienst stammt.

### 5a.3 Externer Wetterdienst-Fallback ❌ (nicht implementiert — `weather-source.ts` dokumentiert dies selbst als "not implemented yet"; README.md behauptet dennoch fälschlich, ein Fallback existiere — Diskrepanz korrigieren)

- Empfohlener Standard-Anbieter: **Open-Meteo** (`open-meteo.com`) — kostenlos, **kein API-Schlüssel nötig**, liefert Live-Werte (aktuelle Strahlung, Wind, Niederschlag, Temperatur, Luftfeuchte/Taupunkt, Luftdruck) **und** eine Tagesvorhersage inkl. Maximaltemperatur über einen einzigen Endpunkt — deckt damit praktisch alle in 5a.1 gelisteten Außen-Messwerte ohne Registrierung/Kosten ab. Alternative/austauschbar: DWD Open-Data (bereits als Muster im irrigation-Vorbild für die Sperrzeit-Temperatur genutzt, siehe dortiges `DWD_STATION_URL`), falls eine rein deutsche, offizielle Quelle bevorzugt wird — dort ist eine Vorhersage-Maximaltemperatur allerdings über einen anderen Datensatz (MOSMIX) als der bisher genutzte POI-Bericht nötig.
- Konfiguration: geografische Position (Breite/Länge) — entweder manuell im Adapter oder aus der globalen ioBroker-Systemkonfiguration (`system.config`, dort ohnehin meist für Astro-Berechnungen gepflegt) übernommen, kein weiterer Pflichtwert.
- Abruf-Rhythmus: Live-Werte alle 10–15 Min (analog zum bereits vorgesehenen `sunCheckIntervalMs`, 6.1), Tagesvorhersage einmal täglich (z. B. morgens beim Scheduler-Neuberechnen, Abschnitt 5) — kein Bedarf für häufigeren Abruf, da sich eine Tagesvorhersage nicht minütlich ändert.
- Fehlerbehandlung: schlägt der Abruf fehl (analog zum `fetchDwdTemperature()`-Muster im irrigation-Vorbild), bleibt der zuletzt bekannte Wert erhalten statt eine Schutzfunktion fälschlich zu deaktivieren/aktivieren; Fehler werden geloggt und in einem `weather.lastFetchError`-State sichtbar gemacht (analog `legalRestrictionLastCheckError`).
- Neue States (global, nicht pro Rolladen): `weather.source` (string, ack=true, z. B. "eigen"/"Open-Meteo" je Messwert oder als kombinierte Übersicht), `weather.lastFetchError`, `weather.lastFetchTs`.
- Der externe Wetterdienst-Fallback ist **komplett optional/deaktivierbar** (globaler Schalter `weatherFallbackEnabled`) — wer ausschließlich eigene Sensoren nutzen möchte, kann den Adapter ohne jede Internet-Abhängigkeit betreiben; ohne Fallback bleiben die betroffenen Schutzfunktionen für nicht konfigurierte Messwerte dann inaktiv (analog zum bestehenden Designprinzip "keine Pflichtkonfiguration", 10a.3).

## 6. Sonnenschutz (Punkt 5) ⚠️ (Kernlogik 6.1/6.2/6.4 fertig; 6.3 und 6.5 offen)

Abgleich mit dem realen Vorbild-Skript `Shutters.js` (haus20a): dort wird Sonnenschutz **nicht** über Azimut/Elevation-Berechnung gelöst, sondern pragmatisch über einen **Solarstrahlungs-Schwellwert** (W/m² von einer Wetterstation) plus einem festen, pro Rolladen konfigurierbaren **Tages-Zeitfenster** — das Zeitfenster übernimmt implizit die Funktion der "trifft Sonne aufs Fenster"-Prüfung, ohne Astronomie berechnen zu müssen. Dieser Ansatz ist deutlich einfacher zu konfigurieren und zu debuggen und wird als **primäre Umsetzung für M5** übernommen; die azimut-/elevationsbasierte Variante bleibt als optionale Erweiterung (M5b) bestehen, für Fälle ohne Solarstrahlungssensor oder mit wechselnden Fensterausrichtungen ohne feste Tageszeit-Korrelation.

### 6.1 Primärer Ansatz: Solarstrahlung + Zeitfenster + Hysterese (aus Shutters.js übernommen) ✅

- Eingangsgröße: ein globaler Solarstrahlungs-State (W/m², z. B. `davis.0.sensors.tx1.solarRad` oder Nachfolger — konfigurierbare State-ID, kein Fremdsystem-Zwang).
- Pro Rolladen konfigurierbar (analog `shutters[]` in `Shutters.js`): Zielposition während Sonnenschutz (`sunprotect`, 0–100 Behang-%), Zeitfenster `spStart`/`spEnd` ("HH:MM", inklusive Start/exklusive Ende). Der im Vorbild-Skript hier zusätzlich vorhandene `block`-Türkontakt-Mechanismus wurde zu einer eigenständigen, konsistenteren Schutzfunktion ausgebaut, die auch den Sonnenschutz selbst berücksichtigt — siehe Abschnitt 7e (Türkontakt-Schutz).
- Heizperioden-Ausnahme: statt eines intern berechneten Datumsbereichs wird primär ein **extern gesetzter Boolean-State** (`isSummer`/`isHeatingPeriod`, im Vorbild von einem separaten Skript `HeatingSommerWinter.js` gepflegt) unterstützt und laufend per `subscribeForeignStatesAsync` verfolgt (nicht nur einmal beim Start gelesen — Bugfix aus dem Vorbild explizit übernehmen). Ergänzend bleibt ein interner Datumsbereich-Fallback (Abschnitt 6.3) verfügbar, falls kein externer State konfiguriert ist. ⚠️ interner Fallback (6.3) fehlt noch — ohne State ist Default derzeit "immer Sommer"
- **Hysterese gegen Flackern** bei wechselnder Bewölkung: Schließen erfolgt sofort ab `sunCloseThreshold` (Default 200 W), Öffnen dagegen erst, wenn die Strahlung **durchgehend** seit `sunOpenMinDurationMs` (Default 10 Min) unter `sunOpenThreshold` (Default 150 W) liegt. Liegt der Wert dazwischen (zwischen Open- und Close-Schwelle, Sperrzeit noch nicht abgelaufen), bleibt der aktuelle Zustand unverändert. Ohne diese Hysterese pendelt der Rolladen bei kurzen Wolkenlücken ständig zwischen Auf/Zu (im Vorbild explizit als Bugfix dokumentiert).
- Außerhalb des konfigurierten Zeitfensters (oder wenn Sonnenschutz/Zeitplan-Automatik global deaktiviert oder `isSummer=false`) wird der Rolladen regulär geöffnet (Zeitplan-Zielwert), nicht in der Sonnenschutzposition gehalten.
- `sun-protection.ts`: zustandsbehaftete Bewertung (wegen der Hysterese **nicht** rein zustandslos wie ursprünglich geplant) — pro Rolladen wird der Zeitpunkt `belowOpenThresholdSince` verfolgt; Funktionssignatur z. B. `evaluateSunProtection(input, hysteresisState): { active: boolean; targetPercent?: number }`.
- Auslösung: sowohl per periodischem Timer-Tick (Fallback, z. B. alle 5 Min) als auch ereignisgetrieben bei Änderung des Solarstrahlungs-States, dort aber auf **eine Auswertung je `sunCheckIntervalMs`** gedrosselt (Default 10 Min, aus dem Vorbild übernommen — Solarstrahlung ändert sich zu häufig für eine ungedrosselte Auswertung pro Adapter-Instanz mit vielen Rolläden).

### 6.2 Optionale Erweiterung: Azimut-/Elevation-basierter Ansatz (M5b) ⚠️ (Azimut/Elevation-Logik fertig — siehe `orientationToleranceMinusDeg`/`orientationTolerancePlusDeg`; Wolkenbedeckungs-Eigenberechnung/`cloud-cover.ts` fehlt)


- Für Rolläden ohne feste Tageszeit-Korrelation zur Sonnenscheindauer (z. B. wechselnde Verschattung durch Nachbarbebauung) oder wenn kein Solarstrahlungssensor vorhanden ist.
- Fensterausrichtung (Grad) + Toleranzbereich, Sonnenazimut/-elevation aus Astro-Lib, optional Wolkenbedeckung (Wetter-API/Sensor) als zusätzliches Kriterium statt der direkten Strahlungsmessung.
- Regel: aktiv, wenn (a) Sonne auf Fenster trifft (Azimut ± Toleranz UND Elevation > Schwellwert), (b) nicht Heizperiode, (c) Wolkenbedeckung < Schwellwert.
- Wolkenbedeckung: sofern verfügbar, direkt den bereits berechneten `cloudCover`-State aus `ioBroker.davis` (`lib/cloudcover.ts`, Modell A "solar" bei Tag, Fallback-Heuristik über Taupunkt-Depression bei Nacht/Dämmerung) als konfigurierbare Fremd-State-ID verwenden, statt selbst eine Klarhimmel-Referenz zu berechnen — spart Doppelarbeit, da dieser State genau dafür existiert.
- **Eigene Berechnung als Fallback, falls kein `cloudCover`-State existiert** (z. B. andere Wetterstation ohne dieses abgeleitete Signal, oder gar keine dedizierte Wetterstation): Die Berechnungslogik aus `ioBroker.davis/lib/cloudcover.ts` ist bewusst generisch und **nicht** Davis-spezifisch (nur Solarstrahlung + aktuelle Sonnenhöhe bzw. Temperatur/Taupunkt/Luftdrucktrend als Eingang) und lässt sich 1:1 in `sun-protection.ts` bzw. ein eigenes `cloud-cover.ts`-Modul übernehmen:
  - **Modell A ("solar", tagsüber)**: Klarhimmel-Index `kt = gemessene Strahlung / theoretische Klarhimmel-Strahlung(Sonnenhöhe)` (Haurwitz-Modell, keine Standortkalibrierung nötig), anschließend stückweise linear auf 0–100 % Bewölkung abgebildet (`kt ≥ 0.8` → 0 %, `kt ≤ 0.2` → 100 %). Voraussetzung: Solarstrahlungs-State (ohnehin für 6.1 vorhanden/konfigurierbar) und Sonnenhöhe (aus der bereits in 6.2 genutzten Astro-Lib) — kein zusätzlicher Sensor nötig, sofern ein Solarstrahlungswert existiert.
  - **Modell B ("heuristic", Fallback für Nacht/Dämmerung bzw. wenn keine Solarstrahlung verfügbar ist)**: grobe Schätzung über die Taupunkt-Depression (Temperatur minus Taupunkt), optional verfeinert mit dem Luftdrucktrend, falls ein Barometer-State vorhanden ist. Deutlich ungenauer als Modell A, aber besser als kein Signal.
  - Beide Modelle benötigen keine Kalibrierung und keine Abhängigkeit vom davis-Adapter selbst — nur konfigurierbare Fremd-State-IDs für Solarstrahlung/Temperatur/Taupunkt/Luftdruck, analog zu den übrigen Wetter-Eingängen in diesem Plan.
  - Für die Sonnenschutz-Zwecke hier reicht Modell A tagsüber vollkommen aus (Modell B ist nachts ohnehin irrelevant, da dort kein Sonnenschutz aktiv wird); Modell B wird trotzdem mit übernommen, um den Code 1:1 wiederverwenden zu können, ohne ihn künstlich zu beschneiden.
  - Ergebnis-State: gleiche Semantik wie ein externer `cloudCover`-State (0–100 %, ack=true), damit 6.2 unabhängig davon funktioniert, ob der Wert von einer Fremd-Instanz kommt oder selbst berechnet wurde.
- **Bewusst nicht** als Ersatz für die Solarstrahlungs-Schwellwerte in 6.1: `cloudCover` normiert die Messung gegen die theoretische Klarhimmel-Strahlung beim aktuellen Sonnenstand und sagt damit "wie klar ist der Himmel relativ zum Möglichen", nicht "wie viel Strahlungsleistung trifft real aufs Fenster". Ein wolkenloser Himmel bei niedrigem Sonnenstand (z. B. früh morgens) hätte 0 % Bewölkung, aber kaum reale Heizwirkung — ein reiner Bewölkungs-Schwellwert würde dort fälschlich verschatten, wo die rohe W/m²-Schwelle aus 6.1 korrekt nicht auslöst. `cloudCover` ist daher nur als **Zusatzkriterium in 6.2** sinnvoll (dort ohnehin mit expliziter Elevation-Prüfung kombiniert), nicht als 1:1-Ersatz für 6.1.
- Pro Rolladen wählbar, welcher der beiden Ansätze (6.1 oder 6.2) genutzt wird; beide teilen sich dieselbe Hysterese- und Override-Logik (6.4) und liefern eine Zielposition an dieselbe Prioritätslogik (Abschnitt 8).

### 6.3 Interner Heizperioden-Fallback (falls kein externer `isSummer`-State konfiguriert) ❌

- Konfigurierbarer Datumsbereich (z. B. Monat-Start/-Ende) oder Außentemperatur-Schwellwert als Ersatz für den externen Boolean aus 6.1.

### 6.4 Manueller Override während aktivem Sonnenschutz ("Tagessperre") ⚠️ (Logik in `automation.ts` vorhanden; `sunProtectionOverrideUntil` ist nicht persistiert, überlebt keinen Adapter-Neustart — siehe 9a.2)

- Wenn ein Nutzer einen Rolladen manuell bedient (Kommando auf `position`/`open`/`close`/`stop` mit `ack=false`, nicht von der Automatik selbst gesetzt), **während** für diesen Rolladen `sunProtectionActive === true` ist, wird die Sonnenschutzfunktion für **genau diesen Rolladen** deaktiviert, bis lokal **24:00 Uhr desselben Tages**.
- Umsetzung: `automation.ts` setzt bei Erkennung dieses Falls `sunProtectionOverrideUntil` auf Mitternacht (lokale Zeit, `adapter.setTimeout`/tägliches Reset-Timing analog zum Scheduler-Mitternachtslauf) und `sunProtectionActive` sofort auf `false`.
- Solange `now < sunProtectionOverrideUntil`, überspringt `automation.ts` die Sonnenschutz-Prüfung für diesen Rolladen komplett (auch wenn `shouldActivateSunProtection()` weiterhin `true` liefern würde) — Zeitplan und Regenschutz bleiben davon unberührt und funktionieren normal weiter.
- Um Mitternacht (gemeinsamer Reset-Zeitpunkt mit dem täglichen Scheduler-Neuberechnen, siehe Abschnitt 5) wird `sunProtectionOverrideUntil` automatisch gelöscht/zurückgesetzt, Sonnenschutz ist am nächsten Tag wieder regulär aktiv.
- Abgrenzung zum allgemeinen manuellen Override (Abschnitt 8, Punkt 1): jener pausiert die **gesamte** Automatik nur kurzzeitig/bis zum nächsten Zeitplanpunkt; dieser Override betrifft **ausschließlich den Sonnenschutz** dieses einen Rolladens und gilt fest bis 24:00 — beide Mechanismen bestehen nebeneinander (siehe Reihenfolge unten).
- Ein erneutes manuelles Bedienen am selben Tag verlängert die Sperre nicht über 24:00 hinaus (Sperre ist immer "bis Tagesende", nicht "X Stunden ab jetzt").
- Regenschutz ist von dieser Sperre **nicht** betroffen — bei akutem Regen soll der Rolladen trotz aktiver Sonnenschutz-Tagessperre weiterhin vor Nässe geschützt werden.

### 6.5 Temperaturabhängige Steuerung (Hitzeschutz) ❌

Ergänzung gegenüber dem Vorbild-Skript (dort nur Solarstrahlung + Zeitfenster, keine Temperaturbetrachtung). Temperatur spielt in zwei unterschiedlichen Rollen eine sinnvolle, voneinander unabhängig aktivierbare Rolle:

**a) Als Filter gegen unnötige Verschattung an hellen, aber kühlen Tagen:**

- Optionaler Schwellwert `sunProtectionMinTemp` (z. B. 20 °C, Außentemperatur-Quelle wie bereits für Heizperioden-Erkennung genutzt, siehe 6.3). Sonnenschutz (6.1/6.2) wird nur aktiv, wenn **zusätzlich** zur Solarstrahlungs-/Azimut-Bedingung diese Temperaturschwelle erreicht ist.
- Zweck: an einem klaren, aber kühlen Tag (hohe Strahlung, niedrige Temperatur — z. B. Frühling) besteht keine Überhitzungsgefahr; ohne dieses Kriterium würde rein nach W/m²-Schwellwert trotzdem unnötig verschattet werden, was für den Nutzer wie ein Fehlverhalten wirkt ("warum fährt der Rolladen runter, es ist doch angenehm draußen?").
- Standardmäßig deaktiviert (kein Schwellwert gesetzt = Verhalten wie bisher, nur Strahlung/Zeitfenster maßgeblich), da nicht jeder Nutzer eine zuverlässige Außentemperaturquelle hat.

**b) Als vorausschauender Trigger für eine frühere/aggressivere Verschattung (Vorabsenkung an Hitzetagen):**

- Eingang: **Vorhersage-Maximaltemperatur** für den laufenden Tag, aus einer konfigurierbaren Fremd-State-ID (z. B. Wettervorhersage-Adapter; `ioBroker.davis` liefert selbst keine Vorhersage, hierfür wäre ein zusätzlicher Wetterdienst wie z. B. eine bereits im System vorhandene Vorhersage-Quelle nötig — siehe offene Fragen, Abschnitt 11).
- Regel: überschreitet die für **heute** vorhergesagte Maximaltemperatur einen konfigurierbaren Schwellwert (`heatDayForecastTemp`, z. B. 28 °C), wird dieser Tag intern als "Hitzetag" markiert (`isHeatDay`, ack=true, einmal täglich beim Scheduler-Neuberechnen morgens ermittelt, siehe Abschnitt 5). An einem Hitzetag:
  - wird der Solarstrahlungs-Schließschwellwert (`sunCloseThreshold`, 6.1) für diesen Tag automatisch abgesenkt (z. B. um 30–50 %), sodass der Rolladen schon bei geringerer Strahlung früher am Morgen schließt, statt erst bei voller Mittagssonne zu reagieren — nutzt die thermische Trägheit des Gebäudes aus, statt erst auf bereits eingetretene Aufheizung zu reagieren.
  - **alternativ/ergänzend** kann eine feste, frühere Startzeit für das Sonnenschutz-Zeitfenster (`spStart`, 6.1) für Hitzetage konfiguriert werden (`spStartHeatDay`), unabhängig von der Solarstrahlung.
- Diese Vorabsenkung ist rein additiv zur bestehenden Logik (6.1/6.2) — kein neues Prioritäts-Level in Abschnitt 8 nötig, sie verändert nur die **Eingangsparameter** der bestehenden Sonnenschutz-Bewertung für den jeweiligen Tag.
- Ist keine Vorhersage-Quelle konfiguriert, bleibt dieses Feature inaktiv (kein Pflichtbestandteil, siehe Designprinzip "sinnvolle Defaults ohne Pflichtkonfiguration", 10a.3); Fallback ist dann ausschließlich das reaktive Verhalten aus 6.1/6.2 plus optional (a) den aktuellen Temperaturfilter.
- Neuer State: `astro.isHeatDay` (boolean, ack=true, global oder pro Zone, falls unterschiedliche Vorhersagequellen/Schwellwerte je Hausseite sinnvoll sind).

## 7. Regenschutz (Punkt 6) ✅

Hinweis: Im Vorbild-Skript `Shutters.js` ist Regenschutz **nicht** implementiert (nur Zeitplan + Sonnenschutz) — dieser Abschnitt ist eine Neuerung gegenüber dem Vorbild, kein übernommenes Muster.

- Eingang: Regen-Sensor-State-ID (extern verlinkt, `subscribeForeignStates`), optional Windrichtung.
- Regel: bei Regen + Windrichtung auf Fensterseite (± Toleranz wie bei Sonnenschutz) → Rolladen auf konfigurierte Schutzposition fahren (z. B. nicht ganz zu, damit Fensterbank/Rahmen nicht nass wird, oder ganz zu je Fenstertyp — konfigurierbar).
- Priorität ggü. Sonnenschutz und Zeitplan: Regenschutz > Sonnenschutz > Zeitplan > manuelle Position (mit `automationEnabled=false` als Override-Escape).
- `rain-protection.ts`: analog Sonnenschutz-Modul, eigene Bewertungsfunktion.

## 7a. Windschutz / Sturmwarnung (Sicherheitsfunktion, höchste Priorität) ⚠️ (Kernlogik + Hysterese + `windProtectionEnabled` fertig; typabhängige `safePosition`-Tabelle aus 2a.5 fehlt — Zielposition ist hart auf `0` codiert)

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

- Eingang: Außentemperatur-State (z. B. bereits für Heizperioden-Erkennung genutzt, siehe 6.3) und optional Luftfeuchte/Niederschlag zur Erkennung akuter Vereisungsgefahr (Temperatur nahe/unter 0 °C **und** Feuchte/Niederschlag vorhanden — reine Kältetrockenheit ist unkritisch).
- Regel: unterhalb eines konfigurierbaren Schwellwerts (`frostThreshold`, Default 0–2 °C) **in Kombination mit** Feuchte/Regen werden reguläre Fahrbefehle (Zeitplan, Sonnenschutz) verzögert bzw. ausgesetzt, um ein Festfrieren des Behangs in einer Zwischenposition oder am Antrieb zu vermeiden. Bereits offene Rolläden werden nicht zwangsweise geschlossen, bereits geschlossene nicht zwangsweise geöffnet — die aktuelle Position bleibt einfach erhalten.
- Windschutz (7a) hat weiterhin Vorrang vor dem Frostschutz-Aussetzen, falls beide gleichzeitig zutreffen (Sturmschaden ist das größere Risiko als ein einzelner ausgesetzter Fahrbefehl).
- Manuelle Kommandos werden trotz Frostschutz ausgeführt (Nutzer trägt hier bewusst das Risiko), nur die automatisierten Fahrbefehle werden ausgesetzt.
- **Explizit pro Einheit ein-/ausschaltbar** (`frostProtectionEnabled`, boolean, eigener Konfigurationswert, analog zum Windschutz-Schalter in 7a), da Frostrelevanz ebenfalls vom Behangtyp und der Einbausituation abhängt: Default **aktiviert** für `rolladen`/`raffstore`/`markise` (Außeneinsatz, witterungsexponiert), Default **deaktiviert** für `lamellen` (i. d. R. innenliegend, keine Vereisungsgefahr, siehe 2a.5). Ist `frostProtectionEnabled = false`, wird für diese Einheit keine Frostbewertung durchgeführt — automatisierte Fahrbefehle laufen dann unverändert nach der übrigen Prioritätslogik (Abschnitt 8).
- Neuer State je Rolladen: `frostProtectionActive` (boolean, ack=true, aktuell tatsächlich wirksam) sowie `frostProtectionEnabled` (boolean, ack=false, Konfigurationsschalter).
- `frost-protection.ts`: einfache, zustandslose Bewertungsfunktion (kein Hysterese-Bedarf, da kein Flackerproblem wie bei Solarstrahlung/Wind); prüft `frostProtectionEnabled` als ersten, einfachen Gate vor jeder weiteren Bewertung (gleiches Muster wie `windProtectionEnabled` in 7a).

## 7c. Sommer-Nachtauskühlung ❌ (Modul `night-cooling.ts` existiert nicht — README behauptet fälschlich, es sei vorhanden)

Neuerung gegenüber dem Vorbild-Skript. Gegenteil des abendlichen Standard-Schließens: nachts gezielt offen lassen/öffnen, um Innentemperaturen abzukühlen.

- Eingang: Innentemperatur-State (raum- bzw. zonenweise, konfigurierbare Fremd-State-ID) und Außentemperatur (bereits vorhanden, siehe 6.3/7b).
- Regel: ist die Innentemperatur einer Zone über einem konfigurierbaren Schwellwert (`nightCoolingIndoorMinTemp`, z. B. 24 °C) **und** die Außentemperatur spürbar niedriger (`nightCoolingMinDelta`, z. B. mind. 3 °C kühler) **und** es ist Nacht (nach Zeitplan-Schließzeitpunkt bzw. innerhalb eines konfigurierbaren Nachtfensters), werden die betroffenen Rolläden geöffnet (oder das abendliche Schließen ausgesetzt), um über offene Fenster/Lüftung eine Abkühlung zu ermöglichen.
- Nur relevant für Sommer (nutzt denselben `isSummer`/Heizperioden-Fallback wie Sonnenschutz, 6.3) und nur pro Zone/Rolladen aktivierbar (z. B. nicht für Schlafzimmer mit Verdunkelungswunsch).
- **Explizit pro Einheit/Zone ein-/ausschaltbar** (`nightCoolingEnabled`, boolean, eigener Konfigurationswert, analog zu `windProtectionEnabled`/`frostProtectionEnabled` in 7a/7b). Anders als Wind- und Frostschutz ist Nachtauskühlung eine reine **Komfortfunktion** ohne Sicherheitsbezug und setzt zusätzlich einen konfigurierten Innentemperatur-Sensor voraus — daher Default **deaktiviert** für **alle** Behangtypen (siehe 2a.5), unabhängig von `coveringType`; der Nutzer aktiviert sie bewusst nur für die Zonen/Rolläden, bei denen nächtliches Öffnen gewünscht und ein Innentemperatur-Sensor vorhanden ist. Ist `nightCoolingEnabled = false` (Default) oder kein Innentemperatur-Sensor konfiguriert, bleibt Schritt 7c für diese Einheit vollständig inaktiv.
- Priorität: niedriger als Windschutz/Regenschutz (Sicherheit geht vor), aber höher als der reguläre abendliche Zeitplan-Schließbefehl, da sie diesen gezielt aussetzt/umkehrt.
- Neuer State je Rolladen: `nightCoolingActive` (boolean, ack=true, aktuell tatsächlich wirksam) sowie `nightCoolingEnabled` (boolean, ack=false, Konfigurationsschalter, Default `false`).
- `night-cooling.ts`: eigene Bewertungsfunktion, liefert bei Aktivierung eine Zielposition (meist "ganz offen") analog zu den übrigen Schutzmodulen; prüft `nightCoolingEnabled` als ersten Gate.

## 7d. Motorschutz: Mindestpause zwischen Fahrten ❌

Neuerung gegenüber dem Vorbild-Skript. Schützt den Antrieb vor zu häufigem Kurztakten, z. B. durch Grenzfälle in der Sonnenschutz-/Windschutz-Hysterese oder mehrfaches schnelles Nutzer-Tippen.

- Pro Rolladen konfigurierbarer Mindestabstand (`minCommandIntervalMs`, Default z. B. 5–10 s) zwischen zwei tatsächlich ausgeführten Fahrbefehlen (Schreibzugriffen auf den Driver), unabhängig davon, welches Modul (Zeitplan, Sonnenschutz, manuell) den Befehl auslöst.
- Befehle, die innerhalb der Sperrzeit eingehen, werden nicht verworfen, sondern der **letzte** angeforderte Zielwert wird gepuffert und nach Ablauf der Sperrzeit einmalig nachgeholt (verhindert sowohl Motorverschleiß als auch verlorene Befehle).
- **Ausnahme**: Windschutz (7a) umgeht die Mindestpause, da die Sicherheitsreaktion auf Sturm nicht durch einen Motorschutz-Timer verzögert werden darf.
- Umsetzung zentral in `shutter-controller.ts` (nicht in den einzelnen Regel-Modulen), da alle Zielpositions-Quellen über diesen Punkt laufen (siehe Abschnitt 8, letzter Absatz).

## 7e. Türkontakt-Schutz (kein Zufahren bei geöffneter Terrassen-/Balkontür) ✅

Löst die bisher nur im Vorbild-Skript enthaltene, dort auf einen Spezialfall (`h20a_EG_Diele_DoorSensor`) beschränkte `block`-Idee aus 6.1 heraus in eine eigenständige, systematische Schutzfunktion — sinnvoll für jeden Rolladen an einer Terrassen-/Balkontür, nicht nur für einen fest verdrahteten Einzelfall.

- Pro Rolladen optional konfigurierbar: ein Türkontakt-/Fensterkontakt-State (`doorContactId`, boolean, "offen"/"geschlossen"), typischerweise an Terrassen-/Balkontüren, seltener an normalen Fenstern relevant.
- Regel: Solange der verlinkte Kontakt "offen" meldet, wird **jede Aktion, die den Rolladen weiter herunterfahren würde** (Zeitplan-Schließen, Sonnenschutz-Zufahren/Absenken, Regenschutz-Zufahren, ein manuelles Zu-Kommando ausgenommen — siehe unten) unterdrückt. **Öffnende** Aktionen (Zeitplan-Auf, Windschutz-Hochfahren, Nachtauskühlung) sind von der Sperre **nie** betroffen, da Hochfahren bei offener Tür immer unproblematisch ist.
- Ein **manuelles** Zu-Kommando des Nutzers wird trotz offener Tür ausgeführt (der Nutzer sieht ja, dass die Tür offen ist, und trägt hier bewusst die Verantwortung) — die Sperre gilt ausschließlich für automatisierte Fahrbefehle, analog zur Behandlung von Frostschutz (7b) und in Abgrenzung zu Windschutz (7a), das immer Vorrang hat.
- Priorität ggü. den übrigen Schutzfunktionen: **niedriger als Windschutz** (7a öffnet ohnehin nur, kein Konflikt), aber **höher als Regenschutz, Sonnenschutz und Zeitplan** — eine offene Tür ist der eindeutigere/unmittelbarere Sicherheitshinweis als drohender Regen. Praktisch bedeutet das: bei offener Tür bleibt der Rolladen in seiner aktuellen (oder einer zuvor erreichten, weiter offenen) Position stehen, auch wenn Regen- oder Sonnenschutz eigentlich ein Zufahren verlangen würden; sobald die Tür wieder geschlossen wird, wird die zu diesem Zeitpunkt eigentlich gültige Zielposition sofort nachgeholt (kein Warten auf den nächsten Automatik-Tick).
- Ersetzt/verallgemeinert den bisherigen, nur auf den Zeitplan wirkenden `block`-State aus 6.1: dort war die Wirkung auf "Zeitplan-Aktionen unterdrücken" beschränkt und wirkte **nicht** auf den Sonnenschutz (im Vorbild-Skript bewusst so, aber fachlich eine Lücke bei Terrassentüren mit aktivem Sonnenschutz-Zeitfenster). Diese Lücke wird hier geschlossen: der Türkontakt-Schutz gilt konsistent für **alle** automatisierten Zufahr-Aktionen.
- Neuer State je Rolladen: `doorProtectionActive` (boolean, ack=true) sowie in `statusText`/`activityLog` (10a.1/10a.8) sichtbar als eigener Grund, z. B. "Zufahren ausgesetzt: Terrassentür offen".
- `door-protection.ts`: einfache, zustandslose Bewertungsfunktion (kein Hysterese-Bedarf — Türkontakte liefern ein eindeutiges, nicht flackerndes Signal), liefert `blocked: boolean` für "würde diese Aktion den Rolladen weiter schließen".

## 8. Prioritäts-/Konfliktlogik ⚠️ (Reihenfolge im Kern korrekt umgesetzt; manuelles Kommando läuft direkt im Controller statt als Tick-Schritt, Türkontaktschutz ist ein Clamp statt eigener Prioritätsstufe, Nachtauskühlung als Stufe fehlt)

Zentrale `automation.ts` (analog `AutomationEngine` in irrigation), die pro Rolladen-Tick in fester Reihenfolge auswertet:

1. **Windschutz aktiv (7a)** → Einheit sofort in ihre typabhängige Sicherheitsposition fahren (siehe 2a.5; bei `rolladen`/`raffstore`/`markise` einheitlich 0 %, jeweils physisch "eingefahren/hochgefahren") — höchste Priorität, überstimmt jede andere Regel inkl. eines aktiven Sonnenschutz-Overrides.
2. Manuelles Kommando gerade jetzt erkannt (State mit `ack=false` auf `position`/`open`/`close`/`stop`) → Aktion sofort ausführen (sofern nicht durch Windschutz überstimmt; Türkontakt-Schutz aus 7e gilt hier **nicht** — ein manuelles Kommando wird immer ausgeführt); zusätzlich: falls `sunProtectionActive` zu diesem Zeitpunkt `true` war, `sunProtectionOverrideUntil` auf 24:00 Uhr desselben Tages setzen (siehe 6.4). Allgemein pausiert das manuelle Kommando die übrige Automatik zusätzlich für konfigurierbare Zeit oder bis zum nächsten Zeitplanpunkt.
3. **Türkontakt-Schutz aktiv (7e)** und die für Schritt 4/5 ermittelte Zielposition würde den Rolladen weiter schließen → Zielwert auf die aktuelle Ist-Position begrenzen (kein Zufahren); rein öffnende Zielwerte (z. B. aus Zeitplan-Auf) sind davon nicht betroffen und werden normal ausgeführt.
4. Regenschutz aktiv → Zielposition Regenschutz (unabhängig von einer aktiven Sonnenschutz-Tagessperre, siehe 6.4; unterliegt aber der Türkontakt-Begrenzung aus Schritt 3).
5. Sonnenschutz aktiv **und** `now >= sunProtectionOverrideUntil` (bzw. kein Override gesetzt) → Zielposition Sonnenschutz (unterliegt ebenfalls Schritt 3).
6. Zeitplan (inkl. Dämmerung/Feiertag/iCal) → Zielposition Zeitplan, **sofern nicht Frostschutz (7b) aktiv** (dann wird der Fahrbefehl ausgesetzt, aktuelle Position bleibt erhalten) und unterliegt bei einem Schließ-Zielwert ebenfalls Schritt 3.
7. Keine Regel aktiv → keine Aktion.

Jede Zielposition wird über `position-mapping.ts` in Laufzeit-% umgerechnet und an `shutter-controller.ts` (Antriebssteuerung, z. B. via verlinkter Fremd-States eines Rolladenaktors) übergeben. Wie im Vorbild (`setShutter()`) wird vor jedem Schreibzugriff der aktuelle Ist-Wert gelesen und nur bei tatsächlicher Abweichung geschrieben, um unnötige Aktor-Befehle zu vermeiden; Schreibfehler pro Rolladen werden abgefangen/geloggt, ohne die Verarbeitung der übrigen Rolläden im selben Tick zu blockieren (siehe Bugfix-Historie in `Shutters.js`).

## 9. Admin-UI (JSONConfig) ⚠️ (tatsächlich ein custom Materialize-HTML/JS-Ansatz statt JSONConfig, `io-package.json` setzt `adminUI.config: "materialize"`; Kalibrierung/Sonnenschutz/Wind-/Frostschutz-Felder vorhanden, aber kein Einrichtungsassistent)

- Tabelle `shutters`: Name, **`coveringType`-Dropdown** (Rolladen/Raffstore/Markise/Lamellenvorhang/…, siehe 2a.5) mit typabhängig angepassten Feld-Bezeichnungen, **`driverType`-Dropdown** (homematic/knx/shelly/zigbee/generic-relay/generic-position/…), abhängig davon dynamisch ein-/ausgeblendete Fremd-State-ID-Felder (auf/zu/stopp bzw. Position-State je Driver, plus Kippwinkel-State bei Raffstore/Lamellenvorhang), Ausrichtung, Bereich, Kalibrierkurve, Automatik an/aus.
- Tabelle `areas`/`zones`: Name, Öffnen-/Schließzeiten (Wochentag/Wochenende/Feiertag), Dämmerungs-Offset, iCal-URL optional.
- Panel `sunProtection`: globale/zonen-Schwellwerte (Elevation, Wolkenbedeckung, Heizperiode-Zeitraum oder Temperatur-Schwellwert), Zielposition.
- Panel `rainProtection`: Regen-Sensor-State-ID, Windrichtung-State-ID (optional), Toleranzen, Zielposition.
- Alle Labels über `admin/i18n/{lang}/translations.json`, keine Strings direkt im JSONConfig; nach Änderungen `npm run translate`.
- **Einrichtungsassistent** (siehe 10a.3): geführter Wizard-Screen "Rolläden suchen → benennen → fertig" oberhalb der Detail-Tabellen, mit direktem Einstieg in den Autoscan (2b); alle Detail-Panels (Kalibrierung, Sonnenschutz-Feinabstimmung, Wind-/Frostschutz-Schwellwerte) sind als "Erweitert"/"Experte" gekennzeichnet und standardmäßig eingeklappt, um die Einstiegshürde niedrig zu halten.

## 9a. Watchdog & Zustands-Recovery ⚠️

Übernommen aus `BW Automatik.js` (irrigation-Vorbild) — dort als bewährter, generischer Sicherheitsmechanismus dokumentiert, hier auf Rolladen-Antriebe übertragen.

### 9a.1 Watchdog: hängender Antrieb ✅ (inline in `shutter-controller.ts` statt eigenem `watchdog.ts`-Modul, funktional aber vorhanden)

- Bei jedem Fahrbefehl wird eine erwartete Fahrzeit (aus Kalibrierkurve/`position-mapping.ts` bzw. einer konfigurierbaren Maximaldauer je Rolladen) hinterlegt.
- Ist die erwartete Fahrzeit plus eine Toleranz (`watchdogGraceSecs`, Default 120 s, wie im Vorbild) überschritten, aber der Antrieb meldet laut `IShutterDriver.isMoving()`/`getCurrentPosition()` weiterhin "in Bewegung" bzw. hat die Zielposition nicht erreicht, wird dies als hängender/nicht reagierender Antrieb gewertet.
- Meldung: `watchdogLastIssue`/`watchdogIssueCount`-States aktualisieren, Log-Eintrag, optional Notify-Versand (siehe 9a.3). Es wird nicht wiederholt für dieselbe Fahrt gemeldet (Dedupe wie im Vorbild `watchdogReported`).
- Rolladen-Systeme ohne Positions-/Bewegungsrückmeldung (z. B. `generic-relay`, manche EnOcean-Profile) können den Watchdog nur eingeschränkt nutzen (nur Zeitüberschreitung, keine Bewegungsbestätigung) — in der Admin-UI entsprechend kennzeichnen.

### 9a.2 Zustands-Recovery nach Adapter-Neustart ⚠️ (Watchdog-States sind `ack=true` persistiert; `sunProtectionOverrideUntil` ist nur In-Memory und keine `recoverAutomatikStateAfterRestart()`-Logik beim `ready`-Handler)

- Laufende Fahrbefehle sowie alle Override-/Schutz-Zustände (`sunProtectionOverrideUntil`, `windProtectionActive`, `frostProtectionActive`) werden mit `ack=true` persistiert, sodass sie einen Adapter-Neustart überleben.
- Beim `ready`-Handler wird geprüft, ob laut persistiertem Zustand eine Fahrt "in Bewegung" war (State-Objekt-Zeitstempel `ts` deutlich älter als die erwartete Fahrzeit) — analog zu `recoverAutomatikStateAfterRestart()` im Vorbild: sicherheitshalber wird der reale Ist-Zustand beim jeweiligen Driver erneut abgefragt (`getCurrentPosition()`) statt blind dem letzten internen State zu vertrauen, da der Antrieb während der Downtime des Adapters unabhängig weitergefahren/gestoppt sein könnte.
- `sunProtectionOverrideUntil` wird nach einem Neustart nicht zurückgesetzt, sondern bleibt bis zum gespeicherten Zeitpunkt gültig (persistenter State, kein reiner In-Memory-Zustand wie ursprünglich in 6.4 skizziert — Anpassung: Umsetzung über `ack=true`-State statt reinem `setTimeout`-Handle, das einen Neustart nicht überleben würde).

### 9a.3 Notify-Integration (optional) ❌ (README behauptet fälschlich, dies sei vorhanden)

- Analog zum Vorbild (Pushover/Telegram-Kanäle, je per Instanz-Name konfigurierbar, `null`/leer deaktiviert einen Kanal) für: Watchdog-Meldungen, Eintritt/Ende von Windschutz (Sturmwarnung), Eintritt/Ende von Frostschutz.
- Fehler beim Notify-Versand (Adapter nicht installiert/konfiguriert) werden abgefangen und geloggt, ohne die übrige Verarbeitung zu beeinträchtigen.

## 9b. Szenen/Vorgabepositionen ✅ (als `scene-manager.ts`)

- Benannte Presets (`scenes[]` in der Konfiguration), die für einen einzelnen Rolladen oder eine Gruppe mehrere Zielwerte gleichzeitig setzen (z. B. "Kino": Wohnzimmer-Rolläden auf 100 % zu; "Nachtruhe": Kinderzimmer auf 100 %, restliches EG auf 30 %).
- Auslösung per Button-State (`scenes.<name>.activate`, ack=false) oder programmatisch per `sendTo`, unabhängig vom Zeitplan — läuft in der Prioritätslogik (Abschnitt 8) auf derselben Stufe wie ein manuelles Kommando (setzt also ggf. ebenfalls den Sonnenschutz-Override, 6.4, falls betroffene Rolläden gerade in Sonnenschutz stehen).
- Szenen kennen keine eigene Fahrlogik, sondern rufen intern für jeden betroffenen Rolladen denselben `setPosition()`-Pfad wie ein manuelles Kommando auf.

## 9e. Dashboard-Hinweis (README, kein Adapter-Code) ❌

- README-Abschnitt mit Empfehlung, welche States sich für ein vis/vis-2-Dashboard-Widget eignen: `positionActual`, `sunProtectionActive`, `windProtectionActive`, `rainProtectionActive`, Gruppen-Buttons (`groups.*.openAll`/`closeAll`), sowie `watchdogLastIssue` für eine Fehler-Übersicht. Keine Umsetzung im Adapter selbst, nur Dokumentationshinweis.

## 10. Umsetzungsreihenfolge (Milestones) ⚠️ (M1-M3/M5-M7/M7b fertig; M1b/M4/M6c/M8 teilweise; M6d offen — siehe Status je Milestone)

1. **M1 — Grundgerüst** ✅: create-adapter, io-package.json, Objekt-Hierarchie für einzelne Rolläden, manuelle Steuerung (Position setzen/lesen), `info.connection`.
2. **M1b — Driver-Layer** ⚠️ (7 von 16 Drivern fertig — Kern-Set fast komplett, `hmip`/Erweiterungs-Set und Nachtrag-Set offen): `IShutterDriver`-Interface, `driver-factory.ts`, mindestens `generic-position-driver` und `generic-relay-driver` fertig implementiert und getestet (unabhängig von konkretem Fremdsystem lauffähig, z. B. per Testadapter-Instanz simuliert); danach Kern-Set (`homematic`, `knx`, `shelly`, `zigbee`), dann Erweiterungs-Set (`tuya`, `somfy`, `hmip`, `zigbee2mqtt`, `mqtt`), dann Nachtrag-Set (`velux`, `enocean`, `loxone`, `velbus`, `homey`) iterativ ergänzen — siehe Priorisierung in 2a.4, jeweils gegen echtes/simuliertes Fremdsystem verifizieren.
3. **M2 — Behangkalibrierung** ✅: `position-mapping.ts` + Admin-Tabelle + Kalibrierlauf (Driver-unabhängig, arbeitet auf Laufzeit-% egal welcher Driver).
4. **M3 — Zeitplan** ✅: `scheduler.ts` inkl. Wochentag/Wochenende/Feiertag, ohne iCal/Dämmerung zunächst.
5. **M4 — Dämmerung & iCal** ⚠️ (Dämmerung ✅, iCal ❌): Erweiterung Scheduler.
6. **M5 — Sonnenschutz** ✅: primär Solarstrahlung + Zeitfenster + Hysterese (6.1); Astro-/Elevation-Variante (6.2) optional als Nachtrag.
7. **M6 — Regenschutz** ✅: Sensor-Anbindung + Regel-Engine + Prioritätslogik (`automation.ts`) inkl. Konflikt mit Sonnenschutz/Zeitplan.
8. **M6b — Windschutz, Frostschutz & Türkontakt-Schutz** ✅: `wind-protection.ts` (mit Hysterese, höchste Priorität in `automation.ts`), `frost-protection.ts` und `door-protection.ts` (7e); Erweiterung der Prioritätslogik aus Abschnitt 8.
9. **M6c — Watchdog & Zustands-Recovery** ⚠️ (Watchdog inline vorhanden, Recovery unvollständig, Notify offen): `watchdog.ts`, persistierte Override-/Fahrzustände, Recovery-Logik beim `ready`-Handler (siehe 9a); optional Notify-Integration (9a.3).
10. **M6d — Nachtauskühlung & Motorschutz** ❌: `night-cooling.ts` (7c) und Mindestpause-Logik in `shutter-controller.ts` (7d).
11. **M7 — Gruppen/Alias** ✅: `groups` Objekt-Ebene, Sammelsteuerung mehrerer Rolläden **über gemischte Driver-Typen hinweg** (eine Gruppe kann z. B. Homematic- und KNX-Rolläden gleichzeitig enthalten, da `shutter-controller.ts` nur das einheitliche Interface kennt).
12. **M7b — Szenen** ✅: Presets (9b).
13. **M8 — Tests & Release** ⚠️ (Lint/Release-Workflow etabliert, viele Kernmodule ohne Tests — siehe Test-Lücken unten; kein Integrationstest, kein README-Dashboard-Hinweis): Unit-Tests für `position-mapping`, `sun-protection`, `rain-protection`, `wind-protection`, `frost-protection`, `night-cooling`, `scheduler`, **je Driver mit gemockten Fremd-States**; Integrationstest via `@iobroker/testing`; Lint; Adapter-Checker; README-Dashboard-Hinweis (9e); erster Release (`npm run release patch`).

**Testlücken (Stand 2026-08-14)**: keine Unit-Tests für `automation.ts` (zentrale Prioritätslogik), `shutter-controller.ts`, `weather-source.ts`, `group-controller.ts`, `scene-manager.ts`, `driver-factory.ts`, `generic-position-driver.ts`, `generic-relay-driver.ts` und die konkreten Kern-Set-Driver-Klassen (nur die gemeinsame Basis `position-stop-driver-base.ts` ist getestet); `test/integration.js` ist unverändertes Scaffold ohne eigene Testfälle.

## 10a. Endnutzer-Bedienkonzept (Einfachheit als Designziel) ⚠️ (siehe Status je Unterabschnitt 10a.1-10a.14)

Der gesamte bisherige Plan ist bewusst technisch/vollständig gehalten (viele Driver, viele Schutzfunktionen, viele Konfigurationsfelder). Für den **täglichen Gebrauch** darf davon so wenig wie möglich sichtbar sein. Leitprinzip: Komplexität steckt in der Konfiguration (einmalig, durch einen technisch versierten Nutzer), nicht in der Bedienung (täglich, durch jedes Familienmitglied).

### 10a.1 Reduzierte State-Oberfläche für Endnutzer ✅ (`statusText` + `expert:true`-Flags vorhanden; `activityLog` aus 10a.8 fehlt separat)

- Pro Rolladen/Gruppe nur eine **kleine, klar benannte Menge** an für Endnutzer relevanten States, mit sprechenden `common.name`: Position (Slider 0–100), Auf/Zu/Stopp-Buttons, ein einziger `automationEnabled`-Schalter ("Automatik an/aus" statt einzeln Sonnenschutz/Zeitplan/Nachtauskühlung an-/abschaltbar zu machen).
- Alle technischen/diagnostischen States (Driver-interne Rohwerte, `positionRaw`, Watchdog-Zähler, Kalibrierkurven-Rohdaten, Hysterese-Zeitstempel) erhalten `common.expert: true` bzw. werden in einem separaten `diagnostics`-Unterbaum abgelegt, damit sie in Standard-Dashboards (Admin "Objekte"-Ansicht mit Experten-Modus aus, vis-Widget-Auswahl) nicht auftauchen und den Nutzer nicht verwirren.
- Ein einziger, **menschenlesbarer Statustext** je Rolladen (`statusText`, analog `STATES.status` im Bewässerungs-Vorbild), der die aktuell wirksame Regel benennt, z. B. "Sonnenschutz aktiv (bis 18:30)" oder "Windschutz: hochgefahren (Sturmwarnung)" oder "Zeitplan: geschlossen bis 07:30" — beantwortet die häufigste Nutzerfrage ("Warum macht der Rolladen das gerade?") ohne dass der Nutzer die Prioritätslogik aus Abschnitt 8 verstehen muss.

### 10a.2 Physische Taster/Fernbedienungen bleiben die primäre Bedienung ✅ (architekturell durch manuellen Override in 6.4/Abschnitt 8 abgedeckt)

- Der Adapter greift **nicht** in vorhandene physische Wandtaster/Fernbedienungen ein — diese steuern weiterhin direkt den Aktor (Homematic/KNX/etc.), der Adapter erkennt die resultierende Zustandsänderung nur passiv über die verlinkten Fremd-States (genau das löst bereits der manuelle Override in 6.4/Abschnitt 8, Punkt 2). Für den Nutzer ändert sich an der gewohnten Bedienung also nichts — "es funktioniert einfach weiter wie bisher", die Automatik reagiert nur intelligent auf das, was ohnehin passiert.
- Kein Zwang, für die Grundbedienung eine App/ioBroker-Oberfläche zu öffnen — nur für Komfortfunktionen (Zeitplan ändern, Szenen) ist eine Oberfläche nötig.

### 10a.3 Einfache Voreinstellungen statt Pflichtkonfiguration ⚠️ (Defaults für Schwellwerte vorhanden; Einrichtungsassistent/Wizard fehlt — laut `admin/i18n/en.json` explizit "not implemented yet")

- Sinnvolle Defaults für praktisch alle Schwellwerte (Sonnenschutz-, Wind-, Frostschutz-Werte aus Abschnitt 6/7 sind bereits mit Default-Werten spezifiziert), sodass ein Rolladen nach dem Autoscan (2b) **ohne weitere Eingabe** sofort sinnvoll funktioniert (Zeitplan Auf/Zu, kein Sonnenschutz, keine Kalibrierkurve nötig — lineare 1:1-Zuordnung Behang=Laufzeit als Default, siehe Abschnitt 4, verfeinerbar aber optional).
- **Einrichtungsassistent** (Admin-UI-Wizard, aufbauend auf dem Autoscan aus 2b): führt in wenigen Schritten durch "Rolläden suchen → Namen vergeben → fertig", Kalibrierung/Sonnenschutz/Zeitplan-Feinjustierung sind bewusst separate, überspringbare Folgeschritte statt eines langen Pflichtformulars.
- Zonen/Gruppen werden beim Autoscan, wo möglich, aus der Objekt-Struktur der Fremdinstanz vorbelegt (z. B. Raumname aus `enum.rooms.*`), damit der Nutzer nicht jeden Rolladen händisch einer Zone zuordnen muss.

### 10a.4 Zentrale Schnellaktionen statt Einzelsteuerung ⚠️ (Gruppen-Buttons `openAll`/`closeAll` pro Gruppe vorhanden; globale `quickActions.allOpen`/`allClose` über alle Rolläden fehlen)

- Wenige, prominente Sammel-Buttons statt vieler Einzel-Schalter: "Alle auf", "Alle zu". Diese decken die häufigsten Alltagssituationen ohne pro Rolladen einzeln etwas einstellen zu müssen.
- Gruppen (Abschnitt 3, `groups`) sind die primäre Bedienebene für den Alltag ("Rolläden EG", "Kinderzimmer"), einzelne Rolläden sind eher die Ausnahme (z. B. ein Fenster, das anders behandelt werden soll).

### 10a.5 Sprachsteuerung/Smart-Home-Integration ohne Zusatzaufwand ✅ (folgt automatisch aus korrekter `role`/`name`-Vergabe, keine Zusatzarbeit nötig)

- Korrekte `common.role: "level.blind"` und sinnvolle `common.name` je Rolladen/Gruppe reichen aus, damit gängige Alexa-/Google-Home-Kopplungsadapter (`ioBroker.iot`, `ioBroker.cloud`) die Rolläden automatisch als steuerbare Rolladen/Cover erkennen — keine Sonderintegration im `shutters`-Adapter selbst nötig, nur konsequente Einhaltung der Standard-Rollen/-Typen aus der ioBroker-Objekt-Schema-Konvention.
- Dadurch funktioniert z. B. "Alexa, schließe die Rolläden im Wohnzimmer" ohne jeden Zusatzaufwand im Adapter, sofern der Nutzer den entsprechenden Kopplungsadapter ohnehin einsetzt.

### 10a.6 Benachrichtigungen bewusst sparsam halten ❌ (gegenstandslos, da Notify-Integration 9a.3 komplett fehlt)

- Notify-Kanäle (9a.3) nur für Ereignisse, auf die der Nutzer **reagieren muss oder sollte** (Watchdog/hängender Antrieb, Sturmwarnung-Auslösung, Fremdsystem dauerhaft nicht erreichbar) — bewusst **keine** Benachrichtigung bei jedem normalen Sonnenschutz-/Zeitplan-Vorgang, um Benachrichtigungsmüdigkeit zu vermeiden, die dazu führt, dass wichtige Meldungen ignoriert werden.

### 10a.7 Vorwarnung vor automatischer Fahrt ❌

- Bei automatisch ausgelösten Fahrbefehlen (Zeitplan, Sonnenschutz, Windschutz, Nachtauskühlung — **nicht** bei direkt vom Nutzer ausgelösten Kommandos) optional eine kurze Vorlaufzeit (`autoMoveWarningSecs`, konfigurierbar, Default z. B. 0 = deaktiviert) einhalten und währenddessen ein Signal ausgeben, z. B. eine TTS-Ansage über einen vorhandenen Sprachausgabe-Adapter (`sayit`, `text2command`, o. ä., als konfigurierbare Fremd-Instanz) oder ein Blinken einer verknüpften Leuchte. Sicherheitsrelevant, damit niemand von einer sich unerwartet bewegenden Rolladenmechanik überrascht wird.
- Windschutz (7a) darf durch die Vorwarnzeit **nicht** relevant verzögert werden (Sicherheitsfunktion hat Vorrang) — die Vorwarnung läuft dort, wenn überhaupt, nur parallel zur sofortigen Fahrt, nicht davor.
- Standardmäßig deaktiviert (Default 0 s), da sie zusätzliche Konfiguration (Lautsprecher-/Leuchten-Instanz) voraussetzt und nicht jeder Haushalt sie braucht.

### 10a.8 Aktivitäts-Verlauf je Rolladen ❌

- Zusätzlich zum aktuellen `statusText` (10a.1) ein kurzes, rollierendes Log der letzten 5–10 automatischen Aktionen je Rolladen (`activityLog`, JSON-Array mit Zeitstempel + Kurzbeschreibung + auslösendem Modul), z. B. "14:32 Sonnenschutz aktiviert", "18:30 Zeitplan: geschlossen". Beantwortet nicht nur "was macht er jetzt", sondern auch "was hat er heute gemacht und warum" — reduziert Rückfragen und erleichtert die Fehlersuche bei unerwartetem Verhalten.
- Wird von derselben Stelle geschrieben wie `statusText` (`automation.ts`, Abschnitt 8), sodass keine zusätzliche Logik zur Ermittlung des Auslösers nötig ist.

### 10a.9 "Letzte automatische Aktion rückgängig machen" ❌

- Button je Rolladen (`undoLastAutoAction`, ack=false), der die zuletzt vom `activityLog` (10a.8) protokollierte automatische Positionsänderung durch die davor geltende Position ersetzt (einfacher Ein-Schritt-Undo, keine vollständige Historie/Redo nötig).
- Löst intern denselben manuellen-Kommando-Pfad wie ein normales Nutzerkommando aus (inkl. Sonnenschutz-Tagessperre, siehe 6.4, falls zutreffend) — der Rolladen verhält sich danach so, als hätte der Nutzer direkt eingegriffen.
- Sinnvoll v. a. in Kombination mit 10a.7 (Vorwarnung) und 10a.8 (Verlauf): der Nutzer sieht, was passiert ist/passieren wird, und kann gezielt gegensteuern.

### 10a.10 Sammel-Konfiguration / Einstellungen übertragen ❌

- In der Admin-Tabelle `shutters` eine Aktion "Einstellungen kopieren auf...", die Sonnenschutz-/Wind-/Frostschutz-Schwellwerte und Zeitfenster eines Rolladens auf eine Auswahl anderer Rolläden (z. B. alle im selben Bereich oder mit derselben Ausrichtung) übertragen kann, statt jeden Rolladen einzeln pflegen zu müssen. Rein State-/Objekt-technisch (kein neues Fremdsystem-Wissen nötig), Umsetzung als `sendTo`-Message analog zum Autoscan-Mechanismus (2b.3).

### 10a.11 Konsistente Defaults für neu erkannte Rolläden im selben Bereich ❌

- Erweiterung des Autoscans (2b): wird ein neuer Rolladen in einer bereits konfigurierten Zone/einem bereits konfigurierten Bereich gefunden, werden die dort bereits üblichen Einstellungen (Zeitfenster, Sonnenschutz-Zielposition/-Schwellwerte) als Vorschlag für den neuen Rolladen vorbelegt, statt mit Leerwerten/globalen Defaults zu starten — reduziert Konfigurationsaufwand beim Nachrüsten weiterer Rolläden im selben Raum.

### 10a.12 Inline-Hilfetexte in der Admin-UI ⚠️ (vereinzelt vorhanden, z. B. Scan-Hinweistext; kein systematisches `help`-Feld je Schwellwert, da kein JSONConfig verwendet wird — siehe Abschnitt 9)

- Jedes technisch nicht selbsterklärende Feld (insbesondere die Solarstrahlungs-/Windgeschwindigkeits-Schwellwerte aus 6.1/7a) erhält einen kurzen `help`-Text in einfacher Sprache direkt im JSONConfig-Feld, z. B. "Höherer Wert = Verschattung reagiert erst bei stärkerer Sonneneinstrahlung" statt nur die Einheit (W/m²) anzuzeigen — richtet sich an Nutzer ohne technischen Hintergrund zur Solarstrahlung.
- Konsistent mit der bestehenden Vorgabe, alle Labels über `admin/i18n/{lang}/translations.json` zu pflegen (Abschnitt 9).

### 10a.13 Test-Button pro Rolladen ❌ (auch der bestehende `calibrate`-Button führt laut Code nur einen Log-Warnhinweis aus, kein geführter Kalibrierlauf)

- Zusätzlicher Button `testMove` je Rolladen in der Admin-Tabelle bzw. im States-Baum, der einmalig kurz auf- und wieder zufährt (oder eine konfigurierbare Testposition ansteuert), um die Konfiguration (Driver, State-IDs) sofort zu verifizieren, ohne auf den nächsten Zeitplan- oder Sonnenschutz-Trigger warten zu müssen. Ergänzt den bereits vorhandenen `calibrate`-Button (Abschnitt 4), der auf die Kalibrierkurve fokussiert ist, hier geht es nur um "reagiert der Rolladen überhaupt".

### 10a.14 Saisonale Erinnerungen ❌ (setzt fehlendes Notify (9a.3) und fehlendes `isHeatDay`/Saisonlogik voraus)

- Einmaliger (nicht wiederholter) Hinweis beim ersten tatsächlichen Aktivwerden des Sonnenschutzes in einer neuen Saison ("Sonnenschutz ist jetzt wieder aktiv — Zeitfenster/Zielposition weiterhin passend?"), über denselben Notify-Kanal wie andere wichtige Meldungen (9a.3), aber deutlich als Hinweis statt als Alarm markiert.
- Verhindert, dass veraltete Konfiguration (z. B. Zeitfenster aus dem Vorjahr) erst durch tatsächliches Fehlverhalten auffällt, statt proaktiv in Erinnerung gerufen zu werden.

## 11. Offene Fragen für Nutzer (vor Umsetzung klären) ❌ (nie schriftlich beantwortet/dokumentiert, z. B. in `CONTEXT.md` oder Commit-Historie)

- Welche Systeme sind konkret im Einsatz bzw. sollen als Erstes unterstützt werden (Reihenfolge der Driver-Implementierung, siehe 2a.4/M1b)? Homematic/HomematicIP/KNX/Shelly/Zigbee/Zigbee2MQTT/Tuya/Somfy/Velux/EnOcean/Velbus/Loxone/Homey/generische Relais — Mehrfachnennung möglich, da Ziel explizit Multi-System-Fähigkeit ist.
- Existierende Wetterdaten-Quelle im System (z. B. `ioBroker.davis`-Adapter aus diesem Workspace) für Wolkenbedeckung/Wind/Regen nutzbar?
- Feiertags-Bundesland und ob Berücksichtigung pro Zone unterschiedlich sein muss.
- iCal-Kalenderquelle (Google, Nextcloud, lokale .ics-Datei?).
