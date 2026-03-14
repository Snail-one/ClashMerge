function stableClone(value, seen = new WeakSet()) {
  if (Array.isArray(value)) {
    return value.map(item => stableClone(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      throw new Error("Proxy contains a circular structure");
    }

    seen.add(value);
    const result = Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = stableClone(value[key], seen);
        return accumulator;
      }, {});
    seen.delete(value);
    return result;
  }

  return value;
}

function proxyFingerprint(proxy) {
  const clone = { ...proxy };
  delete clone.name;
  delete clone.__meta;
  return JSON.stringify(stableClone(clone));
}

function dedupeProxies(proxies) {
  const seen = new Set();
  const results = [];

  for (const proxy of proxies) {
    const key = proxyFingerprint(proxy);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(proxy);
  }

  return results;
}

function createDefaultGroups(proxies) {
  const names = proxies.map(proxy => proxy.name);

  return [
    {
      name: "全部节点",
      type: "select",
      proxies: names,
    },
  ];
}

function mergeConfigs(parsedConfigs) {
  const proxies = dedupeProxies(parsedConfigs.flatMap(config => config.proxies));

  return {
    proxies,
    "proxy-groups": createDefaultGroups(proxies),
  };
}

module.exports = {
  mergeConfigs,
};
