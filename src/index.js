/**
 * HCU Home Connect Plugin
 * Laut Connect API Doku 1.0.1:
 *  - WebSocket: wss://host.containers.internal:9001
 *  - Auth-Token: /TOKEN (von der HCU automatisch befüllt)
 *  - Persistent Storage: /data
 */
import fs from "node:fs/promises";
import { logger } from "./logger.js";
import { HomeConnectAuth } from "./homeconnect/auth.js";
import { HomeConnectClient } from "./homeconnect/client.js";
import { HomeConnectEventStream } from "./homeconnect/events.js";
import { HcuClient } from "./hcu/client.js";
import { Bridge } from "./bridge.js";

const PLUGIN_ID = process.env.HCU_PLUGIN_ID ?? "com.github.maxx3105.homeconnect";

async function resolveAuthToken() {
  try {
    const t = await fs.readFile("/TOKEN", "utf8");
    logger.info("Auth-Token aus /TOKEN gelesen (HCU-Container)");
    return t.trim();
  } catch {
    const env = process.env.HCU_AUTH_TOKEN;
    if (env) {
      logger.warn("Lokale Entwicklung: verwende HCU_AUTH_TOKEN aus .env");
      return env;
    }
    throw new Error("Kein Auth-Token: weder /TOKEN noch HCU_AUTH_TOKEN gefunden.");
  }
}

async function resolveHost() {
  // Im HCU-Container immer host.containers.internal, extern via .env überschreibbar
  return process.env.HCU_HOST ?? "host.containers.internal";
}

async function main() {
  logger.info({ pluginId: PLUGIN_ID }, "HCU Home Connect Plugin startet");

  const [authToken, hcuHost] = await Promise.all([resolveAuthToken(), resolveHost()]);

  const hcu  = new HcuClient({ host: hcuHost, authToken, pluginId: PLUGIN_ID });
  const auth = new HomeConnectAuth();
  await auth.init();

  const hc   = new HomeConnectClient(auth);
  const sse  = new HomeConnectEventStream(auth);
  const bridge = new Bridge({ hcu, hc, sse });

  await hcu.start();
  await new Promise((resolve) => hcu.once("ready", resolve));
  await bridge.run();

  logger.info("Plugin läuft.");

  const shutdown = (sig) => { logger.info({ sig }, "Shutdown"); sse.stop(); hcu.stop(); process.exit(0); };
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => { logger.fatal({ err: err.message }, "Fataler Fehler"); process.exit(1); });
