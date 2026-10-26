import { makeCanvas } from './util.js';

const LABELS = {
  exposureMode: 'Modo de exposición',
  exposureTime: 'Tiempo de exposición',
  exposureCompensation: 'Compensación de exposición',
  iso: 'ISO',
  focusMode: 'Modo de enfoque',
  focusDistance: 'Distancia de enfoque',
  whiteBalanceMode: 'Balance de blancos',
  colorTemperature: 'Temperatura de color (K)',
  brightness: 'Brillo',
  contrast: 'Contraste',
  saturation: 'Saturación',
  sharpness: 'Nitidez',
  zoom: 'Zoom',
  pan: 'Paneo',
  tilt: 'Inclinación',
  backlightCompensation: 'Compensación de contraluz',
  torch: 'Luz',
};

const MODE_LABELS = {
  manual: 'Manual',
  continuous: 'Automático continuo',
  'single-shot': 'Automático (una vez)',
  none: 'Ninguno',
};

// Setting one of these values only works when its mode is set to manual.
const MANUAL_MODE_FOR = {
  exposureTime: 'exposureMode',
  iso: 'exposureMode',
  focusDistance: 'focusMode',
  colorTemperature: 'whiteBalanceMode',
};

export function applyFlip(ctx, w, h, flipH, flipV) {
  if (!flipH && !flipV) return;
  ctx.translate(flipH ? w : 0, flipV ? h : 0);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
}

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.track = null;
    this.onEnded = () => {};
  }

  static get supported() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  static async listDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  get active() {
    return !!this.track && this.track.readyState === 'live' && this.video.videoWidth > 0;
  }

  get width() { return this.video.videoWidth; }
  get height() { return this.video.videoHeight; }

  async start({ deviceId, width = 1920, height = 1080 } = {}) {
    this.stop();
    const video = {
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30 },
    };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = { ideal: 'environment' }; // rear camera on phones
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
    } catch (err) {
      if (deviceId && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
        delete video.deviceId;
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video });
      } else {
        throw err;
      }
    }
    this.stream = stream;
    this.track = stream.getVideoTracks()[0];
    this.track.addEventListener('ended', () => this.onEnded());
    this.video.srcObject = stream;
    await this.video.play().catch(() => {});
    if (!this.video.videoWidth) {
      await new Promise((resolve) => {
        const done = () => { this.video.removeEventListener('loadedmetadata', done); resolve(); };
        this.video.addEventListener('loadedmetadata', done);
        setTimeout(done, 3000);
      });
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.video.srcObject = null;
  }

  info() {
    if (!this.track) return '';
    const s = this.track.getSettings?.() || {};
    const fps = s.frameRate ? ` @ ${Math.round(s.frameRate)} fps` : '';
    return `${this.width} × ${this.height}${fps} · ${this.track.label || 'Cámara'}`;
  }

  capabilities() {
    try { return this.track?.getCapabilities?.() || {}; } catch { return {}; }
  }

  settings() {
    try { return this.track?.getSettings?.() || {}; } catch { return {}; }
  }

  /** Describes the hardware controls this camera exposes, for building UI. */
  describeControls() {
    const caps = this.capabilities();
    const settings = this.settings();
    const controls = [];
    for (const key of Object.keys(LABELS)) {
      const cap = caps[key];
      if (cap == null) continue;
      if (Array.isArray(cap)) {
        if (key === 'torch') continue;
        if (cap.length < 2) continue;
        controls.push({
          key, label: LABELS[key], type: 'select',
          options: cap.map((v) => ({ value: v, label: MODE_LABELS[v] || v })),
          value: settings[key] ?? cap[0],
        });
      } else if (typeof cap === 'object' && 'max' in cap && cap.max > cap.min) {
        controls.push({
          key, label: LABELS[key], type: 'range',
          min: cap.min, max: cap.max, step: cap.step || (cap.max - cap.min) / 100,
          value: settings[key] ?? cap.min,
        });
      } else if (key === 'torch' && cap === true) {
        controls.push({ key, label: LABELS[key], type: 'toggle', value: !!settings.torch });
      }
    }
    return controls;
  }

  async applyControl(key, value) {
    if (!this.track) return;
    const caps = this.capabilities();
    const constraint = { [key]: value };
    const modeKey = MANUAL_MODE_FOR[key];
    if (modeKey && Array.isArray(caps[modeKey]) && caps[modeKey].includes('manual')) constraint[modeKey] = 'manual';
    await this.track.applyConstraints({ advanced: [constraint] });
  }

  /** Freezes auto exposure, focus and white balance at their current values. */
  async lockAuto() {
    if (!this.track) return false;
    const caps = this.capabilities();
    const s = this.settings();
    const c = {};
    const manual = (k) => Array.isArray(caps[k]) && caps[k].includes('manual');
    if (manual('exposureMode')) { c.exposureMode = 'manual'; if (s.exposureTime != null) c.exposureTime = s.exposureTime; }
    if (manual('whiteBalanceMode')) { c.whiteBalanceMode = 'manual'; if (s.colorTemperature != null) c.colorTemperature = s.colorTemperature; }
    if (manual('focusMode')) { c.focusMode = 'manual'; if (s.focusDistance != null) c.focusDistance = s.focusDistance; }
    if (!Object.keys(c).length) return false;
    await this.track.applyConstraints({ advanced: [c] });
    return true;
  }

  async resetAuto() {
    if (!this.track) return false;
    const caps = this.capabilities();
    const c = {};
    for (const k of ['exposureMode', 'whiteBalanceMode', 'focusMode']) {
      if (Array.isArray(caps[k]) && caps[k].includes('continuous')) c[k] = 'continuous';
    }
    if (!Object.keys(c).length) return false;
    await this.track.applyConstraints({ advanced: [c] });
    return true;
  }

  nextFrame() {
    return new Promise((resolve) => {
      if (this.video.requestVideoFrameCallback) this.video.requestVideoFrameCallback(() => resolve());
      else setTimeout(resolve, 34);
    });
  }

  /**
   * Grabs a full-resolution still. With `average` > 1, several consecutive
   * frames are averaged to reduce sensor noise.
   */
  async grab({ average = 1, flipH = false, flipV = false } = {}) {
    const v = this.video;
    const w = v.videoWidth, h = v.videoHeight;
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: average > 1 });
    const draw = () => {
      ctx.save();
      applyFlip(ctx, w, h, flipH, flipV);
      ctx.drawImage(v, 0, 0, w, h);
      ctx.restore();
    };
    const n = Math.min(16, Math.max(1, Math.floor(average)));
    if (n === 1) { draw(); return canvas; }

    const sum = new Uint16Array(w * h * 4);
    for (let k = 0; k < n; k++) {
      await this.nextFrame();
      draw();
      const d = ctx.getImageData(0, 0, w, h).data;
      for (let i = 0; i < d.length; i++) sum[i] += d[i];
    }
    const out = ctx.createImageData(w, h);
    const o = out.data;
    const half = n >> 1;
    for (let i = 0; i < o.length; i++) o[i] = (sum[i] + half) / n;
    ctx.putImageData(out, 0, 0);
    return canvas;
  }
}
