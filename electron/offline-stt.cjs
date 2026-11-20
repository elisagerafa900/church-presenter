// Free, offline speech-to-text on this PC (sherpa-onnx).
// Same events as the Deepgram stream: 'status', 'result', 'error'.
// Silero VAD cuts the sermon into phrases at natural pauses; each phrase is transcribed.
const { EventEmitter } = require('node:events');
const os = require('node:os');
const models = require('./models.cjs');

let sherpa = null;
function lib() {
  if (!sherpa) {
    try {
      sherpa = require('sherpa-onnx-node');
    } catch (e) {
      throw new Error('The offline speech engine is missing from this build. On the build PC run "npm.cmd install", then build again. (' + e.message.split('\n')[0] + ')');
    }
  }
  return sherpa;
}

// Keep the loaded model between Start/Stop presses (loading takes a few seconds).
const cache = { id: null, recognizer: null };

const SAMPLE_RATE = 16000;
const WINDOW = 512; // silero VAD window
// While someone is speaking, the last few seconds are re-read this often, so words
// (and scripture references) appear while the sentence is still going.
const PARTIAL_EVERY_MS = 450;
const PARTIAL_MAX_SECONDS = 5;
const PREROLL = Math.round(SAMPLE_RATE * 0.4);

class OfflineStream extends EventEmitter {
  constructor({ model = 'parakeet' } = {}) {
    super();
    this.modelId = model;
    this.running = false;
    this.vad = null;
    this.pending = new Float32Array(0);
    this.queue = Promise.resolve();
    this.backlog = 0;
    this.speaking = false;
    this.live = []; // Float32Array chunks of the phrase being spoken
    this.liveLen = 0;
    this.recent = new Float32Array(0); // short pre-roll before speech is detected
    this.lastPartial = 0;
    this.partialBusy = false;
  }

  async start() {
    this.running = true;
    try {
      if (!models.isInstalled(this.modelId)) throw new Error('The offline model is not installed yet. Download it in Live → ⚙.');
      const so = lib();
      if (cache.id !== this.modelId) {
        this.emit('status', { state: 'loading' });
        const d = models.modelPath(this.modelId);
        cache.recognizer = await so.OfflineRecognizer.createAsync({
          featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
          modelConfig: {
            ...models.MODELS[this.modelId].config(d),
            numThreads: Math.max(1, Math.min(4, os.cpus().length - 1)),
            provider: 'cpu',
            debug: 0,
          },
        });
        cache.id = this.modelId;
      }
      this.vad = new so.Vad(
        {
          sileroVad: {
            model: models.vadPath(),
            threshold: 0.5,
            minSilenceDuration: 0.3, // a short pause ends a phrase
            minSpeechDuration: 0.25,
            maxSpeechDuration: 8, // preachers rarely pause: cut long runs anyway
            windowSize: WINDOW,
          },
          sampleRate: SAMPLE_RATE,
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
        },
        60,
      );
      if (!this.running) return;
      this.emit('status', { state: 'listening' });
    } catch (e) {
      this.running = false;
      this.emit('error', { message: e.message, fatal: true });
      this.emit('status', { state: 'stopped' });
    }
  }

  /** chunk: Buffer of 16-bit PCM, 16 kHz mono */
  send(chunk) {
    if (!this.running || !this.vad) return;
    const n = chunk.length >> 1;
    const merged = new Float32Array(this.pending.length + n);
    merged.set(this.pending);
    for (let i = 0; i < n; i++) merged[this.pending.length + i] = chunk.readInt16LE(i * 2) / 32768;
    let off = 0;
    while (merged.length - off >= WINDOW) {
      this.vad.acceptWaveform(merged.subarray(off, off + WINDOW));
      off += WINDOW;
    }
    this.pending = merged.slice(off);

    const fresh = merged.subarray(merged.length - n); // the audio that just arrived
    const detected = this.vad.isDetected();
    if (detected && !this.speaking) {
      this.emit('result', { text: '…', isFinal: false });
      // start the live phrase with a little audio from just before speech was detected
      this.live = [this.recent.slice()];
      this.liveLen = this.recent.length;
    }
    if (detected) {
      this.live.push(Float32Array.from(fresh));
      this.liveLen += fresh.length;
      // never keep more than needed for a partial
      while (this.live.length > 1 && this.liveLen - this.live[0].length > SAMPLE_RATE * PARTIAL_MAX_SECONDS) this.liveLen -= this.live.shift().length;
    }
    // keep a short pre-roll of the latest audio
    const both = new Float32Array(this.recent.length + fresh.length);
    both.set(this.recent);
    both.set(fresh, this.recent.length);
    this.recent = both.slice(Math.max(0, both.length - PREROLL));
    this.speaking = detected;
    this.drain();
    if (this.speaking) this.partial();
  }

  /** Re-read the phrase being spoken (its last few seconds) and send it as a partial result. */
  partial() {
    const now = Date.now();
    if (this.partialBusy || this.backlog > 0 || now - this.lastPartial < PARTIAL_EVERY_MS) return;
    if (this.liveLen < SAMPLE_RATE * 0.6) return;
    this.lastPartial = now;
    this.partialBusy = true;
    const max = SAMPLE_RATE * PARTIAL_MAX_SECONDS;
    const len = Math.min(this.liveLen, max);
    const samples = new Float32Array(len);
    let pos = len;
    for (let i = this.live.length - 1; i >= 0 && pos > 0; i--) {
      const c = this.live[i];
      const take = Math.min(c.length, pos);
      samples.set(c.subarray(c.length - take), pos - take);
      pos -= take;
    }
    // same queue as finished phrases, so two decodes never run at once
    this.queue = this.queue.then(async () => {
      try {
        const rec = cache.recognizer;
        const stream = rec.createStream();
        stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
        const res = await rec.decodeAsync(stream);
        const text = (res?.text || '').trim();
        // a finished phrase may have arrived meanwhile; then this partial is stale
        if (text && this.running && this.speaking) this.emit('result', { text, isFinal: false });
      } catch { /* a skipped partial is harmless */ } finally {
        this.partialBusy = false;
      }
    });
  }

  drain() {
    while (!this.vad.isEmpty()) {
      const seg = this.vad.front(false);
      this.vad.pop();
      const samples = Float32Array.from(seg.samples);
      this.transcribe(samples);
      this.live = []; this.liveLen = 0;
    }
  }

  transcribe(samples) {
    this.backlog += 1;
    if (this.backlog > 4) this.emit('status', { state: 'listening', behind: true });
    this.queue = this.queue.then(async () => {
      try {
        const rec = cache.recognizer;
        const stream = rec.createStream();
        stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
        const r = await rec.decodeAsync(stream);
        const text = (r?.text || '').trim();
        if (text) this.emit('result', { text, isFinal: true, speechFinal: true, confidence: null });
      } catch (e) {
        this.emit('error', { message: `Offline transcription error: ${e.message}` });
      } finally {
        this.backlog -= 1;
      }
    });
  }

  stop() {
    const wasRunning = this.running;
    this.running = false;
    if (this.vad && wasRunning) {
      try {
        this.vad.flush();
        this.drain();
      } catch { /* ignore */ }
    }
    this.queue.then(() => this.emit('status', { state: 'stopped' }));
  }
}

module.exports = { OfflineStream };
