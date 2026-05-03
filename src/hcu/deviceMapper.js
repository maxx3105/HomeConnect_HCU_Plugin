import { DEVICE_TYPE, FEATURE, makeDevice, makeFeature } from "../hcu/protocol.js";

/**
 * Bildet eine Home-Connect-Appliance auf ein HCU-Device ab.
 * Feature-Schema nach Connect API Doku 1.0.1, Kap. 6.7.
 */
export function applianceToDevice(app) {
  const features = buildFeatures(app.type);
  return makeDevice({
    id:              `hc-${app.haId}`,
    type:            DEVICE_TYPE.GENERIC_INPUT,
    label:           app.name ?? `${app.brand ?? "HC"} ${app.type}`,
    manufacturerId:  app.brand ?? "Home Connect",
    modelId:         app.vib  ?? app.enumber ?? app.type,
    firmwareVersion: app.enumber ?? "n/a",
    features,
  });
}

function buildFeatures(type) {
  const f = [
    // Alle Geräte: An/Aus (PowerState → SWITCH)
    makeFeature(FEATURE.SWITCH, { on: false }),
  ];

  // Geräte mit Tür: GENERIC_INPUT für Tür-Status
  const hasDoor = ["Dishwasher","Washer","Dryer","WasherDryer","Oven","Microwave",
                   "Refrigerator","Freezer","FridgeFreezer","WineCooler"];
  if (hasDoor.includes(type)) {
    f.push(makeFeature(FEATURE.GENERIC_INPUT, {
      key: "doorState", value: "closed", label: "Tür",
    }));
  }

  // Geräte mit Temperatur-Setpoint (Ofen etc.)
  if (["Oven","Microwave","WarmingDrawer"].includes(type)) {
    f.push(makeFeature(FEATURE.SETPOINT_TEMPERATURE, { value: 0, unit: "CELSIUS" }));
    f.push(makeFeature(FEATURE.ACTUAL_TEMPERATURE,   { value: 0, unit: "CELSIUS" }));
  }

  // Alle: generische Status-Felder für Betriebsstatus, Restzeit, Programm
  f.push(makeFeature(FEATURE.GENERIC_INPUT, {
    key: "operationState", value: "Ready", label: "Status",
  }));
  f.push(makeFeature(FEATURE.GENERIC_INPUT, {
    key: "remainingTime", value: 0, label: "Restzeit (s)",
  }));
  f.push(makeFeature(FEATURE.GENERIC_INPUT, {
    key: "activeProgram", value: "", label: "Programm",
  }));

  return f;
}

/**
 * Übersetzt Home-Connect-Items in Feature-Updates.
 * Rückgabe: Array von { key, value } Paaren für GENERIC_INPUT Features
 * oder { featureType, properties } für typisierte Features.
 */
export function itemsToFeatureUpdates(items) {
  const updates = [];
  for (const it of items ?? []) {
    switch (it.key) {
      case "BSH.Common.Setting.PowerState":
        updates.push({ featureType: FEATURE.SWITCH,
          props: { on: it.value === "BSH.Common.EnumType.PowerState.On" } });
        break;
      case "BSH.Common.Status.OperationState":
        updates.push({ featureType: FEATURE.GENERIC_INPUT,
          props: { key: "operationState", value: String(it.value ?? "").split(".").pop() } });
        break;
      case "BSH.Common.Status.DoorState":
        updates.push({ featureType: FEATURE.GENERIC_INPUT,
          props: { key: "doorState",
            value: it.value === "BSH.Common.EnumType.DoorState.Open" ? "open" : "closed" } });
        break;
      case "BSH.Common.Root.ActiveProgram":
        updates.push({ featureType: FEATURE.GENERIC_INPUT,
          props: { key: "activeProgram", value: String(it.value ?? "").split(".").pop() } });
        break;
      case "BSH.Common.Option.RemainingProgramTime":
        updates.push({ featureType: FEATURE.GENERIC_INPUT,
          props: { key: "remainingTime", value: Number(it.value ?? 0) } });
        break;
      case "BSH.Common.Event.ProgramFinished":
        updates.push({ featureType: FEATURE.GENERIC_INPUT,
          props: { key: "operationState", value: "Finished" } });
        break;
      case "BSH.Common.Event.ProgramAborted":
        updates.push({ featureType: FEATURE.GENERIC_INPUT,
          props: { key: "operationState", value: "Aborted" } });
        break;
    }
  }
  return updates;
}

/**
 * Übersetzt HCU-Control-Features in Home-Connect-Aktionen.
 */
export function featuresToHcAction(features) {
  if (!features) return null;
  for (const f of features) {
    if (f.type === FEATURE.SWITCH && f.on !== undefined) {
      return { action: "setPower", args: { on: !!f.on } };
    }
    if (f.type === FEATURE.GENERIC_INPUT && f.key === "activeProgram" && f.value) {
      return { action: "startProgram", args: { programKey: f.value, options: [] } };
    }
  }
  return null;
}
