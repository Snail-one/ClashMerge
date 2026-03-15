const path = require("node:path");
const { fork } = require("node:child_process");

const { readDefaultScript, runTransformInProcess } = require("./transform-runtime");
const { paths } = require("../config/paths");

const TRANSFORM_TIMEOUT_MS = Number(process.env.TRANSFORM_TIMEOUT_MS || 1500);
const workerPath = path.join(__dirname, "transform-worker.js");
const allowInProcessFallback = process.env.ALLOW_IN_PROCESS_TRANSFORM_FALLBACK === "true" || process.env.NODE_ENV === "test";

function runTransformInWorker(scriptContent, config, context) {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = fork(workerPath, {
        cwd: paths.rootDir,
        execArgv: [],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill();
      reject(new Error(`Transform timed out after ${TRANSFORM_TIMEOUT_MS}ms`));
    }, TRANSFORM_TIMEOUT_MS);

    child.on("message", message => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      child.kill();

      if (!message || message.ok !== true) {
        reject(new Error(message?.error || "Transform failed"));
        return;
      }

      resolve(message.output);
    });

    child.on("error", error => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", code => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Transform worker exited unexpectedly with code ${code}`));
    });

    child.send({
      type: "run-transform",
      scriptContent,
      config,
      context,
    });
  });
}

async function runTransformContent(scriptContent, config, context) {
  try {
    return await runTransformInWorker(scriptContent, config, context);
  } catch (error) {
    if (allowInProcessFallback && error && (error.code === "EPERM" || error.code === "EACCES" || error.code === "ENOENT")) {
      return runTransformInProcess(scriptContent, config, context);
    }
    throw error;
  }
}

async function runTransform(config, context) {
  const scriptContent = await readDefaultScript();
  return runTransformContent(scriptContent, config, context);
}

module.exports = {
  runTransform,
  runTransformContent,
};
