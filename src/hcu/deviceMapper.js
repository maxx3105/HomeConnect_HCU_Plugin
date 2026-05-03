/**
 * Mapping Home Connect → HCU Devices
 *
 * Pro Gerät 3 Devices:
 *
 * 1. LIGHT  (friendlyName: Gerätename)
 *    - switchState: on = Gerät aktiv (OperationState = Run/Pause/DelayedStart)
 *    - dimming:     dimLevel 0.0-1.0 = Fortschritt (ProgramProgress ÷ 100)
 *    - maintenance: unreach = Gerät offline
 *    → Steuerbar: switchState on/off → PowerState On/Standby
 *
 * 2. CLIMATE_SENSOR  (friendlyName: Gerätename + " Timer")
 *    - sunshineDuration: sunshineDuration = Restzeit in Sekunden
 *
 * 3. CONTACT_SENSOR  (friendlyName: Gerätename + " Fernstart")
 *    - contactSensorState: triggered = RemoteControlStartAllowed aktiv
 *
 * Optional (Dishwasher):
 * 4. WATER_SENSOR  (friendlyName: Gerätename + " Vorräte")
 *    - waterlevelDetected: Salz fast leer
 *    - moistureDetected:   Klarspüler fast leer
 */
import { makeDevice } from "./protocol.js";

export const DEVICE_TYPE = {
  LIGHT:          "LIGHT",
  CLIMATE_SENSOR: "CLIMATE_SENSOR",
  CONTACT_SENSOR: "CONTACT_SENSOR",
  WATER_SENSOR:   "WATER_SENSOR",
};

/** Gerätetypen mit Tür */
const HAS_DOOR = new Set([
  "Dishwasher", "Washer", "Dryer", "WasherDryer",
  "Oven", "Microwave"
]);

/** Gerätetypen mit Vorrats-Warnungen (Salz, Klarspüler) */
const HAS_SUPPLIES = new Set(["Dishwasher"]);

/**
 * Erstellt alle HCU-Devices für eine HC-Appliance.
 */
export function applianceToDevices(app) {
  const baseId   = `hc-${app.haId}`;
  const baseName = app.name ?? `${app.brand ?? "HC"} ${app.type}`;
  const model    = app.vib ?? app.enumber ?? app.type;
  const fw       = app.enumber ?? "n/a";

  const devices = [];

  // 1. LIGHT — Hauptgerät (läuft/läuft-nicht + Fortschritt)
  devices.push(makeDevice({
    deviceId:     baseId,
    deviceType:   DEVICE_TYPE.LIGHT,
    friendlyName: baseName,
    modelType:    model,
    firmwareVersion: fw,
    features: [
      { type: "switchState", on: false },
      { type: "dimming",     dimLevel: 0 },
      { type: "maintenance", unreach: false, lowBat: false, sabotage: false },
    ],
  }));

  // 2. CLIMATE_SENSOR — Restzeit
  devices.push(makeDevice({
    deviceId:     `${baseId}-timer`,
    deviceType:   DEVICE_TYPE.CLIMATE_SENSOR,
    friendlyName: `${baseName} Restzeit`,
    modelType:    model,
    firmwareVersion: fw,
    features: [
      { type: "sunshineDuration", sunshineDuration: 0, todaySunshineDuration: 0, yesterdaySunshineDuration: 0 },
    ],
  }));

  // 3. CONTACT_SENSOR — Fernstart erlaubt
  devices.push(makeDevice({
    deviceId:     `${baseId}-remote`,
    deviceType:   DEVICE_TYPE.CONTACT_SENSOR,
    friendlyName: `${baseName} Fernstart`,
    modelType:    model,
    firmwareVersion: fw,
    features: [
      { type: "contactSensorState", triggered: false },
    ],
  }));

  // 4. WATER_SENSOR — Vorräte (nur Dishwasher)
  if (HAS_SUPPLIES.has(app.type)) {
    devices.push(makeDevice({
      deviceId:     `${baseId}-supplies`,
      deviceType:   DEVICE_TYPE.WATER_SENSOR,
      friendlyName: `${baseName} Vorräte`,
      modelType:    model,
      firmwareVersion: fw,
      features: [
        { type: "waterlevelDetected", waterlevelDetected: false }, // Salz
        { type: "moistureDetected",   moistureDetected: false },   // Klarspüler
      ],
    }));
  }

  return devices;
}

/**
 * Übersetzt HC SSE Items in HCU STATUS_EVENTs.
 * Gibt Array von { deviceId, features } zurück.
 */
export function itemsToStatusEvents(baseDeviceId, items) {
  const events = [];

  // Aggregierte Updates pro Device
  const lightFeatures    = {};
  const timerFeatures    = {};
  const remoteFeatures   = {};
  const suppliesFeatures = {};

  for (const it of items ?? []) {
    switch (it.key) {

      // Betriebszustand → switchState + dimLevel reset wenn fertig
      case "BSH.Common.Status.OperationState": {
        const running = [
          "BSH.Common.EnumType.OperationState.Run",
          "BSH.Common.EnumType.OperationState.Pause",
          "BSH.Common.EnumType.OperationState.DelayedStart",
          "BSH.Common.EnumType.OperationState.ActionRequired",
        ].includes(it.value);
        lightFeatures.switchState = { type: "switchState", on: running };
        if (!running) {
          lightFeatures.dimming = { type: "dimming", dimLevel: 0 };
        }
        break;
      }

      // PowerState → auch switchState
      case "BSH.Common.Setting.PowerState":
        if (it.value === "BSH.Common.EnumType.PowerState.Off" ||
            it.value === "BSH.Common.EnumType.PowerState.Standby") {
          lightFeatures.switchState = { type: "switchState", on: false };
          lightFeatures.dimming     = { type: "dimming", dimLevel: 0 };
        }
        break;

      // Fortschritt → dimLevel (0.0 - 1.0)
      case "BSH.Common.Option.ProgramProgress":
        lightFeatures.dimming = { type: "dimming", dimLevel: Number(it.value ?? 0) / 100 };
        break;

      // Restzeit → sunshineDuration (Sekunden)
      case "BSH.Common.Option.RemainingProgramTime":
        timerFeatures.sunshineDuration = {
          type: "sunshineDuration",
          sunshineDuration:          Number(it.value ?? 0),
          todaySunshineDuration:     Number(it.value ?? 0),
          yesterdaySunshineDuration: 0,
        };
        break;

      // Remote Start erlaubt → contactSensorState triggered
      case "BSH.Common.Status.RemoteControlStartAllowed":
        remoteFeatures.contactSensorState = {
          type:      "contactSensorState",
          triggered: it.value === true || it.value === "true",
        };
        break;

      // Offline → maintenance.unreach
      case "connected":
        lightFeatures.maintenance = {
          type:     "maintenance",
          unreach:  it.value === false || it.value === "false",
          lowBat:   false,
          sabotage: false,
        };
        break;

      // Programm fertig/abgebrochen → aus + Fortschritt 0
      case "BSH.Common.Event.ProgramFinished":
      case "BSH.Common.Event.ProgramAborted":
        lightFeatures.switchState = { type: "switchState", on: false };
        lightFeatures.dimming     = { type: "dimming", dimLevel: 0 };
        timerFeatures.sunshineDuration = {
          type: "sunshineDuration",
          sunshineDuration: 0, todaySunshineDuration: 0, yesterdaySunshineDuration: 0
        };
        break;

      // Salz fast leer → waterlevelDetected
      case "Dishcare.Dishwasher.Event.SaltNearlyEmpty":
        suppliesFeatures.waterlevelDetected = {
          type: "waterlevelDetected",
          waterlevelDetected: it.value !== "BSH.Common.EnumType.EventPresentState.Off",
        };
        break;

      // Klarspüler fast leer → moistureDetected
      case "Dishcare.Dishwasher.Event.RinseAidNearlyEmpty":
        suppliesFeatures.moistureDetected = {
          type: "moistureDetected",
          moistureDetected: it.value !== "BSH.Common.EnumType.EventPresentState.Off",
        };
        break;
    }
  }

  // Events zusammenbauen
  if (Object.keys(lightFeatures).length > 0)
    events.push({ deviceId: baseDeviceId,            features: Object.values(lightFeatures) });
  if (Object.keys(timerFeatures).length > 0)
    events.push({ deviceId: `${baseDeviceId}-timer`,   features: Object.values(timerFeatures) });
  if (Object.keys(remoteFeatures).length > 0)
    events.push({ deviceId: `${baseDeviceId}-remote`,  features: Object.values(remoteFeatures) });
  if (Object.keys(suppliesFeatures).length > 0)
    events.push({ deviceId: `${baseDeviceId}-supplies`, features: Object.values(suppliesFeatures) });

  return events;
}

/**
 * HCU CONTROL_REQUEST → HC Aktion
 */
export function featuresToHcAction(deviceId, features) {
  // Nur das Haupt-Device ist steuerbar
  if (deviceId.endsWith("-timer") || deviceId.endsWith("-remote") || deviceId.endsWith("-supplies")) {
    return null;
  }

  for (const f of features ?? []) {
    if (f.type === "switchState") {
      return f.on ? { action: "powerOn" } : { action: "powerOff" };
    }
  }
  return null;
}
