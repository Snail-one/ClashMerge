const fs = require("node:fs/promises");
const path = require("node:path");

const { paths } = require("../config/paths");
const { ensureDir, fileExists } = require("../utils/fs");

const MAX_BUILD_RECORDS = Number(process.env.MAX_BUILD_RECORDS || 10);

async function listBuilds() {
  const exists = await fileExists(paths.buildsDir);

  if (!exists) {
    return [];
  }

  const names = await fs.readdir(paths.buildsDir);
  const files = names.filter(name => name.endsWith(".json"));
  const builds = await Promise.all(
    files.map(async name => {
      const raw = await fs.readFile(path.join(paths.buildsDir, name), "utf8");
      return JSON.parse(raw);
    })
  );

  return builds.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function trimBuildRecords(limit = MAX_BUILD_RECORDS) {
  await ensureDir(paths.buildsDir);
  const builds = await listBuilds();
  const staleBuilds = builds.slice(Math.max(1, limit));

  await Promise.all(
    staleBuilds.map(build => fs.rm(path.join(paths.buildsDir, `${build.id}.json`), { force: true }))
  );

  return Math.min(builds.length, Math.max(1, limit));
}

async function writeBuildRecord(record) {
  await ensureDir(paths.buildsDir);
  await fs.writeFile(
    path.join(paths.buildsDir, `${record.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
  await trimBuildRecords();
  return record;
}

module.exports = {
  listBuilds,
  MAX_BUILD_RECORDS,
  trimBuildRecords,
  writeBuildRecord,
};
