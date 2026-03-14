const { buildConfig } = require("./build");
const { cleanupOrphanSourceCache } = require("./fetch");
const { writeAppLog } = require("./logs");
const { readSystemSettings, updateSystemSettings } = require("./system");
const { listSources } = require("./sources");
const { refreshSource } = require("./refresh");

let schedulerTimer = null;
let schedulerRunning = false;

async function cleanupSourceCache() {
  const sources = await listSources();
  await cleanupOrphanSourceCache(sources.map(source => source.id));
}

async function refreshAllSources() {
  const sources = (await listSources()).filter(source => source.enabled);
  const results = [];

  for (const source of sources) {
    const result = await refreshSource(source);
    results.push({ sourceId: source.id, ok: result.ok });
  }

  return results;
}

async function runScheduledCycle() {
  if (schedulerRunning) {
    return;
  }

  schedulerRunning = true;

  try {
    const settings = await readSystemSettings();
    await updateSystemSettings({
      lastSchedulerRunAt: new Date().toISOString(),
      lastSchedulerStatus: "running",
      lastSchedulerError: null,
    });

    await cleanupSourceCache();

    if (settings.autoBuildEnabled) {
      await buildConfig({ reason: "scheduler" });
    } else if (settings.autoRefreshEnabled) {
      await refreshAllSources();
    }

    await updateSystemSettings({
      lastSchedulerStatus: "success",
      lastSchedulerError: null,
    });

    await writeAppLog("info", "scheduler.cycle.success", "Scheduled cycle completed", {
      autoBuildEnabled: settings.autoBuildEnabled,
      autoRefreshEnabled: settings.autoRefreshEnabled,
    });
  } catch (error) {
    await updateSystemSettings({
      lastSchedulerStatus: "error",
      lastSchedulerError: error.message,
    });
    await writeAppLog("error", "scheduler.cycle.failed", error.message).catch(() => {});
  } finally {
    schedulerRunning = false;
  }
}

async function startScheduler() {
  const settings = await readSystemSettings();
  const intervalMs = Math.max(1, Number(settings.refreshIntervalMinutes) || 30) * 60 * 1000;

  if (schedulerTimer) {
    clearInterval(schedulerTimer);
  }

  schedulerTimer = setInterval(() => {
    runScheduledCycle().catch(() => {});
  }, intervalMs);

  schedulerTimer.unref?.();
  await writeAppLog("info", "scheduler.started", "Scheduler started", {
    refreshIntervalMinutes: settings.refreshIntervalMinutes,
  }).catch(() => {});
  runScheduledCycle().catch(() => {});
}

async function restartScheduler() {
  await startScheduler();
}

module.exports = {
  cleanupSourceCache,
  refreshAllSources,
  restartScheduler,
  runScheduledCycle,
  startScheduler,
};
