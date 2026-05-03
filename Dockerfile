# ── Basisimage: ARM64-kompatibel (HCU läuft auf ARM64) ──────────────────────
# Laut Doku: "Use an ARM64-compatible base image"
# Das offizielle eQ-3 Basisimage: ghcr.io/homematicip/alpine-node-simple:0.0.1
# Wir nutzen das direkt, da es Node.js auf Alpine/ARM64 bereitstellt.
FROM --platform=linux/arm64 ghcr.io/homematicip/alpine-node-simple:0.0.1

WORKDIR /app

# Dependencies installieren
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# Quellcode kopieren
COPY src ./src

# Persistent storage directory (HCU mountet /data für Plugin-Daten)
RUN mkdir -p /data

# ── Plugin-Metadaten als Docker Label ────────────────────────────────────────
# PFLICHT laut Connect API Doku 1.0.1 Kap. 4.1
# Label-Key: de.eq3.hmip.plugin.metadata
# Pflichtfelder: pluginId, issuer, version, hcuMinVersion, scope, friendlyName.de
LABEL de.eq3.hmip.plugin.metadata='\
{\
  "pluginId": "de.eq3.homeconnect",\
  "issuer": "community",\
  "version": "0.1.0",\
  "hcuMinVersion": "1.4.7",\
  "scope": "CLOUD",\
  "friendlyName": {\
    "en": "Home Connect",\
    "de": "Home Connect"\
  },\
  "description": {\
    "en": "Integrates Bosch/Siemens/Neff/Gaggenau Home Connect appliances into Homematic IP HCU.",\
    "de": "Bindet Bosch/Siemens/Neff/Gaggenau Home Connect Geräte in die Homematic IP HCU ein."\
  },\
  "logsEnabled": true\
}'

# ── Startbefehl ───────────────────────────────────────────────────────────────
# /TOKEN wird von der HCU automatisch in den Container kopiert (enthält authToken)
# host.containers.internal ist der HCU-interne Hostname (Connect API Port 9001)
ENTRYPOINT ["node", "src/index.js"]
