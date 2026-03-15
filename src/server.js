const { createServer } = require("./app");
const { writeAppLog } = require("./core/logs");
const { getEnvironmentManagementToken, readSystemSettings } = require("./core/system");

const port = Number(process.env.PORT || 3000);
const host = String(process.env.HOST || "127.0.0.1").trim() || "127.0.0.1";

async function start() {
  const server = await createServer();
  await readSystemSettings();
  const environmentToken = getEnvironmentManagementToken();

  server.listen(port, host, () => {
    console.log(`Proxy manager listening on http://${host}:${port}`);
    console.log("Use the management token from data/system.json to unlock the web console and all /api/* endpoints.");
    writeAppLog("info", "server.started", `Server listening on ${host}:${port}`, {
      host,
      port,
      managementTokenSource: environmentToken ? "env" : "file",
    }).catch(() => {});
  });
}

start().catch(error => {
  console.error(error);
  writeAppLog("error", "server.start_failed", error.message, {
    host,
    port,
  }).catch(() => {});
  process.exitCode = 1;
});
