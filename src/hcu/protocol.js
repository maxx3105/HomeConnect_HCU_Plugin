/**
 * HCU Connect API – Protokoll-Schicht.
 *
 * =========================================================================
 * WICHTIG: Exakte Feldnamen bitte gegen die offizielle Dokumentation
 *  `connect-api-documentation-1.0.1.html`
 *  https://github.com/homematicip/connect-api/releases/tag/1.0.1
 * prüfen. Die Namen hier folgen dem Java-Referenz-Paketlayout
 *  `de.eq3.plugin.{device,control,user,system}` und der dokumentierten
 * WebSocket-Header/Body-Struktur.
 *
 * Wenn Felder bei dir anders heißen (z. B. `messageType` vs. `type` oder
 * CamelCase vs. SCREAMING_SNAKE_CASE), musst du NUR diese Datei anpassen –
 * alles andere konsumiert die Builder hier.
 * =========================================================================
 */

/** Nachrichten-Typen (vom Plugin an die HCU gesendet). */
export const MSG_OUT = {
  PLUGIN_READY:            "PLUGIN_READY_REQUEST",
  PLUGIN_STATE_RESPONSE:   "PLUGIN_STATE_RESPONSE",
  DEVICE_ADDED:            "DEVICE_ADDED_EVENT",
  DEVICE_REMOVED:          "DEVICE_REMOVED_EVENT",
  DEVICE_UPDATED:          "DEVICE_UPDATED_EVENT",
  CHANNEL_EVENT:           "CHANNEL_EVENT",
  CONTROL_RESPONSE:        "CONTROL_RESPONSE",
};

/** Nachrichten-Typen (von der HCU an das Plugin). */
export const MSG_IN = {
  PLUGIN_STATE_REQUEST:   "PLUGIN_STATE_REQUEST",
  CONTROL_REQUEST:        "CONTROL_REQUEST",
  DEVICE_CONFIG_REQUEST:  "DEVICE_CONFIG_REQUEST",
  PING:                   "PING",
};

/** Virtuelle Device-Typen, auf die wir Home-Connect-Geräte abbilden. */
export const DEVICE_TYPE = {
  GENERIC_SWITCH:   "EXTERNAL_SWITCH",
  GENERIC_SENSOR:   "EXTERNAL_SENSOR",
  GENERIC_COMPLEX:  "EXTERNAL_COMPLEX_DEVICE",
};

/** Channel-Typen. */
export const CHANNEL_TYPE = {
  SWITCH:          "SWITCH_CHANNEL",
  TEXT_STATE:      "TEXT_STATE_CHANNEL",
  NUMBER_STATE:    "NUMBER_STATE_CHANNEL",
  PROGRAM:         "PROGRAM_SELECT_CHANNEL",
  CONTACT:         "CONTACT_CHANNEL",   // für Tür auf/zu
};

/** Datenpunkt-Keys innerhalb eines Channels. */
export const DP = {
  // SWITCH
  ON:              "STATE",
  // TEXT/NUMBER STATE
  TEXT:            "TEXT_VALUE",
  NUMBER:          "NUMBER_VALUE",
  UNIT:            "UNIT",
  // PROGRAM
  PROGRAM_KEY:     "PROGRAM_KEY",
  PROGRAM_OPTIONS: "PROGRAM_OPTIONS",
  REMAINING:       "REMAINING_TIME",
  PROGRESS:        "PROGRESS",
  // CONTACT
  CONTACT_OPEN:    "CONTACT_OPEN",
};

let seq = 0;
const nextId = () => `msg-${Date.now()}-${++seq}`;

/**
 * Standard-Envelope. Das Format ist:
 *   { header: { type, id, timestamp, pluginId }, body: {...} }
 */
function envelope(type, body, { pluginId, correlationId } = {}) {
  return {
    header: {
      type,
      id: nextId(),
      correlationId: correlationId ?? null,
      timestamp: Date.now(),
      pluginId: pluginId ?? null,
      version: "1.0.1",
    },
    body: body ?? {},
  };
}

// ===== Message Builders ===================================================

export function buildPluginReady({ pluginId, pluginVersion }) {
  return envelope(
    MSG_OUT.PLUGIN_READY,
    { pluginId, pluginVersion, capabilities: ["device.virtual", "event.subscription", "control.dispatch"] },
    { pluginId }
  );
}

export function buildPluginStateResponse({ pluginId, devices, correlationId }) {
  return envelope(
    MSG_OUT.PLUGIN_STATE_RESPONSE,
    { pluginId, devices },
    { pluginId, correlationId }
  );
}

export function buildDeviceAdded({ pluginId, device }) {
  return envelope(MSG_OUT.DEVICE_ADDED, { device }, { pluginId });
}

export function buildDeviceRemoved({ pluginId, deviceId }) {
  return envelope(MSG_OUT.DEVICE_REMOVED, { deviceId }, { pluginId });
}

export function buildDeviceUpdated({ pluginId, device }) {
  return envelope(MSG_OUT.DEVICE_UPDATED, { device }, { pluginId });
}

export function buildChannelEvent({ pluginId, deviceId, channelIndex, values }) {
  return envelope(
    MSG_OUT.CHANNEL_EVENT,
    {
      deviceId,
      channelIndex,
      // values = { STATE: true, TEXT_VALUE: "Cotton 40°", ... }
      values,
      timestamp: Date.now(),
    },
    { pluginId }
  );
}

export function buildControlResponse({ pluginId, correlationId, success, error }) {
  return envelope(
    MSG_OUT.CONTROL_RESPONSE,
    { success, error: error ?? null },
    { pluginId, correlationId }
  );
}

// ===== Device / Channel Constructors ======================================

/**
 * Ein virtuelles Gerät, das an die HCU gemeldet wird.
 *
 * @param {object} p
 * @param {string} p.deviceId     stabil (z. B. "hc-<haId>")
 * @param {string} p.label        Anzeigename
 * @param {string} p.manufacturer z. B. "Bosch"
 * @param {string} p.modelType    z. B. "Dishwasher"
 * @param {string} p.firmware
 * @param {Array}  p.channels     Liste von Channel-Objekten
 */
export function makeDevice({ deviceId, label, manufacturer, modelType, firmware, channels }) {
  return {
    id: deviceId,
    type: DEVICE_TYPE.GENERIC_COMPLEX,
    label,
    manufacturer,
    modelType,
    firmwareVersion: firmware ?? "n/a",
    channels,
  };
}

/**
 * Channel-Deskriptor. Channel-Index 0 ist per Konvention "Maintenance",
 * die funktionalen Channels starten bei 1.
 */
export function makeChannel({ index, type, label, writable = false, initialValues = {} }) {
  return {
    index,
    type,
    label,
    writable,
    values: initialValues,
  };
}
