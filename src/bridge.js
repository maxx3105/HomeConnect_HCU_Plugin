import { childLogger } from "./logger.js";
import {
  applianceToDevice,
  itemsToChannelUpdates,
  controlToHomeConnectAction,
} from "./hcu/deviceMapper.js";

const log = childLogger("bridge");

/**
 * Das Herzstück: hält den lokalen Zustand, leitet HC-Events an die HCU und
 * HCU-Control-Requests an die HC-REST-API weiter.
 */
export class Bridge {
  constructor({ hcu, hc, sse }) {
    this.hcu = hcu;
    this.hc = hc;
    this.sse = sse;

    /** @type {Map<string, object>} deviceId -> virtuelles HCU-Device */
    this.devices = new Map();
    /** @type {Map<string, string>} deviceId -> haId */
    this.deviceToHaId = new Map();
  }

  async run() {
    this.#wireHcu();
    this.#wireSse();

    await this.#discover();
    await this.sse.start();
  }

  // ---- Discovery & initial sync ----------------------------------------

  async #discover() {
    log.info("Discovering Home Connect appliances");
    const apps = await this.hc.listAppliances();
    log.info({ count: apps.length }, "Appliances found");

    for (const app of apps) {
      const device = applianceToDevice(app);
      this.devices.set(device.id, device);
      this.deviceToHaId.set(device.id, app.haId);
      this.hcu.announceDevice(device);

      // initialen Zustand nachladen
      try {
        await this.#syncInitialState(app.haId, device.id);
      } catch (err) {
        log.warn({ err: err.message, haId: app.haId }, "Initial state sync failed");
      }
    }
  }

  async #syncInitialState(haId, deviceId) {
    if (!this.#isConnected(haId)) return;
    const status = await this.hc.getStatus(haId).catch(() => []);
    const settings = await this.hc.getSettings(haId).catch(() => []);
    const active = await this.hc.getActiveProgram(haId).catch(() => null);

    const items = [
      ...status,
      ...settings,
      ...(active?.options ?? []),
      ...(active?.key ? [{ key: "BSH.Common.Root.ActiveProgram", value: active.key }] : []),
    ];
    this.#applyChannelUpdates(deviceId, items);
  }

  #isConnected(haId) {
    // zwar in app.connected vorhanden, wird aber durch SSE aktualisiert
    for (const [devId, id] of this.deviceToHaId) {
      if (id === haId) return this.devices.get(devId) != null;
    }
    return true;
  }

  // ---- HCU -> plugin ---------------------------------------------------

  #wireHcu() {
    this.hcu.on("ready", () => {
      // Nach (Re-)Connect alle Devices erneut anmelden.
      for (const device of this.devices.values()) {
        this.hcu.announceDevice(device);
      }
    });

    this.hcu.on("state_request", ({ correlationId }) => {
      this.hcu.sendPluginState([...this.devices.values()], correlationId);
    });

    this.hcu.on("control_request", async (req) => {
      await this.#handleControl(req);
    });
  }

  async #handleControl({ correlationId, deviceId, channelIndex, values }) {
    log.info({ deviceId, channelIndex, values }, "Control request from HCU");
    const haId = this.deviceToHaId.get(deviceId);
    if (!haId) {
      return this.hcu.respondToControl({
        correlationId,
        success: false,
        error: `unknown deviceId ${deviceId}`,
      });
    }

    const plan = controlToHomeConnectAction(channelIndex, values);
    if (!plan) {
      return this.hcu.respondToControl({
        correlationId,
        success: false,
        error: "channel/value combination not supported",
      });
    }

    try {
      switch (plan.action) {
        case "setPower":
          await this.hc.setSetting(
            haId,
            "BSH.Common.Setting.PowerState",
            plan.args.on
              ? "BSH.Common.EnumType.PowerState.On"
              : "BSH.Common.EnumType.PowerState.Off"
          );
          break;
        case "startProgram":
          await this.hc.startProgram(haId, plan.args.programKey, plan.args.options);
          break;
        case "stopProgram":
          await this.hc.stopProgram(haId);
          break;
        case "selectProgram":
          await this.hc.selectProgram(haId, plan.args.programKey, plan.args.options);
          break;
      }
      this.hcu.respondToControl({ correlationId, success: true });
    } catch (err) {
      log.error({ err: err.message, plan }, "Control execution failed");
      this.hcu.respondToControl({
        correlationId,
        success: false,
        error: err.message ?? String(err),
      });
    }
  }

  // ---- Home Connect -> HCU --------------------------------------------

  #wireSse() {
    this.sse.on("event", ({ type, haId, items }) => {
      if (!haId) return;
      const deviceId = this.#lookupDeviceId(haId);
      if (!deviceId) return;

      switch (type) {
        case "CONNECTED":
          this.#pushStatusText(deviceId, "Online");
          break;
        case "DISCONNECTED":
          this.#pushStatusText(deviceId, "Offline");
          break;
        case "PAIRED":
          // neues Gerät: einfach neu discovern
          this.#refreshAppliance(haId).catch((err) =>
            log.warn({ err: err.message, haId }, "Refresh after PAIRED failed")
          );
          break;
        case "DEPAIRED":
          this.#removeDevice(deviceId);
          break;
        case "STATUS":
        case "EVENT":
        case "NOTIFY":
          this.#applyChannelUpdates(deviceId, items);
          break;
        default:
          break;
      }
    });
  }

  #applyChannelUpdates(deviceId, items) {
    const updates = itemsToChannelUpdates(items);
    for (const u of updates) {
      this.hcu.pushChannelEvent({
        deviceId,
        channelIndex: u.channelIndex,
        values: u.values,
      });
    }
  }

  #pushStatusText(deviceId, text) {
    this.hcu.pushChannelEvent({
      deviceId,
      channelIndex: 2, // CHAN.STATUS
      values: { TEXT_VALUE: text },
    });
  }

  #lookupDeviceId(haId) {
    for (const [devId, id] of this.deviceToHaId) {
      if (id === haId) return devId;
    }
    return null;
  }

  #removeDevice(deviceId) {
    this.devices.delete(deviceId);
    this.deviceToHaId.delete(deviceId);
    this.hcu.removeDevice(deviceId);
  }

  async #refreshAppliance(haId) {
    const app = await this.hc.getAppliance(haId);
    const device = applianceToDevice(app);
    this.devices.set(device.id, device);
    this.deviceToHaId.set(device.id, haId);
    this.hcu.announceDevice(device);
    await this.#syncInitialState(haId, device.id);
  }
}
