# HCU ⇄ Home Connect Plugin

Homematic IP HCU Plugin (Node.js), das Home Connect Geräte (Bosch, Siemens, Neff,
Gaggenau, Balay, Thermador) in deine Homematic IP Installation einbindet.

Das Plugin nutzt die **Homematic IP Connect API** (WebSocket) und die
**Home Connect API** (REST + Server-Sent Events) und bildet jedes Home-Connect-
Gerät als virtuelles Gerät in der HCU ab.

## Architektur

```
 ┌──────────────┐     WebSocket       ┌─────────────────────┐      REST / SSE       ┌───────────────┐
 │   HCU        │ ◀────JSON (header/  │  Node.js Plugin     │ ◀───OAuth2 + Bearer──▶│ Home Connect  │
 │ (hcu1-xxxx)  │      body)──────────▶│  (dieses Projekt)   │      api.home-        │ Cloud         │
 └──────────────┘                     └─────────────────────┘      connect.com       └───────────────┘
```

- **`src/hcu/`** – Client zur HCU (Auth, State-Sync, Events, Control-Dispatch).
- **`src/homeconnect/`** – OAuth2 Device Flow, REST-Client, SSE-Event-Stream.
- **`src/devices/`** – Mapping von Home-Connect-Geräten auf HCU-Device-Typen mit
  Channels/Features (Power, Programm, Restzeit, Tür, Programm-Start …).
- **`src/bridge.js`** – Bindeglied: verdrahtet HC-Events zu HCU-Updates und
  HCU-Control-Requests zu HC-REST-Calls.

## Voraussetzungen

### 1. Home Connect Developer Account

1. Konto auf <https://developer.home-connect.com> anlegen.
2. Unter **Applications** eine neue App anlegen.
3. **OAuth Flow:** *Device Flow* wählen (kein Webserver für Redirect nötig).
4. Scopes auswählen für jede Geräteklasse, die du steuern willst, z. B.
   `IdentifyAppliance Monitor Control Settings Dishwasher Washer CoffeeMaker`.
5. `Client ID` und `Client Secret` notieren.
6. Beim Registrieren deine **Home Connect User-Account-Email** als
   "Default Home Connect User Account for Testing" eintragen (nur Kleinbuchstaben).
   Danach muss die App vor Nutzung freigeschaltet werden (bis zu 15 min).

### 2. HCU Entwicklermodus

1. HCUweb öffnen: `https://hcu1-XXXX.local` (XXXX = letzte 4 Stellen der SGTIN).
2. Entwicklermodus aktivieren. Vorher Backup anlegen – Rückweg nur per
   Werksreset oder Backup-Restore.
3. Lokalen API-Zugriff (WebSocket) aktivieren.
4. Aktivierungsschlüssel / Plugin-Auth-Token erzeugen.

## Installation

```bash
git clone <dieses repo>
cd hcu-homeconnect-plugin
npm install
cp config.example.json config.json
cp .env.example .env
# .env mit HC Client ID/Secret und HCU-Verbindungsdaten füllen
npm start
```

Beim ersten Start druckt das Plugin einen Home-Connect-Device-Code samt URL in
den Log; an dem Gerät deiner Wahl öffnen, Code eingeben, authorisieren – der
Refresh-Token wird in `./data/tokens.json` gespeichert.

## Docker (für lokalen HCU-Plugin-Betrieb)

```bash
docker build -t hcu-homeconnect-plugin .
docker run -d --name hcu-hc-plugin \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  hcu-homeconnect-plugin
```

## ⚠️ Wichtiger Hinweis zum HCU-Protokoll

Die offizielle `connect-api-documentation-1.0.1.html` aus
<https://github.com/homematicip/connect-api/releases/tag/1.0.1> definiert das
exakte WebSocket-Nachrichtenschema zwischen Plugin und HCU. In diesem Projekt
sind die Schemata in **einer einzigen Datei** isoliert:

> `src/hcu/protocol.js`

Dort sind die Nachrichtentypen (`PLUGIN_STATE_REQUEST`, `DEVICE_ADDED`,
`CONTROL_REQUEST`, …) und ihre Felder als Konstanten und Builder-Funktionen
definiert. Sollten einzelne Feldnamen in der offiziellen Doku anders heißen
(z. B. `messageType` statt `type`), passe sie **nur in dieser Datei** an – alles
andere bleibt unverändert. Die Konventionen hier folgen dem Java-Referenz-
Paketlayout `de.eq3.plugin.{device,control,user,system}`.

Das Home-Connect-Teil (`src/homeconnect/`) ist vollständig nach offizieller
Spec implementiert und sollte out of the box laufen.

## Unterstützte Geräteklassen (Referenzimplementierung)

| Home Connect Typ | HCU-Mapping                                | Features                                          |
|------------------|--------------------------------------------|---------------------------------------------------|
| Dishwasher       | Switch + TextStatus + ProgramSelector      | Power, ActiveProgram, RemainingTime, DoorState    |
| Washer           | Switch + TextStatus + ProgramSelector      | Power, ActiveProgram, RemainingTime, DoorState    |
| Dryer            | Switch + TextStatus + ProgramSelector      | Power, ActiveProgram, RemainingTime, DoorState    |
| CoffeeMaker      | Switch + TextStatus + ProgramSelector      | Power, ActiveProgram, BeanAmount                  |
| Oven             | Switch + TextStatus + NumberTarget (Temp)  | Power, ActiveProgram, Temperatur-Setpoint         |

Weitere Geräte (Hood, Cooktop, Fridge, Freezer, CleaningRobot) lassen sich nach
demselben Muster in `src/devices/` ergänzen.

## Lizenz

Apache-2.0 – gleich wie die Connect API Beispiele von eQ-3.
