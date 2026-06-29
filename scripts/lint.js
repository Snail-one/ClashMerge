const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rootDir = path.resolve(__dirname, "..");
const roots = ["src", "scripts", "tests", "public"];
const ignoredSegments = new Set(["node_modules", "vendor"]);

function shouldSkip(filePath) {
  return filePath.split(path.sep).some(segment => ignoredSegments.has(segment));
}

function collectJavaScriptFiles(directory, files = []) {
  if (!fs.existsSync(directory) || shouldSkip(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJavaScriptFiles(entryPath, files);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".js") && !shouldSkip(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

const files = roots.flatMap(root => collectJavaScriptFiles(path.join(rootDir, root)));
let failed = false;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout || `${file} failed syntax check\n`);
  }
}

if (failed) {
  process.exit(1);
}

console.log(`Checked ${files.length} JavaScript files`);
