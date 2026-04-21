import { logger } from "./logger.js";
import { HomeConnectAuth } from "./homeconnect/auth.js";
import { HomeConnectClient } from "./homeconnect/client.js";
import { HomeConnectEventStream } from "./homeconnect/events.js";
import { HcuClient } from "./hcu/client.js";
import { Bridge } from "./bridge.js";

async function main() {
  logger.info("Starting HCU Home Connect Plugin");

  const auth = new HomeConnectAuth();
  await auth.init();

  const hc = new HomeConnectClient(auth);
  const sse = new HomeConnectEventStream(auth);
  const hcu = new HcuClient();

  const bridge = new Bridge({ hcu, hc, sse });

  // HCU zuerst starten – die Bridge registriert Devices, sobald "ready" kommt
  await hcu.start();

  // kurzer Moment, bis der WS "open" ist, bevor wir Devices discovern
  await new Promise((resolve) => hcu.once("ready", resolve));
  await bridge.run();

  logger.info("Plugin is running. Ctrl-C to quit.");

  const shutdown = (signal) => {
    logger.info({ signal }, "Shutting down");
    sse.stop();
    hcu.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err: err.message, stack: err.stack }, "Fatal error");
  process.exit(1);
});
