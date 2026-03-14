const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const YAML = require("yaml");

const { createDefaultSystemSettings } = require("./bootstrap");
const { paths } = require("../config/paths");

function getEnvironmentManagementToken() {
  return String(process.env.MANAGEMENT_TOKEN || "").trim();
}

function getManagementTokenSource() {
  return getEnvironmentManagementToken() ? "env" : "file";
}

function applyEnvironmentOverrides(settings) {
  const managementToken = getEnvironmentManagementToken();

  if (!managementToken) {
    return settings;
  }

  return {
    ...settings,
    managementToken,
  };
}

async function readPersistedSystemSettings() {
  const raw = await fs.readFile(paths.systemFile, "utf8");
  return {
    ...createDefaultSystemSettings(),
    ...JSON.parse(raw),
  };
}

async function readSystemSettings() {
  const settings = await readPersistedSystemSettings();
  return applyEnvironmentOverrides(settings);
}

async function writeSystemSettings(settings) {
  await fs.writeFile(paths.systemFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

async function updateSystemSettings(patch) {
  const current = await readPersistedSystemSettings();
  const next = {
    ...current,
    ...patch,
  };
  await writeSystemSettings(next);
  return applyEnvironmentOverrides(next);
}

async function rotateSubscriptionToken() {
  const token = crypto.randomBytes(24).toString("hex");
  return updateSystemSettings({ subscriptionToken: token });
}

function validateRawTopConfig(rawTopConfigContent) {
  const content = typeof rawTopConfigContent === "string" ? rawTopConfigContent.trim() : "";

  if (!content) {
    return {};
  }

  const parsed = YAML.parse(content);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Raw top config must be a YAML object");
  }

  if (Object.prototype.hasOwnProperty.call(parsed, "proxies")) {
    throw new Error("Raw top config cannot define proxies");
  }

  if (Object.prototype.hasOwnProperty.call(parsed, "proxy-groups")) {
    throw new Error("Raw top config cannot define proxy-groups");
  }

  return parsed;
}

function sanitizeSystemSettings(settings) {
  return {
    autoRefreshEnabled: settings.autoRefreshEnabled,
    autoBuildEnabled: settings.autoBuildEnabled,
    refreshIntervalMinutes: settings.refreshIntervalMinutes,
    rawTopConfigEnabled: settings.rawTopConfigEnabled,
    rawTopConfigContent: settings.rawTopConfigContent,
    publicBaseUrl: settings.publicBaseUrl,
    lastSchedulerRunAt: settings.lastSchedulerRunAt,
    lastSchedulerStatus: settings.lastSchedulerStatus,
    lastSchedulerError: settings.lastSchedulerError,
    lastBuildAt: settings.lastBuildAt,
    lastBuildStatus: settings.lastBuildStatus,
  };
}

module.exports = {
  getManagementTokenSource,
  getEnvironmentManagementToken,
  readPersistedSystemSettings,
  readSystemSettings,
  rotateSubscriptionToken,
  sanitizeSystemSettings,
  updateSystemSettings,
  validateRawTopConfig,
  writeSystemSettings,
};
