// Shooting assistant: compares each new photo with the frame before it and
// warns about common accidents (camera bumped, light changed, double shot,
// something entering at the edge, focus lost). It only reads images: it never
// changes, moves or deletes a photo.

/** Analysis width in pixels; images are scaled to this before comparing. */
export const ANALYSIS_W = 320;

/** Threshold multipliers: «alta» warns about smaller problems, «baja» only about big ones. */
export const SENSITIVITY = { low: 2, normal: 1, high: 0.5 };

const GRID = 8;            // blocks per side for robust, local statistics
const RING = 0.2;          // outer 20 % of the frame: the background, rarely animated
const MAX_SHIFT = 5;       // camera shift search, in pixels of the half-size image (≈3 % of the width)

/** Rec.601 luma of RGBA pixel data. */
export function grayOf(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114;
  return { g, w, h };
}

function half({ g, w, h }) {
  const hw = w >> 1, hh = h >> 1;
  const out = new Float32Array(hw * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < hw; x++) {
      const i = 2 * y * w + 2 * x;
      out[y * hw + x] = (g[i] + g[i + 1] + g[i + w] + g[i + w + 1]) / 4;
    }
  }
  return { g: out, w: hw, h: hh };
}

/** Mean of each GRID×GRID block. */
function blockMeans({ g, w, h }) {
  const sums = new Float64Array(GRID * GRID), counts = new Uint32Array(GRID * GRID);
  for (let y = 0; y < h; y++) {
    const by = Math.min(GRID - 1, Math.floor((y * GRID) / h));
    for (let x = 0; x < w; x++) {
      const b = by * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / w));
      sums[b] += g[y * w + x];
      counts[b]++;
    }
  }
  return Array.from(sums, (s, i) => (counts[i] ? s / counts[i] : 0));
}

const median = (arr) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[s.length >> 1];
};

/**
 * Overall light change between two images, robust to the animated part: the
 * median of the per-block brightness ratios. 1 = same light.
 */
export function lightRatio(a, b) {
  const ma = blockMeans(a), mb = blockMeans(b);
  const ratios = [];
  for (let i = 0; i < ma.length; i++) if (ma[i] > 8 && mb[i] > 8) ratios.push(mb[i] / ma[i]);
  return ratios.length ? median(ratios) : 1;
}

function gradient({ g, w, h }) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      out[i] = Math.abs(g[i + 1] - g[i]) + Math.abs(g[i + w] - g[i]);
    }
  }
  return { g: out, w, h };
}

const inRing = (x, y, w, h) => x < w * RING || x >= w * (1 - RING) || y < h * RING || y >= h * (1 - RING);

/** Mean absolute difference over the ring when `b` is displaced by (dx, dy). */
function ringSAD(a, b, dx, dy) {
  const { w, h } = a;
  let sum = 0, n = 0;
  for (let y = Math.max(0, -dy); y < Math.min(h, h - dy); y++) {
    for (let x = Math.max(0, -dx); x < Math.min(w, w - dx); x++) {
      if (!inRing(x, y, w, h)) continue;
      sum += Math.abs(a.g[y * w + x] - b.g[(y + dy) * w + x + dx]);
      n++;
    }
  }
  return n ? sum / n : Infinity;
}

/** Sub-pixel offset of a parabola's minimum through three samples. */
const vertex = (l, c, r) => {
  const den = l - 2 * c + r;
  return den > 0 ? Math.max(-0.5, Math.min(0.5, (l - r) / (2 * den))) : 0;
};

/**
 * How far the camera moved between `a` and `b`, measured on the background
 * edges at half resolution. Returns the shift as a fraction of the width and
 * height, and how much better the shifted match is than no shift (0…1).
 */
export function cameraShift(a, b) {
  const ga = gradient(half(a)), gb = gradient(half(b));
  const texture = ringMean(ga);
  let best = { dx: 0, dy: 0, sad: ringSAD(ga, gb, 0, 0) };
  const zero = best.sad;
  const table = new Map();
  for (let dy = -MAX_SHIFT; dy <= MAX_SHIFT; dy++) {
    for (let dx = -MAX_SHIFT; dx <= MAX_SHIFT; dx++) {
      const sad = dx || dy ? ringSAD(ga, gb, dx, dy) : zero;
      table.set(`${dx},${dy}`, sad);
      if (sad < best.sad) best = { dx, dy, sad };
    }
  }
  const at = (dx, dy) => table.get(`${dx},${dy}`) ?? best.sad;
  const fx = best.dx + vertex(at(best.dx - 1, best.dy), best.sad, at(best.dx + 1, best.dy));
  const fy = best.dy + vertex(at(best.dx, best.dy - 1), best.sad, at(best.dx, best.dy + 1));
  return {
    x: fx / ga.w, y: fy / ga.h,
    gain: zero > 0 ? (zero - best.sad) / zero : 0,
    texture,
  };
}

function ringMean({ g, w, h }) {
  let sum = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inRing(x, y, w, h)) { sum += g[y * w + x]; n++; }
  return n ? sum / n : 0;
}

/** Mean squared gradient of each block: higher is sharper. */
function blockSharpness({ g, w, h }) {
  const sums = new Float64Array(GRID * GRID), counts = new Uint32Array(GRID * GRID);
  for (let y = 0; y < h - 1; y++) {
    const by = Math.min(GRID - 1, Math.floor((y * GRID) / h));
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x;
      const gx = g[i + 1] - g[i], gy = g[i + w] - g[i];
      const k = by * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / w));
      sums[k] += gx * gx + gy * gy;
      counts[k]++;
    }
  }
  return Array.from(sums, (s, i) => (counts[i] ? s / counts[i] : 0));
}

/**
 * Change in sharpness between two images (1 = same), robust to the animated
 * part: blur from lost focus affects every textured block, a moving puppet only a few.
 */
export function sharpnessRatio(a, b, light = 1) {
  const sa = blockSharpness(a), sb = blockSharpness(b);
  const ratios = [];
  for (let i = 0; i < sa.length; i++) if (sa[i] > 4) ratios.push(sb[i] / (light * light) / sa[i]);
  return ratios.length >= 4 ? median(ratios) : 1;
}

/** Mean absolute difference of each block, after evening out the light. */
function blockChanges(a, b, gain) {
  const { w, h } = a;
  const sums = new Float64Array(GRID * GRID), counts = new Uint32Array(GRID * GRID);
  for (let y = 0; y < h; y++) {
    const by = Math.min(GRID - 1, Math.floor((y * GRID) / h));
    for (let x = 0; x < w; x++) {
      const k = by * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / w));
      sums[k] += Math.abs(b.g[y * w + x] / gain - a.g[y * w + x]);
      counts[k]++;
    }
  }
  return Array.from(sums, (s, i) => (counts[i] ? s / counts[i] : 0));
}

function sidesOf(changes, limit) {
  const sides = new Set();
  for (let by = 0; by < GRID; by++) {
    for (let bx = 0; bx < GRID; bx++) {
      if (changes[by * GRID + bx] <= limit) continue;
      if (by === 0) sides.add('arriba');
      if (by === GRID - 1) sides.add('abajo');
      if (bx === 0) sides.add('izquierda');
      if (bx === GRID - 1) sides.add('derecha');
    }
  }
  return [...sides];
}

const pct = (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v * 100))} %`;

/**
 * Compares a new frame `b` with the previous one `a` (both from grayOf, same
 * size). `widthPx` is the real width of the photos, to report shifts in pixels.
 * @returns {{ metrics: object, issues: { type: string, short: string, text: string }[] }}
 */
export function compareFrames(a, b, { sensitivity = 'normal', widthPx = 1920, checks = null } = {}) {
  const m = SENSITIVITY[sensitivity] ?? 1;
  const want = (t) => !checks || checks.includes(t);
  const light = lightRatio(a, b);
  const shift = cameraShift(a, b);
  const changes = blockChanges(a, b, light || 1);
  const metrics = { light, shift, maxChange: Math.max(...changes), sharpRatio: sharpnessRatio(a, b, light || 1) };
  const issues = [];

  const shiftPx = Math.hypot(shift.x * widthPx, shift.y * widthPx * (a.h / a.w));
  const bumped = shift.texture > 1.5 && shift.gain > 0.12 && Math.hypot(shift.x, shift.y) > 0.003 * m;
  if (want('bump') && bumped) {
    const dir = Math.abs(shift.x) >= Math.abs(shift.y) ? (shift.x > 0 ? 'a la izquierda' : 'a la derecha') : (shift.y > 0 ? 'hacia arriba' : 'hacia abajo');
    issues.push({ type: 'bump', short: 'Cámara movida', text: `La cámara se movió unos ${Math.max(1, Math.round(shiftPx))} px ${dir} respecto al fotograma anterior.` });
  }
  if (want('exposure') && Math.abs(light - 1) > 0.05 * m) {
    issues.push({ type: 'exposure', short: `Luz ${pct(light - 1)}`, text: `La luz cambió ${pct(light - 1)} respecto al fotograma anterior (¿una lámpara, una ventana o un ajuste de la cámara?).` });
  }
  if (want('duplicate') && !bumped && metrics.maxChange < 2.5 / m) {
    issues.push({ type: 'duplicate', short: 'Sin cambios', text: 'No se ve ningún cambio respecto al fotograma anterior: ¿se disparó dos veces?' });
  }
  if (want('edge') && !bumped) {
    const changed = changes.filter((c) => c > 25 * m).length;
    const sides = changed < changes.length * 0.6 ? sidesOf(changes, 25 * m) : [];
    if (sides.length) issues.push({ type: 'edge', short: 'Algo en el borde', text: `Algo cambió en el borde del encuadre (${sides.join(', ')}): ¿una mano, una herramienta o una sombra?` });
  }
  if (want('focus') && !bumped && metrics.sharpRatio < 1 - 0.3 * m) {
    issues.push({ type: 'focus', short: 'Foco', text: `La imagen está menos nítida que la anterior (${pct(metrics.sharpRatio - 1)}): revisa el foco.` });
  }
  return { metrics, issues };
}
