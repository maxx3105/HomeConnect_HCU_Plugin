FROM --platform=linux/arm64 ghcr.io/homematicip/alpine-node-simple:0.0.1

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

RUN mkdir -p /data

LABEL de.eq3.hmip.plugin.metadata='{"pluginId":"com.github.maxx3105.homeconnect","issuer":"community","version":"0.1.0","hcuMinVersion":"1.4.7","scope":"CLOUD","friendlyName":{"en":"Home Connect","de":"Home Connect"},"description":{"en":"Integrates Home Connect appliances into Homematic IP HCU.","de":"Bindet Home Connect Geraete in die Homematic IP HCU ein."},"logsEnabled":true}'

ENTRYPOINT ["node", "src/index.js"]
