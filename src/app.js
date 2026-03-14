const crypto = require("node:crypto");
const http = require("node:http");

const { ensureProjectFiles } = require("./core/bootstrap");
const { trimBuildRecords } = require("./core/builds");
const { cleanupOrphanSourceCache } = require("./core/fetch");
const { trimAllLogFiles } = require("./core/logs");
const { startScheduler } = require("./core/scheduler");
const { listSources } = require("./core/sources");
const { handleRequest } = require("./routes");

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function createServer(options = {}) {
  await ensureProjectFiles();
  const sources = await listSources();
  await cleanupOrphanSourceCache(sources.map(source => source.id));
  await Promise.all([
    trimBuildRecords(),
    trimAllLogFiles(),
  ]);

  if (options.startBackgroundJobs !== false) {
    await startScheduler();
  }

  return http.createServer(async (req, res) => {
    handleRequest(req, res, {
      safeEqual,
    });
  });
}

module.exports = {
  createServer,
};
