import "dotenv/config";

export const config = {
  homeConnect: {
    baseUrl:      process.env.HC_BASE_URL    ?? "https://api.home-connect.com",
    clientId:     process.env.HC_CLIENT_ID   ?? "",
    clientSecret: process.env.HC_CLIENT_SECRET ?? "",
    scopes:       process.env.HC_SCOPES      ?? "IdentifyAppliance Monitor Control Settings",
  },
  // Token-Datei für OAuth Refresh-Tokens (im Container: /data/tokens.json)
  tokenStore: process.env.TOKEN_STORE ?? "/data/tokens.json",
  logLevel:   process.env.LOG_LEVEL   ?? "info",
};
