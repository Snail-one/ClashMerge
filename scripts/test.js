process.env.ALLOW_IN_PROCESS_TRANSFORM_FALLBACK = "true";
process.env.NODE_ENV = "test";
process.env.MAX_TOTAL_LOG_BYTES = "2048";
process.env.MAX_LOG_RETENTION_DAYS = "10";

const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

const { createServer } = require("../src/app");
const { paths } = require("../src/config/paths");
const { ensureProjectFiles, createDefaultSystemSettings, defaultScript } = require("../src/core/bootstrap");
const { buildConfig } = require("../src/core/build");
const { listBuilds, MAX_BUILD_RECORDS, trimBuildRecords, writeBuildRecord } = require("../src/core/builds");
const {
  appendLogEntry,
  formatDateKey,
  getLogFilePath,
  getLogSummary,
  logDirectories,
  MAX_LOG_RETENTION_DAYS,
  MAX_TOTAL_LOG_BYTES,
  pruneLogs,
  readLogEntries,
} = require("../src/core/logs");
const { parseClashConfig } = require("../src/core/parse");
const { mergeConfigs } = require("../src/core/merge");
const { runScheduledCycle } = require("../src/core/scheduler");
const { readPersistedSystemSettings, readSystemSettings } = require("../src/core/system");

const fixtureAPath = path.join(paths.rootDir, "tests", "fixtures", "source-a.yaml");
const fixtureBPath = path.join(paths.rootDir, "tests", "fixtures", "source-b.yaml");

async function resetDataDir() {
  delete process.env.MANAGEMENT_TOKEN;
  await ensureProjectFiles();
  await fs.writeFile(paths.sourcesFile, "[]\n", "utf8");
  await fs.writeFile(paths.systemFile, `${JSON.stringify(createDefaultSystemSettings(), null, 2)}\n`, "utf8");
  await fs.writeFile(paths.defaultScriptFile, defaultScript, "utf8");
  await fs.rm(paths.logsDir, { recursive: true, force: true });
  await fs.mkdir(paths.logsDir, { recursive: true });
  const buildFiles = await fs.readdir(paths.buildsDir);
  await Promise.all(buildFiles.map(name => fs.rm(path.join(paths.buildsDir, name), { force: true })));
}

async function getTotalLogBytes() {
  let total = 0;
  for (const directory of Object.values(logDirectories)) {
    try {
      const names = await fs.readdir(directory);
      for (const name of names) {
        const stat = await fs.stat(path.join(directory, name));
        total += stat.size;
      }
    } catch {}
  }
  return total;
}

async function testParseClashConfig() {
  const raw = await fs.readFile(fixtureAPath, "utf8");
  const parsed = parseClashConfig(raw, { id: "src_a", name: "A" });
  assert.equal(parsed.proxies.length, 2);
  assert.equal(parsed.rules.length, 1);
  assert.equal(parsed.proxies[0].__meta.sourceId, "src_a");
}

async function testMergeConfigs() {
  const [rawA, rawB] = await Promise.all([
    fs.readFile(fixtureAPath, "utf8"),
    fs.readFile(fixtureBPath, "utf8"),
  ]);
  const merged = mergeConfigs([
    parseClashConfig(rawA, { id: "src_a", name: "A" }),
    parseClashConfig(rawB, { id: "src_b", name: "B" }),
  ]);
  assert.equal(merged.proxies.length, 3);
  assert.equal(merged["proxy-groups"].length, 1);
  assert.equal(merged["proxy-groups"][0].name, "全部节点");
  assert.equal(Object.prototype.hasOwnProperty.call(merged, "rules"), false);
}

async function testBuildConfigWithRawTopConfig() {
  await fs.writeFile(
    paths.sourcesFile,
    `${JSON.stringify([
      { id: "src_a", name: "A", type: "local", filePath: fixtureAPath, enabled: true },
      { id: "src_b", name: "B", type: "local", filePath: fixtureBPath, enabled: true }
    ], null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(
    paths.systemFile,
    `${JSON.stringify({
      ...createDefaultSystemSettings(),
      rawTopConfigEnabled: true,
      rawTopConfigContent: "mode: rule\nmixed-port: 35931\nallow-lan: true\nlog-level: info\nipv6: true\nexternal-controller: ''\n"
    }, null, 2)}\n`,
    "utf8"
  );

  const result = await buildConfig();
  const output = await fs.readFile(paths.outputFile, "utf8");

  assert.equal(result.proxyCount, 3);
  assert.match(output, /mode: rule/);
  assert.match(output, /mixed-port: 35931/);
  assert.match(output, /proxy-groups:/);
  assert.match(output, /全部节点/);
}

async function testScheduledCacheCleanup() {
  await fs.writeFile(
    paths.sourcesFile,
    `${JSON.stringify([{ id: "src_live", name: "Live", type: "inline", content: "proxies: []\n", enabled: true }], null, 2)}\n`,
    "utf8"
  );
  await fs.writeFile(path.join(paths.cacheDir, "src_live.yaml"), "live-cache", "utf8");
  const orphanCacheFile = path.join(paths.cacheDir, "src_orphan.yaml");
  await fs.writeFile(orphanCacheFile, "orphan-cache", "utf8");

  await runScheduledCycle();

  await fs.access(path.join(paths.cacheDir, "src_live.yaml"));
  await assert.rejects(fs.access(orphanCacheFile));
}

async function testRetentionCleanup() {
  for (let index = 0; index < 12; index += 1) {
    await appendLogEntry("audit", {
      action: `audit.keep.${index}`,
      outcome: "success",
      order: index,
    });
  }

  const sameDayAuditEntries = await readLogEntries({ type: "audit", limit: 50, search: "audit.keep" });
  assert.equal(sameDayAuditEntries.length, 12);

  const staleDate = new Date(Date.now() - (MAX_LOG_RETENTION_DAYS + 2) * 24 * 60 * 60 * 1000);
  const stalePath = getLogFilePath("audit", formatDateKey(staleDate));
  await fs.mkdir(path.dirname(stalePath), { recursive: true });
  await fs.writeFile(stalePath, '{"timestamp":"2026-03-01T00:00:00.000Z","type":"audit","action":"stale"}\n', "utf8");

  const midDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const midPath = getLogFilePath("app", formatDateKey(midDate));
  const currentPath = getLogFilePath("app", formatDateKey(new Date()));
  await fs.mkdir(path.dirname(midPath), { recursive: true });
  await fs.writeFile(midPath, `${"x".repeat(1200)}\n`, "utf8");
  await fs.utimes(midPath, midDate, midDate);
  await fs.appendFile(currentPath, `${JSON.stringify({ timestamp: new Date().toISOString(), type: "app", level: "info", event: "current", message: "keep" })}\n`, "utf8");

  await pruneLogs();

  const summary = await getLogSummary();
  const totalLogBytes = await getTotalLogBytes();
  const postPruneAuditEntries = await readLogEntries({ type: "audit", limit: 50, search: "audit.keep" });

  assert.equal(postPruneAuditEntries.length, 12);
  await assert.rejects(fs.access(stalePath));
  assert.ok(totalLogBytes <= MAX_TOTAL_LOG_BYTES);
  assert.ok(summary.audit.sizeBytes > 0);
  assert.ok(summary.app.sizeBytes > 0);
}

async function testBuildRetentionCleanup() {
  for (let index = 0; index < MAX_BUILD_RECORDS + 4; index += 1) {
    await writeBuildRecord({
      id: `build_test_${String(index).padStart(2, "0")}`,
      createdAt: `2026-03-14T10:${String(index).padStart(2, "0")}:00.000Z`,
      sourceIds: [],
      includedSourceIds: [],
      proxyCount: index,
      groupCount: 1,
      outputFile: "merged.yaml",
      status: "success",
      trigger: "test",
      errors: [],
    });
  }

  await trimBuildRecords();
  const builds = await listBuilds();

  assert.equal(builds.length, MAX_BUILD_RECORDS);
  assert.equal(builds[0].id, "build_test_13");
  assert.equal(builds.at(-1).id, "build_test_04");
}

async function testEnvironmentManagementTokenPriority() {
  const persisted = await readPersistedSystemSettings();
  const fileToken = persisted.managementToken;
  const envToken = "env-priority-token-1234567890";
  process.env.MANAGEMENT_TOKEN = envToken;

  try {
    const effective = await readSystemSettings();
    assert.equal(effective.managementToken, envToken);
    assert.equal((await readPersistedSystemSettings()).managementToken, fileToken);

    const server = await createServer({ startBackgroundJobs: false });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const loginWithFileToken = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "env-priority-file" },
        body: JSON.stringify({ token: fileToken }),
      });
      assert.equal(loginWithFileToken.status, 401);
      const loginWithFileTokenPayload = await loginWithFileToken.json();
      assert.match(loginWithFileTokenPayload.error, /MANAGEMENT_TOKEN/);

      const loginWithEnvToken = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "env-priority-env" },
        body: JSON.stringify({ token: envToken }),
      });
      assert.equal(loginWithEnvToken.status, 200);

      const systemWithFileToken = await fetch(`${baseUrl}/api/system/status`, {
        headers: { "X-Admin-Token": fileToken },
      });
      assert.equal(systemWithFileToken.status, 401);

      const systemWithEnvToken = await fetch(`${baseUrl}/api/system/status`, {
        headers: { "X-Admin-Token": envToken },
      });
      assert.equal(systemWithEnvToken.status, 200);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  } finally {
    delete process.env.MANAGEMENT_TOKEN;
  }
}

async function testHttpUiAndProtectedSubscription() {
  const server = await createServer({ startBackgroundJobs: false });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const settings = await readSystemSettings();
  const adminHeaders = {
    "Content-Type": "application/json",
    "X-Admin-Token": settings.managementToken,
  };

  try {
    const home = await fetch(`${baseUrl}/`);
    const homeText = await home.text();
    assert.equal(home.status, 200);
    assert.match(homeText, /Clash 订阅控制台/);
    assert.match(homeText, /输入管理令牌/);
    assert.match(homeText, /inline-demo/);
    assert.doesNotMatch(homeText, /本地 YAML/);
    assert.match(home.headers.get("content-security-policy"), /default-src 'self'/);

    const unauthorizedSystem = await fetch(`${baseUrl}/api/system/status`);
    assert.equal(unauthorizedSystem.status, 401);

    const createSource = await fetch(`${baseUrl}/api/sources`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Inline Demo",
        type: "inline",
        content: "proxies:\n  - name: demo\n    type: ss\n    server: 1.2.3.4\n    port: 443\n    cipher: aes-128-gcm\n    password: secret\n",
        tags: ["demo"],
      }),
    });
    assert.equal(createSource.status, 201);
    const createdSource = await createSource.json();

    const updateSource = await fetch(`${baseUrl}/api/sources/${createdSource.id}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        name: "Inline Demo Updated",
        type: "inline",
        content: "proxies:\n  - name: demo-updated\n    type: ss\n    server: 5.6.7.8\n    port: 8443\n    cipher: aes-128-gcm\n    password: secret-2\n",
        tags: ["edited", "inline"],
      }),
    });
    assert.equal(updateSource.status, 200);

    const listSourcesResponse = await fetch(`${baseUrl}/api/sources`, {
      headers: { "X-Admin-Token": settings.managementToken },
    });
    assert.equal(listSourcesResponse.status, 200);
    const listedSources = await listSourcesResponse.json();
    const updatedSource = listedSources.find(item => item.id === createdSource.id);
    assert.equal(updatedSource.name, "Inline Demo Updated");
    assert.deepEqual(updatedSource.tags, ["edited", "inline"]);
    assert.match(updatedSource.content, /demo-updated/);

    for (let index = 0; index < 5; index += 1) {
      const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: `bad-token-${index}` }),
      });
      assert.equal(badLogin.status, 401);
    }

    const limitedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "still-bad" }),
    });
    assert.equal(limitedLogin.status, 429);

    const authorizedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "test-client-success" },
      body: JSON.stringify({ token: settings.managementToken }),
    });
    assert.equal(authorizedLogin.status, 200);
    const loginPayload = await authorizedLogin.json();
    assert.match(loginPayload.subscriptionUrl, /token=/);

    const invalidSave = await fetch(`${baseUrl}/api/system/settings`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ rawTopConfigEnabled: true, rawTopConfigContent: "proxies: []\n" }),
    });
    assert.equal(invalidSave.status, 500);

    const oversizedScript = await fetch(`${baseUrl}/api/scripts/current`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ content: "a".repeat(300 * 1024) }),
    });
    assert.equal(oversizedScript.status, 413);

    const protectedFail = await fetch(`${baseUrl}/sub/merged.yaml`);
    assert.equal(protectedFail.status, 403);

    const invalidLocalSource = await fetch(`${baseUrl}/api/sources`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ id: "bad_local", name: "Bad", type: "local", filePath: "C:\\Windows\\win.ini", enabled: true }),
    });
    assert.equal(invalidLocalSource.status, 500);

    await fs.writeFile(
      paths.sourcesFile,
      `${JSON.stringify([{ id: "src_a", name: "A", type: "local", filePath: fixtureAPath, enabled: true }], null, 2)}\n`,
      "utf8"
    );
    await buildConfig();

    const sourceContent = await fetch(`${baseUrl}/api/sources/src_a/content`, { headers: { "X-Admin-Token": settings.managementToken } });
    assert.equal(sourceContent.status, 200);
    const sourceContentPayload = await sourceContent.json();
    assert.equal(sourceContentPayload.type, "local");
    assert.match(sourceContentPayload.content, /proxies:/);

    const cacheFile = path.join(paths.cacheDir, "src_a.yaml");
    await fs.writeFile(cacheFile, "cached-content", "utf8");
    const deleteSourceResponse = await fetch(`${baseUrl}/api/sources/src_a`, {
      method: "DELETE",
      headers: { "X-Admin-Token": settings.managementToken },
    });
    assert.equal(deleteSourceResponse.status, 200);
    await assert.rejects(fs.access(cacheFile));

    const validateOk = await fetch(`${baseUrl}/api/scripts/validate`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ content: defaultScript }),
    });
    assert.equal(validateOk.status, 200);
    const validatePayload = await validateOk.json();
    assert.equal(validatePayload.ok, true);

    const validateRequireBlocked = await fetch(`${baseUrl}/api/scripts/validate`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ content: "function transform(config) { require('node:fs'); return config; }\nmodule.exports = { transform };\n" }),
    });
    assert.equal(validateRequireBlocked.status, 422);

    const validateProcessBlocked = await fetch(`${baseUrl}/api/scripts/validate`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ content: "function transform(config) { return { value: process.version }; }\nmodule.exports = { transform };\n" }),
    });
    assert.equal(validateProcessBlocked.status, 422);
    const validateBad = await fetch(`${baseUrl}/api/scripts/validate`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ content: `${defaultScript}\n123123123\n` }),
    });
    assert.equal(validateBad.status, 422);

    const saveBad = await fetch(`${baseUrl}/api/scripts/current`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ content: `${defaultScript}\n123123123\n` }),
    });
    assert.equal(saveBad.status, 422);

    const saveGood = await fetch(`${baseUrl}/api/scripts/current`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ content: defaultScript }),
    });
    assert.equal(saveGood.status, 200);
    const saveGoodPayload = await saveGood.json();
    assert.equal(saveGoodPayload.validation.ok, true);

    await fetch(`${baseUrl}/api/scripts/current`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ content: "function transform() { return {}; }\nmodule.exports = { transform };\n" }),
    });
    const resetResponse = await fetch(`${baseUrl}/api/scripts/reset`, { method: "POST", headers: { "X-Admin-Token": settings.managementToken } });
    assert.equal(resetResponse.status, 200);
    const resetPayload = await resetResponse.json();
    assert.equal(resetPayload.content, defaultScript);

    const protectedOk = await fetch(loginPayload.subscriptionUrl);
    assert.equal(protectedOk.status, 200);

    const saveResponse = await fetch(`${baseUrl}/api/system/settings`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ autoRefreshEnabled: true, autoBuildEnabled: true, refreshIntervalMinutes: 5, rawTopConfigEnabled: true, rawTopConfigContent: "mode: rule\nlog-level: info\n" }),
    });
    assert.equal(saveResponse.status, 200);

    const logsAll = await fetch(`${baseUrl}/api/logs?type=all&limit=20`, {
      headers: { "X-Admin-Token": settings.managementToken },
    });
    assert.equal(logsAll.status, 200);
    const logsPayload = await logsAll.json();
    assert.ok(Array.isArray(logsPayload.entries));
    assert.ok(logsPayload.entries.length > 0);
    assert.equal(typeof logsPayload.summary.audit.exists, "boolean");
    assert.equal(typeof logsPayload.summary.app.exists, "boolean");

    const auditLogs = await fetch(`${baseUrl}/api/logs?type=audit&search=script.save&limit=20`, {
      headers: { "X-Admin-Token": settings.managementToken },
    });
    assert.equal(auditLogs.status, 200);
    const auditPayload = await auditLogs.json();
    assert.ok(auditPayload.entries.some(entry => entry.action === "script.save"));

    const appLogs = await fetch(`${baseUrl}/api/logs?type=app&level=info&search=build&limit=20`, {
      headers: { "X-Admin-Token": settings.managementToken },
    });
    assert.equal(appLogs.status, 200);
    const appPayload = await appLogs.json();
    assert.ok(appPayload.entries.some(entry => entry.type === "app"));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function run(name, fn) {
  await resetDataDir();
  await fn();
  console.log(`PASS ${name}`);
}

async function main() {
  await run("parseClashConfig", testParseClashConfig);
  await run("mergeConfigs", testMergeConfigs);
  await run("buildConfigWithRawTopConfig", testBuildConfigWithRawTopConfig);
  await run("scheduledCacheCleanup", testScheduledCacheCleanup);
  await run("retentionCleanup", testRetentionCleanup);
  await run("buildRetentionCleanup", testBuildRetentionCleanup);
  await run("environmentManagementTokenPriority", testEnvironmentManagementTokenPriority);
  await run("httpUiAndProtectedSubscription", testHttpUiAndProtectedSubscription);
  console.log("All tests passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});





