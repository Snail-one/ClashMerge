const { appendLogEntry } = require("./logs");

async function writeAuditLog(entry) {
  return appendLogEntry("audit", entry);
}

module.exports = {
  writeAuditLog,
};
