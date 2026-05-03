import fs from "node:fs/promises";
import { logger } from "./logger.js";
import { HomeConnectAuth } from "./homeconnect/auth.js";
import { HomeConnectClient } from "./homeconnect/client.js";
import { HomeConnectEventStream } from "./homeconnect/events.js";
import { HcuClient } from "./hcu/client.js";
import { Bridge } from "./bridge.js";

const PLUGIN_ID   = process.env.HCU_PLUGIN_ID ?? "com.github.maxx3105.homeconnect";
const CONFIG_FILE = "/data/config.json";

async function resolveAuthToken() {
  try { return (await fs.readFile("/TOKEN", "utf8")).trim(); }
  catch {
    const env = process.env.HCU_AUTH_TOKEN;
    if (env) return env;
    throw new Error("Kein Auth-Token.");
  }
}

async function loadConfig() {
  try { return JSON.parse(await fs.readFile(CONFIG_FILE, "utf8")); }
  catch { return null; }
}

async function saveConfig(cfg) {
  await fs.mkdir("/data", { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/** Sendet CONFIG_TEMPLATE_RESPONSE mit optionalem Auth-Status */
function sendConfigTemplate(hcu, cfg, authState) {
  const properties = {
    hcClientId: {
      friendlyName:  "Client ID",
      description:   "Home Connect API Client ID (developer.home-connect.com → Applications)",
      dataType:      "STRING",
      required:      "true",
      groupId:       "homeconnect",
      currentValue:  cfg?.clientId ?? "",
      minimumLength: 10,
      maximumLength: 200
    },
    hcClientSecret: {
      friendlyName:  "Client Secret",
      description:   "Home Connect API Client Secret",
      dataType:      "STRING",
      required:      "true",
      groupId:       "homeconnect",
      currentValue:  cfg?.clientSecret ? "••••••••" : "",
      minimumLength: 10,
      maximumLength: 200
    }
  };

  // Während Device Flow: Code + Link als zusätzliche Felder anzeigen
  if (authState?.code) {
    properties.hcAuthCode = {
      friendlyName:  "Autorisierungs-Code",
      description:   "Diesen Code auf der Home Connect Webseite eingeben (Zwischenablage-Button verwenden)",
      dataType:      "STRING",
      required:      "false",
      groupId:       "auth",
      currentValue:  authState.code,
      minimumLength: 0,
      maximumLength: 20
    };
    properties.hcAuthLink = {
      friendlyName:  "Autorisierungs-Link",
      description:   "Link direkt öffnen und Code eingeben",
      dataType:      "STRING",
      required:      "false",
      groupId:       "auth",
      currentValue:  authState.link,
      minimumLength: 0,
      maximumLength: 500
    };
    properties.hcAuthStatus = {
      friendlyName:  "Status",
      description:   `Warte auf Autorisierung... (läuft ab in ${authState.expires}s)`,
      dataType:      "STRING",
      required:      "false",
      groupId:       "auth",
      currentValue:  "⏳ Bitte Link öffnen und Code eingeben",
      minimumLength: 0,
      maximumLength: 100
    };
  }

  hcu.sendConfigTemplateResponse({
    correlationId: null,
    groups: {
      homeconnect: {
        friendlyName: "Home Connect API",
        description:  "Zugangsdaten der Home Connect Developer App",
        order: 1
      },
      ...(authState?.code ? {
        auth: {
          friendlyName: "Autorisierung",
          description:  "Home Connect Autorisierung läuft",
          order: 2
        }
      } : {})
    },
    properties
  });
}

async function main() {
  logger.info({ pluginId: PLUGIN_ID }, "HCU Home Connect Plugin startet");

  const authToken = await resolveAuthToken();
  const hcuHost   = process.env.HCU_HOST ?? "host.containers.internal";
  const hcu       = new HcuClient({ host: hcuHost, authToken, pluginId: PLUGIN_ID });

  let cfg       = await loadConfig();
  let authState = null; // { code, link, expires } während Device Flow

  hcu.on("config_template_request", ({ correlationId }) => {
    logger.info("Config-Template angefragt");
    sendConfigTemplate(hcu, cfg, authState);
  });

  hcu.on("config_update_request", async ({ correlationId, properties }) => {
    logger.info("Config-Update empfangen");

    // Auth-Felder ignorieren (readonly)
    const newCfg = {
      clientId:     properties.hcClientId ?? cfg?.clientId,
      clientSecret: (properties.hcClientSecret === "••••••••")
                      ? cfg?.clientSecret
                      : (properties.hcClientSecret ?? cfg?.clientSecret),
    };

    if (!newCfg.clientId || !newCfg.clientSecret) {
      hcu.sendConfigUpdateResponse({
        correlationId,
        status:  "REJECTED",
        message: "Client ID und Client Secret sind erforderlich."
      });
      return;
    }

    try { await fs.unlink("/data/tokens.json"); } catch {}
    await saveConfig(newCfg);
    cfg = newCfg;
    logger.info("Konfiguration gespeichert, starte neu...");

    hcu.sendConfigUpdateResponse({
      correlationId,
      status:  "APPLIED",
      message: "Konfiguration gespeichert. Plugin wird neu gestartet..."
    });
    setTimeout(() => process.exit(0), 1000);
  });

  await hcu.start();
  await new Promise((resolve) => hcu.once("ready", resolve));

  if (!cfg?.clientId || !cfg?.clientSecret) {
    logger.warn("Keine Konfiguration. Bitte in HCUweb konfigurieren.");
    hcu.setReadiness("NOT_READY");
    await new Promise(() => {});
    return;
  }

  logger.info("Starte Home Connect...");
  const auth = new HomeConnectAuth({
    clientId:     cfg.clientId,
    clientSecret: cfg.clientSecret,
  });

  // Callback: Code in Konfig-Ansicht anzeigen
  auth.onDeviceCode = ({ code, link, expires }) => {
    logger.info({ code, link }, "Device Code erhalten - wird bei nächstem Config-Request angezeigt");
    authState = { code, link, expires };
    // Kein unaufgefordertes Senden - HCU fragt selbst wenn Config-Seite geöffnet wird
  };

  await auth.init();
  authState = null; // Code nicht mehr anzeigen nach Autorisierung

  const hc = new HomeConnectClient(auth);
  logger.info("Frage Home Connect Geräte ab...");
  const appliances = await hc.listAppliances();
  logger.info({ count: appliances.length, types: appliances.map(a => a.type) }, "Gefundene Geräte");

  const upgraded = await auth.upgradeScopes(appliances);
  if (upgraded) {
    cfg.cachedScopes = auth.scopes;
    await saveConfig(cfg);
  }

  const sse    = new HomeConnectEventStream(auth);
  const bridge = new Bridge({ hcu, hc, sse });
  await bridge.run();
  logger.info("Plugin läuft.");

  const shutdown = (sig) => { sse.stop(); hcu.stop(); process.exit(0); };
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => { logger.fatal({ err: err.message }, "Fataler Fehler"); process.exit(1); });
