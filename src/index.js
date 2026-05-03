/**
 * HCU Home Connect Plugin
 *
 * Ablauf:
 * 1. Ohne Config: NOT_READY, wartet auf Konfiguration via HCUweb
 * 2. Mit Config: Auth mit IdentifyAppliance (Minimal-Scope)
 * 3. Geräte abfragen → benötigte Scopes ableiten
 * 4. Falls neue Scopes nötig: neuer Device Flow mit vollen Scopes
 * 5. Geräte in HCU registrieren + SSE-Stream starten
 */
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
  try {
    return (await fs.readFile("/TOKEN", "utf8")).trim();
  } catch {
    const env = process.env.HCU_AUTH_TOKEN;
    if (env) return env;
    throw new Error("Kein Auth-Token: weder /TOKEN noch HCU_AUTH_TOKEN.");
  }
}

async function loadConfig() {
  try {
    return JSON.parse(await fs.readFile(CONFIG_FILE, "utf8"));
  } catch { return null; }
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

  let cfg = await loadConfig();

  // Config-Handler registrieren
  hcu.on("config_template_request", ({ correlationId }) => {
    logger.info("Config-Template angefragt");
    hcu.sendConfigTemplateResponse({
      correlationId,
      groups: {
        homeconnect: {
          friendlyName: "Home Connect API",
          description:  "Zugangsdaten der Home Connect Developer App (developer.home-connect.com)",
          order: 1
        }
      },
      properties: {
        hcClientId: {
          friendlyName:  "Client ID",
          description:   "Home Connect API Client ID",
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
      }
    });
  });

  hcu.on("config_update_request", async ({ correlationId, properties }) => {
    logger.info("Config-Update empfangen");

    const newCfg = {
      clientId:     properties.hcClientId     ?? cfg?.clientId,
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

    // Alten HC-Token löschen damit neuer Device Flow startet
    try { await fs.unlink("/data/tokens.json"); } catch {}

    await saveConfig(newCfg);
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

  // Ohne Config: NOT_READY
  if (!cfg?.clientId || !cfg?.clientSecret) {
    logger.warn("Keine Konfiguration. Bitte in HCUweb unter Plugin-Einstellungen konfigurieren.");
    hcu.setReadiness("NOT_READY");
    await new Promise(() => {}); // wartet bis Config gesetzt → Neustart
    return;
  }

  // Mit Config: Home Connect starten
  logger.info("Starte Home Connect...");
  const auth = new HomeConnectAuth({
    clientId:     cfg.clientId,
    clientSecret: cfg.clientSecret,
  });

  // Schritt 1: Minimal-Auth (IdentifyAppliance)
  await auth.init();

  const hc = new HomeConnectClient(auth);

  // Schritt 2: Geräte abfragen
  logger.info("Frage Home Connect Geräte ab...");
  const appliances = await hc.listAppliances();
  logger.info({ count: appliances.length, types: appliances.map(a => a.type) }, "Gefundene Geräte");

  // Schritt 3: Scopes upgraden falls nötig
  const upgraded = await auth.upgradeScopes(appliances);
  if (upgraded) {
    logger.info("Scopes wurden erweitert - Plugin startet neu für vollständigen Zugriff");
    // Scopes in config cachen
    cfg.cachedScopes = auth.scopes;
    await saveConfig(cfg);
    // Nach Device Flow direkt weiter (Token wurde bereits geholt)
  }

  // Schritt 4: Bridge starten
  const sse    = new HomeConnectEventStream(auth);
  const bridge = new Bridge({ hcu, hc, sse });
  await bridge.run();

  logger.info("Plugin läuft. Alle Geräte registriert.");

  const shutdown = (sig) => {
    logger.info({ sig }, "Shutdown");
    sse.stop(); hcu.stop(); process.exit(0);
  };
  process.on("SIGINT",  () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => { logger.fatal({ err: err.message }, "Fataler Fehler"); process.exit(1); });
