const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const { paths } = require("../config/paths");
const { ensureDir, fileExists } = require("../utils/fs");

const defaultScript = `function transform(config, context) {
  return config;
}

module.exports = { transform };
`;

function createDefaultSystemSettings() {
  return {
    autoRefreshEnabled: true,
    autoBuildEnabled: true,
    refreshIntervalMinutes: 30,
    rawTopConfigEnabled: false,
    rawTopConfigContent: "mode: rule\nmixed-port: 35931\nallow-lan: true\nlog-level: info\nipv6: true\nexternal-controller: ''\n",
    subscriptionToken: crypto.randomBytes(24).toString("hex"),
    managementToken: crypto.randomBytes(24).toString("hex"),
    publicBaseUrl: String(process.env.PUBLIC_BASE_URL || "").trim(),
    lastSchedulerRunAt: null,
    lastSchedulerStatus: "idle",
    lastSchedulerError: null,
    lastBuildAt: null,
    lastBuildStatus: null,
  };
}

async function ensureProjectFiles() {
  await Promise.all([
    ensureDir(paths.dataDir),
    ensureDir(paths.cacheDir),
    ensureDir(paths.scriptsDir),
    ensureDir(paths.outputDir),
    ensureDir(paths.buildsDir),
    ensureDir(paths.logsDir),
  ]);

  if (!(await fileExists(paths.sourcesFile))) {
    await fs.writeFile(paths.sourcesFile, "[]\n", "utf8");
  }

  if (!(await fileExists(paths.defaultScriptFile))) {
    await fs.writeFile(paths.defaultScriptFile, defaultScript, "utf8");
  }

  if (!(await fileExists(paths.systemFile))) {
    await fs.writeFile(paths.systemFile, `${JSON.stringify(createDefaultSystemSettings(), null, 2)}\n`, "utf8");
  }
}

module.exports = {
  createDefaultSystemSettings,
  defaultScript,
  ensureProjectFiles,
};
