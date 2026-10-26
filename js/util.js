export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function debounce(fn, ms) {
  let t = 0;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pad = (n, w = 4) => String(n).padStart(w, '0');

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo codificar la imagen'))), type, quality);
  });
}

/** Rectangle that fits (sw × sh) inside (W × H) keeping the aspect ratio. */
export function fitContain(sw, sh, W, H) {
  const s = Math.min(W / sw, H / sh);
  const w = sw * s, h = sh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/** Rectangle that covers (W × H) with (sw × sh) keeping the aspect ratio. */
export function fitCover(sw, sh, W, H) {
  const s = Math.max(W / sw, H / sh);
  const w = sw * s, h = sh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function safeFileName(name) {
  // Accents are stripped: some browsers drop non-ASCII download names.
  const ascii = (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '');
  return ascii.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'mesora';
}

export function extForType(type) {
  if (type === 'image/png') return 'png';
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  if (type === 'image/gif') return 'gif';
  return 'bin';
}

const TYPE_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm',
  json: 'application/json',
};
export function typeForName(name) {
  const ext = name.split('.').pop().toLowerCase();
  return TYPE_BY_EXT[ext] || 'application/octet-stream';
}

let toastRoot = null;
export function toast(message, type = 'info', ms = 2800) {
  toastRoot ??= document.getElementById('toasts');
  if (!toastRoot) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastRoot.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = value;
}

/** Fills missing keys of `target` from `defaults`, recursively. */
export function withDefaults(target, defaults) {
  const out = { ...defaults, ...(target || {}) };
  for (const [k, v] of Object.entries(defaults)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = withDefaults(target?.[k], v);
  }
  return out;
}

export function formatDate(ts) {
  return new Date(ts).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
}

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || el.isContentEditable) return true;
  if (tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = el.type;
    return !['checkbox', 'radio', 'range', 'button', 'color'].includes(t);
  }
  return false;
}
