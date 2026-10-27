const PEAKS_PER_SECOND = 200;

/** Soundtrack for lip-sync: decoding, waveform peaks, playback and scrubbing. */
export class AudioTrack {
  constructor() {
    this.ctx = null;
    this.buffer = null;
    this.peaks = null;
    this.source = null;
  }

  get ready() { return !!this.buffer; }
  get duration() { return this.buffer?.duration || 0; }

  context() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  async load(blob) {
    const data = await blob.arrayBuffer();
    this.buffer = await this.context().decodeAudioData(data);
    this.peaks = computePeaks(this.buffer);
  }

  clear() {
    this.stop();
    this.buffer = null;
    this.peaks = null;
  }

  /** Plays from `atSeconds` (negative = start after a delay). */
  /** Plays from `atSeconds` (negative: starts after a delay). `rate` < 1 plays slower, staying in sync with slow review. */
  play(atSeconds, destination, rate = 1) {
    this.stop();
    if (!this.buffer) return;
    const ctx = this.context();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = rate;
    src.connect(destination || ctx.destination);
    if (atSeconds >= 0) {
      if (atSeconds >= this.buffer.duration) return;
      src.start(0, atSeconds);
    } else {
      src.start(ctx.currentTime - atSeconds / rate, 0);
    }
    this.source = src;
  }

  stop() {
    try { this.source?.stop(); } catch { /* already stopped */ }
    this.source?.disconnect();
    this.source = null;
  }

  /** Plays a short slice, used when stepping frame by frame. */
  scrub(atSeconds, duration) {
    if (!this.buffer || atSeconds < 0 || atSeconds >= this.buffer.duration) return;
    const ctx = this.context();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(1, t);
    gain.gain.setValueAtTime(1, t + duration * 0.85);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    src.connect(gain).connect(ctx.destination);
    src.start(t, atSeconds, duration);
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

  /**
   * Draws the waveform aligned to the exposure grid.
   * @param {HTMLCanvasElement} canvas
   * @param {number} pxPerExposure CSS pixels per exposure
   * @param {number} fps
   * @param {number} offset exposure at which the audio starts
   * @param {number} cssWidth
   */
  drawWaveform(canvas, pxPerExposure, fps, offset, cssWidth) {
    const dpr = window.devicePixelRatio || 1;
    const maxW = 16000;
    const W = Math.min(maxW, Math.round(cssWidth * dpr));
    const H = Math.round(44 * dpr);
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = `${cssWidth}px`;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (!this.peaks) return;
    const scale = W / cssWidth;
    const pxPerSecond = pxPerExposure * fps * scale;
    const offsetPx = offset * pxPerExposure * scale;
    const mid = H / 2;
    ctx.fillStyle = 'rgba(255, 176, 32, 0.85)';
    const peaks = this.peaks;
    for (let x = 0; x < W; x++) {
      const t0 = (x - offsetPx) / pxPerSecond;
      const t1 = (x + 1 - offsetPx) / pxPerSecond;
      if (t1 <= 0) continue;
      const i0 = Math.max(0, Math.floor(t0 * PEAKS_PER_SECOND));
      const i1 = Math.min(peaks.length, Math.max(i0 + 1, Math.ceil(t1 * PEAKS_PER_SECOND)));
      if (i0 >= peaks.length) break;
      let m = 0;
      for (let i = i0; i < i1; i++) if (peaks[i] > m) m = peaks[i];
      const h = Math.max(1, m * (H - 4));
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
    // exposure ticks
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    const step = pxPerExposure * scale;
    if (step >= 6) for (let x = 0; x < W; x += step) ctx.fillRect(Math.round(x), 0, 1, H);
  }
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
