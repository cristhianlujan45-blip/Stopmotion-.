import { makeCanvas, fitContain, fitCover, clamp } from './util.js';
import { PREVIEW_MAX } from './framestore.js';

const CHROMA_W = 640;
const PEAK_W = 480;

/** Composites the stage: live view, frames, onion skin and assist overlays. */
export class Viewer {
  constructor({ area, stage, main, overlay, guides, loupe }) {
    this.area = area;
    this.stage = stage;
    this.main = main;
    this.overlay = overlay;
    this.guides = guides;
    this.loupe = loupe;
    this.ctx = main.getContext('2d');
    this.aspect = 16 / 9;
    this.onResize = () => {};

    this.work = makeCanvas(1, 1);
    this.wctx = this.work.getContext('2d', { willReadFrequently: true });
    this.peak = makeCanvas(1, 1);
    this.pctx = this.peak.getContext('2d', { willReadFrequently: true });
    this.peakOut = makeCanvas(1, 1);
    this.poctx = this.peakOut.getContext('2d');
    this.hist = makeCanvas(160, 90);
    this.hctx = this.hist.getContext('2d', { willReadFrequently: true });
    this.checker = null;

    new ResizeObserver(() => this.resize()).observe(area);
  }

  get W() { return this.main.width; }
  get H() { return this.main.height; }

  setSize(w, h) {
    if (!w || !h) return;
    this.aspect = w / h;
    const W = Math.min(PREVIEW_MAX, w);
    const H = Math.round(W / this.aspect);
    if (this.main.width !== W || this.main.height !== H) {
      this.main.width = W;
      this.main.height = H;
      this.checker = null;
    }
    this.resize();
  }

  resize() {
    const r = this.area.getBoundingClientRect();
    const pad = r.width < 600 ? 8 : 24;
    const top = 40;
    const aw = Math.max(50, r.width - pad * 2);
    const ah = Math.max(50, r.height - top - pad);
    let w = aw, h = w / this.aspect;
    if (h > ah) { h = ah; w = h * this.aspect; }
    w = Math.floor(w); h = Math.floor(h);
    this.stage.style.width = `${w}px`;
    this.stage.style.height = `${h}px`;
    this.stage.style.marginTop = `${top - pad}px`;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.overlay, this.guides]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.onResize();
  }

  clear(color = '#000') {
    this.ctx.save();
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.W, this.H);
    this.ctx.restore();
  }

  draw(src, sw, sh, { flipH = false, flipV = false, alpha = 1, op = 'source-over', filter = 'none' } = {}) {
    const { ctx, W, H } = this;
    const f = fitContain(sw, sh, W, H);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    if (filter !== 'none') ctx.filter = filter;
    if (flipH || flipV) {
      ctx.translate(flipH ? W : 0, flipV ? H : 0);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    }
    ctx.drawImage(src, f.x, f.y, f.w, f.h);
    ctx.restore();
  }

  checkerboard() {
    if (!this.checker) {
      const c = makeCanvas(32, 32);
      const x = c.getContext('2d');
      x.fillStyle = '#3a3d44'; x.fillRect(0, 0, 32, 32);
      x.fillStyle = '#2a2c31'; x.fillRect(0, 0, 16, 16); x.fillRect(16, 16, 16, 16);
      this.checker = this.ctx.createPattern(c, 'repeat');
    }
    return this.checker;
  }

  /** Keys out the chosen colour on the current composite, over `background`. */
  chroma({ color, threshold, softness }, background) {
    const { ctx, W, H } = this;
    const ww = Math.min(CHROMA_W, W);
    const wh = Math.round((ww * H) / W);
    if (this.work.width !== ww || this.work.height !== wh) { this.work.width = ww; this.work.height = wh; }
    const w = this.wctx;
    w.globalCompositeOperation = 'source-over';
    w.drawImage(this.main, 0, 0, ww, wh);
    const img = w.getImageData(0, 0, ww, wh);
    const d = img.data;
    const kr = parseInt(color.slice(1, 3), 16) / 255;
    const kg = parseInt(color.slice(3, 5), 16) / 255;
    const kb = parseInt(color.slice(5, 7), 16) / 255;
    const kcb = -0.168736 * kr - 0.331264 * kg + 0.5 * kb;
    const kcr = 0.5 * kr - 0.418688 * kg - 0.081312 * kb;
    const greenKey = kg >= kr && kg >= kb;
    const blueKey = kb > kr && kb > kg;
    const soft = Math.max(0.001, softness);
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const cb = -0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 0.5 * r - 0.418688 * g - 0.081312 * b;
      const dist = Math.hypot(cb - kcb, cr - kcr);
      const a = clamp((dist - threshold) / soft, 0, 1);
      if (a < 1) {
        // spill suppression
        if (greenKey) d[i + 1] = Math.min(d[i + 1], Math.max(d[i], d[i + 2]));
        else if (blueKey) d[i + 2] = Math.min(d[i + 2], Math.max(d[i], d[i + 1]));
      }
      d[i + 3] = a * 255;
    }
    w.putImageData(img, 0, 0);
    ctx.save();
    if (background) {
      const f = fitCover(background.width, background.height, W, H);
      ctx.drawImage(background, f.x, f.y, f.w, f.h);
    } else {
      ctx.fillStyle = this.checkerboard();
      ctx.fillRect(0, 0, W, H);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.work, 0, 0, W, H);
    ctx.restore();
  }

  /** Highlights in-focus edges (Sobel magnitude above threshold). */
  peaking(threshold = 60, color = [255, 40, 40]) {
    const { W, H } = this;
    const pw = Math.min(PEAK_W, W);
    const ph = Math.round((pw * H) / W);
    if (this.peak.width !== pw || this.peak.height !== ph) {
      this.peak.width = pw; this.peak.height = ph;
      this.peakOut.width = pw; this.peakOut.height = ph;
      this.peakImg = this.poctx.createImageData(pw, ph);
      this.gray = new Uint8Array(pw * ph);
    }
    this.pctx.drawImage(this.main, 0, 0, pw, ph);
    const src = this.pctx.getImageData(0, 0, pw, ph).data;
    const g = this.gray;
    for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = (src[i] * 77 + src[i + 1] * 150 + src[i + 2] * 29) >> 8;
    const out = this.peakImg.data;
    out.fill(0);
    const t = threshold * 4;
    for (let y = 1; y < ph - 1; y++) {
      const row = y * pw;
      for (let x = 1; x < pw - 1; x++) {
        const p = row + x;
        const tl = g[p - pw - 1], tc = g[p - pw], tr = g[p - pw + 1];
        const ml = g[p - 1], mr = g[p + 1];
        const bl = g[p + pw - 1], bc = g[p + pw], br = g[p + pw + 1];
        const gx = tr + 2 * mr + br - tl - 2 * ml - bl;
        const gy = bl + 2 * bc + br - tl - 2 * tc - tr;
        if (Math.abs(gx) + Math.abs(gy) > t) {
          const o = p * 4;
          out[o] = color[0]; out[o + 1] = color[1]; out[o + 2] = color[2]; out[o + 3] = 255;
        }
      }
    }
    this.poctx.putImageData(this.peakImg, 0, 0);
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.peakOut, 0, 0, W, H);
    this.ctx.restore();
  }

  /** Draws an RGB + luma histogram of the current composite. */
  histogram(target) {
    const hw = this.hist.width, hh = this.hist.height;
    this.hctx.drawImage(this.main, 0, 0, hw, hh);
    const d = this.hctx.getImageData(0, 0, hw, hh).data;
    const bins = 64;
    const r = new Uint32Array(bins), g = new Uint32Array(bins), b = new Uint32Array(bins), l = new Uint32Array(bins);
    for (let i = 0; i < d.length; i += 4) {
      r[d[i] >> 2]++; g[d[i + 1] >> 2]++; b[d[i + 2] >> 2]++;
      l[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 10]++;
    }
    let max = 1;
    for (let i = 1; i < bins - 1; i++) max = Math.max(max, r[i], g[i], b[i], l[i]);
    const ctx = target.getContext('2d');
    const W = target.width, H = target.height;
    ctx.clearRect(0, 0, W, H);
    const bw = W / bins;
    const plot = (arr, style, op) => {
      ctx.globalCompositeOperation = op;
      ctx.fillStyle = style;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < bins; i++) ctx.lineTo(i * bw + bw / 2, H - Math.min(1, arr[i] / max) * (H - 4));
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    };
    plot(l, 'rgba(220,220,220,0.35)', 'source-over');
    plot(r, 'rgba(255,60,60,0.55)', 'lighter');
    plot(g, 'rgba(60,255,60,0.45)', 'lighter');
    plot(b, 'rgba(60,110,255,0.55)', 'lighter');
    ctx.globalCompositeOperation = 'source-over';
    // clipping warnings
    const total = hw * hh;
    if (l[0] / total > 0.02) { ctx.fillStyle = '#3b82f6'; ctx.fillRect(0, 0, 4, H); }
    if (l[bins - 1] / total > 0.02) { ctx.fillStyle = '#ff4d3d'; ctx.fillRect(W - 4, 0, 4, H); }
  }

  /** Grid, framing masks and safe areas. */
  drawOverlays({ grid = 'none', mask = 'none', safe = false } = {}) {
    const c = this.overlay;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, w, h);

    let fx = 0, fy = 0, fw = w, fh = h;
    if (mask !== 'none') {
      const r = Number(mask);
      const a = w / h;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      if (r > a) {
        fh = w / r; fy = (h - fh) / 2;
        ctx.fillRect(0, 0, w, fy);
        ctx.fillRect(0, fy + fh, w, h - fy - fh);
      } else if (r < a) {
        fw = h * r; fx = (w - fw) / 2;
        ctx.fillRect(0, 0, fx, h);
        ctx.fillRect(fx + fw, 0, w - fx - fw, h);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = dpr;
      ctx.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = dpr;
    const lines = (n) => {
      ctx.beginPath();
      for (let i = 1; i < n; i++) {
        const x = Math.round(fx + (fw * i) / n) + 0.5;
        const y = Math.round(fy + (fh * i) / n) + 0.5;
        ctx.moveTo(x, fy); ctx.lineTo(x, fy + fh);
        ctx.moveTo(fx, y); ctx.lineTo(fx + fw, y);
      }
      ctx.stroke();
    };
    if (grid === 'thirds') lines(3);
    else if (grid === 'quarters') lines(4);
    else if (grid === 'fine') { ctx.strokeStyle = 'rgba(255,255,255,0.22)'; lines(8); }
    else if (grid === 'center') {
      const cx = fx + fw / 2, cy = fy + fh / 2, s = Math.min(fw, fh) * 0.04;
      ctx.beginPath();
      ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
      ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
      ctx.stroke();
    }

    if (safe) {
      ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(255,220,80,0.6)';
      for (const p of [0.9, 0.8]) {
        const sw = fw * p, sh = fh * p;
        ctx.strokeRect(fx + (fw - sw) / 2, fy + (fh - sh) / 2, sw, sh);
      }
      ctx.setLineDash([]);
    }
  }

  /** Strokes are stored in normalised (0…1) stage coordinates. */
  drawGuides(strokes, visible, active) {
    const c = this.guides;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    if (!visible) return;
    const dpr = window.devicePixelRatio || 1;
    const all = active ? [...strokes, active] : strokes;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const s of all) {
      if (!s.points.length) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width * dpr;
      ctx.beginPath();
      const [x0, y0] = s.points[0];
      ctx.moveTo(x0 * c.width, y0 * c.height);
      if (s.points.length === 1) ctx.lineTo(x0 * c.width + 0.1, y0 * c.height);
      for (let i = 1; i < s.points.length; i++) {
        const [x, y] = s.points[i];
        ctx.lineTo(x * c.width, y * c.height);
      }
      ctx.stroke();
    }
  }

  /**
   * Magnifier showing the source at native resolution.
   * `u`,`v` are normalised stage coordinates of the pointer.
   */
  drawLoupe(clientX, clientY, u, v, source, sw, sh, { flipH = false, flipV = false } = {}) {
    const L = this.loupe;
    const areaRect = this.area.getBoundingClientRect();
    L.style.left = `${clientX - areaRect.left - L.offsetWidth / 2}px`;
    L.style.top = `${clientY - areaRect.top - L.offsetHeight / 2}px`;
    const ctx = L.getContext('2d');
    const size = L.width;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);
    if (!source) return;
    const f = fitContain(sw, sh, this.W, this.H);
    let mx = u * this.W, my = v * this.H;
    if (flipH) mx = this.W - mx;
    if (flipV) my = this.H - my;
    const sx = ((mx - f.x) / f.w) * sw;
    const sy = ((my - f.y) / f.h) * sh;
    const zoom = 2;
    const region = size / zoom;
    ctx.save();
    if (flipH || flipV) {
      ctx.translate(flipH ? size : 0, flipV ? size : 0);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, sx - region / 2, sy - region / 2, region, region, 0, 0, size, size);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(size / 2 - 10, size / 2 + 0.5); ctx.lineTo(size / 2 + 10, size / 2 + 0.5);
    ctx.moveTo(size / 2 + 0.5, size / 2 - 10); ctx.lineTo(size / 2 + 0.5, size / 2 + 10);
    ctx.stroke();
  }
}
