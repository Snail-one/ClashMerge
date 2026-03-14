const fs = require("node:fs/promises");

const { defaultScript } = require("./bootstrap");
const { paths } = require("../config/paths");

async function readScript() {
  return fs.readFile(paths.defaultScriptFile, "utf8");
}

async function writeScript(content) {
  await fs.writeFile(paths.defaultScriptFile, content, "utf8");
  return {
    filePath: paths.defaultScriptFile,
    updatedAt: new Date().toISOString(),
  };
}

async function resetScript() {
  await fs.writeFile(paths.defaultScriptFile, defaultScript, "utf8");
  return {
    content: defaultScript,
    filePath: paths.defaultScriptFile,
    updatedAt: new Date().toISOString(),
  };
}

module.exports = {
  readScript,
  resetScript,
  writeScript,
};
