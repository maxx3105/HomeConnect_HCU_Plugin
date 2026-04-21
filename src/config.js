import "dotenv/config";

function required(name) {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

export const config = {
  homeConnect: {
    baseUrl: process.env.HC_BASE_URL ?? "https://api.home-connect.com",
    clientId: required("HC_CLIENT_ID"),
    clientSecret: required("HC_CLIENT_SECRET"),
    scopes: (process.env.HC_SCOPES ?? "IdentifyAppliance Monitor Control Settings").trim(),
  },
  hcu: {
    host: required("HCU_HOST"),
    // Standard-WebSocket-Pfad der HCU Connect API.
    // Falls die offizielle Doku einen abweichenden Pfad vorsieht, hier anpassen.
    wsPath: process.env.HCU_WS_PATH ?? "/plugins/ws",
    authToken: required("HCU_AUTH_TOKEN"),
    pluginId: required("HCU_PLUGIN_ID"),
    insecureTls: (process.env.HCU_INSECURE_TLS ?? "1") === "1",
  },
  tokenStore: process.env.TOKEN_STORE ?? "./data/tokens.json",
  logLevel: process.env.LOG_LEVEL ?? "info",
};
