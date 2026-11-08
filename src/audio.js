// Microphone capture: 16 kHz mono 16-bit PCM in 100 ms chunks, plus a level meter.
const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  constructor() { super(); this.size = 1600; this.buf = new Int16Array(this.size); this.n = 0; this.sum = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      this.sum += v * v;
      if (this.n === this.size) {
        const rms = Math.sqrt(this.sum / this.size);
        this.port.postMessage({ pcm: this.buf.buffer, rms }, [this.buf.buffer]);
        this.buf = new Int16Array(this.size); this.n = 0; this.sum = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

export async function listMics() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

/**
 * @param {{deviceId?: string, noiseSuppression?: boolean, onChunk: (buf: ArrayBuffer) => void, onLevel?: (rms: number) => void}} o
 */
export async function startMic({ deviceId, noiseSuppression = true, onChunk, onLevel }) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression,
      autoGainControl: true,
    },
  });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const src = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, 'pcm-tap');
  const mute = ctx.createGain();
  mute.gain.value = 0; // keep the graph running without playing the mic out loud
  tap.port.onmessage = (e) => {
    onChunk(e.data.pcm);
    onLevel?.(e.data.rms);
  };
  src.connect(tap).connect(mute).connect(ctx.destination);
  const track = stream.getAudioTracks()[0];
  return {
    label: track?.label || 'Microphone',
    stop() {
      try { src.disconnect(); tap.disconnect(); } catch { /* already */ }
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
