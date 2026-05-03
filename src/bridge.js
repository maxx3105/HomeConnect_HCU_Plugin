import { childLogger } from "./logger.js";
import { applianceToDevice, itemsToFeatureUpdates, featuresToHcAction } from "./hcu/deviceMapper.js";

const log = childLogger("bridge");

export class Bridge {
  constructor({ hcu, hc, sse }) {
    this.hcu = hcu;
    this.hc  = hc;
    this.sse = sse;
    /** @type {Map<string, object>} deviceId → device */
    this.devices = new Map();
    /** @type {Map<string, string>} deviceId → haId */
    this.deviceToHaId = new Map();
  }

  async run() {
    this.#wireHcu();
    this.#wireSse();
    await this.#discover();
    await this.sse.start();
  }

  // ── Discovery ─────────────────────────────────────────────────────────────

  async #discover() {
    log.info("Suche Home-Connect-Geräte");
    const apps = await this.hc.listAppliances();
    log.info({ count: apps.length }, "Gefundene Geräte");

    for (const app of apps) {
      const device = applianceToDevice(app);
      this.devices.set(device.id, device);
      this.deviceToHaId.set(device.id, app.haId);
      try { await this.#syncInitialState(app.haId, device.id); }
      catch (err) { log.warn({ err: err.message, haId: app.haId }, "Initialzustand nicht abrufbar"); }
    }
    log.info({ count: this.devices.size }, "Geräte bereit");
  }

  async #syncInitialState(haId, deviceId) {
    const [status, settings, active] = await Promise.all([
      this.hc.getStatus(haId).catch(() => []),
      this.hc.getSettings(haId).catch(() => []),
      this.hc.getActiveProgram(haId).catch(() => null),
    ]);
    const items = [
      ...status, ...settings,
      ...(active?.options ?? []),
      ...(active?.key ? [{ key: "BSH.Common.Root.ActiveProgram", value: active.key }] : []),
    ];
    this.#applyUpdates(deviceId, items);
  }

  // ── HCU Events ───────────────────────────────────────────────────────────

  #wireHcu() {
    // Nach (Re-)Connect: Geräteliste sofort pushen
    this.hcu.on("ready", () => {
      if (this.devices.size > 0) {
        this.hcu.sendDiscoverResponse([...this.devices.values()], null);
      }
    });

    // DISCOVER_REQUEST: HCU will Geräteliste
    this.hcu.on("discover_request", ({ correlationId }) => {
      this.hcu.sendDiscoverResponse([...this.devices.values()], correlationId);
    });

    // CONTROL_REQUEST: HCU will Gerät steuern
    this.hcu.on("control_request", async ({ deviceId, features, correlationId }) => {
      await this.#handleControl({ deviceId, features, correlationId });
    });
  }

  async #handleControl({ deviceId, features, correlationId }) {
    log.info({ deviceId, features }, "Control Request");
    const haId = this.deviceToHaId.get(deviceId);
    if (!haId) {
      return this.hcu.sendControlResponse(false, "UNKNOWN_DEVICE", correlationId);
    }
    const plan = featuresToHcAction(features);
    if (!plan) {
      return this.hcu.sendControlResponse(false, "UNSUPPORTED_FEATURE", correlationId);
    }
    try {
      switch (plan.action) {
        case "setPower":
          await this.hc.setSetting(haId, "BSH.Common.Setting.PowerState",
            plan.args.on ? "BSH.Common.EnumType.PowerState.On" : "BSH.Common.EnumType.PowerState.Off");
          break;
        case "startProgram":
          await this.hc.startProgram(haId, plan.args.programKey, plan.args.options);
          break;
        case "stopProgram":
          await this.hc.stopProgram(haId);
          break;
      }
      this.hcu.sendControlResponse(true, null, correlationId);
    } catch (err) {
      log.error({ err: err.message }, "Control fehlgeschlagen");
      this.hcu.sendControlResponse(false, err.message?.slice(0, 100), correlationId);
    }
  }

  // ── Home Connect SSE Events ───────────────────────────────────────────────

  #wireSse() {
    this.sse.on("event", ({ type, haId, items }) => {
      if (!haId) return;
      const deviceId = this.#lookupDeviceId(haId);
      if (!deviceId) return;

      switch (type) {
        case "CONNECTED":    this.#pushGenericInput(deviceId, "operationState", "Online"); break;
        case "DISCONNECTED": this.#pushGenericInput(deviceId, "operationState", "Offline"); break;
        case "DEPAIRED":     this.#removeDevice(deviceId); break;
        case "PAIRED":       this.#refreshAppliance(haId).catch((e) => log.warn(e)); break;
        case "STATUS": case "EVENT": case "NOTIFY":
          this.#applyUpdates(deviceId, items);
          break;
      }
    });
  }

  #applyUpdates(deviceId, items) {
    const updates = itemsToFeatureUpdates(items);
    if (updates.length === 0) return;

    // Features zusammenführen und als STATUS_EVENT pushen
    const features = updates.map(u => ({ type: u.featureType, ...u.props }));
    this.hcu.pushStatusEvent(deviceId, features);
  }

  #pushGenericInput(deviceId, key, value) {
    this.hcu.pushStatusEvent(deviceId, [{ type: "GENERIC_INPUT", key, value }]);
  }

  #lookupDeviceId(haId) {
    for (const [devId, id] of this.deviceToHaId) if (id === haId) return devId;
    return null;
  }

  #removeDevice(deviceId) {
    this.devices.delete(deviceId);
    this.deviceToHaId.delete(deviceId);
  }

  async #refreshAppliance(haId) {
    const app    = await this.hc.getAppliance(haId);
    const device = applianceToDevice(app);
    this.devices.set(device.id, device);
    this.deviceToHaId.set(device.id, haId);
    await this.#syncInitialState(haId, device.id);
    this.hcu.sendDiscoverResponse([...this.devices.values()], null);
  }
}
