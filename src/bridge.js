import { childLogger } from "./logger.js";
import { applianceToDevices, itemsToStatusEvents, featuresToHcAction } from "./hcu/deviceMapper.js";

const log = childLogger("bridge");

export class Bridge {
  constructor({ hcu, hc, sse }) {
    this.hcu = hcu;
    this.hc  = hc;
    this.sse = sse;
    /** Map: baseDeviceId → haId */
    this.deviceToHaId = new Map();
    /** Map: deviceId → device (alle inkl. Tür-Devices) */
    this.devices = new Map();
  }

  async run() {
    this.#wireHcu();
    this.#wireSse();
    await this.#discover();
    await this.sse.start();
  }

  async #discover() {
    log.info("Suche Home Connect Geräte");
    const apps = await this.hc.listAppliances();
    log.info({ count: apps.length }, "Gefundene Geräte");

    for (const app of apps) {
      const devs = applianceToDevices(app);
      const baseId = `hc-${app.haId}`;
      this.deviceToHaId.set(baseId, app.haId);
      for (const d of devs) this.devices.set(d.deviceId, d);
      try { await this.#syncInitialState(app.haId, baseId); }
      catch (err) { log.warn({ err: err.message, haId: app.haId }, "Initialzustand nicht abrufbar"); }
    }
    log.info({ count: this.devices.size }, "Geräte bereit");
  }

  async #syncInitialState(haId, baseId) {
    const [status, settings, active] = await Promise.all([
      this.hc.getStatus(haId).catch(() => []),
      this.hc.getSettings(haId).catch(() => []),
      this.hc.getActiveProgram(haId).catch(() => null),
    ]);
    const items = [
      ...status, ...settings,
      ...(active?.key ? [{ key: "BSH.Common.Root.ActiveProgram", value: active.key }] : []),
    ];
    // Status-Events für initiale Zustände
    const events = itemsToStatusEvents(baseId, items);
    for (const ev of events) {
      // Device-Cache aktualisieren
      const dev = this.devices.get(ev.deviceId);
      if (dev) dev.features = ev.features;
    }
  }

  #wireHcu() {
    this.hcu.on("ready", () => {
      if (this.devices.size > 0) {
        this.hcu.sendDiscoverResponse([...this.devices.values()], null);
      }
    });

    this.hcu.on("discover_request", ({ correlationId }) => {
      log.info("DISCOVER_REQUEST empfangen");
      this.hcu.sendDiscoverResponse([...this.devices.values()], correlationId);
    });

    this.hcu.on("control_request", async ({ deviceId, features, correlationId }) => {
      await this.#handleControl({ deviceId, features, correlationId });
    });
  }

  async #handleControl({ deviceId, features, correlationId }) {
    log.info({ deviceId, features }, "Control Request");

    // Tür-Devices können nicht gesteuert werden
    if (deviceId.endsWith("-door")) {
      return this.hcu.sendControlResponse(false, "READ_ONLY", correlationId);
    }

    const haId = this.deviceToHaId.get(deviceId);
    if (!haId) {
      return this.hcu.sendControlResponse(false, "UNKNOWN_DEVICE", correlationId);
    }

    const plan = featuresToHcAction(deviceId, features);
    if (!plan) {
      return this.hcu.sendControlResponse(false, "UNSUPPORTED_FEATURE", correlationId);
    }

    // Dimmer ignorieren
    if (plan.action === "ignore") {
      this.hcu.sendControlResponse(true, null, correlationId);
      return;
    }

    try {
      if (plan.action === "startProgram") {
        // Vorgewähltes Programm starten
        await this.hc.sendCommand(haId, "BSH.Common.Command.StartProgram", true);
      } else if (plan.action === "stopProgram") {
        await this.hc.stopProgram(haId);
      }
      this.hcu.sendControlResponse(true, null, correlationId);
    } catch (err) {
      log.error({ err: err.message }, "Control fehlgeschlagen");
      this.hcu.sendControlResponse(false, err.message?.slice(0, 100), correlationId);
    }
  }

  #wireSse() {
    this.sse.on("event", ({ type, haId, items }) => {
      if (!haId) return;
      const baseId = `hc-${haId}`;
      if (!this.deviceToHaId.has(baseId)) return;

      switch (type) {
        case "CONNECTED":
          this.hcu.pushStatusEvent(baseId, [{ type: "switchState", on: true }]);
          break;
        case "DISCONNECTED":
          this.hcu.pushStatusEvent(baseId, [{ type: "switchState", on: false }]);
          break;
        case "DEPAIRED":
          this.devices.delete(baseId);
          this.devices.delete(`${baseId}-door`);
          this.deviceToHaId.delete(baseId);
          break;
        case "PAIRED":
          this.#refreshAppliance(haId).catch((e) => log.warn(e));
          break;
        case "STATUS": case "EVENT": case "NOTIFY": {
          const events = itemsToStatusEvents(baseId, items);
          for (const ev of events) {
            // Device-Cache aktualisieren
            const dev = this.devices.get(ev.deviceId);
            if (dev) dev.features = ev.features;
            this.hcu.pushStatusEvent(ev.deviceId, ev.features);
          }
          break;
        }
      }
    });
  }

  async #refreshAppliance(haId) {
    const app  = await this.hc.getAppliance(haId);
    const devs = applianceToDevices(app);
    const baseId = `hc-${haId}`;
    this.deviceToHaId.set(baseId, haId);
    for (const d of devs) this.devices.set(d.deviceId, d);
    this.hcu.sendDiscoverResponse([...this.devices.values()], null);
  }
}
