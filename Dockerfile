FROM node:20-alpine

WORKDIR /app

COPY package*.json .
RUN npm install ws uuid --omit=dev

COPY plugin.js .

ENTRYPOINT ["node", "plugin.js", "com.github.maxx3105.homeconnect", "host.containers.internal", "/TOKEN"]

LABEL de.eq3.hmip.plugin.metadata='{"pluginId":"com.github.maxx3105.homeconnect","issuer":"Markus","version":"1.0.0","hcuMinVersion":"1.4.7","scope":"CLOUD","friendlyName":{"en":"Home Connect","de":"Home Connect"},"description":{"en":"Home Connect integration","de":"Home Connect Integration"},"logsEnabled":true}'
