const fs = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");

const { paths } = require("../config/paths");
const { resolveRemoteHostname, validateLocalSourcePath, validateRemoteSourceUrl } = require("./security");

const DEFAULT_FETCH_TIMEOUT_MS = Number(process.env.REMOTE_SOURCE_TIMEOUT_MS || 10000);
const MAX_REMOTE_SOURCE_BYTES = Number(process.env.MAX_REMOTE_SOURCE_BYTES || 4 * 1024 * 1024);

function getCacheFilePath(sourceId) {
  return path.join(paths.cacheDir, `${sourceId}.yaml`);
}

async function deleteCachedSourceContent(sourceId) {
  const filePath = getCacheFilePath(sourceId);

  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function cacheSourceContent(sourceId, content) {
  const filePath = getCacheFilePath(sourceId);
  await fs.writeFile(filePath, content, "utf8");
}

async function readCachedSourceContent(sourceId) {
  const filePath = getCacheFilePath(sourceId);
  return fs.readFile(filePath, "utf8");
}

function readResponseText(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;

    response.on("data", chunk => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_REMOTE_SOURCE_BYTES) {
        response.destroy(new Error(`Remote source too large (max ${MAX_REMOTE_SOURCE_BYTES} bytes)`));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });

    response.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    response.on("error", reject);
  });
}

function requestPinnedRemoteText(urlString) {
  return new Promise(async (resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(new Error("Remote source URL is invalid"));
      return;
    }

    let resolvedAddresses;
    try {
      resolvedAddresses = await resolveRemoteHostname(parsedUrl.hostname);
    } catch (error) {
      reject(error);
      return;
    }

    const [selected] = resolvedAddresses;
    if (!selected || !selected.address) {
      reject(new Error("Unable to resolve remote source host"));
      return;
    }

    const selectedFamily = Number(selected.family) || net.isIP(selected.address);
    if (![4, 6].includes(selectedFamily)) {
      reject(new Error(`Invalid resolved IP address: ${selected.address}`));
      return;
    }

    const client = parsedUrl.protocol === "https:" ? https : http;
    const request = client.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || undefined,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: "GET",
      headers: {
        Host: parsedUrl.host,
        Accept: "text/yaml, application/yaml, text/plain;q=0.9, */*;q=0.1",
        "User-Agent": "proxy-manager/1.0",
      },
      servername: parsedUrl.hostname,
      lookup(hostname, options, callback) {
        const done = typeof options === "function" ? options : callback;
        if (options && typeof options === "object" && options.all === true) {
          done(null, [{ address: selected.address, family: selectedFamily }]);
          return;
        }
        done(null, selected.address, selectedFamily);
      },
      timeout: DEFAULT_FETCH_TIMEOUT_MS,
    }, async response => {
      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        response.resume();
        reject(new Error(`Failed to fetch source: ${response.statusCode} ${response.statusMessage || ""}`.trim()));
        return;
      }

      try {
        resolve(await readResponseText(response));
      } catch (error) {
        reject(error);
      }
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Remote source request timed out after ${DEFAULT_FETCH_TIMEOUT_MS}ms`));
    });

    request.on("error", error => {
      reject(error);
    });

    request.end();
  });
}

async function loadSourceContent(source) {
  if (source.type === "remote") {
    const url = await validateRemoteSourceUrl(source.url);
    const content = await requestPinnedRemoteText(url);
    await cacheSourceContent(source.id, content);
    return content;
  }

  if (source.type === "local") {
    const filePath = await validateLocalSourcePath(source.filePath);
    return fs.readFile(filePath, "utf8");
  }

  if (source.type === "inline") {
    return source.content || "";
  }

  throw new Error(`Unsupported source type: ${source.type}`);
}

async function readSourceContentForView(source) {
  if (source.type === "remote") {
    try {
      const content = await readCachedSourceContent(source.id);
      return { content, mode: "cache" };
    } catch {
      const content = await loadSourceContent(source);
      return { content, mode: "live" };
    }
  }

  const content = await loadSourceContent(source);
  return { content, mode: source.type };
}

async function cleanupOrphanSourceCache(sourceIds) {
  const activeIds = new Set(sourceIds);
  const files = await fs.readdir(paths.cacheDir, { withFileTypes: true });

  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith(".yaml")) {
      continue;
    }

    const sourceId = file.name.slice(0, -5);
    if (activeIds.has(sourceId)) {
      continue;
    }

    await deleteCachedSourceContent(sourceId);
  }
}

module.exports = {
  cleanupOrphanSourceCache,
  deleteCachedSourceContent,
  loadSourceContent,
  readCachedSourceContent,
  readSourceContentForView,
  requestPinnedRemoteText,
};
