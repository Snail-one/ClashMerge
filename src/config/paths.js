const path = require("node:path");

const rootDir = path.resolve(__dirname, "..", "..");
const dataDir = path.join(rootDir, "data");

const paths = {
  rootDir,
  dataDir,
  sourcesFile: path.join(dataDir, "sources.json"),
  systemFile: path.join(dataDir, "system.json"),
  cacheDir: path.join(dataDir, "cache"),
  scriptsDir: path.join(dataDir, "scripts"),
  outputDir: path.join(dataDir, "output"),
  buildsDir: path.join(dataDir, "builds"),
  logsDir: path.join(dataDir, "logs"),
  defaultScriptFile: path.join(dataDir, "scripts", "default.js"),
  outputFile: path.join(dataDir, "output", "merged.yaml"),
};

module.exports = { paths };
