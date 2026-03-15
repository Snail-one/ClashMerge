const fs = require("node:fs/promises");
const path = require("node:path");
const YAML = require("yaml");

const { paths } = require("../config/paths");

const TOP_LEVEL_KEY_ORDER = [
  "port",
  "socks-port",
  "redir-port",
  "tproxy-port",
  "mixed-port",
  "allow-lan",
  "bind-address",
  "mode",
  "log-level",
  "ipv6",
  "unified-delay",
  "tcp-concurrent",
  "find-process-mode",
  "global-client-fingerprint",
  "geodata-mode",
  "geox-url",
  "geo-auto-update",
  "geo-update-interval",
  "external-controller",
  "external-ui",
  "secret",
  "profile",
  "dns",
  "ntp",
  "tun",
  "sniffer",
  "hosts",
  "proxy-providers",
  "proxies",
  "proxy-groups",
  "rule-providers",
  "rules",
];

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

function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value
      .filter(item => item !== undefined)
      .map(item => stripUndefined(item));
  }

  if (value && typeof value === "object") {
    return Object.entries(value).reduce((accumulator, [key, entryValue]) => {
      if (entryValue !== undefined) {
        accumulator[key] = stripUndefined(entryValue);
      }
      return accumulator;
    }, {});
  }

  return value;
}

function orderTopLevelKeys(config) {
  const ordered = {};
  const seen = new Set();

  for (const key of TOP_LEVEL_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(config, key)) {
      ordered[key] = config[key];
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (!seen.has(key)) {
      ordered[key] = value;
    }
  }

  return ordered;
}

function validateMihomoConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("Generated config must be a YAML object");
  }

  if (!Array.isArray(config.proxies)) {
    throw new Error("Generated config must include a proxies array");
  }

  if (!Array.isArray(config["proxy-groups"])) {
    throw new Error("Generated config must include a proxy-groups array");
  }

  for (const [index, proxy] of config.proxies.entries()) {
    if (!proxy || typeof proxy !== "object" || Array.isArray(proxy)) {
      throw new Error(`Proxy #${index + 1} must be an object`);
    }

    if (typeof proxy.name !== "string" || !proxy.name.trim()) {
      throw new Error(`Proxy #${index + 1} is missing a valid name`);
    }
  }

  for (const [index, group] of config["proxy-groups"].entries()) {
    if (!group || typeof group !== "object" || Array.isArray(group)) {
      throw new Error(`Proxy group #${index + 1} must be an object`);
    }

    if (typeof group.name !== "string" || !group.name.trim()) {
      throw new Error(`Proxy group #${index + 1} is missing a valid name`);
    }

    if (typeof group.type !== "string" || !group.type.trim()) {
      throw new Error(`Proxy group ${group.name} is missing a valid type`);
    }

    if (Object.prototype.hasOwnProperty.call(group, "proxies") && !Array.isArray(group.proxies)) {
      throw new Error(`Proxy group ${group.name} must use an array for proxies`);
    }
  }

  if (Object.prototype.hasOwnProperty.call(config, "rules")) {
    if (!Array.isArray(config.rules)) {
      throw new Error("Generated config rules must be an array");
    }

    for (const [index, rule] of config.rules.entries()) {
      if (typeof rule !== "string" || !rule.trim()) {
        throw new Error(`Rule #${index + 1} must be a non-empty string`);
      }
    }
  }

  return config;
}

function createOutputYaml(config) {
  const preparedConfig = orderTopLevelKeys(stripUndefined(stripInternalFields(normalizeGroups(config))));
  validateMihomoConfig(preparedConfig);

  const yaml = YAML.stringify(preparedConfig, {
    indent: 2,
    lineWidth: 0,
    collectionStyle: "block",
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
    simpleKeys: true,
  });

  const reparsed = YAML.parse(yaml);
  validateMihomoConfig(reparsed);
  return yaml.endsWith("\n") ? yaml : `${yaml}\n`;
}

async function writeOutput(config) {
  const yaml = createOutputYaml(config);
  await fs.writeFile(paths.outputFile, yaml, "utf8");
  return {
    filePath: paths.outputFile,
    fileName: path.basename(paths.outputFile),
    content: yaml,
  };
}

module.exports = {
  createOutputYaml,
  writeOutput,
};
