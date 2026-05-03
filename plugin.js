const WebSocket = require("ws");
const { v4: uuidv4 } = require("uuid");
const fs = require("fs").promises;

async function start(pluginId, host, authtokenFile) {
  const authtoken = await fs.readFile(authtokenFile, "utf8");
  const webSocket = new WebSocket("wss://" + host + ":9001", {
    rejectUnauthorized: false,
    headers: {
      "authtoken": authtoken.trim(),
      "plugin-id": pluginId
    }
  });

  function sendPluginReady(messageId) {
    const message = {
      id: messageId,
      pluginId: pluginId,
      type: "PLUGIN_STATE_RESPONSE",
      body: { pluginReadinessStatus: "READY" }
    };
    webSocket.send(JSON.stringify(message));
    console.log("Sent:", JSON.stringify(message));
  }

  webSocket.on("open", () => {
    console.log("Connected");
    sendPluginReady(uuidv4());
  });

  webSocket.on("message", (data) => {
    const message = JSON.parse(data);
    console.log("Received:", JSON.stringify(message));
    if (message.type === "PLUGIN_STATE_REQUEST") {
      sendPluginReady(message.id);
    }
  });

  webSocket.on("error", (err) => {
    console.error("Error:", err.code, err.message || err);
  });
}

const args = process.argv.slice(2);
start(args[0], args[1], args[2]);
