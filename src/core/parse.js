const YAML = require("yaml");

function parseClashConfig(raw, source) {
  const parsed = YAML.parse(raw) || {};
  const proxies = Array.isArray(parsed.proxies) ? parsed.proxies : [];
  const proxyGroups = Array.isArray(parsed["proxy-groups"]) ? parsed["proxy-groups"] : [];
  const rules = Array.isArray(parsed.rules) ? parsed.rules : [];

  return {
    proxies: proxies.map(proxy => ({
      ...proxy,
      __meta: {
        sourceId: source.id,
        sourceName: source.name,
      },
    })),
    proxyGroups,
    rules,
    metadata: {
      sourceId: source.id,
      sourceName: source.name,
    },
    raw: parsed,
  };
}

module.exports = {
  parseClashConfig,
};
