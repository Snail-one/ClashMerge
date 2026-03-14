const MAX_JSON_BYTES = 1024 * 1024;

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readJson(req, options = {}) {
  const maxBytes = Number(options.maxBytes) || MAX_JSON_BYTES;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    req.on("data", chunk => {
      if (settled) {
        return;
      }

      totalBytes += chunk.length;

      if (totalBytes > maxBytes) {
        settled = true;
        reject(createHttpError(413, `JSON body too large (max ${maxBytes} bytes)`));
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) {
        return;
      }

      if (chunks.length === 0) {
        settled = true;
        resolve({});
        return;
      }

      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        settled = true;
        resolve(JSON.parse(raw));
      } catch {
        settled = true;
        reject(createHttpError(400, "Invalid JSON body"));
      }
    });

    req.on("error", error => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(body);
}

module.exports = {
  createHttpError,
  readJson,
  sendJson,
  sendText,
};
