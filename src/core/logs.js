const fs = require("node:fs/promises");
const path = require("node:path");

const { paths } = require("../config/paths");
const { ensureDir, fileExists } = require("../utils/fs");

const MAX_LOG_RETENTION_DAYS = Number(process.env.MAX_LOG_RETENTION_DAYS || 10);
const MAX_TOTAL_LOG_BYTES = Number(process.env.MAX_TOTAL_LOG_BYTES || 1024 * 1024 * 1024);
const legacyLogFiles = {
  audit: path.join(paths.logsDir, "audit.log"),
  app: path.join(paths.logsDir, "app.log"),
};
const logDirectories = {
  audit: path.join(paths.logsDir, "audit"),
  app: path.join(paths.logsDir, "app"),
};

function formatDateKey(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function parseDateKey(fileName) {
  const match = String(fileName || "").match(/^(\d{4}-\d{2}-\d{2})\.log$/);
  return match ? match[1] : null;
}

function getLogFilePath(type, dateKey = formatDateKey()) {
  const directory = logDirectories[type];
  if (!directory) {
    throw new Error(`Unsupported log type: ${type}`);
  }
  return path.join(directory, `${dateKey}.log`);
}

function normalizeLogEntry(type, rawLine) {
  try {
    return JSON.parse(rawLine);
  } catch {
    return {
      timestamp: new Date().toISOString(),
      type,
      level: "error",
      event: "log.parse_error",
      message: "Invalid log line",
      raw: rawLine,
    };
  }
}

async function listTypeLogFiles(type) {
  const directory = logDirectories[type];
  if (!directory) {
    throw new Error(`Unsupported log type: ${type}`);
  }

  if (!(await fileExists(directory))) {
    return [];
  }

  const names = await fs.readdir(directory);
  return names
    .filter(name => parseDateKey(name))
    .map(name => path.join(directory, name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
}

async function migrateLegacyLogFile(type) {
  const legacyPath = legacyLogFiles[type];
  if (!(await fileExists(legacyPath))) {
    return 0;
  }

  const raw = await fs.readFile(legacyPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    await fs.rm(legacyPath, { force: true });
    return 0;
  }

  await ensureDir(logDirectories[type]);
  const grouped = new Map();

  for (const line of lines) {
    const entry = normalizeLogEntry(type, line);
    const dateKey = formatDateKey(entry.timestamp || new Date());
    const bucket = grouped.get(dateKey) || [];
    bucket.push(JSON.stringify({ ...entry, type }));
    grouped.set(dateKey, bucket);
  }

  for (const [dateKey, records] of grouped.entries()) {
    await fs.appendFile(getLogFilePath(type, dateKey), `${records.join("\n")}\n`, "utf8");
  }

  await fs.rm(legacyPath, { force: true });
  return lines.length;
}

async function migrateLegacyLogs() {
  const result = {};

  for (const type of Object.keys(logDirectories)) {
    result[type] = await migrateLegacyLogFile(type);
  }

  return result;
}

async function trimLogFileTail(filePath, keepBytes) {
  if (keepBytes <= 0) {
    await fs.rm(filePath, { force: true });
    return 0;
  }

  const buffer = await fs.readFile(filePath);
  if (buffer.length <= keepBytes) {
    return buffer.length;
  }

  let tail = buffer.slice(-keepBytes);
  const firstNewline = tail.indexOf(0x0a);
  if (firstNewline >= 0 && firstNewline < tail.length - 1) {
    tail = tail.slice(firstNewline + 1);
  }

  if (tail.length === 0) {
    await fs.rm(filePath, { force: true });
    return 0;
  }

  const nextBuffer = tail[tail.length - 1] === 0x0a ? tail : Buffer.concat([tail, Buffer.from("\n")]);
  await fs.writeFile(filePath, nextBuffer);
  return nextBuffer.length;
}

async function pruneLogs() {
  await migrateLegacyLogs();

  const now = new Date();
  const cutoffTime = now.getTime() - (Math.max(1, MAX_LOG_RETENTION_DAYS) - 1) * 24 * 60 * 60 * 1000;

  for (const type of Object.keys(logDirectories)) {
    await ensureDir(logDirectories[type]);
    const files = await listTypeLogFiles(type);

    for (const filePath of files) {
      const dateKey = parseDateKey(path.basename(filePath));
      if (!dateKey) {
        continue;
      }

      const fileTime = new Date(`${dateKey}T00:00:00.000Z`).getTime();
      if (fileTime < cutoffTime) {
        await fs.rm(filePath, { force: true });
      }
    }
  }

  const remainingFiles = [];
  for (const type of Object.keys(logDirectories)) {
    const files = await listTypeLogFiles(type);
    for (const filePath of files) {
      const stat = await fs.stat(filePath);
      remainingFiles.push({ type, filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }

  remainingFiles.sort((left, right) => left.mtimeMs - right.mtimeMs || left.filePath.localeCompare(right.filePath));
  let totalBytes = remainingFiles.reduce((sum, item) => sum + item.size, 0);
  const remainingTypeCounts = remainingFiles.reduce((counts, item) => {
    counts[item.type] = (counts[item.type] || 0) + 1;
    return counts;
  }, {});

  for (const file of remainingFiles) {
    if (totalBytes <= MAX_TOTAL_LOG_BYTES) {
      break;
    }

    const bytesNeeded = totalBytes - MAX_TOTAL_LOG_BYTES;
    if (file.size <= bytesNeeded && remainingTypeCounts[file.type] > 1) {
      await fs.rm(file.filePath, { force: true });
      totalBytes -= file.size;
      remainingTypeCounts[file.type] -= 1;
      continue;
    }

    const keepBytes = Math.max(0, file.size - bytesNeeded);
    const nextSize = await trimLogFileTail(file.filePath, keepBytes);
    totalBytes = totalBytes - file.size + nextSize;
  }

  return totalBytes;
}

async function appendLogEntry(type, entry) {
  const directory = logDirectories[type];
  if (!directory) {
    throw new Error(`Unsupported log type: ${type}`);
  }

  await ensureDir(directory);
  const record = {
    timestamp: new Date().toISOString(),
    type,
    ...entry,
  };
  await fs.appendFile(getLogFilePath(type), `${JSON.stringify(record)}\n`, "utf8");
  await pruneLogs();
  return record;
}

async function writeAppLog(level, event, message, meta = {}) {
  return appendLogEntry("app", {
    level,
    event,
    message,
    ...meta,
  });
}

async function readLogFilePath(filePath, type) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => normalizeLogEntry(type, line));
}

async function readLogEntries(options = {}) {
  const type = options.type || "all";
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
  const level = String(options.level || "").trim().toLowerCase();
  const search = String(options.search || "").trim().toLowerCase();

  await migrateLegacyLogs();
  const types = type === "all" ? Object.keys(logDirectories) : [type];
  const allEntries = [];

  for (const itemType of types) {
    const files = await listTypeLogFiles(itemType);
    for (const filePath of files) {
      const entries = await readLogFilePath(filePath, itemType);
      allEntries.push(...entries);
    }
  }

  return allEntries
    .filter(entry => (level ? String(entry.level || "").toLowerCase() === level : true))
    .filter(entry => {
      if (!search) return true;
      return JSON.stringify(entry).toLowerCase().includes(search);
    })
    .sort((left, right) => String(right.timestamp || "").localeCompare(String(left.timestamp || "")))
    .slice(0, limit);
}

async function getLogSummary() {
  await migrateLegacyLogs();
  const summary = {};

  for (const [type, directory] of Object.entries(logDirectories)) {
    if (!(await fileExists(directory))) {
      summary[type] = {
        exists: false,
        sizeBytes: 0,
        fileCount: 0,
        updatedAt: null,
      };
      continue;
    }

    const files = await listTypeLogFiles(type);
    if (files.length === 0) {
      summary[type] = {
        exists: false,
        sizeBytes: 0,
        fileCount: 0,
        updatedAt: null,
      };
      continue;
    }

    const stats = (await Promise.all(files.map(async filePath => {
      try {
        return await fs.stat(filePath);
      } catch (error) {
        if (error && error.code === "ENOENT") {
          return null;
        }
        throw error;
      }
    }))).filter(Boolean);

    if (stats.length === 0) {
      summary[type] = {
        exists: false,
        sizeBytes: 0,
        fileCount: 0,
        updatedAt: null,
      };
      continue;
    }

    const sizeBytes = stats.reduce((sum, stat) => sum + stat.size, 0);
    const updatedAt = stats
      .map(stat => stat.mtime.toISOString())
      .sort((left, right) => right.localeCompare(left))[0] || null;

    summary[type] = {
      exists: true,
      sizeBytes,
      fileCount: files.length,
      updatedAt,
    };
  }

  return summary;
}

module.exports = {
  appendLogEntry,
  formatDateKey,
  getLogFilePath,
  getLogSummary,
  legacyLogFiles,
  logDirectories,
  MAX_LOG_RETENTION_DAYS,
  MAX_TOTAL_LOG_BYTES,
  parseDateKey,
  pruneLogs,
  readLogEntries,
  trimAllLogFiles: pruneLogs,
  writeAppLog,
};



