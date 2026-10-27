// Local log file for the desktop app (errors and warnings), so problems seen
// during a shoot can be reported. Nothing is sent anywhere.
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;
let file = null;

function initLog(dir) {
  fs.mkdirSync(dir, { recursive: true });
  file = path.join(dir, 'mesora.log');
  try {
    if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
  } catch {
    // No log yet.
  }
}

function format(part) {
  if (part instanceof Error) return part.stack || part.message;
  return typeof part === 'string' ? part : JSON.stringify(part);
}

function log(level, ...parts) {
  if (!file) return;
  try {
    fs.appendFileSync(file, `${new Date().toISOString()} [${level}] ${parts.map(format).join(' ')}\n`);
  } catch {
    // Logging must never break the app.
  }
}

module.exports = { initLog, log, logFile: () => file };
