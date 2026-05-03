FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src

RUN mkdir -p /data

ENTRYPOINT ["node", "src/index.js"]

LABEL de.eq3.hmip.plugin.metadata='{"pluginId":"com.github.maxx3105.homeconnect","issuer":"Markus Hiebler","version":"0.1.0","hcuMinVersion":"1.4.7","scope":"LOCAL","friendlyName":{"en":"Home Connect","de":"Home Connect"},"description":{"en":"Integrates Home Connect appliances into Homematic IP HCU.","de":"Bindet Home Connect Geraete in die Homematic IP HCU ein."},"logsEnabled":true}'
