/**
 * Mapping Home Connect → HCU Devices
 *
 * HC-Geräte die wir als HCU-SWITCH mappen:
 *   Dishwasher, Washer, Dryer, WasherDryer, CoffeeMaker, Oven, Hood, Hob
 *
 * Für jedes Gerät gibt es:
 *   - Ein SWITCH-Device (An/Aus via PowerState)
 *   - Ein CONTACT_SENSOR-Device für Tür (falls vorhanden)
 *
 * HC Status-Keys die wir als Features pushen:
 *   BSH.Common.Status.OperationState   → switchState (on = Running/Pause/DelayedStart)
 *   BSH.Common.Status.DoorState        → contactSensorState (open = Door.Open)
 *   BSH.Common.Setting.PowerState      → switchState (on = PowerState.On)
 *   BSH.Common.Option.RemainingProgramTime → Meta-Info (kein HCU Feature, aber STATUS_EVENT)
 */
import { DEVICE_TYPE, makeDevice, makeSwitchFeature, makeContactFeature } from "./protocol.js";

/** Gerätetypen mit Tür */
const HAS_DOOR = new Set([
  "Dishwasher", "Washer", "Dryer", "WasherDryer",
  "Oven", "Microwave", "Refrigerator", "Freezer", "FridgeFreezer", "WineCooler"
]);

/**
 * Erstellt HCU-Devices aus einer HC-Appliance.
 * Gibt Array zurück (1 oder 2 Devices pro Appliance).
 */
export function applianceToDevices(app) {
  const devices = [];
  const baseId = `hc-${app.haId}`;
  const baseName = app.name ?? `${app.brand ?? "HC"} ${app.type}`;

  // Haupt-Device: SWITCH (Power on/off + Betriebsstatus)
  devices.push(makeDevice({
    deviceId:        baseId,
    deviceType:      DEVICE_TYPE.SWITCH,
    friendlyName:    baseName,
    modelType:       app.vib ?? app.enumber ?? app.type,
    firmwareVersion: app.enumber ?? "n/a",
    features: [
      makeSwitchFeature(false),  // initial: aus
    ],
  }));

  // Tür-Device: CONTACT_SENSOR (Tür offen/geschlossen)
  if (HAS_DOOR.has(app.type)) {
    devices.push(makeDevice({
      deviceId:     `${baseId}-door`,
      deviceType:   DEVICE_TYPE.CONTACT_SENSOR,
      friendlyName: `${baseName} Tür`,
      modelType:    app.type,
      features: [
        makeContactFeature(false), // initial: geschlossen
      ],
    }));
  }

  return devices;
}

/**
 * Übersetzt Home Connect SSE Items in HCU STATUS_EVENTs.
 * Gibt Array von { deviceId, features } zurück.
 *
 * @param {string} baseDeviceId  z.B. "hc-SIEMENS-xxx"
 * @param {Array}  items         HC SSE items
 */
export function itemsToStatusEvents(baseDeviceId, items) {
  const events = [];

  for (const it of items ?? []) {
    switch (it.key) {

      // PowerState → SWITCH on/off
      case "BSH.Common.Setting.PowerState":
        events.push({
          deviceId: baseDeviceId,
          features: [makeSwitchFeature(
            it.value === "BSH.Common.EnumType.PowerState.On"
          )],
        });
        break;

      // OperationState → SWITCH on = aktiv (läuft / pausiert / verzögert)
      case "BSH.Common.Status.OperationState": {
        const active = [
          "BSH.Common.EnumType.OperationState.Run",
          "BSH.Common.EnumType.OperationState.Pause",
          "BSH.Common.EnumType.OperationState.DelayedStart",
          "BSH.Common.EnumType.OperationState.ActionRequired",
        ].includes(it.value);
        events.push({
          deviceId: baseDeviceId,
          features: [makeSwitchFeature(active)],
        });
        break;
      }

      // DoorState → CONTACT_SENSOR open/closed
      case "BSH.Common.Status.DoorState":
        events.push({
          deviceId: `${baseDeviceId}-door`,
          features: [makeContactFeature(
            it.value === "BSH.Common.EnumType.DoorState.Open"
          )],
        });
        break;

      // ProgramFinished/Aborted → SWITCH off
      case "BSH.Common.Event.ProgramFinished":
      case "BSH.Common.Event.ProgramAborted":
        events.push({
          deviceId: baseDeviceId,
          features: [makeSwitchFeature(false)],
        });
        break;
    }
  }

  return events;
}

/**
 * Übersetzt HCU CONTROL_REQUEST in HC-Aktion.
 * features = Array von Feature-Objekten aus dem CONTROL_REQUEST body.
 */
export function featuresToHcAction(features) {
  for (const f of features ?? []) {
    if (f.type === "switchState") {
      if (f.on) {
        return { action: "powerOn" };
      } else {
        return { action: "powerOff" };
      }
    }
  }
  return null;
}
