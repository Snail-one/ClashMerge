const fs = require("node:fs/promises");
const path = require("node:path");
const { URL } = require("node:url");

const { paths } = require("../config/paths");
const { writeAuditLog } = require("../core/audit");
const { listBuilds } = require("../core/builds");
const { buildConfig, collectBuildInput } = require("../core/build");
const { deleteCachedSourceContent, readSourceContentForView } = require("../core/fetch");
const { getLogSummary, readLogEntries, writeAppLog } = require("../core/logs");
const { refreshSource } = require("../core/refresh");
const { restartScheduler } = require("../core/scheduler");
const { readScript, resetScript, writeScript } = require("../core/scripts");
const { addSource, deleteSource, getSource, listSources, markSourceUpdated, updateSource } = require("../core/sources");
const { readSystemSettings, rotateSubscriptionToken, sanitizeSystemSettings, updateSystemSettings, validateRawTopConfig } = require("../core/system");
const { runTransformContent } = require("../core/transform");
const { fileExists } = require("../utils/fs");
const { createHttpError, readJson, sendJson, sendText } = require("../utils/http");

const publicDir = path.join(paths.rootDir, "public");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};
const loginAttempts = new Map();
const apiRateLimits = new Map();
const MAX_LOGIN_ATTEMPTS = Number(process.env.MAX_LOGIN_ATTEMPTS || 5);
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 10 * 60 * 1000);
const API_RATE_LIMIT_MAX = Number(process.env.API_RATE_LIMIT_MAX || 240);
const API_RATE_LIMIT_WINDOW_MS = Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000);

async function sendFile(res, filePath) {
  const ext = path.extname(filePath);
  const content = await fs.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypes[ext] || "application/octet-stream",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  });
  res.end(content);
}

async function serveStatic(urlPath, res) {
  const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "");
  const filePath = path.resolve(publicDir, relativePath);

  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return true;
  }

  if (!(await fileExists(filePath))) {
    return false;
  }

  await sendFile(res, filePath);
  return true;
}

function buildSubscriptionUrl(req, settings) {
  const configuredBaseUrl = String(settings.publicBaseUrl || "").trim();

  if (configuredBaseUrl) {
    const baseUrl = new URL(configuredBaseUrl.endsWith("/") ? configuredBaseUrl : `${configuredBaseUrl}/`);
    return new URL(`sub/merged.yaml?token=${settings.subscriptionToken}`, baseUrl).toString();
  }

  const port = req.socket?.localPort || process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/sub/merged.yaml?token=${settings.subscriptionToken}`;
}

function getClientKey(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwardedFor || String(req.socket?.remoteAddress || "unknown");
}

function readAdminToken(req) {
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return String(req.headers["x-admin-token"] || "").trim();
}

async function isAuthorized(req, safeEqual) {
  const settings = await readSystemSettings();
  return safeEqual(readAdminToken(req), settings.managementToken);
}

function sendUnauthorized(res) {
  sendJson(res, 401, { error: "Unauthorized" });
}

function getAttemptEntry(store, key, windowMs) {
  const now = Date.now();
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + windowMs };
    store.set(key, fresh);
    return fresh;
  }

  return current;
}

function clearLoginAttempts(req) {
  loginAttempts.delete(getClientKey(req));
}

function registerFailedLogin(req) {
  const entry = getAttemptEntry(loginAttempts, getClientKey(req), LOGIN_WINDOW_MS);
  entry.count += 1;
  return entry;
}

function assertLoginRateLimit(req) {
  const entry = getAttemptEntry(loginAttempts, getClientKey(req), LOGIN_WINDOW_MS);
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
    const error = createHttpError(429, `Too many login attempts. Retry in ${retryAfterSeconds}s`);
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
}

function assertApiRateLimit(req) {
  const key = `${getClientKey(req)}:${req.method}`;
  const entry = getAttemptEntry(apiRateLimits, key, API_RATE_LIMIT_WINDOW_MS);
  if (entry.count >= API_RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
    const error = createHttpError(429, `Too many API requests. Retry in ${retryAfterSeconds}s`);
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
  entry.count += 1;
}

function createAuditContext(req) {
  return {
    client: getClientKey(req),
    method: req.method,
    path: req.url,
  };
}

async function validateScriptContent(content) {
  const prepared = await collectBuildInput({ reason: "validate", persistBuildState: false });
  const transformed = await runTransformContent(content, prepared.baseConfig, prepared.context);
  const proxyCount = Array.isArray(transformed.proxies) ? transformed.proxies.length : 0;
  const groupCount = Array.isArray(transformed["proxy-groups"]) ? transformed["proxy-groups"].length : 0;
  const warningCount = prepared.errors.length;
  const warningText = warningCount > 0 ? `，${warningCount} 个订阅刷新失败` : "";

  return {
    ok: true,
    proxyCount,
    groupCount,
    sourceCount: prepared.context.sourceCount,
    warningCount,
    message: `校验通过：${proxyCount} 个节点，${groupCount} 个分组${warningText}。`,
  };
}

async function handleRequest(req, res, appContext = {}) {
  const url = new URL(req.url, "http://127.0.0.1");
  const sourceMatch = url.pathname.match(/^\/api\/sources\/([^/]+)$/);
  const sourceContentMatch = url.pathname.match(/^\/api\/sources\/([^/]+)\/content$/);
  const refreshMatch = url.pathname.match(/^\/api\/sources\/([^/]+)\/refresh$/);
  const safeEqual = appContext.safeEqual || ((left, right) => left === right);
  const isApiRequest = url.pathname.startsWith("/api/");
  const isPublicApi = url.pathname === "/api/health" || url.pathname === "/api/auth/login";
  const audit = createAuditContext(req);

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (isApiRequest && url.pathname !== "/api/health") {
      assertApiRateLimit(req);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      assertLoginRateLimit(req);
      const body = await readJson(req, { maxBytes: 8 * 1024 });
      const settings = await readSystemSettings();
      const token = String(body.token || "").trim();

      if (!safeEqual(token, settings.managementToken)) {
        registerFailedLogin(req);
        await writeAuditLog({
          ...audit,
          action: "auth.login.failed",
          outcome: "deny",
        });
        sendUnauthorized(res);
        return;
      }

      clearLoginAttempts(req);
      await writeAuditLog({
        ...audit,
        action: "auth.login.success",
        outcome: "success",
      });
      sendJson(res, 200, {
        ok: true,
        settings: sanitizeSystemSettings(settings),
        subscriptionUrl: buildSubscriptionUrl(req, settings),
      });
      return;
    }

    if (isApiRequest && !isPublicApi) {
      if (!(await isAuthorized(req, safeEqual))) {
        await writeAuditLog({
          ...audit,
          action: "api.unauthorized",
          outcome: "deny",
        });
        sendUnauthorized(res);
        return;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/sources") {
      sendJson(res, 200, await listSources());
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sources") {
      const body = await readJson(req, { maxBytes: 1024 * 1024 });
      const source = await addSource(body);
      await writeAuditLog({ ...audit, action: "source.create", outcome: "success", sourceId: source.id, sourceType: source.type });
      sendJson(res, 201, source);
      return;
    }

    if (sourceContentMatch && req.method === "GET") {
      const source = await getSource(sourceContentMatch[1]);

      if (!source) {
        sendJson(res, 404, { error: "Source not found" });
        return;
      }

      const result = await readSourceContentForView(source);
      await writeAuditLog({ ...audit, action: "source.content.view", outcome: "success", sourceId: source.id, sourceType: source.type, mode: result.mode });
      sendJson(res, 200, {
        id: source.id,
        name: source.name,
        type: source.type,
        mode: result.mode,
        content: result.content,
      });
      return;
    }

    if (sourceMatch && req.method === "PUT") {
      const body = await readJson(req, { maxBytes: 1024 * 1024 });
      const source = await updateSource(sourceMatch[1], body);

      if (!source) {
        sendJson(res, 404, { error: "Source not found" });
        return;
      }

      await writeAuditLog({ ...audit, action: "source.update", outcome: "success", sourceId: source.id, sourceType: source.type });
      sendJson(res, 200, source);
      return;
    }

    if (sourceMatch && req.method === "DELETE") {
      const deleted = await deleteSource(sourceMatch[1]);
      if (deleted) {
        await deleteCachedSourceContent(sourceMatch[1]);
        await writeAuditLog({ ...audit, action: "source.delete", outcome: "success", sourceId: sourceMatch[1], cacheCleared: true });
      }
      sendJson(res, deleted ? 200 : 404, deleted ? { deleted: true } : { error: "Source not found" });
      return;
    }

    if (refreshMatch && req.method === "POST") {
      const source = await getSource(refreshMatch[1]);

      if (!source) {
        sendJson(res, 404, { error: "Source not found" });
        return;
      }

      const result = await refreshSource(source);

      if (!result.ok) {
        await writeAuditLog({ ...audit, action: "source.refresh", outcome: "error", sourceId: source.id, error: result.error.message });
        sendJson(res, 502, { error: result.error.message });
        return;
      }

      await markSourceUpdated(source.id);
      await writeAuditLog({ ...audit, action: "source.refresh", outcome: "success", sourceId: source.id, bytes: Buffer.byteLength(result.content, "utf8") });
      sendJson(res, 200, {
        id: source.id,
        name: source.name,
        bytes: Buffer.byteLength(result.content, "utf8"),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/scripts/current") {
      sendJson(res, 200, { content: await readScript() });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/scripts/current") {
      const body = await readJson(req, { maxBytes: 256 * 1024 });
      const content = typeof body.content === "string" ? body.content : "";
      const validation = await validateScriptContent(content);
      const saved = await writeScript(content);
      await writeAuditLog({ ...audit, action: "script.save", outcome: "success", size: Buffer.byteLength(content, "utf8") });
      sendJson(res, 200, {
        ...saved,
        validation,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scripts/reset") {
      const result = await resetScript();
      await writeAuditLog({ ...audit, action: "script.reset", outcome: "success" });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/scripts/validate") {
      const body = await readJson(req, { maxBytes: 256 * 1024 });
      const content = typeof body.content === "string" ? body.content : "";

      try {
        const result = await validateScriptContent(content);
        await writeAuditLog({ ...audit, action: "script.validate", outcome: "success", size: Buffer.byteLength(content, "utf8") });
        sendJson(res, 200, result);
      } catch (error) {
        await writeAuditLog({ ...audit, action: "script.validate", outcome: "error", error: error.message });
        sendJson(res, 422, {
          ok: false,
          error: error.message,
        });
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/build") {
      const result = await buildConfig({ reason: "manual" });
      await writeAuditLog({ ...audit, action: "build.manual", outcome: "success", buildId: result.id, status: result.status });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/builds") {
      sendJson(res, 200, await listBuilds());
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      const entries = await readLogEntries({
        type: url.searchParams.get("type") || "all",
        level: url.searchParams.get("level") || "",
        search: url.searchParams.get("search") || "",
        limit: url.searchParams.get("limit") || "100",
      });
      const summary = await getLogSummary();
      sendJson(res, 200, { entries, summary });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/system/status") {
      const settings = await readSystemSettings();
      sendJson(res, 200, {
        settings: sanitizeSystemSettings(settings),
        subscriptionUrl: buildSubscriptionUrl(req, settings),
      });
      return;
    }

    if (req.method === "PUT" && url.pathname === "/api/system/settings") {
      const body = await readJson(req, { maxBytes: 256 * 1024 });
      const current = await readSystemSettings();
      const rawTopConfigEnabled = typeof body.rawTopConfigEnabled === "boolean" ? body.rawTopConfigEnabled : current.rawTopConfigEnabled;
      const rawTopConfigContent = typeof body.rawTopConfigContent === "string" ? body.rawTopConfigContent : current.rawTopConfigContent;

      if (rawTopConfigEnabled) {
        validateRawTopConfig(rawTopConfigContent);
      }

      const next = await updateSystemSettings({
        autoRefreshEnabled: typeof body.autoRefreshEnabled === "boolean" ? body.autoRefreshEnabled : current.autoRefreshEnabled,
        autoBuildEnabled: typeof body.autoBuildEnabled === "boolean" ? body.autoBuildEnabled : current.autoBuildEnabled,
        refreshIntervalMinutes: Math.max(1, Number(body.refreshIntervalMinutes) || current.refreshIntervalMinutes),
        rawTopConfigEnabled,
        rawTopConfigContent,
      });
      await restartScheduler();

      const response = {
        settings: sanitizeSystemSettings(next),
        subscriptionUrl: buildSubscriptionUrl(req, next),
      };

      if (body.rebuildOutput === true) {
        response.build = await buildConfig({ reason: "settings_update" });
      }

      await writeAuditLog({ ...audit, action: "system.settings.update", outcome: "success", rebuildOutput: body.rebuildOutput === true });
      sendJson(res, 200, response);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/system/rotate-token") {
      const next = await rotateSubscriptionToken();
      await writeAuditLog({ ...audit, action: "system.subscription_token.rotate", outcome: "success" });
      sendJson(res, 200, {
        settings: sanitizeSystemSettings(next),
        subscriptionUrl: buildSubscriptionUrl(req, next),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/output/info") {
      const settings = await readSystemSettings();
      const exists = await fileExists(paths.outputFile);

      if (!exists) {
        sendJson(res, 404, { error: "Output not generated yet" });
        return;
      }

      const stat = await fs.stat(paths.outputFile);
      sendJson(res, 200, {
        fileName: path.basename(paths.outputFile),
        filePath: paths.outputFile,
        updatedAt: stat.mtime.toISOString(),
        subscriptionPath: "/sub/merged.yaml",
        subscriptionUrl: buildSubscriptionUrl(req, settings),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/output/content") {
      const exists = await fileExists(paths.outputFile);

      if (!exists) {
        sendJson(res, 404, { error: "Output not generated yet" });
        return;
      }

      sendJson(res, 200, { content: await fs.readFile(paths.outputFile, "utf8") });
      return;
    }

    if (req.method === "GET" && url.pathname === "/sub/merged.yaml") {
      const settings = await readSystemSettings();
      const token = url.searchParams.get("token");

      if (!safeEqual(token, settings.subscriptionToken)) {
        await writeAuditLog({ ...audit, action: "subscription.fetch", outcome: "deny" });
        sendText(res, 403, "Forbidden");
        return;
      }

      const exists = await fileExists(paths.outputFile);

      if (!exists) {
        sendText(res, 404, "Output not generated yet");
        return;
      }

      const content = await fs.readFile(paths.outputFile, "utf8");
      await writeAuditLog({ ...audit, action: "subscription.fetch", outcome: "success" });
      sendText(res, 200, content, "application/yaml; charset=utf-8");
      return;
    }

    if (req.method === "GET") {
      const served = await serveStatic(url.pathname, res);

      if (served) {
        return;
      }
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    if (url.pathname !== "/api/health") {
      await writeAuditLog({
        ...audit,
        action: "request.error",
        outcome: "error",
        error: error.message,
        statusCode: error.statusCode || null,
      }).catch(() => {});
      await writeAppLog("error", "request.failed", error.message, {
        method: req.method,
        path: req.url,
        statusCode: error.statusCode || 500,
      }).catch(() => {});
    }
    const statusCode = error.statusCode || (req.method === "PUT" && url.pathname === "/api/scripts/current" ? 422 : 500);
    if (error.retryAfterSeconds) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    sendJson(res, statusCode, {
      error: error.message,
    });
  }
}

module.exports = {
  handleRequest,
};
