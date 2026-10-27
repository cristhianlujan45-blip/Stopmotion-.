const PEAKS_PER_SECOND = 200;

/** Colour of each track in the timeline, in order. */
export const TRACK_COLORS = ['#ffb020', '#4cc3ff', '#c08cff', '#5ee08a', '#ff7a9a', '#f5e050'];

/**
 * Sound of a scene: several tracks (dialogue, music, effects), each with its
 * own start exposure, volume and mute, mixed for playback, scrubbing and export.
 * A track is { id, blobId, name, offset (exposure where it starts), volume, muted }.
 */
export class AudioMix {
  constructor() {
    this.ctx = null;
    this.decoded = new Map(); // blobId → { buffer, peaks }
    this.tracks = [];
    this.fps = 12;
    this.nodes = [];
  }

  context() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /** Decodes a sound file once. Throws if the format is not supported. */
  async decode(blobId, blob) {
    const buffer = await this.context().decodeAudioData(await blob.arrayBuffer());
    this.decoded.set(blobId, { buffer, peaks: computePeaks(buffer) });
    return buffer.duration;
  }

  has(blobId) { return this.decoded.has(blobId); }
  durationOf(blobId) { return this.decoded.get(blobId)?.buffer.duration || 0; }
  peaksOf(blobId) { return this.decoded.get(blobId)?.peaks || null; }

  /** The tracks to play (the project's own array, so edits apply at once) and the frame rate of their offsets. */
  setTracks(tracks, fps) {
    this.stop();
    this.tracks = tracks;
    this.fps = fps;
    for (const id of [...this.decoded.keys()]) if (!tracks.some((t) => t.blobId === id)) this.decoded.delete(id);
  }

  clear() {
    this.stop();
    this.decoded.clear();
    this.tracks = [];
  }

  audible() {
    return this.tracks.filter((t) => this.decoded.has(t.blobId) && !t.muted && (t.volume ?? 1) > 0);
  }

  /** True when there is something to hear. */
  get ready() { return this.audible().length > 0; }

  /** Where the last sound ends, in seconds from exposure 0. */
  get duration() {
    let end = 0;
    for (const t of this.tracks) if (this.decoded.has(t.blobId)) end = Math.max(end, (t.offset || 0) / this.fps + this.durationOf(t.blobId));
    return end;
  }

  /** Starts each audible track at `atSeconds` of the timeline (exposure 0 = 0 s). */
  _start(ctx, atSeconds, destination, { rate = 1, when = ctx.currentTime, duration = null, fade = false } = {}) {
    const started = [];
    for (const t of this.audible()) {
      const { buffer } = this.decoded.get(t.blobId);
      const at = atSeconds - (t.offset || 0) / this.fps; // position inside this file
      if (at >= buffer.duration || (duration != null && at + duration <= 0)) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      const volume = t.volume ?? 1;
      gain.gain.setValueAtTime(volume, when);
      if (fade && duration) {
        gain.gain.setValueAtTime(volume, when + duration * 0.85);
        gain.gain.linearRampToValueAtTime(0, when + duration);
      }
      src.connect(gain).connect(destination);
      if (at >= 0) src.start(when, at, duration ?? undefined);
      else src.start(when - at / rate, 0, duration != null ? duration + at : undefined);
      started.push(src, gain);
    }
    return started;
  }

  /** Plays from `atSeconds` of the timeline. `rate` < 1 plays slower, staying in sync with slow review. */
  play(atSeconds, destination, rate = 1) {
    this.stop();
    const ctx = this.context();
    this.nodes = this._start(ctx, atSeconds, destination || ctx.destination, { rate });
  }

  stop() {
    for (const n of this.nodes) {
      try { n.stop?.(); } catch { /* already stopped */ }
      n.disconnect();
    }
    this.nodes = [];
  }

  /** Plays a short slice, used when stepping frame by frame. */
  scrub(atSeconds, duration) {
    if (!this.ready) return;
    const ctx = this.context();
    this._start(ctx, atSeconds, ctx.destination, { duration, fade: true });
  }

  /**
   * The audible tracks mixed to stereo, from `startSeconds` of the timeline and
   * `durationSeconds` long, for export.
   */
  async mixdown(startSeconds, durationSeconds, sampleRate = 48000) {
    const length = Math.max(1, Math.ceil(durationSeconds * sampleRate));
    const off = new OfflineAudioContext(2, length, sampleRate);
    this._start(off, startSeconds, off.destination, { when: 0 });
    return off.startRendering();
  }

  /** Synthesized shutter click. */
  shutter() {
    const ctx = this.context();
    const len = Math.floor(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = i < len * 0.08 ? 1 : Math.exp(-(i - len * 0.08) / (len * 0.12));
      d[i] = (Math.random() * 2 - 1) * env * 0.5;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2600;
    filter.Q.value = 0.8;
    src.connect(filter).connect(ctx.destination);
    src.start();
  }
}

/**
 * Draws the waveforms of several tracks on top of each other, aligned to the exposure grid.
 * @param {{ peaks: Float32Array, offset: number, color: string, muted?: boolean }[]} layers
 */
export function drawWaveforms(canvas, layers, pxPerExposure, fps, cssWidth) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.min(16000, Math.round(cssWidth * dpr));
  const H = Math.round(44 * dpr);
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = `${cssWidth}px`;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const scale = W / cssWidth;
  const pxPerSecond = pxPerExposure * fps * scale;
  const mid = H / 2;
  for (const { peaks, offset, color, muted } of layers) {
    if (!peaks) continue;
    const offsetPx = offset * pxPerExposure * scale;
    ctx.fillStyle = color;
    ctx.globalAlpha = muted ? 0.25 : 0.8;
    for (let x = Math.max(0, Math.floor(offsetPx)); x < W; x++) {
      const t0 = (x - offsetPx) / pxPerSecond;
      const t1 = (x + 1 - offsetPx) / pxPerSecond;
      const i0 = Math.max(0, Math.floor(t0 * PEAKS_PER_SECOND));
      const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(t1 * PEAKS_PER_SECOND)));
      if (i0 >= peaks.length) break;
      let m = 0;
      for (let i = i0; i < i1; i++) if (peaks[i] > m) m = peaks[i];
      const h = Math.max(1, m * (H - 4));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }
  ctx.globalAlpha = 1;
  // exposure ticks
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  const step = pxPerExposure * scale;
  if (step >= 6) for (let x = 0; x < W; x += step) ctx.fillRect(Math.round(x), 0, 1, H);
}

/** 16-bit PCM WAV file from channel data (values outside −1…1 are clipped). */
export function encodeWav(channels, sampleRate) {
  const n = channels[0]?.length || 0;
  const ch = channels.length;
  const bytes = new Uint8Array(44 + n * ch * 2);
  const v = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  v.setUint32(4, 36 + n * ch * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, n * ch * 2, true);
  let at = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(at, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
      at += 2;
    }
  }
  return bytes;
}

/** Loudness of each exposure of a sound (RMS, 0…1), and how noisy it is (zero crossings per sample). */
export function exposureLevels(samples, sampleRate, fps) {
  const per = sampleRate / fps;
  const n = Math.ceil(samples.length / per);
  const out = [];
  for (let e = 0; e < n; e++) {
    const a = Math.floor(e * per), b = Math.min(samples.length, Math.floor((e + 1) * per));
    let sum = 0, zc = 0;
    for (let i = a; i < b; i++) {
      sum += samples[i] * samples[i];
      if (i > a && (samples[i] >= 0) !== (samples[i - 1] >= 0)) zc++;
    }
    const len = Math.max(1, b - a);
    out.push({ rms: Math.sqrt(sum / len), zcr: zc / len });
  }
  return out;
}

function computePeaks(buffer) {
  const block = Math.max(1, Math.floor(buffer.sampleRate / PEAKS_PER_SECOND));
  const n = Math.ceil(buffer.length / block);
  const peaks = new Float32Array(n);
  const channels = [];
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c));
  let max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(buffer.length, (i + 1) * block);
    for (const ch of channels) {
      for (let s = i * block; s < end; s++) {
        const v = Math.abs(ch[s]);
        if (v > m) m = v;
      }
    }
    peaks[i] = m;
    if (m > max) max = m;
  }
  if (max > 0) for (let i = 0; i < n; i++) peaks[i] /= max;
  return peaks;
}
