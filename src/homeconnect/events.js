import { EventEmitter } from "node:events";
import EventSource from "eventsource";
import { config } from "../config.js";
import { childLogger } from "../logger.js";

const log = childLogger("hc-sse");

/**
 * Home Connect Events kommen als Server-Sent-Events.
 *
 * Event-Typen (die wir hier rausemittieren):
 *   - "KEEP-ALIVE"
 *   - "STATUS"     (Geräte-Status wie DoorState, OperationState, RemoteControlActive)
 *   - "EVENT"      (Ereignisse wie ProgramFinished, DoorAlarm, ...)
 *   - "NOTIFY"     (z. B. Fortschritt / RemainingTime / PowerState-Änderung)
 *   - "CONNECTED" / "DISCONNECTED"
 *   - "PAIRED" / "DEPAIRED"
 *
 * Payload pro Event: { haId, items: [{key, value, unit, timestamp}, ...] }
 *
 * Endpoint: GET {base}/api/homeappliances/events (global, alle Geräte)
 */
export class HomeConnectEventStream extends EventEmitter {
  constructor(auth) {
    super();
    this.auth = auth;
    this.url = `${config.homeConnect.baseUrl}/api/homeappliances/events`;
    /** @type {?EventSource} */
    this.es = null;
    this.reconnectDelay = 2000;
    this.stopped = false;
  }

  async start() {
    this.stopped = false;
    await this.#connect();
  }

  stop() {
    this.stopped = true;
    this.es?.close();
    this.es = null;
  }

  async #connect() {
    if (this.stopped) return;
    const token = await this.auth.getAccessToken();
    log.info("Connecting to Home Connect SSE stream");

    this.es = new EventSource(this.url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "text/event-stream",
      },
    });

    for (const type of ["STATUS", "EVENT", "NOTIFY", "CONNECTED", "DISCONNECTED", "PAIRED", "DEPAIRED", "KEEP-ALIVE"]) {
      this.es.addEventListener(type, (evt) => this.#handle(type, evt));
    }

    this.es.onopen = () => {
      log.info("HC SSE connected");
      this.reconnectDelay = 2000;
    };

    this.es.onerror = async (err) => {
      log.warn({ err: err?.message ?? err }, "HC SSE error, reconnecting");
      this.es?.close();
      this.es = null;
      if (this.stopped) return;
      // 401 => Token abgelaufen oder widerrufen: refresh und retry.
      try {
        await this.auth.refresh();
      } catch (e) {
        log.error({ err: e }, "Refresh during SSE reconnect failed");
      }
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(delay * 2, 60000);
      setTimeout(() => this.#connect(), delay);
    };
  }

  #handle(type, evt) {
    // evt.data ist entweder leer (keep-alive, connected/disconnected manchmal) oder
    //   { "haId": "...", "items": [...] }
    let payload = null;
    if (evt.data) {
      try {
        payload = JSON.parse(evt.data);
      } catch (e) {
        log.warn({ data: evt.data, err: e }, "Could not parse SSE data");
        return;
      }
    }
    // Bei CONNECTED/DISCONNECTED kann evt.lastEventId die haId tragen.
    const haId = payload?.haId ?? evt.lastEventId ?? null;
    log.debug({ type, haId, items: payload?.items?.length }, "HC event");
    this.emit("event", { type, haId, items: payload?.items ?? [], raw: payload });
  }
}
