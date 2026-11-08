// Offline speech models: where they live, how to download / install them.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const BASE = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models';

const MODELS = {
  parakeet: {
    id: 'parakeet',
    name: 'Accurate — Parakeet',
    note: 'Best for accents. ~480 MB download, ~1.2 GB memory.',
    folder: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    sizeMB: 482,
    config: (d) => ({
      transducer: { encoder: path.join(d, 'encoder.int8.onnx'), decoder: path.join(d, 'decoder.int8.onnx'), joiner: path.join(d, 'joiner.int8.onnx') },
      tokens: path.join(d, 'tokens.txt'),
      modelType: 'nemo_transducer',
    }),
    check: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
  },
  moonshine: {
    id: 'moonshine',
    name: 'Light — Moonshine Tiny',
    note: 'Faster, smaller, less accurate. ~110 MB download.',
    folder: 'sherpa-onnx-moonshine-tiny-en-int8',
    sizeMB: 108,
    config: (d) => ({
      moonshine: {
        preprocessor: path.join(d, 'preprocess.onnx'),
        encoder: path.join(d, 'encode.int8.onnx'),
        uncachedDecoder: path.join(d, 'uncached_decode.int8.onnx'),
        cachedDecoder: path.join(d, 'cached_decode.int8.onnx'),
      },
      tokens: path.join(d, 'tokens.txt'),
    }),
    check: ['preprocess.onnx', 'encode.int8.onnx', 'uncached_decode.int8.onnx', 'cached_decode.int8.onnx', 'tokens.txt'],
  },
};
const VAD_FILE = 'silero_vad.onnx';

let modelsDir = null;
function setModelsDir(dir) {
  modelsDir = dir;
  fs.mkdirSync(dir, { recursive: true });
}

function modelPath(id) {
  return path.join(modelsDir, MODELS[id].folder);
}
function vadPath() {
  return path.join(modelsDir, VAD_FILE);
}
function isInstalled(id) {
  const d = modelPath(id);
  return MODELS[id].check.every((f) => fs.existsSync(path.join(d, f))) && fs.existsSync(vadPath());
}
function list() {
  return Object.values(MODELS).map((m) => ({ id: m.id, name: m.name, note: m.note, sizeMB: m.sizeMB, installed: isInstalled(m.id) }));
}

function getFetch() {
  try {
    const { net } = require('electron');
    if (net?.fetch) return net.fetch.bind(net); // uses Windows proxy settings
  } catch { /* plain node (tests) */ }
  return fetch;
}

async function downloadFile(url, dest, onProgress) {
  const res = await getFetch()(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  let received = 0;
  let lastReport = 0;
  const tmp = `${dest}.part`;
  const reader = Readable.fromWeb(res.body);
  reader.on('data', (c) => {
    received += c.length;
    const now = Date.now();
    if (now - lastReport > 250) { lastReport = now; onProgress?.({ received, total }); }
  });
  await pipeline(reader, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  onProgress?.({ received, total });
}

/** Extract .tar.bz2 with the tar.exe that ships with Windows 10/11 (also works on Mac/Linux). */
function extractTarBz2(file, toDir) {
  return new Promise((resolve, reject) => {
    const p = spawn('tar', ['-xjf', file, '-C', toDir], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Could not unpack the model (${err.trim() || code})`))));
  });
}

async function ensureVad(onProgress) {
  if (fs.existsSync(vadPath())) return;
  onProgress?.({ phase: 'vad' });
  await downloadFile(`${BASE}/${VAD_FILE}`, vadPath());
}

/** Download + unpack a model. onProgress({phase, received, total}) */
async function download(id, onProgress) {
  const m = MODELS[id];
  if (!m) throw new Error('Unknown model');
  await ensureVad(onProgress);
  const archive = path.join(modelsDir, `${m.folder}.tar.bz2`);
  if (!fs.existsSync(archive)) {
    await downloadFile(`${BASE}/${m.folder}.tar.bz2`, archive, (p) => onProgress?.({ phase: 'download', ...p }));
  }
  onProgress?.({ phase: 'unpack' });
  await extractTarBz2(archive, modelsDir);
  fs.rmSync(archive, { force: true });
  if (!isInstalled(id)) throw new Error('Model files are incomplete after unpacking.');
  onProgress?.({ phase: 'done' });
}

/** Install from a .tar.bz2 the user downloaded in their browser. */
async function installFromFile(id, file, onProgress) {
  const m = MODELS[id];
  if (!path.basename(file).startsWith(m.folder)) {
    throw new Error(`That file is not the ${m.name} model. Expected ${m.folder}.tar.bz2`);
  }
  await ensureVad(onProgress);
  onProgress?.({ phase: 'unpack' });
  await extractTarBz2(file, modelsDir);
  if (!isInstalled(id)) throw new Error('Model files are incomplete after unpacking.');
  onProgress?.({ phase: 'done' });
}

function remove(id) {
  fs.rmSync(modelPath(id), { recursive: true, force: true });
}

module.exports = { MODELS, setModelsDir, list, isInstalled, modelPath, vadPath, download, installFromFile, remove, BASE };
