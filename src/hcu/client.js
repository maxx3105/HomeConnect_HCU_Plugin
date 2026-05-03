import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { childLogger } from "../logger.js";
import {
  MSG_IN, MSG_OUT,
  buildPluginStateResponse,
  buildDiscoverResponse,
  buildStatusEvent,
  buildStatusResponse,
  buildControlResponse,
} from "./protocol.js";

const log = childLogger("hcu");

export class HcuClient extends EventEmitter {
  constructor({ host, authToken, pluginId }) {
    super();
    this.host      = host;
    this.authToken = authToken;
    this.pluginId  = pluginId;
    this.ws        = null;
    this.stopped   = false;
    this.reconnectDelay = 3000;
    this._readiness = "READY";
    this._deviceCache = new Map(); // deviceId → device
  }

  setReadiness(status) {
    this._readiness = status;
    this.#send(buildPluginStateResponse(this.pluginId, null, status));
  }

  async start() {
    this.stopped = false;
    this.#connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  sendDiscoverResponse(devices, correlationId) {
    for (const d of devices) this._deviceCache.set(d.deviceId, d);
    this.#send(buildDiscoverResponse(this.pluginId, devices, correlationId));
  }

  pushStatusEvent(deviceId, features) {
    this.#send(buildStatusEvent(this.pluginId, deviceId, features));
  }

  sendControlResponse(success, errorCode, correlationId) {
    this.#send(buildControlResponse(this.pluginId, success, errorCode, correlationId));
  }

  sendConfigTemplateResponse({ correlationId, groups, properties }) {
    if (!correlationId) {
      // Ohne Request keine Response senden
      return;
    }
    this.#send({
      id: correlationId,
      pluginId: this.pluginId,
      type: MSG_OUT.CONFIG_TEMPLATE_RESPONSE,
      body: { groups, properties }
    });
  }

  sendConfigUpdateResponse({ correlationId, status, message }) {
    this.#send({
      id: correlationId,
      pluginId: this.pluginId,
      type: MSG_OUT.CONFIG_UPDATE_RESPONSE,
      body: { status, ...(message ? { message } : {}) }
    });
  }

  #connect() {
    if (this.stopped) return;
    const url = `wss://${this.host}:9001`;
    log.info({ url, pluginId: this.pluginId }, "Verbinde mit HCU");

    this.ws = new WebSocket(url, {
      rejectUnauthorized: false,
      headers: { "authtoken": this.authToken, "plugin-id": this.pluginId },
    });

    this.ws.on("open", () => {
      log.info("HCU WebSocket verbunden");
      this.reconnectDelay = 3000;
      this.#send(buildPluginStateResponse(this.pluginId, null, this._readiness));
      this.emit("ready");
    });

    this.ws.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); }
      catch { log.warn({ raw: raw.toString().slice(0, 200) }, "Ungültige JSON"); return; }
      this.#route(msg);
    });

    this.ws.on("close", (code, reason) => {
      log.warn({ code, reason: reason?.toString() }, "HCU WebSocket geschlossen");
      this.emit("disconnected");
      if (!this.stopped) setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60000);
        this.#connect();
      }, this.reconnectDelay);
    });

    this.ws.on("error", (err) => log.error({ err: err.message }, "HCU Fehler"));
  }

  #send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    log.debug({ type: obj?.type }, "→ HCU");
    this.ws.send(JSON.stringify(obj));
  }

  #route(msg) {
    const type = msg?.type;
    log.debug({ type, id: msg?.id }, "← HCU");
    switch (type) {
      case MSG_IN.PLUGIN_STATE_REQUEST:
        this.#send(buildPluginStateResponse(this.pluginId, msg.id, this._readiness));
        return;
      case MSG_IN.DISCOVER_REQUEST:
        this.emit("discover_request", { correlationId: msg.id });
        return;
      case MSG_IN.STATUS_REQUEST: {
        // HCU fragt aktuellen Status eines Geräts
        const deviceId = msg.body?.deviceId;
        const device   = this._deviceCache.get(deviceId);
        if (device) {
          this.#send(buildStatusResponse(this.pluginId, deviceId, device.features, msg.id));
        }
        return;
      }
      case MSG_IN.CONTROL_REQUEST:
        this.emit("control_request", {
          deviceId:     msg.body?.deviceId,
          features:     msg.body?.features,
          correlationId: msg.id,
        });
        return;
      case MSG_IN.CONFIG_TEMPLATE_REQUEST:
        this.emit("config_template_request", { correlationId: msg.id, languageCode: msg.body?.languageCode ?? "de" });
        return;
      case MSG_IN.CONFIG_UPDATE_REQUEST:
        this.emit("config_update_request", { correlationId: msg.id, properties: msg.body?.properties ?? {} });
        return;
      default:
        log.debug({ type }, "Unbekannte Nachricht");
    }
  }
}
