const dns = require("node:dns/promises");
const fs = require("node:fs/promises");
const net = require("node:net");
const path = require("node:path");
const { URL } = require("node:url");

const { paths } = require("../config/paths");

const blockedInternalHostnames = new Set([
  "localhost",
  "host.docker.internal",
  "gateway.docker.internal",
  "kubernetes.default",
  "kubernetes.default.svc",
  "metadata.google.internal",
]);

function parseBooleanFlag(value) {
  return String(value || "").toLowerCase() === "true";
}

async function getAllowedLocalSourceRoots() {
  const configured = String(process.env.ALLOWED_LOCAL_SOURCE_ROOTS || "")
    .split(path.delimiter)
    .map(item => item.trim())
    .filter(Boolean);
  const roots = configured.length > 0 ? configured : [paths.rootDir];

  return Promise.all(roots.map(async root => {
    const resolved = path.resolve(root);
    try {
      return await fs.realpath(resolved);
    } catch {
      return resolved;
    }
  }));
}

function isPathInsideRoot(filePath, rootPath) {
  const relative = path.relative(rootPath, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function validateLocalSourcePath(filePath) {
  const input = String(filePath || "").trim();

  if (!input) {
    throw new Error("Local source file path is required");
  }

  const resolved = path.resolve(input);
  let realPath;

  try {
    realPath = await fs.realpath(resolved);
  } catch {
    throw new Error("Local source file does not exist or cannot be resolved");
  }

  const stat = await fs.lstat(resolved);
  if (stat.isSymbolicLink()) {
    throw new Error("Local source file must not be a symbolic link");
  }

  const allowedRoots = await getAllowedLocalSourceRoots();

  if (!allowedRoots.some(rootPath => isPathInsideRoot(realPath, rootPath))) {
    throw new Error(`Local source file must stay inside allowed roots: ${allowedRoots.join(", ")}`);
  }

  return realPath;
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part))) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 0) return true;
  return false;
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe80:")
    || normalized.startsWith("::ffff:127.");
}

function isPrivateAddress(hostname) {
  const lower = String(hostname || "").toLowerCase();
  if (!lower) return true;
  if (blockedInternalHostnames.has(lower) || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;

  const ipType = net.isIP(lower);
  if (ipType === 4) return isPrivateIpv4(lower);
  if (ipType === 6) return isPrivateIpv6(lower);
  return false;
}

async function resolveRemoteHostname(hostname) {
  if (isPrivateAddress(hostname)) {
    throw new Error("Remote source host must not be localhost, internal service, or a private address");
  }

  let results;
  try {
    results = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Unable to resolve remote source host");
  }

  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("Unable to resolve remote source host");
  }

  for (const result of results) {
    if (isPrivateAddress(result.address)) {
      throw new Error("Remote source host resolved to a private address");
    }
  }

  return results;
}

async function validateRemoteSourceUrl(urlValue) {
  const input = String(urlValue || "").trim();

  if (!input) {
    throw new Error("Remote source URL is required");
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error("Remote source URL is invalid");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Remote source URL must use http or https");
  }

  if (parsed.username || parsed.password) {
    throw new Error("Remote source URL must not contain embedded credentials");
  }

  if (!parseBooleanFlag(process.env.ALLOW_PRIVATE_REMOTE_SOURCES)) {
    await resolveRemoteHostname(parsed.hostname);
  }

  return parsed.toString();
}

module.exports = {
  blockedInternalHostnames,
  getAllowedLocalSourceRoots,
  isPrivateAddress,
  resolveRemoteHostname,
  validateLocalSourcePath,
  validateRemoteSourceUrl,
};
