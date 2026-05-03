/**
 * Mapping Home Connect → HCU Devices
 *
 * Pro Gerät (Dishwasher / Washer) 1 LIGHT-Device:
 *
 *   switchState: on  = Fernstart aktiv ODER Programm läuft
 *   dimLevel:   1.0  = Fernstart aktiv (bereit zum Starten)
 *   dimLevel: 0.x→0  = Programm läuft, Fortschritt von 100%→0%
 *   dimLevel:   0.0  = Programm fertig / aus
 *   switchState: off = Gerät aus / fertig
 *
 * Steuerung:
 *   switchState on  → startProgram (vorgewähltes Programm starten)
 *   switchState off → stopProgram (Programm abbrechen)
 *   dimming wird ignoriert (read-only)
 *
 * Dishwasher zusätzlich: WATER_SENSOR für Salz/Klarspüler
 */
import { makeDevice } from "./protocol.js";

export const DEVICE_TYPE = {
  LIGHT:        "LIGHT",
  WATER_SENSOR: "WATER_SENSOR",
};

const HAS_SUPPLIES = new Set(["Dishwasher"]);

export function applianceToDevices(app) {
  const baseId   = `hc-${app.haId}`;
  const baseName = app.name ?? `${app.brand ?? "HC"} ${app.type}`;
  const model    = app.vib ?? app.enumber ?? app.type;
  const fw       = app.enumber ?? "n/a";

  const devices = [];

  // Haupt-Device: LIGHT
  devices.push(makeDevice({
    deviceId:        baseId,
    deviceType:      DEVICE_TYPE.LIGHT,
    friendlyName:    baseName,
    modelType:       model,
    firmwareVersion: fw,
    features: [
      { type: "switchState", on: false },
      { type: "dimming",     dimLevel: 0 },
      { type: "maintenance", unreach: false, lowBat: false, sabotage: false },
    ],
  }));

  // Vorräte-Device: WATER_SENSOR (nur Dishwasher)
  if (HAS_SUPPLIES.has(app.type)) {
    devices.push(makeDevice({
      deviceId:        `${baseId}-supplies`,
      deviceType:      DEVICE_TYPE.WATER_SENSOR,
      friendlyName:    `${baseName} Vorräte`,
      modelType:       model,
      firmwareVersion: fw,
      features: [
        { type: "waterlevelDetected", waterlevelDetected: false }, // Salz
        { type: "moistureDetected",   moistureDetected:   false }, // Klarspüler
      ],
    }));
  }

  return devices;
}

/**
 * HC SSE Items → HCU STATUS_EVENTs
 *
 * dimLevel Logik:
 *   RemoteControlStartAllowed = true  → dimLevel: 1.0 + switchState: on
 *   ProgramProgress = X               → dimLevel: (100-X)/100 (100%→0%)
 *   ProgramFinished/Aborted           → dimLevel: 0 + switchState: off
 *   OperationState = Inactive/Ready   → dimLevel: 0 + switchState: off
 */
export function itemsToStatusEvents(baseDeviceId, items) {
  const lightFeatures    = {};
  const suppliesFeatures = {};

  for (const it of items ?? []) {
    switch (it.key) {

      // Fernstart aktiv → dimLevel 100% + switch on
      case "BSH.Common.Status.RemoteControlStartAllowed":
        if (it.value === true || it.value === "true") {
          lightFeatures.switchState = { type: "switchState", on: true };
          lightFeatures.dimming     = { type: "dimming", dimLevel: 1.0 };
        } else {
          // Fernstart deaktiviert → nur dimLevel zurücksetzen wenn nicht läuft
          lightFeatures.dimming = { type: "dimming", dimLevel: 0 };
        }
        break;

      // Betriebszustand
      case "BSH.Common.Status.OperationState": {
        const running = [
          "BSH.Common.EnumType.OperationState.Run",
          "BSH.Common.EnumType.OperationState.Pause",
          "BSH.Common.EnumType.OperationState.DelayedStart",
          "BSH.Common.EnumType.OperationState.ActionRequired",
        ].includes(it.value);

        const ready = [
          "BSH.Common.EnumType.OperationState.Ready",
          "BSH.Common.EnumType.OperationState.Inactive",
        ].includes(it.value);

        if (running) {
          lightFeatures.switchState = { type: "switchState", on: true };
        } else if (ready) {
          // Fertig/bereit - Switch bleibt on wenn Fernstart aktiv
          // wird durch RemoteControlStartAllowed gesteuert
        } else {
          // Finished/Error/etc.
          lightFeatures.switchState = { type: "switchState", on: false };
          lightFeatures.dimming     = { type: "dimming", dimLevel: 0 };
        }
        break;
      }

      // Fortschritt → dimLevel von 1.0 → 0.0 (100%→0%)
      case "BSH.Common.Option.ProgramProgress": {
        const progress = Number(it.value ?? 0);
        // 0% Fortschritt = 100% dimLevel, 100% Fortschritt = 0% dimLevel
        lightFeatures.dimming = { type: "dimming", dimLevel: (100 - progress) / 100 };
        break;
      }

      // PowerState Off/Standby → alles aus
      case "BSH.Common.Setting.PowerState":
        if (it.value !== "BSH.Common.EnumType.PowerState.On") {
          lightFeatures.switchState = { type: "switchState", on: false };
          lightFeatures.dimming     = { type: "dimming", dimLevel: 0 };
        }
        break;

      // Programm fertig/abgebrochen → aus
      case "BSH.Common.Event.ProgramFinished":
      case "BSH.Common.Event.ProgramAborted":
        lightFeatures.switchState = { type: "switchState", on: false };
        lightFeatures.dimming     = { type: "dimming", dimLevel: 0 };
        break;

      // Gerät offline
      case "connected":
        lightFeatures.maintenance = {
          type: "maintenance",
          unreach:  !(it.value === true || it.value === "true"),
          lowBat:   false,
          sabotage: false,
        };
        break;

      // Salz fast leer (Dishwasher)
      case "Dishcare.Dishwasher.Event.SaltNearlyEmpty":
        suppliesFeatures.waterlevelDetected = {
          type:               "waterlevelDetected",
          waterlevelDetected: it.value !== "BSH.Common.EnumType.EventPresentState.Off",
        };
        break;

      // Klarspüler fast leer (Dishwasher)
      case "Dishcare.Dishwasher.Event.RinseAidNearlyEmpty":
        suppliesFeatures.moistureDetected = {
          type:             "moistureDetected",
          moistureDetected: it.value !== "BSH.Common.EnumType.EventPresentState.Off",
        };
        break;
    }
  }

  const events = [];
  if (Object.keys(lightFeatures).length > 0)
    events.push({ deviceId: baseDeviceId,              features: Object.values(lightFeatures) });
  if (Object.keys(suppliesFeatures).length > 0)
    events.push({ deviceId: `${baseDeviceId}-supplies`, features: Object.values(suppliesFeatures) });

  return events;
}

/**
 * HCU CONTROL_REQUEST → HC Aktion
 *
 * switchState on  → startProgram (vorgewähltes Programm)
 * switchState off → stopProgram
 * dimming         → ignoriert (read-only Fortschrittsanzeige)
 */
export function featuresToHcAction(deviceId, features) {
  // Vorräte-Device ist nicht steuerbar
  if (deviceId.endsWith("-supplies")) return null;

  for (const f of features ?? []) {
    if (f.type === "switchState") {
      return f.on ? { action: "startProgram" } : { action: "stopProgram" };
    }
    if (f.type === "dimming") {
      // Dimmer-Slider ignorieren - ist nur Fortschrittsanzeige
      return { action: "ignore" };
    }
  }
  return null;
}
