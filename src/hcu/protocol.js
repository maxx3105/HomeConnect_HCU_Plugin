/**
 * HCU Connect API – Protokoll (Connect API Doku 1.0.1)
 *
 * Message-Format (PluginMessage Envelope):
 *   {
 *     "id":       "<uuid>",          // Nachrichts-ID
 *     "pluginId": "<plugin-id>",     // deine Plugin-ID
 *     "type":     "<MessageType>",   // z.B. "PLUGIN_STATE_RESPONSE"
 *     "body":     { ... }            // typ-spezifischer Body
 *   }
 *
 * WebSocket-Auth-Header:
 *   authtoken: <token>
 *   plugin-id: <pluginId>
 *
 * WebSocket-URL (im Container): wss://host.containers.internal:9001
 */

import { randomUUID } from "node:crypto";

// ── Nachrichtentypen Plugin → HCU ─────────────────────────────────────────
export const MSG_OUT = {
  PLUGIN_STATE_RESPONSE: "PLUGIN_STATE_RESPONSE",
  DISCOVER_RESPONSE:     "DISCOVER_RESPONSE",
  STATUS_EVENT:          "STATUS_EVENT",
  STATUS_RESPONSE:       "STATUS_RESPONSE",
  CONTROL_RESPONSE:      "CONTROL_RESPONSE",
  SYSTEM_INFO_REQUEST:   "SYSTEM_INFO_REQUEST",
  HMIP_SYSTEM_REQUEST:   "HmipSystemRequest",
};

// ── Nachrichtentypen HCU → Plugin ─────────────────────────────────────────
export const MSG_IN = {
  PLUGIN_STATE_REQUEST:  "PLUGIN_STATE_REQUEST",
  DISCOVER_REQUEST:      "DISCOVER_REQUEST",
  CONTROL_REQUEST:       "CONTROL_REQUEST",
  CONFIG_TEMPLATE_REQUEST: "CONFIG_TEMPLATE_REQUEST",
  CONFIG_UPDATE_REQUEST:   "CONFIG_UPDATE_REQUEST",
};

// ── pluginReadinessStatus Werte ───────────────────────────────────────────
export const READINESS = {
  READY:        "READY",
  NOT_READY:    "NOT_READY",
  INITIALIZING: "INITIALIZING",
};

// ── Feature-Typen (aus Doku Kap. 6.6.6) ──────────────────────────────────
export const FEATURE = {
  SWITCH:              "SWITCH",
  COLOR_TEMPERATURE:   "COLOR_TEMPERATURE",
  DIMMER:              "DIMMER",
  SHADING:             "SHADING",
  ACTUAL_TEMPERATURE:  "ACTUAL_TEMPERATURE",
  SETPOINT_TEMPERATURE:"SETPOINT_TEMPERATURE",
  BATTERY_STATE:       "BATTERY_STATE",
  PRESENCE:            "PRESENCE",
  LOCK:                "LOCK",
  GENERIC_INPUT:       "GENERIC_INPUT",
};

// ── DeviceType (Kap. 6.6.5) ───────────────────────────────────────────────
export const DEVICE_TYPE = {
  SWITCH_MEASURIG_ACTUATOR: "SWITCH_MEASURING_ACTUATOR",
  TEMPERATURE_SENSOR:       "TEMPERATURE_SENSOR",
  CONTACT_INTERFACE:        "CONTACT_INTERFACE",
  ROTARY_HANDLE_SENSOR:     "ROTARY_HANDLE_SENSOR",
  GENERIC_INPUT:            "GENERIC_INPUT",
  ROOM_CONTROL_DEVICE:      "ROOM_CONTROL_DEVICE",
};

// ── Message Builder ───────────────────────────────────────────────────────

/** Basis-Envelope */
function msg(pluginId, type, body, id) {
  return { id: id ?? randomUUID(), pluginId, type, body: body ?? {} };
}

/** PLUGIN_STATE_RESPONSE – als Antwort auf PLUGIN_STATE_REQUEST oder beim Start */
export function buildPluginStateResponse(pluginId, correlationId) {
  return msg(pluginId, MSG_OUT.PLUGIN_STATE_RESPONSE,
    { pluginReadinessStatus: READINESS.READY },
    correlationId   // id = correlationId der Request laut Doku
  );
}

/** DISCOVER_RESPONSE – meldet verfügbare Geräte */
export function buildDiscoverResponse(pluginId, devices, correlationId) {
  return msg(pluginId, MSG_OUT.DISCOVER_RESPONSE, { devices }, correlationId);
}

/** STATUS_EVENT – pushed Zustandsänderung eines Geräts */
export function buildStatusEvent(pluginId, deviceId, features) {
  return msg(pluginId, MSG_OUT.STATUS_EVENT, { deviceId, features });
}

/** STATUS_RESPONSE – Antwort auf STATUS_REQUEST */
export function buildStatusResponse(pluginId, deviceId, features, correlationId) {
  return msg(pluginId, MSG_OUT.STATUS_RESPONSE, { deviceId, features }, correlationId);
}

/** CONTROL_RESPONSE – Antwort auf CONTROL_REQUEST */
export function buildControlResponse(pluginId, success, errorCode, correlationId) {
  return msg(pluginId, MSG_OUT.CONTROL_RESPONSE,
    { success, ...(errorCode ? { errorCode } : {}) },
    correlationId
  );
}

// ── Device-Objekt Konstruktor ─────────────────────────────────────────────

/**
 * Geräteobjekt für DISCOVER_RESPONSE.
 * Features = Array von Feature-Deskriptoren (je nach Geräteklasse).
 */
export function makeDevice({ id, type, label, manufacturerId, modelId, firmwareVersion, features }) {
  return {
    id,
    type:            type ?? DEVICE_TYPE.GENERIC_INPUT,
    label:           label ?? id,
    manufacturerId:  manufacturerId ?? "home-connect",
    modelId:         modelId ?? "appliance",
    firmwareVersion: firmwareVersion ?? "n/a",
    features:        features ?? [],
  };
}

/** Feature-Deskriptor */
export function makeFeature(type, properties = {}) {
  return { type, ...properties };
}
