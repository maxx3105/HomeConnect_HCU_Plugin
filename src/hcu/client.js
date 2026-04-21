import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { config } from "../config.js";
import { childLogger } from "../logger.js";
import {
  MSG_IN,
  MSG_OUT,
  buildPluginReady,
  buildPluginStateResponse,
  buildDeviceAdded,
  buildDeviceRemoved,
  buildDeviceUpdated,
  buildChannelEvent,
  buildControlResponse,
} from "./protocol.js";

const log = childLogger("hcu");

/**
 * HCU WebSocket-Verbindung.
 *
 * Anschluss:  wss://<HCU_HOST>/<HCU_WS_PATH>
 * Auth:       Header "AUTH-TOKEN: <token>" + "PLUGIN-ID: <id>"
 *             (Namen ggf. in protocol.js/hier anpassen, falls die offizielle
 *             Doku abweicht – typisch wäre auch "X-Auth-Token".)
 *
 * Events dieser Klasse:
 *   "ready"           – Handshake abgeschlossen, HCU erwartet Geräte-Liste.
 *   "state_request"   – HCU will die vollständige Pluginstate.
 *   "control_request" – { deviceId, channelIndex, values, correlationId }.
 *   "disconnected"
 */
export class HcuClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.reconnectDelay = 2000;
    this.stopped = false;
    this.pluginId = config.hcu.pluginId;
  }

  async start() {
    this.stopped = false;
    await this.#connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  // ---- Outbound (Plugin -> HCU) -----------------------------------------

  announceDevice(device) {
    this.#send(buildDeviceAdded({ pluginId: this.pluginId, device }));
  }

  removeDevice(deviceId) {
    this.#send(buildDeviceRemoved({ pluginId: this.pluginId, deviceId }));
  }

  updateDevice(device) {
    this.#send(buildDeviceUpdated({ pluginId: this.pluginId, device }));
  }

  pushChannelEvent({ deviceId, channelIndex, values }) {
    this.#send(buildChannelEvent({ pluginId: this.pluginId, deviceId, channelIndex, values }));
  }

  respondToControl({ correlationId, success, error }) {
    this.#send(buildControlResponse({ pluginId: this.pluginId, correlationId, success, error }));
  }

  sendPluginState(devices, correlationId) {
    this.#send(buildPluginStateResponse({ pluginId: this.pluginId, devices, correlationId }));
  }

  // ---- Connection -------------------------------------------------------

  async #connect() {
    if (this.stopped) return;
    const url = `wss://${config.hcu.host}${config.hcu.wsPath}`;
    log.info({ url, pluginId: this.pluginId }, "Connecting to HCU");

    this.ws = new WebSocket(url, {
      headers: {
        "AUTH-TOKEN": config.hcu.authToken,
        "PLUGIN-ID": this.pluginId,
      },
      rejectUnauthorized: !config.hcu.insecureTls,
    });

    this.ws.on("open", () => {
      log.info("HCU WebSocket open");
      this.reconnectDelay = 2000;
      this.#send(buildPluginReady({ pluginId: this.pluginId, pluginVersion: "0.1.0" }));
      this.emit("ready");
    });

    this.ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        log.warn({ err, raw: raw.toString().slice(0, 200) }, "Could not parse HCU message");
        return;
      }
      this.#route(msg);
    });

    this.ws.on("close", (code, reason) => {
      log.warn({ code, reason: reason?.toString() }, "HCU WebSocket closed");
      this.emit("disconnected");
      this.#scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      log.error({ err: err.message }, "HCU WebSocket error");
    });
  }

  #scheduleReconnect() {
    if (this.stopped) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, 60000);
    setTimeout(() => this.#connect(), delay);
  }

  #send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.debug({ type: obj?.header?.type }, "Drop outgoing msg – socket not open");
      return;
    }
    this.ws.send(JSON.stringify(obj));
  }

  #route(msg) {
    const type = msg?.header?.type;
    log.debug({ type, id: msg?.header?.id }, "HCU -> plugin");
    switch (type) {
      case MSG_IN.PING:
        // Pong beantworten (falls HCU das nutzt statt des WS-Frame-Pings)
        this.#send({ header: { type: "PONG", correlationId: msg.header.id, timestamp: Date.now() }, body: {} });
        return;

      case MSG_IN.PLUGIN_STATE_REQUEST:
        this.emit("state_request", { correlationId: msg.header.id });
        return;

      case MSG_IN.CONTROL_REQUEST: {
        const { deviceId, channelIndex, values } = msg.body ?? {};
        this.emit("control_request", {
          correlationId: msg.header.id,
          deviceId,
          channelIndex,
          values,
        });
        return;
      }

      case MSG_IN.DEVICE_CONFIG_REQUEST:
        // Für einfache Plugins reicht es oft, die bereits gemeldeten Devices zu wiederholen.
        this.emit("state_request", { correlationId: msg.header.id });
        return;

      default:
        log.debug({ msg }, "Unhandled HCU message");
    }
  }
}
