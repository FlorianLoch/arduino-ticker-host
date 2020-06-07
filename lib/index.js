const express = require("express");
const glob = require("glob");
const util = require("util");
const deepmerge = require("deepmerge");
const path = require("path");
const fs = require("fs");
const UDPBroadcastService = require("./udpBroadcastService");
const c = require("colors/safe");

const config = loadConfig();
const app = express();

onExit(() => {
  // This should be sync as the eventloop isn't used anymore when shutting down
  fs.writeFileSync(
    path.join(__dirname, "../config.json"),
    JSON.stringify(config)
  );
});

(async () => {
  const udpService = new UDPBroadcastService(config.udpPort, config.secret);
  await udpService.start("0.0.0.0");
  console.log(
    c.blue("==> UDP server is running on port 47000 on all interfaces!")
  );

  await loadPlugins();

  await app.listen(config.webUIPort);
  console.log(
    c.blue(
      `=> Web server is up and running: 'http://localhost:${config.webUIPort}'`
    )
  );

  async function loadPlugins() {
    // TODO make host configurable in config
    const hostUri = "http://localhost:" + config.webUIPort;

    const pluginEntryFiles = await util.promisify(glob)(
      "../plugins/*/index.js",
      {
        cwd: __dirname,
      }
    );

    for (file of pluginEntryFiles) {
      try {
        const plugin = require(file);
        const pluginId = path.basename(path.dirname(file));

        if (!(pluginId in config.plugins)) {
          config.plugins[pluginId] = {};
        }

        await plugin.onLoad(
          config.plugins[pluginId],
          hostUri,
          app,
          (message) => {
            console.log(`=> '${pluginId}' sends: '${message}'`)
            udpService.broadcast(message);
          }
        );

        console.log(
          `=> Successfully loaded plugin '${plugin.pluginName}' from '${file}'`
        );
      } catch (err) {
        console.log(`=> Failed loading plugin from '${file}': `, err);
      }
    }
  }
})();

function loadConfig() {
  const defaultConfig = {
    webUIPort: 1789,
    udpPort: 47000,
    plugins: {},
  };

  let loadedConfig = {};
  try {
    loadedConfig = require("../config.json");
  } catch {
    console.log(
      "=> Could not load config ('config.json'), assuming empty configuration"
    );
  }

  return deepmerge(defaultConfig, loadedConfig);
}

function onExit(fn) {
  // taken from https://stackoverflow.com/a/14032965/1339560
  process.on("exit", fn.bind(null, { cleanup: true }));

  //catches ctrl+c event
  process.on("SIGINT", fn.bind(null, { exit: true }));

  // catches "kill pid" (for example: nodemon restart)
  process.on("SIGUSR1", fn.bind(null, { exit: true }));
  process.on("SIGUSR2", fn.bind(null, { exit: true }));

  process.on("uncaughtException", fn.bind(null, { exit: true }));
}
