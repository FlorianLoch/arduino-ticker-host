const express = require("express");
const glob = require("glob");
const util = require("util");
const deepmerge = require("deepmerge");
const path = require("path");
const fs = require("fs");

const config = loadConfig();
const app = express();

(async () => {
  loadPlugins();

  await app.listen(config.port);
  console.log(
    `=> Web server is up and running: 'http://localhost:${config.port}'`
  );
})();

onExit(() => {
  // This should be sync as the eventloop isn't used anymore when shutting down
  fs.writeFileSync(path.join(__dirname, "../config.json"), JSON.stringify(config));
});

function loadConfig() {
  const defaultConfig = {
    port: 1789,
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

async function loadPlugins() {
  // TODO make host configurable in config
  const hostUri = "http://localhost:" + config.port;

  const pluginEntryFiles = await util.promisify(glob)("../plugins/*/index.js", {
    cwd: __dirname,
  });

  for (file of pluginEntryFiles) {
    try {
      const plugin = require(file);
      const pluginId = path.basename(path.dirname(file));

      if (!(pluginId in config.plugins)) {
        config.plugins[pluginId] = {};
      }

      await plugin.onLoad(config.plugins[pluginId], hostUri, app, (...args) => {
        console.log("Called dummy send-function with: ", args);
      });

      console.log(
        `=> Successfully loaded plugin '${plugin.pluginName}' from '${file}'`
      );
    } catch (err) {
      console.log(`=> Failed loading plugin from '${file}': `, err);
    }
  }
}
