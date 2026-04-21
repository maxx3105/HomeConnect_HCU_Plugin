import { CHANNEL_TYPE, DP, makeChannel, makeDevice } from "../hcu/protocol.js";

/**
 * Channel-Layout:
 *   0 – (reserviert, Maintenance – hier nicht belegt)
 *   1 – SWITCH           (Power on/off)
 *   2 – TEXT_STATE       (Operation State / ProgramKey / StatusText)
 *   3 – NUMBER_STATE     (Remaining Time, Sekunden)
 *   4 – NUMBER_STATE     (Progress, Prozent)
 *   5 – CONTACT          (Door open/closed – wenn Gerät eine Tür hat)
 *   6 – PROGRAM          (ProgramSelect – lesbar/schreibbar)
 */
export const CHAN = {
  POWER: 1,
  STATUS: 2,
  REMAINING: 3,
  PROGRESS: 4,
  DOOR: 5,
  PROGRAM: 6,
};

/** Gerätetypen, die eine Tür haben. */
const HAS_DOOR = new Set([
  "Dishwasher",
  "Washer",
  "Dryer",
  "WasherDryer",
  "Oven",
  "Microwave",
  "Refrigerator",
  "Freezer",
  "FridgeFreezer",
  "WineCooler",
]);

/**
 * Baut ein virtuelles HCU-Device aus einer Home-Connect-Appliance.
 *
 * @param {{haId:string, type:string, name?:string, brand?:string, vib?:string, connected:boolean, enumber?:string}} app
 */
export function applianceToDevice(app) {
  const channels = [
    makeChannel({
      index: CHAN.POWER,
      type: CHANNEL_TYPE.SWITCH,
      label: "Power",
      writable: true,
      initialValues: { [DP.ON]: false },
    }),
    makeChannel({
      index: CHAN.STATUS,
      type: CHANNEL_TYPE.TEXT_STATE,
      label: "Status",
      writable: false,
      initialValues: { [DP.TEXT]: app.connected ? "Ready" : "Offline" },
    }),
    makeChannel({
      index: CHAN.REMAINING,
      type: CHANNEL_TYPE.NUMBER_STATE,
      label: "Remaining Time",
      writable: false,
      initialValues: { [DP.NUMBER]: 0, [DP.UNIT]: "s" },
    }),
    makeChannel({
      index: CHAN.PROGRESS,
      type: CHANNEL_TYPE.NUMBER_STATE,
      label: "Progress",
      writable: false,
      initialValues: { [DP.NUMBER]: 0, [DP.UNIT]: "%" },
    }),
  ];

  if (HAS_DOOR.has(app.type)) {
    channels.push(
      makeChannel({
        index: CHAN.DOOR,
        type: CHANNEL_TYPE.CONTACT,
        label: "Door",
        writable: false,
        initialValues: { [DP.CONTACT_OPEN]: false },
      })
    );
  }

  channels.push(
    makeChannel({
      index: CHAN.PROGRAM,
      type: CHANNEL_TYPE.PROGRAM,
      label: "Program",
      writable: true,
      initialValues: { [DP.PROGRAM_KEY]: "", [DP.PROGRAM_OPTIONS]: [] },
    })
  );

  return makeDevice({
    deviceId: `hc-${app.haId}`,
    label: app.name ?? `${app.brand ?? "HC"} ${app.type}`,
    manufacturer: app.brand ?? "Home Connect",
    modelType: app.vib ?? app.enumber ?? app.type,
    firmware: app.enumber ?? "n/a",
    channels,
  });
}

/**
 * Übersetzt Home-Connect-Status/Event-Items in Channel-Updates für die HCU.
 *
 * Mapping:
 *   BSH.Common.Status.OperationState            -> CHAN.STATUS.TEXT_VALUE
 *   BSH.Common.Status.DoorState                 -> CHAN.DOOR.CONTACT_OPEN
 *   BSH.Common.Setting.PowerState               -> CHAN.POWER.STATE
 *   BSH.Common.Root.ActiveProgram               -> CHAN.PROGRAM.PROGRAM_KEY
 *   BSH.Common.Option.RemainingProgramTime      -> CHAN.REMAINING.NUMBER_VALUE
 *   BSH.Common.Option.ProgramProgress           -> CHAN.PROGRESS.NUMBER_VALUE
 *   BSH.Common.Event.ProgramFinished / Aborted  -> CHAN.STATUS (Text-Update)
 *
 * @param {{key:string, value:any}[]} items
 * @returns {{channelIndex:number, values:object}[]}
 */
export function itemsToChannelUpdates(items) {
  const updates = [];

  for (const it of items ?? []) {
    switch (it.key) {
      case "BSH.Common.Setting.PowerState":
        updates.push({
          channelIndex: CHAN.POWER,
          values: { [DP.ON]: it.value === "BSH.Common.EnumType.PowerState.On" },
        });
        break;

      case "BSH.Common.Status.OperationState": {
        const text = String(it.value ?? "").split(".").pop();
        updates.push({
          channelIndex: CHAN.STATUS,
          values: { [DP.TEXT]: text },
        });
        break;
      }

      case "BSH.Common.Status.DoorState":
        updates.push({
          channelIndex: CHAN.DOOR,
          values: {
            [DP.CONTACT_OPEN]: it.value === "BSH.Common.EnumType.DoorState.Open",
          },
        });
        break;

      case "BSH.Common.Root.ActiveProgram":
        updates.push({
          channelIndex: CHAN.PROGRAM,
          values: { [DP.PROGRAM_KEY]: it.value ?? "" },
        });
        break;

      case "BSH.Common.Option.RemainingProgramTime":
        updates.push({
          channelIndex: CHAN.REMAINING,
          values: { [DP.NUMBER]: Number(it.value ?? 0), [DP.UNIT]: "s" },
        });
        break;

      case "BSH.Common.Option.ProgramProgress":
        updates.push({
          channelIndex: CHAN.PROGRESS,
          values: { [DP.NUMBER]: Number(it.value ?? 0), [DP.UNIT]: "%" },
        });
        break;

      case "BSH.Common.Event.ProgramFinished":
        updates.push({ channelIndex: CHAN.STATUS, values: { [DP.TEXT]: "Finished" } });
        break;

      case "BSH.Common.Event.ProgramAborted":
        updates.push({ channelIndex: CHAN.STATUS, values: { [DP.TEXT]: "Aborted" } });
        break;

      default:
        // ignore
        break;
    }
  }
  return updates;
}

/**
 * Übersetzt eine Channel-Control-Request (HCU -> Plugin) in einen REST-Call-Plan
 * gegen die Home-Connect-API.
 *
 * Rückgabe: { action, args }  oder  null, wenn nicht zuordenbar.
 *
 *   action = "setPower"     args = { on: boolean }
 *   action = "startProgram" args = { programKey, options }
 *   action = "stopProgram"  args = {}
 *   action = "selectProgram" args = { programKey, options }
 */
export function controlToHomeConnectAction(channelIndex, values) {
  if (channelIndex === CHAN.POWER && DP.ON in values) {
    return { action: "setPower", args: { on: !!values[DP.ON] } };
  }
  if (channelIndex === CHAN.PROGRAM) {
    if (values.START === true && values[DP.PROGRAM_KEY]) {
      return {
        action: "startProgram",
        args: {
          programKey: values[DP.PROGRAM_KEY],
          options: values[DP.PROGRAM_OPTIONS] ?? [],
        },
      };
    }
    if (values.STOP === true) return { action: "stopProgram", args: {} };
    if (values[DP.PROGRAM_KEY]) {
      return {
        action: "selectProgram",
        args: {
          programKey: values[DP.PROGRAM_KEY],
          options: values[DP.PROGRAM_OPTIONS] ?? [],
        },
      };
    }
  }
  return null;
}
