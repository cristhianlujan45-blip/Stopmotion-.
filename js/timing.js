// Pure helpers for exposure sheets, timecode and motion spacing.

/** Total number of exposures (video frames) of a sequence. */
export function totalExposures(frames) {
  let n = 0;
  for (const f of frames) n += f.hold;
  return n;
}

/** Maps each exposure to its frame index, for frames in [start, end). */
export function expandExposures(frames, start = 0, end = frames.length) {
  const out = [];
  for (let i = start; i < end; i++) for (let k = 0; k < frames[i].hold; k++) out.push(i);
  return out;
}

/** Exposure at which frame `index` starts. */
export function exposureStart(frames, index) {
  let n = 0;
  for (let i = 0; i < index && i < frames.length; i++) n += frames[i].hold;
  return n;
}

/** Formats an exposure count as MM:SS:FF. */
export function formatTime(exposures, fps) {
  const f = Math.max(0, Math.round(exposures));
  const rate = Math.max(1, Math.round(fps));
  const totalSec = Math.floor(f / rate);
  const ff = f % rate;
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(ff).padStart(2, '0')}`;
}

/**
 * Moves the items at `indices` so they land just before position `target`
 * (expressed in the original array's coordinates). Returns a new array.
 */
export function moveItems(array, indices, target) {
  const set = new Set(indices);
  const moving = array.filter((_, i) => set.has(i));
  const rest = array.filter((_, i) => !set.has(i));
  let before = 0;
  for (const i of set) if (i < target) before++;
  const at = Math.max(0, Math.min(rest.length, target - before));
  rest.splice(at, 0, ...moving);
  return rest;
}

export const EASINGS = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => 1 - (1 - t) * (1 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

/**
 * Position of the object at each frame (0…frames) to travel `distance`
 * following an easing curve, plus the increment to apply on each frame.
 */
export function computeSpacing(distance, frames, easing = 'linear') {
  const ease = EASINGS[easing] || EASINGS.linear;
  const n = Math.max(1, Math.floor(frames));
  const out = [];
  let prev = 0;
  for (let i = 0; i <= n; i++) {
    const position = distance * ease(i / n);
    out.push({ frame: i, position, delta: i === 0 ? 0 : position - prev });
    prev = position;
  }
  return out;
}
