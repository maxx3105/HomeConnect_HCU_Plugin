import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { childLogger } from "../logger.js";
import {
  MSG_IN,
  buildPluginStateResponse,
  buildDiscoverResponse,
  buildStatusEvent,
  buildStatusResponse,
  buildControlResponse,
} from "./protocol.js";

const log = childLogger("hcu");

/**
 * HCU Connect API WebSocket-Client.
 *
 * Verbindung:  wss://<host>:9001
 * Auth-Header: authtoken: <token>
 *              plugin-id:  <pluginId>
 *
 * Emittierte Events:
 *   "ready"            – WebSocket offen + initialer PLUGIN_STATE_RESPONSE gesendet
 *   "discover_request" – { correlationId }
 *   "control_request"  – { deviceId, features, correlationId }
 *   "disconnected"
 */
export class HcuClient extends EventEmitter {
  constructor({ host, authToken, pluginId }) {
    super();
    this.host      = host;
    this.authToken = authToken;
    this.pluginId  = pluginId;
    this.ws        = null;
    this.stopped   = false;
    this.reconnectDelay = 3000;
    this._deviceCache = new Map(); // deviceId → device (für STATUS_REQUEST)
  }

  async start() {
    this.stopped = false;
    this.#connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  // ── Outbound ─────────────────────────────────────────────────────────────

  /** Melde Geräteliste als Antwort auf DISCOVER_REQUEST */
  sendDiscoverResponse(devices, correlationId) {
    for (const d of devices) this._deviceCache.set(d.id, d);
    this.#send(buildDiscoverResponse(this.pluginId, devices, correlationId));
  }

  /** Push Zustandsänderung (unaufgefordert) */
  pushStatusEvent(deviceId, features) {
    this.#send(buildStatusEvent(this.pluginId, deviceId, features));
  }

  /** Antwort auf CONTROL_REQUEST */
  sendControlResponse(success, errorCode, correlationId) {
    this.#send(buildControlResponse(this.pluginId, success, errorCode, correlationId));
  }

  // ── Connection ───────────────────────────────────────────────────────────

  #connect() {
    if (this.stopped) return;
    const url = `wss://${this.host}:9001`;
    log.info({ url, pluginId: this.pluginId }, "Verbinde mit HCU");

    this.ws = new WebSocket(url, {
      rejectUnauthorized: false,  // HCU nutzt self-signed cert
      headers: {
        "authtoken":  this.authToken,
        "plugin-id":  this.pluginId,
      },
    });

    this.ws.on("open", () => {
      log.info("HCU WebSocket verbunden");
      this.reconnectDelay = 3000;
      // Laut Doku: beim Start sofort PLUGIN_STATE_RESPONSE mit READY senden
      this.#send(buildPluginStateResponse(this.pluginId));
      this.emit("ready");
    });

    this.ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { log.warn({ raw: raw.toString().slice(0, 200) }, "Ungültige JSON-Nachricht"); return; }
      this.#route(msg);
    });

    this.ws.on("close", (code, reason) => {
      log.warn({ code, reason: reason?.toString() }, "HCU WebSocket geschlossen");
      this.emit("disconnected");
      if (!this.stopped) {
        setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
          this.#connect();
        }, this.reconnectDelay);
      }
    });

    this.ws.on("error", (err) => log.error({ err: err.message }, "HCU WebSocket Fehler"));
  }

  #send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.debug({ type: obj?.type }, "Drop: Socket nicht offen");
      return;
    }
    log.debug({ type: obj.type, id: obj.id }, "→ HCU");
    this.ws.send(JSON.stringify(obj));
  }

  #route(msg) {
    const type = msg?.type;
    log.debug({ type, id: msg?.id }, "← HCU");

    switch (type) {
      // HCU fragt nach Plugin-Status (z.B. wenn Plugin-Seite in HCUweb geöffnet wird)
      case MSG_IN.PLUGIN_STATE_REQUEST:
        this.#send(buildPluginStateResponse(this.pluginId, msg.id));
        return;

      // HCU fragt nach den vom Plugin verwalteten Geräten
      case MSG_IN.DISCOVER_REQUEST:
        this.emit("discover_request", { correlationId: msg.id });
        return;

      // HCU will ein Gerät steuern
      case MSG_IN.CONTROL_REQUEST: {
        const { deviceId, features } = msg.body ?? {};
        this.emit("control_request", { deviceId, features, correlationId: msg.id });
        return;
      }

      // Config-Requests ignorieren wir (kein UI nötig)
      case MSG_IN.CONFIG_TEMPLATE_REQUEST:
      case MSG_IN.CONFIG_UPDATE_REQUEST:
        log.debug({ type }, "Config-Request ignoriert");
        return;

      default:
        log.debug({ type, msg }, "Unbekannte Nachricht");
    }
  }
}
