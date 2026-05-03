/**
 * HCU Home Connect Plugin
 * Startet erst wenn HC_CLIENT_ID und HC_CLIENT_SECRET
 * über HCUweb konfiguriert wurden.
 */
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { logger } from "./logger.js";
import { HomeConnectAuth } from "./homeconnect/auth.js";
import { HomeConnectClient } from "./homeconnect/client.js";
import { HomeConnectEventStream } from "./homeconnect/events.js";
import { HcuClient } from "./hcu/client.js";
import { Bridge } from "./bridge.js";

const PLUGIN_ID  = process.env.HCU_PLUGIN_ID ?? "com.github.maxx3105.homeconnect";
const CONFIG_FILE = "/data/config.json";

async function resolveAuthToken() {
  try {
    const t = await fs.readFile("/TOKEN", "utf8");
    return t.trim();
  } catch {
    const env = process.env.HCU_AUTH_TOKEN;
    if (env) return env;
    throw new Error("Kein Auth-Token: weder /TOKEN noch HCU_AUTH_TOKEN.");
  }
}

async function loadConfig() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveConfig(cfg) {
  await fs.mkdir("/data", { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

async function main() {
  logger.info({ pluginId: PLUGIN_ID }, "HCU Home Connect Plugin startet");

  const authToken = await resolveAuthToken();
  const hcuHost   = process.env.HCU_HOST ?? "host.containers.internal";
  const hcu       = new HcuClient({ host: hcuHost, authToken, pluginId: PLUGIN_ID });

  // Config laden
  let cfg = await loadConfig();

  // HCU verbinden - Config-Handler registrieren BEVOR start()
  hcu.on("config_template_request", ({ correlationId, languageCode }) => {
    logger.info("Config-Template angefragt");
    hcu.sendConfigTemplateResponse({
      correlationId,
      groups: {
        homeconnect: {
          friendlyName: "Home Connect API",
          description:  "Zugangsdaten der Home Connect Developer App",
          order: 1
        }
      },
      properties: {
        hcClientId: {
          friendlyName:  "Client ID",
          description:   "Home Connect API Client ID (developer.home-connect.com)",
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
        },
        hcScopes: {
          friendlyName: "Scopes",
          description:  "Geräte-Scopes (Space-getrennt)",
          dataType:     "STRING",
          required:     "false",
          groupId:      "homeconnect",
          currentValue: cfg?.scopes ?? "IdentifyAppliance Monitor Control Settings Dishwasher Washer Dryer CoffeeMaker Oven",
          minimumLength: 5,
          maximumLength: 500
        }
      }
    });
  });

  hcu.on("config_update_request", async ({ correlationId, properties }) => {
    logger.info({ properties: Object.keys(properties) }, "Config-Update empfangen");

    const newCfg = {
      clientId:     properties.hcClientId     ?? cfg?.clientId,
      clientSecret: properties.hcClientSecret ?? cfg?.clientSecret,
      scopes:       properties.hcScopes       ?? cfg?.scopes ?? "IdentifyAppliance Monitor Control Settings",
    };

    if (!newCfg.clientId || !newCfg.clientSecret) {
      hcu.sendConfigUpdateResponse({
        correlationId,
        status:  "REJECTED",
        message: "Client ID und Client Secret sind erforderlich."
      });
      return;
    }

    // Wenn Secret ein Platzhalter ist, alten Wert behalten
    if (newCfg.clientSecret === "••••••••" && cfg?.clientSecret) {
      newCfg.clientSecret = cfg.clientSecret;
    }

    await saveConfig(newCfg);
    cfg = newCfg;
    logger.info("Konfiguration gespeichert");

    hcu.sendConfigUpdateResponse({
      correlationId,
      status:  "APPLIED",
      message: "Konfiguration gespeichert. Plugin wird neu gestartet..."
    });

    // Kurz warten dann neu starten
    setTimeout(() => process.exit(0), 1000);
  });

  await hcu.start();
  await new Promise((resolve) => hcu.once("ready", resolve));

  // Ohne Config: NOT_READY melden und auf Config warten
  if (!cfg?.clientId || !cfg?.clientSecret) {
    logger.warn("Keine Konfiguration vorhanden. Bitte in HCUweb konfigurieren.");
    hcu.setReadiness("NOT_READY");
    // Warten bis Config gesetzt wird (via config_update_request → process.exit)
    await new Promise(() => {}); // läuft bis Config gesetzt und Neustart
    return;
  }

  // Mit Config: Home Connect starten
  logger.info("Konfiguration vorhanden, starte Home Connect...");
  process.env.HC_CLIENT_ID     = cfg.clientId;
  process.env.HC_CLIENT_SECRET = cfg.clientSecret;
  process.env.HC_SCOPES        = cfg.scopes;

  const auth = new HomeConnectAuth();
  await auth.init();

  const hc    = new HomeConnectClient(auth);
  const sse   = new HomeConnectEventStream(auth);
  const bridge = new Bridge({ hcu, hc, sse });

  await bridge.run();
  logger.info("Plugin läuft.");

  const shutdown = (sig) => { logger.info({ sig }, "Shutdown"); sse.stop(); hcu.stop(); process.exit(0); };
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => { logger.fatal({ err: err.message }, "Fataler Fehler"); process.exit(1); });
