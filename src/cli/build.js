const { ensureProjectFiles } = require("../core/bootstrap");
const { buildConfig } = require("../core/build");

async function main() {
  await ensureProjectFiles();
  const result = await buildConfig();
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
