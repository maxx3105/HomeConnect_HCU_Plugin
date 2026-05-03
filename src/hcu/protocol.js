/**
 * HCU Connect API – Protokoll (Connect API Doku 1.0.1)
 *
 * Message-Format:
 *   { id, pluginId, type, body }
 *
 * WebSocket-Auth-Header:
 *   authtoken: <token>
 *   plugin-id: <pluginId>
 */
import { randomUUID } from "node:crypto";

export const MSG_OUT = {
  PLUGIN_STATE_RESPONSE:       "PLUGIN_STATE_RESPONSE",
  DISCOVER_RESPONSE:           "DISCOVER_RESPONSE",
  STATUS_EVENT:                "STATUS_EVENT",
  STATUS_RESPONSE:             "STATUS_RESPONSE",
  CONTROL_RESPONSE:            "CONTROL_RESPONSE",
  CONFIG_TEMPLATE_RESPONSE:    "CONFIG_TEMPLATE_RESPONSE",
  CONFIG_UPDATE_RESPONSE:      "CONFIG_UPDATE_RESPONSE",
  CREATE_USER_MESSAGE_REQUEST: "CREATE_USER_MESSAGE_REQUEST",
  DELETE_USER_MESSAGE_REQUEST: "DELETE_USER_MESSAGE_REQUEST",
};

export const MSG_IN = {
  PLUGIN_STATE_REQUEST:  "PLUGIN_STATE_REQUEST",
  DISCOVER_REQUEST:      "DISCOVER_REQUEST",
  CONTROL_REQUEST:       "CONTROL_REQUEST",
  CONFIG_TEMPLATE_REQUEST: "CONFIG_TEMPLATE_REQUEST",
  CONFIG_UPDATE_REQUEST:   "CONFIG_UPDATE_REQUEST",
  STATUS_REQUEST:          "STATUS_REQUEST",
};

export const READINESS = {
  READY:        "READY",
  NOT_READY:    "NOT_READY",
  INITIALIZING: "INITIALIZING",
};

/** HCU DeviceType Enum (Doku 6.6.5) */
export const DEVICE_TYPE = {
  SWITCH:          "SWITCH",           // Required: switchState
  CONTACT_SENSOR:  "CONTACT_SENSOR",   // Required: contactSensorState
  CLIMATE_SENSOR:  "CLIMATE_SENSOR",   // Optional: actualTemperature, humidity
};

/** Feature type names (camelCase!) laut Doku 6.6.6 */
export const FEATURE_TYPE = {
  SWITCH_STATE:          "switchState",
  CONTACT_SENSOR_STATE:  "contactSensorState",
  ACTUAL_TEMPERATURE:    "actualTemperature",
  MAINTENANCE:           "maintenance",
};

function msg(pluginId, type, body, id) {
  return { id: id ?? randomUUID(), pluginId, type, body: body ?? {} };
}

export function buildPluginStateResponse(pluginId, correlationId, readiness = "READY") {
  return msg(pluginId, MSG_OUT.PLUGIN_STATE_RESPONSE,
    { pluginReadinessStatus: readiness },
    correlationId
  );
}

export function buildDiscoverResponse(pluginId, devices, correlationId) {
  return msg(pluginId, MSG_OUT.DISCOVER_RESPONSE,
    { success: true, devices },
    correlationId
  );
}

export function buildStatusEvent(pluginId, deviceId, features) {
  return msg(pluginId, MSG_OUT.STATUS_EVENT, { deviceId, features });
}

export function buildStatusResponse(pluginId, deviceId, features, correlationId) {
  return msg(pluginId, MSG_OUT.STATUS_RESPONSE, { deviceId, features }, correlationId);
}

export function buildControlResponse(pluginId, success, errorCode, correlationId) {
  return msg(pluginId, MSG_OUT.CONTROL_RESPONSE,
    { success, ...(errorCode ? { errorCode } : {}) },
    correlationId
  );
}

/**
 * Geräteobjekt für DISCOVER_RESPONSE.
 * Pflichtfelder: deviceId, deviceType, features
 */
export function makeDevice({ deviceId, deviceType, friendlyName, modelType, firmwareVersion, features }) {
  return {
    deviceId,
    deviceType,
    friendlyName:    friendlyName ?? deviceId,
    modelType:       modelType    ?? "unknown",
    firmwareVersion: firmwareVersion ?? "n/a",
    features:        features ?? [],
  };
}

/** switchState Feature: { type: "switchState", on: boolean } */
export function makeSwitchFeature(on = false) {
  return { type: FEATURE_TYPE.SWITCH_STATE, on };
}

/** contactSensorState Feature: { type: "contactSensorState", open: boolean } */
export function makeContactFeature(open = false) {
  return { type: FEATURE_TYPE.CONTACT_SENSOR_STATE, open };
}

/** actualTemperature Feature: { type: "actualTemperature", temperature: number, unit: "CELSIUS" } */
export function makeTempFeature(temperature = 0) {
  return { type: FEATURE_TYPE.ACTUAL_TEMPERATURE, temperature, unit: "CELSIUS" };
}
