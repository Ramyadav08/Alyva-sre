// Tiny JSON-file persistence — deliberately not a database. MVP scope: this
// skill's whole state (service profiles, pending questions, draft/approved
// rules, tuning history, outcome memory) is small enough to live in a few
// JSON files under data/, which also makes it trivial to inspect by hand
// during judging ("show me the raw reasoning trace").

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function load(name, fallback) {
  ensureDir();
  const p = filePath(name);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function save(name, data) {
  ensureDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

module.exports = { load, save, DATA_DIR };
