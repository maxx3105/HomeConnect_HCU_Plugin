FROM node:20-alpine

WORKDIR /app

# Deps-Install separat für besseren Layer-Cache
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY plugin-description.json ./

# Token-Persistenz
VOLUME ["/app/data"]
ENV NODE_ENV=production
ENV TOKEN_STORE=/app/data/tokens.json

CMD ["node", "src/index.js"]
