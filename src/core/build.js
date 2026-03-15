const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const { writeOutput } = require("./generate");
const { writeAppLog } = require("./logs");
const { mergeConfigs } = require("./merge");
const { parseClashConfig } = require("./parse");
const { readSourceContentForBuild } = require("./fetch");
const { listSources, updateSources } = require("./sources");
const { writeBuildRecord } = require("./builds");
const { readSystemSettings, updateSystemSettings, validateRawTopConfig } = require("./system");
const { runTransform } = require("./transform");

let activeBuildPromise = null;

function createBuildId() {
  return `build_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function collectBuildInput(options = {}) {
  const systemSettings = await readSystemSettings();
  const sources = (await listSources()).filter(source => source.enabled);
  const parsedConfigs = [];
  let templateConfig = null;
  let templateSourceId = null;
  const errors = [];
  const includedSourceIds = [];

  for (const source of sources) {
    try {
      const loaded = await readSourceContentForBuild(source);
      const parsedConfig = parseClashConfig(loaded.content, source);
      parsedConfigs.push(parsedConfig);
      if (source.useAsTemplate) {
        templateConfig = parsedConfig;
        templateSourceId = source.id;
      }
      includedSourceIds.push(source.id);
    } catch (error) {
      errors.push({
        sourceId: source.id,
        sourceName: source.name,
        message: error.message,
      });
    }
  }

  if (options.persistBuildState !== false) {
    await updateSources(existing => existing.map(source => ({
      ...source,
      lastBuildIncluded: includedSourceIds.includes(source.id),
    })));
  }

  const merged = mergeConfigs(parsedConfigs, { templateConfig });
  const rawTopConfig = systemSettings.rawTopConfigEnabled
    ? validateRawTopConfig(systemSettings.rawTopConfigContent)
    : null;
  const baseConfig = rawTopConfig
    ? {
        ...rawTopConfig,
        proxies: merged.proxies,
        "proxy-groups": merged["proxy-groups"],
        ...(Array.isArray(rawTopConfig.rules) || Array.isArray(merged.rules)
          ? {
              rules: [
                ...(Array.isArray(rawTopConfig.rules) ? rawTopConfig.rules : []),
                ...(Array.isArray(merged.rules) ? merged.rules : []),
              ],
            }
          : {}),
      }
    : merged;
  const context = {
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    errors,
    reason: options.reason || "manual",
    templateSourceId,
  };

  return {
    systemSettings,
    sources,
    errors,
    includedSourceIds,
    baseConfig,
    context,
    templateSourceId,
  };
}

async function runBuild(options = {}) {
  const prepared = await collectBuildInput(options);
  const transformed = await runTransform(prepared.baseConfig, prepared.context);
  const output = await writeOutput(transformed);
  const buildId = createBuildId();
  const record = {
    id: buildId,
    createdAt: new Date().toISOString(),
    sourceIds: prepared.sources.map(source => source.id),
    includedSourceIds: prepared.includedSourceIds,
    proxyCount: Array.isArray(transformed.proxies) ? transformed.proxies.length : 0,
    groupCount: Array.isArray(transformed["proxy-groups"]) ? transformed["proxy-groups"].length : 0,
    outputFile: output.fileName,
    status: prepared.errors.length > 0 ? "partial_success" : "success",
    trigger: options.reason || "manual",
    errors: prepared.errors,
  };

  await writeBuildRecord(record);

  await updateSystemSettings({
    lastBuildAt: record.createdAt,
    lastBuildStatus: record.status,
  });

  await writeAppLog("info", "build.completed", `Build ${buildId} completed`, {
    buildId,
    trigger: record.trigger,
    status: record.status,
    proxyCount: record.proxyCount,
    groupCount: record.groupCount,
    errorCount: record.errors.length,
    templateSourceId: prepared.templateSourceId,
  });

  return {
    ...record,
    output,
  };
}

function buildConfig(options = {}) {
  if (activeBuildPromise) {
    return activeBuildPromise;
  }

  activeBuildPromise = runBuild(options)
    .catch(async error => {
      await writeAppLog("error", "build.failed", error.message, {
        trigger: options.reason || "manual",
      }).catch(() => {});
      throw error;
    })
    .finally(() => {
      activeBuildPromise = null;
    });

  return activeBuildPromise;
}

module.exports = {
  buildConfig,
  collectBuildInput,
};
