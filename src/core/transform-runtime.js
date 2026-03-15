const fs = require("node:fs/promises");
const vm = require("node:vm");

const { paths } = require("../config/paths");

const FORBIDDEN_SCRIPT_PATTERNS = [
  { pattern: /\brequire\s*\(/, reason: "require is not allowed in transform scripts" },
  { pattern: /\bprocess\b/, reason: "process is not allowed in transform scripts" },
  { pattern: /\bglobal\b/, reason: "global is not allowed in transform scripts" },
  { pattern: /\bglobalThis\b/, reason: "globalThis is not allowed in transform scripts" },
  { pattern: /\bFunction\b/, reason: "Function constructor is not allowed in transform scripts" },
  { pattern: /\beval\s*\(/, reason: "eval is not allowed in transform scripts" },
  { pattern: /\bAsyncFunction\b/, reason: "AsyncFunction constructor is not allowed in transform scripts" },
  { pattern: /\bGeneratorFunction\b/, reason: "GeneratorFunction constructor is not allowed in transform scripts" },
  { pattern: /\bWebAssembly\b/, reason: "WebAssembly is not allowed in transform scripts" },
  { pattern: /\bimport\s*\(/, reason: "dynamic import is not allowed in transform scripts" },
  { pattern: /\bSharedArrayBuffer\b/, reason: "SharedArrayBuffer is not allowed in transform scripts" },
  { pattern: /__proto__|prototype\s*\.|constructor\s*\./, reason: "prototype access is not allowed in transform scripts" },
];

function sanitizeConfig(config) {
  return JSON.parse(JSON.stringify(config, (key, value) => {
    if (key === "__meta") {
      return value;
    }

    return value;
  }));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

function cloneForOutput(value) {
  return JSON.parse(JSON.stringify(value));
}

function getLineNumber(scriptContent, pattern) {
  const lines = String(scriptContent).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      return index + 1;
    }
  }
  return null;
}

function assertNoForbiddenPatterns(scriptContent) {
  for (const entry of FORBIDDEN_SCRIPT_PATTERNS) {
    if (entry.pattern.test(scriptContent)) {
      const line = getLineNumber(scriptContent, entry.pattern);
      throw new Error(`${entry.reason}${line ? ` on line ${line}` : ""}`);
    }
  }
}

function assertNoSuspiciousTopLevelStatements(scriptContent) {
  const lines = String(scriptContent).split(/\r?\n/);
  const suspicious = [];

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();

    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*") || line.startsWith("*/")) {
      continue;
    }

    if (/^(function\s|async\s+function\s|const\s|let\s|var\s|class\s|if\s*\(|for\s*\(|while\s*\(|switch\s*\(|try\s*\{|throw\s|return\s|module\.exports\s*=|exports\.|[{});,]$)/.test(line)) {
      continue;
    }

    if (/^['"`]/.test(line)) {
      suspicious.push(index + 1);
      continue;
    }

    if (/^[\d.]+;?$/.test(line)) {
      suspicious.push(index + 1);
      continue;
    }

    if (/^(true|false|null|undefined);?$/.test(line)) {
      suspicious.push(index + 1);
      continue;
    }
  }

  if (suspicious.length > 0) {
    throw new Error(`Script contains suspicious top-level statements on line ${suspicious.join(", ")}`);
  }
}

function attachLineNumberToError(error) {
  if (!error || /on line \d+/i.test(String(error.message || ""))) {
    return error;
  }

  const stack = String(error.stack || "");
  const match = stack.match(/default\.js:(\d+):(\d+)/i);
  if (!match) {
    return error;
  }

  error.message = `${error.message} on line ${match[1]}`;
  return error;
}
function loadTransformFromContent(scriptContent) {
  assertNoSuspiciousTopLevelStatements(scriptContent);
  assertNoForbiddenPatterns(scriptContent);

  const sandbox = {
    module: { exports: {} },
    exports: {},
  };

  vm.createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
    name: "transform-sandbox",
  });

  const script = new vm.Script(scriptContent, {
    filename: paths.defaultScriptFile,
    displayErrors: true,
  });
  script.runInContext(sandbox, {
    timeout: 1000,
    displayErrors: true,
    microtaskMode: "afterEvaluate",
  });

  const transform = sandbox.module.exports.transform || sandbox.exports.transform;

  if (typeof transform !== "function") {
    throw new Error("Default script must export a transform function");
  }

  return transform;
}

async function runTransformInProcess(scriptContent, config, context) {
  const transform = loadTransformFromContent(scriptContent);
  const input = deepFreeze(sanitizeConfig(config));
  const safeContext = deepFreeze(sanitizeConfig(context));
  const output = transform(input, safeContext);

  if (!output || typeof output !== "object") {
    throw new Error("Transform must return a config object");
  }

  return cloneForOutput(output);
}

async function readDefaultScript() {
  return fs.readFile(paths.defaultScriptFile, "utf8");
}

module.exports = {
  assertNoForbiddenPatterns,
  assertNoSuspiciousTopLevelStatements,
  loadTransformFromContent,
  readDefaultScript,
  runTransformInProcess,
  sanitizeConfig,
};

