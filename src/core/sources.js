const fs = require("node:fs/promises");
const crypto = require("node:crypto");

const { paths } = require("../config/paths");
const { validateLocalSourcePath, validateRemoteSourceUrl } = require("./security");

async function listSources() {
  const raw = await fs.readFile(paths.sourcesFile, "utf8");
  return JSON.parse(raw);
}

async function saveSources(sources) {
  await fs.writeFile(paths.sourcesFile, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
}

function createSourceId() {
  return `src_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function normalizeSource(input) {
  const now = new Date().toISOString();
  const source = {
    id: input.id || createSourceId(),
    name: String(input.name || "Unnamed Source").trim() || "Unnamed Source",
    type: input.type || "remote",
    enabled: input.enabled !== false,
    url: input.url || "",
    filePath: input.filePath || "",
    content: input.content || "",
    tags: Array.isArray(input.tags) ? input.tags : [],
    note: input.note || "",
    updatedAt: input.updatedAt || null,
    createdAt: input.createdAt || now,
    modifiedAt: now,
    lastRefreshAt: input.lastRefreshAt || null,
    lastRefreshStatus: input.lastRefreshStatus || "idle",
    lastRefreshError: input.lastRefreshError || null,
    lastContentBytes: Number.isFinite(input.lastContentBytes) ? input.lastContentBytes : 0,
    lastBuildIncluded: input.lastBuildIncluded === true,
  };

  if (!["remote", "local", "inline"].includes(source.type)) {
    throw new Error("Unsupported source type");
  }

  if (source.type === "remote") {
    source.url = await validateRemoteSourceUrl(source.url);
    source.filePath = "";
    source.content = "";
  }

  if (source.type === "local") {
    source.filePath = await validateLocalSourcePath(source.filePath);
    source.url = "";
    source.content = "";
  }

  if (source.type === "inline") {
    source.content = String(source.content || "");
    source.url = "";
    source.filePath = "";
  }

  return source;
}

async function addSource(input) {
  const sources = await listSources();
  const source = await normalizeSource(input);
  sources.push(source);
  await saveSources(sources);
  return source;
}

async function updateSource(id, patch) {
  const sources = await listSources();
  const index = sources.findIndex(source => source.id === id);

  if (index === -1) {
    return null;
  }

  const next = await normalizeSource({
    ...sources[index],
    ...patch,
    id,
    createdAt: sources[index].createdAt,
  });

  sources[index] = next;
  await saveSources(sources);
  return next;
}

async function updateSources(mutator) {
  const sources = await listSources();
  const next = mutator(sources.map(source => ({ ...source })));
  await saveSources(next);
  return next;
}

async function getSource(id) {
  const sources = await listSources();
  return sources.find(source => source.id === id) || null;
}

async function deleteSource(id) {
  const sources = await listSources();
  const next = sources.filter(source => source.id !== id);

  if (next.length === sources.length) {
    return false;
  }

  await saveSources(next);
  return true;
}

async function markSourceUpdated(id) {
  return updateSource(id, { updatedAt: new Date().toISOString() });
}

async function markSourceRefresh(id, patch) {
  return updateSource(id, {
    lastRefreshAt: new Date().toISOString(),
    ...patch,
  });
}

module.exports = {
  addSource,
  deleteSource,
  getSource,
  listSources,
  markSourceRefresh,
  markSourceUpdated,
  updateSource,
  updateSources,
};

