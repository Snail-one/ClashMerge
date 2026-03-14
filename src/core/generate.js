const fs = require("node:fs/promises");
const path = require("node:path");
const YAML = require("yaml");

const { paths } = require("../config/paths");

function normalizeGroups(config) {
  const proxyNames = new Set((config.proxies || []).map(proxy => proxy.name));
  const reservedGroups = new Set((config["proxy-groups"] || []).map(group => group.name));

  const groups = (config["proxy-groups"] || [])
    .map(group => ({
      ...group,
      proxies: Array.isArray(group.proxies)
        ? group.proxies.filter(name => proxyNames.has(name) || reservedGroups.has(name))
        : [],
    }))
    .filter(group => group.type === "select" || group.proxies.length > 0);

  return {
    ...config,
    "proxy-groups": groups,
  };
}

function stripInternalFields(config) {
  return {
    ...config,
    proxies: (config.proxies || []).map(proxy => {
      const next = { ...proxy };
      delete next.__meta;
      return next;
    }),
  };
}

async function writeOutput(config) {
  const normalizedConfig = normalizeGroups(config);
  const cleanConfig = stripInternalFields(normalizedConfig);
  const yaml = YAML.stringify(cleanConfig);
  await fs.writeFile(paths.outputFile, yaml, "utf8");
  return {
    filePath: paths.outputFile,
    fileName: path.basename(paths.outputFile),
    content: yaml,
  };
}

module.exports = {
  writeOutput,
};
