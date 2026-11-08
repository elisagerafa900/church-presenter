// Electron main process: operator window, projector output window,
// and a small web server so OBS/vMix can use the output as a browser source.
const { app, BrowserWindow, ipcMain, screen, dialog, safeStorage } = require('electron');
const path = require('node:path');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const ndi = require('./ndi.cjs');
const { DeepgramStream, testKey } = require('./stt.cjs');
const { OfflineStream } = require('./offline-stt.cjs');
const models = require('./models.cjs');
const bibles = require('./bibles.cjs');
const yv = require('./youversion.cjs');
const yvCache = require('./yvcache.cjs');

// ---------- automatic updates (GitHub Releases: elisagerafa900/church-presenter-releases) ----------
let updateState = { state: 'idle', version: app.getVersion() };
function sendUpdate(patch) {
  updateState = { ...updateState, ...patch };
  operatorWin?.webContents.send('update:status', updateState);
}
let checkUpdates = () => sendUpdate({ state: 'error', message: 'Updates work in the installed app (Setup .exe), not with npm start.' });
let installUpdate = () => {};
ipcMain.handle('update:check', () => { checkUpdates(); return updateState; });
ipcMain.handle('update:install', () => installUpdate());
function setupUpdates() {
  if (DEV || !app.isPackaged) return; // only the installed app updates itself
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = true; // download quietly in the background
  autoUpdater.autoInstallOnAppQuit = true; // install when the app is closed — never during a service
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => sendUpdate({ state: 'downloading', newVersion: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'latest', checkedAt: Date.now() }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', newVersion: i.version }));
  autoUpdater.on('error', (e) => sendUpdate({ state: 'error', message: String(e?.message || e).split('\n')[0] }));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  checkUpdates = check;
  setTimeout(check, 15000); // shortly after start
  setInterval(check, 4 * 60 * 60 * 1000); // and every 4 hours
  installUpdate = async () => {
    const r = await dialog.showMessageBox(operatorWin, {
      type: 'question',
      buttons: ['Restart and update now', 'Later (when I close the app)'],
      defaultId: 1,
      cancelId: 1,
      title: 'Update ready',
      message: `Version ${updateState.newVersion} is ready.`,
      detail: 'The app (and the projector window) will close for a few seconds, then reopen.',
    });
    if (r.response === 0) autoUpdater.quitAndInstall(true, true);
  };
}

const DEV = process.env.VITE_DEV === '1';
const DEV_URL = 'http://localhost:5173';
const DIST = path.join(__dirname, '..', 'dist');
const WEB_PORT = 4317;

let operatorWin = null;
let outputWin = null;
let outputDisplayId = null;
let lastState = null;
const sseClients = new Set();

function loadPage(win, page, query = {}) {
  if (DEV) {
    const qs = new URLSearchParams(query).toString();
    return win.loadURL(`${DEV_URL}/${page}${qs ? `?${qs}` : ''}`);
  }
  return win.loadFile(path.join(DIST, page), { query });
}

function createOperator() {
  operatorWin = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1115',
    title: 'Church Presenter',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  operatorWin.removeMenu();
  loadPage(operatorWin, 'index.html');
  operatorWin.on('closed', () => {
    operatorWin = null;
    if (outputWin) outputWin.close();
    app.quit();
  });
}

function sendOutputStatus() {
  operatorWin?.webContents.send('output:status', { open: !!outputWin, displayId: outputDisplayId });
}

function openOutput(displayId) {
  const displays = screen.getAllDisplays();
  const target =
    displays.find((d) => d.id === displayId) ||
    displays.find((d) => d.id !== screen.getPrimaryDisplay().id) ||
    screen.getPrimaryDisplay();
  outputDisplayId = target.id;

  if (outputWin) {
    outputWin.setFullScreen(false);
    outputWin.setBounds(target.bounds);
    outputWin.setFullScreen(true);
    sendOutputStatus();
    return;
  }
  outputWin = new BrowserWindow({
    ...target.bounds,
    frame: false,
    fullscreen: true,
    backgroundColor: '#000000',
    skipTaskbar: true,
    focusable: target.id === screen.getPrimaryDisplay().id,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true },
  });
  loadPage(outputWin, 'output.html', { layout: 'full' });
  outputWin.webContents.on('did-finish-load', () => {
    if (lastState) outputWin?.webContents.send('output:state', lastState);
  });
  outputWin.on('closed', () => {
    outputWin = null;
    outputDisplayId = null;
    sendOutputStatus();
  });
  sendOutputStatus();
}

// ---------- NDI outputs (rendered off-screen, sent as NDI video) ----------
// Each source: { layout, name, win, sender, image, dirty, lastSent, timer }
const ndiSources = new Map();
let ndiConfig = { fps: 30, full: { enabled: false, name: 'Church Presenter Main' }, lower: { enabled: false, name: 'Church Presenter Lower Third' } };
let ndiLastError = null;
const NDI_W = 1920;
const NDI_H = 1080;

function stopNdi(layout) {
  const src = ndiSources.get(layout);
  if (!src) return;
  clearInterval(src.timer);
  if (src.win && !src.win.isDestroyed()) src.win.destroy();
  try { src.sender.destroy(); } catch { /* already gone */ }
  ndiSources.delete(layout);
}

function startNdi(layout, name) {
  let sender;
  try {
    sender = new ndi.Sender(name);
  } catch (e) {
    ndiLastError = e.message;
    return;
  }
  const lower = layout === 'lower';
  const win = new BrowserWindow({
    show: false,
    width: NDI_W,
    height: NDI_H,
    useContentSize: true,
    frame: false,
    transparent: lower,
    backgroundColor: lower ? '#00000000' : '#000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, offscreen: true },
  });
  const src = { layout, name, win, sender, image: null, dirty: false, lastSent: 0, timer: null };
  win.webContents.setFrameRate(ndiConfig.fps);
  win.webContents.on('paint', (_e, _dirty, image) => {
    src.image = image;
    src.dirty = true;
  });
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(1);
    if (lastState) win.webContents.send('output:state', lastState);
  });
  loadPage(win, 'output.html', { layout });
  // Send when the picture changed, plus once a second so receivers stay happy.
  src.timer = setInterval(() => {
    if (!src.image) return;
    const now = Date.now();
    if (!src.dirty && now - src.lastSent < 1000) return;
    if (src.sender.connections() === 0) return; // nobody watching: save CPU
    let img = src.image;
    const size = img.getSize();
    if (size.width !== NDI_W || size.height !== NDI_H) img = img.resize({ width: NDI_W, height: NDI_H, quality: 'good' });
    const buf = img.toBitmap(); // BGRA
    if (lower) ndi.unpremultiply(buf);
    src.sender.send(buf, NDI_W, NDI_H, ndiConfig.fps);
    src.dirty = false;
    src.lastSent = now;
  }, Math.round(1000 / ndiConfig.fps));
  ndiSources.set(layout, src);
}

function applyNdi(cfg) {
  ndiConfig = { ...ndiConfig, ...cfg };
  ndiLastError = null;
  for (const layout of ['full', 'lower']) {
    const want = ndiConfig[layout];
    const have = ndiSources.get(layout);
    if (have && (!want.enabled || have.name !== want.name || have.fps !== ndiConfig.fps)) stopNdi(layout);
    if (want.enabled && !ndiSources.has(layout)) {
      startNdi(layout, want.name.trim() || (layout === 'full' ? 'Church Presenter Main' : 'Church Presenter Lower Third'));
      const s = ndiSources.get(layout);
      if (s) s.fps = ndiConfig.fps;
    }
  }
  return ndiStatus();
}

function ndiStatus() {
  const st = ndi.status();
  const sources = {};
  for (const layout of ['full', 'lower']) {
    const s = ndiSources.get(layout);
    sources[layout] = s ? { running: true, name: s.name, connections: s.sender.connections() } : { running: false };
  }
  return { ...st, error: ndiLastError || st.error, machine: os.hostname(), sources };
}

function broadcast(state) {
  lastState = state;
  outputWin?.webContents.send('output:state', state);
  for (const src of ndiSources.values()) src.win.webContents.send('output:state', state);
  const data = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of sseClients) res.write(data);
}

// ---------- browser-source web server ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

function startWebServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(': connected\n\n');
      if (lastState) res.write(`data: ${JSON.stringify(lastState)}\n\n`);
      sseClients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
      return;
    }
    if (DEV) {
      res.writeHead(302, { Location: `${DEV_URL}${url.pathname}${url.search}` });
      return res.end();
    }
    let file = path.normalize(path.join(DIST, url.pathname === '/' ? 'output.html' : url.pathname));
    if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  server.on('error', (e) => console.error('Web output server error:', e.message));
  server.listen(WEB_PORT, '0.0.0.0');
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ---------- IPC ----------
ipcMain.handle('displays:list', () => {
  const primary = screen.getPrimaryDisplay().id;
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `${d.id === primary ? 'Laptop' : `Screen ${i + 1}`} · ${d.size.height}p`,
    primary: d.id === primary,
  }));
});
ipcMain.handle('output:open', (_e, displayId) => openOutput(displayId));
ipcMain.handle('output:close', () => outputWin?.close());
ipcMain.handle('web:info', () => ({ port: WEB_PORT, addresses: lanAddresses() }));
ipcMain.handle('update:status', () => updateState);
ipcMain.on('output:state', (_e, state) => broadcast(state));
ipcMain.handle('ndi:status', () => ndiStatus());

// ---------- live transcription ----------
let stt = null;
const sttSend = (type, payload = {}) => operatorWin?.webContents.send('stt:event', { type, ...payload });
ipcMain.handle('stt:start', (_e, opts) => {
  if (stt) { stt.removeAllListeners(); stt.stop(); }
  stt = opts.engine === 'offline' ? new OfflineStream({ model: opts.model }) : new DeepgramStream(opts);
  stt.on('status', (st) => sttSend('status', st));
  stt.on('result', (r) => sttSend('result', r));
  stt.on('utteranceEnd', () => sttSend('utteranceEnd'));
  stt.on('error', (e) => sttSend('error', e));
  stt.start();
  return true;
});
ipcMain.on('stt:audio', (_e, chunk) => stt?.send(Buffer.from(chunk)));
ipcMain.handle('stt:stop', () => { stt?.stop(); stt = null; });
ipcMain.handle('stt:test', (_e, key) => testKey(key));

// ---------- offline models ----------
let modelBusy = null;
const modelProgress = (id) => (p) => operatorWin?.webContents.send('models:progress', { id, ...p });
ipcMain.handle('models:list', () => ({ models: models.list(), busy: modelBusy }));
ipcMain.handle('models:download', async (_e, id) => {
  if (modelBusy) return { ok: false, message: 'Another model is downloading.' };
  modelBusy = id;
  try {
    await models.download(id, modelProgress(id));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `${e.message}. You can also download the file in your browser and use “Install from file”.` };
  } finally {
    modelBusy = null;
  }
});
ipcMain.handle('models:installFile', async (_e, id) => {
  const r = await dialog.showOpenDialog(operatorWin, {
    title: `Choose ${models.MODELS[id].folder}.tar.bz2`,
    filters: [{ name: 'Model archive', extensions: ['bz2'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  modelBusy = id;
  try {
    await models.installFromFile(id, r.filePaths[0], modelProgress(id));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e.message };
  } finally {
    modelBusy = null;
  }
});
// YouVersion online Bibles (errors go back to the screen as { error })
const yvCall = (fn) => async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message }; }
};
ipcMain.handle('yv:versions', yvCall((key, lang) => yv.listVersions(key, lang)));
ipcMain.handle('yv:version', yvCall((key, id) => yv.getVersion(key, id)));
const yvOff = require('./yvoffline.cjs')(yv, yvCache);
const yvIndex = yvOff.index;
const yvChapter = yvOff.chapter;
ipcMain.handle('yv:index', yvCall((key, id, offline) => yvIndex(key, id, offline)));
ipcMain.handle('yv:chapter', yvCall((key, id, usfm, offline) => yvChapter(key, id, usfm, offline)));
ipcMain.handle('yv:cacheStats', (_e, id) => yvCache.stats(id));
ipcMain.handle('yv:cacheClear', (_e, id) => { yvCache.clear(id); return yvCache.stats(id); });

// "Download all" for a version (only if its offline copy is switched on)
ipcMain.handle('yv:cancelDownload', (_e, id) => yvOff.cancel(id));
ipcMain.handle('yv:downloadAll', yvCall((key, id) => yvOff.downloadAll(key, id, (p) => operatorWin?.webContents.send('yv:progress', p))));
ipcMain.handle('bibles:list', () => bibles.list());
ipcMain.handle('bibles:save', (_e, id, name, json) => bibles.save(id, name, json));
ipcMain.handle('bibles:read', (_e, id) => bibles.read(id));
ipcMain.handle('bibles:remove', (_e, id) => bibles.remove(id));
ipcMain.handle('models:remove', (_e, id) => { models.remove(id); return models.list(); });
ipcMain.handle('models:url', (_e, id) => `${models.BASE}/${models.MODELS[id].folder}.tar.bz2`);
ipcMain.handle('ndi:config', (_e, cfg) => applyNdi(cfg));

app.whenReady().then(() => {
  models.setModelsDir(path.join(app.getPath('userData'), 'models'));
  bibles.setDir(path.join(app.getPath('userData'), 'bibles'));
  yvCache.setup(path.join(app.getPath('userData'), 'yv-offline'), safeStorage);
  startWebServer();
  createOperator();
  setupUpdates();
  screen.on('display-removed', () => {
    if (outputWin && !screen.getAllDisplays().some((d) => d.id === outputDisplayId)) outputWin.close();
  });
  screen.on('display-added', () => operatorWin?.webContents.send('displays:changed'));
  // Keep the operator's NDI panel up to date (who is watching)
  setInterval(() => {
    if (operatorWin && ndiSources.size) operatorWin.webContents.send('ndi:status', ndiStatus());
  }, 2000);
});

app.on('before-quit', () => {
  stt?.stop();
  for (const layout of [...ndiSources.keys()]) stopNdi(layout);
});

app.on('window-all-closed', () => app.quit());
