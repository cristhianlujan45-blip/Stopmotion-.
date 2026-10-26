// Pure helpers for colour grading and light-flicker removal.

/** Least-squares line through points, evaluated at x. */
function lineAt(points, x) {
  const n = points.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [px, py] of points) { sx += px; sy += py; sxx += px * px; sxy += px * py; }
  const den = n * sxx - sx * sx;
  if (!den) return sy / n;
  const slope = (n * sxy - sx * sy) / den;
  return (sy - slope * sx) / n + slope * x;
}

/**
 * Per-frame brightness gains that remove frame-to-frame light flicker.
 * Each frame is pulled towards a robust local trend of its neighbours
 * (a straight line fitted after discarding the most deviant frame), so
 * deliberate fades survive while random jumps are evened out.
 * @param {number[]} lumas mean brightness of each frame (0…255)
 */
export function deflickerGains(lumas, radius = 3, maxGain = 1.35) {
  const n = lumas.length;
  const size = 2 * radius + 1;
  const gains = new Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const own = lumas[i];
    if (!(own > 0)) continue;
    const start = Math.max(0, Math.min(i - radius, n - size));
    const end = Math.min(n, start + size);
    let points = [];
    for (let j = start; j < end; j++) if (lumas[j] > 0) points.push([j, lumas[j]]);
    if (points.length >= 5) {
      // Discard the most deviant frame only when it is a clear outlier.
      const errs = points.map(([x, y]) => Math.abs(y - lineAt(points, x)));
      const sorted = [...errs].sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1];
      const worst = errs.indexOf(sorted[sorted.length - 1]);
      if (errs[worst] > 0.5 && errs[worst] > 2.5 * median) points = points.filter((_, k) => k !== worst);
    }
    const target = lineAt(points, i);
    gains[i] = target > 0 ? Math.min(maxGain, Math.max(1 / maxGain, target / own)) : 1;
  }
  return gains;
}

/** Mean Rec.601 luma of RGBA pixel data. */
export function meanLuma(data) {
  let sum = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  return count ? sum / count : 0;
}

/** Canvas 2D `filter` string for a grade, or 'none' when it changes nothing. */
export function gradeFilter({ brightness = 1, contrast = 1, saturation = 1 } = {}, gain = 1) {
  const b = brightness * gain;
  const parts = [];
  if (Math.abs(b - 1) > 0.001) parts.push(`brightness(${b.toFixed(4)})`);
  if (Math.abs(contrast - 1) > 0.001) parts.push(`contrast(${contrast.toFixed(4)})`);
  if (Math.abs(saturation - 1) > 0.001) parts.push(`saturate(${saturation.toFixed(4)})`);
  return parts.length ? parts.join(' ') : 'none';
}
