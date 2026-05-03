# HCU ⇄ Home Connect Plugin

Bindet Bosch/Siemens/Neff/Gaggenau Home-Connect-Geräte in die Homematic IP HCU ein.

## Wie es funktioniert

Das Plugin läuft als **Docker-Container auf der HCU**:
- Auth-Token kommt automatisch aus `/TOKEN` (wird von der HCU beim Installieren rein gelegt)
- WebSocket verbindet auf `wss://host.containers.internal:9001`
- Persistente Daten (OAuth-Token für Home Connect) in `/data`

## Plugin bauen und installieren

### Schritt 1 – Home Connect Developer App anlegen

1. Konto auf https://developer.home-connect.com anlegen
2. Neue Application anlegen, **Device Flow** wählen
3. Scopes: `IdentifyAppliance Monitor Control Settings Dishwasher Washer Dryer CoffeeMaker Oven`
4. `Client ID` und `Client Secret` notieren

### Schritt 2 – .env befüllen

```bash
cp .env.example .env
nano .env
# Mindestens setzen:
# HC_CLIENT_ID=...
# HC_CLIENT_SECRET=...
```

Die `.env` wird **nicht** ins Docker-Image gebrannt. Sie wird nur beim ersten Start
(lokale Entwicklung) oder via Docker-Compose-Environment übergeben.

### Schritt 3 – Image bauen und als .tar.gz exportieren

```bash
chmod +x build-plugin.sh
./build-plugin.sh
```

Das Skript erzeugt `homeconnect-plugin-0.1.0.tar.gz`.

> **ARM64 vs x86:** Die HCU läuft auf ARM64. Auf einem x86-Entwicklerrechner
> braucht docker buildx + QEMU (`docker run --privileged --rm tonistiigi/binfmt --install arm64`).
> Auf einem Raspberry Pi / ARM-Server funktioniert ein normales `docker build`.

### Schritt 4 – Plugin auf der HCU installieren

1. HCUweb öffnen: `https://hcu1-XXXX.local`
2. **Entwicklermodus** aktivieren (Backup vorher!)
3. Plugins → **Eigenes Plugin installieren**
4. `homeconnect-plugin-0.1.0.tar.gz` hochladen

### Schritt 5 – Home Connect autorisieren

Beim ersten Start druckt das Plugin einen Code in den Log:

```
OPEN: https://www.home-connect.com/security/oauth/pairing
ENTER CODE: XXXX-XXXX
```

Im Log des Containers (HCUweb → Plugin → Logs) nachsehen und Code eingeben.

## Umgebungsvariablen

| Variable | Beschreibung | Pflicht |
|---|---|---|
| `HC_CLIENT_ID` | Home Connect Client ID | ✅ |
| `HC_CLIENT_SECRET` | Home Connect Client Secret | ✅ |
| `HC_SCOPES` | OAuth Scopes (Space-getrennt) | Nein |
| `HCU_PLUGIN_ID` | Plugin ID (Standard: `de.eq3.homeconnect`) | Nein |
| `HCU_HOST` | HCU-Host (nur für lokale Entwicklung) | Nein |
| `HCU_AUTH_TOKEN` | Auth-Token (nur für lokale Entwicklung) | Nein |
| `LOG_LEVEL` | `debug`/`info`/`warn` | Nein |

Im Container auf der HCU: `HCU_HOST` und `HCU_AUTH_TOKEN` werden ignoriert —
das Plugin liest den Token aus `/TOKEN` und verbindet auf `host.containers.internal:9001`.

## Lokale Entwicklung (Remote Plugin)

```bash
npm install
cp .env.example .env
# .env befüllen mit HCU_HOST und HCU_AUTH_TOKEN (aus HCUweb generieren)
npm start
```

## Plugin-Metadaten (Docker Label)

Das Plugin-Manifest sitzt als Label im Dockerfile:
```
LABEL de.eq3.hmip.plugin.metadata='{ "pluginId": "de.eq3.homeconnect", ... }'
```
Pflichtfelder: `pluginId`, `issuer`, `version`, `hcuMinVersion`, `scope`, `friendlyName.de`
