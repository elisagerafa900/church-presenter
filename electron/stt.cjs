// Live speech-to-text through Deepgram (cloud). Runs in the Electron main process
// so the API key is sent as a proper Authorization header.
// The renderer sends 16 kHz mono 16-bit PCM chunks; we stream them to Deepgram
// and pass transcripts back.
const WebSocket = require('ws');
const { EventEmitter } = require('node:events');

const DG_URL = process.env.DEEPGRAM_URL || 'wss://api.deepgram.com/v1/listen';

// Book names speech engines often mishear. Deepgram Nova-3 "keyterm" hints.
const BIBLE_KEYTERMS = [
  'Deuteronomy', 'Leviticus', 'Nehemiah', 'Ecclesiastes', 'Lamentations', 'Ezekiel', 'Obadiah',
  'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi', 'Corinthians', 'Galatians',
  'Ephesians', 'Philippians', 'Colossians', 'Thessalonians', 'Philemon', 'Hebrews', 'Psalms',
];

class DeepgramStream extends EventEmitter {
  constructor({ apiKey, language = 'en', keyterms = [], sampleRate = 16000 }) {
    super();
    this.apiKey = apiKey;
    this.language = language;
    this.keyterms = [...BIBLE_KEYTERMS, ...keyterms].filter(Boolean).slice(0, 50);
    this.sampleRate = sampleRate;
    this.ws = null;
    this.running = false;
    this.retries = 0;
    this.lastAudioAt = 0;
    this.keepAlive = null;
    this.reconnectTimer = null;
  }

  url() {
    const p = new URLSearchParams({
      model: 'nova-3',
      language: this.language,
      encoding: 'linear16',
      sample_rate: String(this.sampleRate),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '300',
      utterance_end_ms: '1000',
    });
    for (const k of this.keyterms) p.append('keyterm', k);
    return `${DG_URL}?${p.toString()}`;
  }

  start() {
    this.running = true;
    this.connect();
  }

  connect() {
    this.emit('status', { state: this.retries ? 'reconnecting' : 'connecting' });
    const ws = new WebSocket(this.url(), { headers: { Authorization: `Token ${this.apiKey}` } });
    this.ws = ws;

    ws.on('open', () => {
      this.retries = 0;
      this.emit('status', { state: 'listening' });
      clearInterval(this.keepAlive);
      // Deepgram closes idle streams; keep it alive during silence / pauses.
      this.keepAlive = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && Date.now() - this.lastAudioAt > 4000) {
          ws.send(JSON.stringify({ type: 'KeepAlive' }));
        }
      }, 4000);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type === 'Results') {
        const alt = msg.channel?.alternatives?.[0];
        if (!alt) return;
        this.emit('result', {
          text: alt.transcript || '',
          confidence: alt.confidence ?? null,
          isFinal: !!msg.is_final,
          speechFinal: !!msg.speech_final,
          start: msg.start,
          duration: msg.duration,
        });
      } else if (msg.type === 'UtteranceEnd') {
        this.emit('utteranceEnd');
      } else if (msg.type === 'Error') {
        this.emit('error', { message: msg.description || msg.message || 'Deepgram error' });
      }
    });

    ws.on('unexpected-response', (req, res) => {
      const code = res.statusCode;
      const fatal = code === 400 || code === 401 || code === 402 || code === 403;
      const msg =
        code === 401 || code === 403 ? 'Deepgram rejected the API key. Check it in the Live tab.'
        : code === 402 ? 'Deepgram account is out of credit.'
        : code === 400 ? 'Deepgram did not accept the settings (400).'
        : `Deepgram is busy or unavailable (${code}). Retrying…`;
      res.resume();
      req.destroy();
      this.emit('error', { message: msg, fatal });
      if (fatal) {
        this.running = false;
        this.emit('status', { state: 'stopped' });
      } else {
        this.scheduleReconnect();
      }
    });

    ws.on('error', (err) => {
      this.emit('error', { message: `Connection problem: ${err.message}` });
    });

    ws.on('close', () => {
      clearInterval(this.keepAlive);
      if (ws !== this.ws) return; // an older socket
      if (!this.running) {
        this.emit('status', { state: 'stopped' });
        return;
      }
      this.scheduleReconnect();
    });
  }

  // Internet blip: try again with backoff (1s, 2s, 4s … max 15s)
  scheduleReconnect() {
    if (!this.running || this.reconnectTimer) return;
    this.retries += 1;
    const wait = Math.min(15000, 1000 * 2 ** (this.retries - 1));
    this.emit('status', { state: 'reconnecting', inMs: wait });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) this.connect();
    }, wait);
  }

  /** chunk: Buffer of 16-bit little-endian PCM */
  send(chunk) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
      this.lastAudioAt = Date.now();
    }
  }

  stop() {
    this.running = false;
    clearInterval(this.keepAlive);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const ws = this.ws;
    if (!ws) return this.emit('status', { state: 'stopped' });
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'CloseStream' })); } catch { /* closing anyway */ }
      setTimeout(() => ws.close(), 1500); // let the last words come back
    } else {
      ws.terminate();
    }
  }
}

/** Quick check that a key works: open a stream and close it. */
function testKey(apiKey) {
  return new Promise((resolve) => {
    const s = new DeepgramStream({ apiKey });
    let done = false;
    const finish = (r) => { if (!done) { done = true; s.stop(); resolve(r); } };
    s.on('status', (st) => st.state === 'listening' && finish({ ok: true }));
    s.on('error', (e) => finish({ ok: false, message: e.message }));
    setTimeout(() => finish({ ok: false, message: 'No answer from Deepgram (check the internet).' }), 10000);
    s.start();
  });
}

module.exports = { DeepgramStream, testKey, BIBLE_KEYTERMS };
