// Offline copy of YouVersion Bibles — only for versions the church has switched on
// (and confirmed its licence allows offline storage).
// Stored encrypted with Windows' per-user protection (Electron safeStorage / DPAPI),
// so it can't be copied off the PC as a Bible file.
const fs = require('node:fs');
const path = require('node:path');

const MAX_AGE_DAYS = 60; // must be re-confirmed online at least this often

let root = null;
let enc = null; // { encrypt(str) -> Buffer, decrypt(Buffer) -> str }

function setup(dir, safeStorage) {
  root = dir;
  fs.mkdirSync(root, { recursive: true });
  if (safeStorage?.isEncryptionAvailable?.()) {
    enc = { encrypt: (s) => safeStorage.encryptString(s), decrypt: (b) => safeStorage.decryptString(b) };
  } else {
    enc = null; // no secure storage on this PC: offline copies are disabled
  }
}

const available = () => !!(root && enc);
const dirFor = (yvId) => path.join(root, String(Number(yvId)));
const fileFor = (yvId, name) => path.join(dirFor(yvId), `${name.replace(/[^A-Z0-9.]/gi, '_')}.bin`);
const metaFile = (yvId) => path.join(dirFor(yvId), 'meta.json');

function readMeta(yvId) {
  try { return JSON.parse(fs.readFileSync(metaFile(yvId), 'utf8')); } catch { return null; }
}
function writeMeta(yvId, patch) {
  fs.mkdirSync(dirFor(yvId), { recursive: true });
  const m = { ...(readMeta(yvId) || {}), ...patch };
  fs.writeFileSync(metaFile(yvId), JSON.stringify(m));
  return m;
}

/** Call after YouVersion confirmed (online) that this key may still use the version. */
function markVerified(yvId) {
  if (!available()) return;
  writeMeta(yvId, { verifiedAt: Date.now() });
}

function expired(yvId) {
  const m = readMeta(yvId);
  return !m?.verifiedAt || Date.now() - m.verifiedAt > MAX_AGE_DAYS * 86400000;
}

function get(yvId, name) {
  if (!available()) return null;
  if (expired(yvId)) { clear(yvId); return null; }
  try { return enc.decrypt(fs.readFileSync(fileFor(yvId, name))); } catch { return null; }
}

function put(yvId, name, text) {
  if (!available()) return;
  fs.mkdirSync(dirFor(yvId), { recursive: true });
  fs.writeFileSync(fileFor(yvId, name), enc.encrypt(text));
}

function has(yvId, name) {
  return available() && fs.existsSync(fileFor(yvId, name));
}

function clear(yvId) {
  if (!root) return;
  fs.rmSync(dirFor(yvId), { recursive: true, force: true });
}

function stats(yvId) {
  if (!available()) return { available: false, chapters: 0 };
  let chapters = 0;
  try { chapters = fs.readdirSync(dirFor(yvId)).filter((f) => /\.\d+\.bin$/.test(f)).length; } catch { /* none yet */ }
  const m = readMeta(yvId);
  return { available: true, chapters, verifiedAt: m?.verifiedAt || null, maxAgeDays: MAX_AGE_DAYS };
}

module.exports = { setup, available, get, put, has, clear, stats, markVerified, expired };
