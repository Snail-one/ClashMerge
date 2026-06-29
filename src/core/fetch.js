const fs = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const path = require("node:path");
const tls = require("node:tls");

const { paths } = require("../config/paths");
const { resolveRemoteHostname, validateLocalSourcePath, validateRemoteSourceUrl } = require("./security");
const { readSystemSettings } = require("./system");

const DEFAULT_FETCH_TIMEOUT_MS = Number(process.env.REMOTE_SOURCE_TIMEOUT_MS || 10000);
const MAX_REMOTE_SOURCE_BYTES = Number(process.env.MAX_REMOTE_SOURCE_BYTES || 4 * 1024 * 1024);
const MAX_REMOTE_REDIRECTS = Number(process.env.MAX_REMOTE_REDIRECTS || 5);

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

function createRequestHeaders(parsedUrl) {
  return {
    Host: parsedUrl.host,
    Accept: "text/yaml, application/yaml, text/plain;q=0.9, */*;q=0.1",
    "User-Agent": "proxy-manager/1.0",
  };
}

function parseProxyUrl(proxyUrl) {
  const input = String(proxyUrl || "").trim();
  if (!input) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Proxy URL is invalid");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Proxy URL must use http or https");
  }

  return parsed;
}

function getProxyAuthorizationHeader(proxyUrl) {
  if (!proxyUrl.username && !proxyUrl.password) {
    return null;
  }

  return `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString("base64")}`;
}

function createProxyConnectSocket(proxyUrl, parsedUrl, selectedAddress, selectedFamily) {
  return new Promise((resolve, reject) => {
    const proxyClient = proxyUrl.protocol === "https:" ? https : http;
    const proxyAuth = getProxyAuthorizationHeader(proxyUrl);
    const headers = {
      Host: `${parsedUrl.hostname}:${parsedUrl.port || 443}`,
    };

    if (proxyAuth) {
      headers["Proxy-Authorization"] = proxyAuth;
    }

    const request = proxyClient.request({
      protocol: proxyUrl.protocol,
      hostname: proxyUrl.hostname,
      port: proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80),
      method: "CONNECT",
      path: `${selectedFamily === 6 ? `[${selectedAddress}]` : selectedAddress}:${parsedUrl.port || 443}`,
      headers,
      timeout: DEFAULT_FETCH_TIMEOUT_MS,
    });

    request.on("connect", (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT failed: ${response.statusCode} ${response.statusMessage || ""}`.trim()));
        return;
      }

      const tlsSocket = tls.connect({
        socket,
        servername: parsedUrl.hostname,
      });
      tlsSocket.once("secureConnect", () => resolve(tlsSocket));
      tlsSocket.once("error", reject);
    });

    request.on("timeout", () => {
      request.destroy(new Error(`Proxy CONNECT timed out after ${DEFAULT_FETCH_TIMEOUT_MS}ms`));
    });

    request.on("error", reject);
    request.end();
  });
}

async function createProxiedHttpsRequestOptions(proxyUrl, parsedUrl, selectedAddress, selectedFamily) {
  const socket = await createProxyConnectSocket(proxyUrl, parsedUrl, selectedAddress, selectedFamily);
  return {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || undefined,
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    method: "GET",
    headers: createRequestHeaders(parsedUrl),
    createConnection() {
      return socket;
    },
    timeout: DEFAULT_FETCH_TIMEOUT_MS,
  };
}

function createHttpProxyRequestOptions(proxyUrl, parsedUrl, selectedAddress, selectedFamily) {
  const proxyAuth = getProxyAuthorizationHeader(proxyUrl);
  const targetUrl = new URL(parsedUrl.toString());
  targetUrl.hostname = selectedFamily === 6 ? `[${selectedAddress}]` : selectedAddress;

  const headers = createRequestHeaders(parsedUrl);
  if (proxyAuth) {
    headers["Proxy-Authorization"] = proxyAuth;
  }

  return {
    protocol: proxyUrl.protocol,
    hostname: proxyUrl.hostname,
    port: proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80),
    path: targetUrl.toString(),
    method: "GET",
    headers,
    servername: proxyUrl.hostname,
    timeout: DEFAULT_FETCH_TIMEOUT_MS,
  };
}

async function createRemoteRequestOptions(parsedUrl, selectedAddress, selectedFamily, proxyUrl) {
  if (proxyUrl) {
    if (parsedUrl.protocol === "https:") {
      return createProxiedHttpsRequestOptions(proxyUrl, parsedUrl, selectedAddress, selectedFamily);
    }

    return createHttpProxyRequestOptions(proxyUrl, parsedUrl, selectedAddress, selectedFamily);
  }

  return {
    protocol: parsedUrl.protocol,
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || undefined,
    path: `${parsedUrl.pathname}${parsedUrl.search}`,
    method: "GET",
    headers: createRequestHeaders(parsedUrl),
    servername: parsedUrl.hostname,
    lookup(hostname, options, callback) {
      const done = typeof options === "function" ? options : callback;
      if (options && typeof options === "object" && options.all === true) {
        done(null, [{ address: selectedAddress, family: selectedFamily }]);
        return;
      }
      done(null, selectedAddress, selectedFamily);
    },
    timeout: DEFAULT_FETCH_TIMEOUT_MS,
  };
}

async function requestPinnedRemoteText(urlString, redirectCount = 0, proxyUrlString = "") {
  return new Promise(async (resolve, reject) => {
    let parsedUrl;
    let proxyUrl;
    try {
      parsedUrl = new URL(urlString);
    } catch {
      reject(new Error("Remote source URL is invalid"));
      return;
    }

    try {
      proxyUrl = parseProxyUrl(proxyUrlString);
    } catch (error) {
      reject(error);
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
    let requestOptions;
    try {
      requestOptions = await createRemoteRequestOptions(parsedUrl, selected.address, selectedFamily, proxyUrl);
    } catch (error) {
      reject(error);
      return;
    }
    const requestClient = proxyUrl && parsedUrl.protocol === "http:"
      ? (proxyUrl.protocol === "https:" ? https : http)
      : client;
    const request = requestClient.request(requestOptions, async response => {
      const statusCode = response.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = response.headers.location;
        response.resume();

        if (!location) {
          reject(new Error(`Remote source redirect missing location header (${statusCode})`));
          return;
        }

        if (redirectCount >= MAX_REMOTE_REDIRECTS) {
          reject(new Error(`Remote source exceeded redirect limit (${MAX_REMOTE_REDIRECTS})`));
          return;
        }

        try {
          const nextUrl = await validateRemoteSourceUrl(new URL(location, parsedUrl).toString());
          resolve(await requestPinnedRemoteText(nextUrl, redirectCount + 1, proxyUrlString));
        } catch (error) {
          reject(error);
        }
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`Failed to fetch source: ${statusCode} ${response.statusMessage || ""}`.trim()));
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
    const settings = await readSystemSettings();
    const content = await requestPinnedRemoteText(url, 0, settings.proxyUrl);
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

async function readSourceContentForBuild(source) {
  if (source.type === "remote") {
    try {
      const content = await readCachedSourceContent(source.id);
      return { content, mode: "cache" };
    } catch {
      throw new Error("Remote source has not been refreshed yet");
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
  readSourceContentForBuild,
  readSourceContentForView,
  requestPinnedRemoteText,
};
