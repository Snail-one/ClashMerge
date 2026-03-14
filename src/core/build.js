const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const { writeOutput } = require("./generate");
const { writeAppLog } = require("./logs");
const { mergeConfigs } = require("./merge");
const { parseClashConfig } = require("./parse");
const { refreshSource } = require("./refresh");
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
  const errors = [];
  const includedSourceIds = [];

  for (const source of sources) {
    const refreshed = await refreshSource(source);

    if (!refreshed.ok) {
      errors.push({
        sourceId: source.id,
        sourceName: source.name,
        message: refreshed.error.message,
      });
      continue;
    }

    parsedConfigs.push(parseClashConfig(refreshed.content, source));
    includedSourceIds.push(source.id);
  }

  if (options.persistBuildState !== false) {
    await updateSources(existing => existing.map(source => ({
      ...source,
      lastBuildIncluded: includedSourceIds.includes(source.id),
    })));
  }

  const merged = mergeConfigs(parsedConfigs);
  const baseConfig = systemSettings.rawTopConfigEnabled
    ? {
        ...validateRawTopConfig(systemSettings.rawTopConfigContent),
        proxies: merged.proxies,
        "proxy-groups": merged["proxy-groups"],
      }
    : merged;
  const context = {
    generatedAt: new Date().toISOString(),
    sourceCount: sources.length,
    errors,
    reason: options.reason || "manual",
  };

  return {
    systemSettings,
    sources,
    errors,
    includedSourceIds,
    baseConfig,
    context,
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
