import * as db from './db.js';
import { uid, makeCanvas, canvasToBlob } from './util.js';

export const PREVIEW_MAX = 1280;
export const THUMB_H = 72;

/**
 * Persists captured frames (full image + preview + thumbnail) and keeps a
 * bounded LRU cache of decoded ImageBitmaps for fast drawing.
 */
export class FrameStore {
  constructor({ maxCache = 72, onLoad = () => {} } = {}) {
    this.cache = new Map();
    this.pending = new Map();
    this.thumbUrls = new Map();
    this.maxCache = maxCache;
    this.onLoad = onLoad;
  }

  /** Stores a captured canvas. Resolves to { id, w, h }. */
  async addFromCanvas(projectId, canvas, { format = 'jpeg', quality = 0.95 } = {}) {
    const type = format === 'png' ? 'image/png' : 'image/jpeg';
    const full = await canvasToBlob(canvas, type, quality);
    return this._add(projectId, canvas, canvas.width, canvas.height, full);
  }

  /** Stores an image file, keeping the original bytes. Resolves to { id, w, h }. */
  async addFromBlob(projectId, blob) {
    const bmp = await createImageBitmap(blob);
    try {
      return await this._add(projectId, bmp, bmp.width, bmp.height, blob);
    } finally {
      bmp.close?.();
    }
  }

  async _add(projectId, source, w, h, full) {
    const id = uid();
    const pw = Math.min(PREVIEW_MAX, w);
    const ph = Math.round((h * pw) / w);
    const pc = makeCanvas(pw, ph);
    const pctx = pc.getContext('2d');
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(source, 0, 0, pw, ph);
    const th = THUMB_H;
    const tw = Math.round((w * th) / h);
    const tc = makeCanvas(tw, th);
    const tctx = tc.getContext('2d');
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(pc, 0, 0, tw, th);
    const [preview, thumb, bitmap] = await Promise.all([
      canvasToBlob(pc, 'image/jpeg', 0.88),
      canvasToBlob(tc, 'image/jpeg', 0.78),
      createImageBitmap(pc),
    ]);
    await db.put('frames', { id, projectId, full, preview, thumb, w, h, created: Date.now() });
    this._set(`${id}:preview`, bitmap);
    return { id, w, h };
  }

  /** Returns the cached bitmap or null, scheduling a load when missing. */
  peek(id, kind = 'preview') {
    const key = `${id}:${kind}`;
    const bmp = this.cache.get(key);
    if (bmp) {
      this.cache.delete(key);
      this.cache.set(key, bmp);
      return bmp;
    }
    this.load(id, kind);
    return null;
  }

  load(id, kind = 'preview') {
    const key = `${id}:${kind}`;
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    if (this.pending.has(key)) return this.pending.get(key);
    const p = (async () => {
      try {
        const rec = await db.get('frames', id);
        if (!rec?.[kind]) return null;
        const bmp = await createImageBitmap(rec[kind]);
        this._set(key, bmp);
        this.onLoad(id, kind);
        return bmp;
      } catch (err) {
        console.warn('No se pudo cargar el fotograma', id, err);
        return null;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, p);
    return p;
  }

  /** Decodes an image without caching it (caller must close it). */
  async decode(id, kind = 'full', options) {
    const rec = await db.get('frames', id);
    if (!rec) return null;
    return options ? createImageBitmap(rec[kind], options) : createImageBitmap(rec[kind]);
  }

  getRecord(id) {
    return db.get('frames', id);
  }

  async thumbUrl(id) {
    if (this.thumbUrls.has(id)) return this.thumbUrls.get(id);
    const rec = await db.get('frames', id);
    if (!rec) return '';
    const url = URL.createObjectURL(rec.thumb);
    this.thumbUrls.set(id, url);
    return url;
  }

  _set(key, bmp) {
    const old = this.cache.get(key);
    if (old && old !== bmp) old.close?.();
    this.cache.delete(key);
    this.cache.set(key, bmp);
    while (this.cache.size > this.maxCache) {
      const [k, b] = this.cache.entries().next().value;
      this.cache.delete(k);
      b.close?.();
    }
  }

  forget(id) {
    for (const kind of ['preview', 'full']) {
      const key = `${id}:${kind}`;
      this.cache.get(key)?.close?.();
      this.cache.delete(key);
    }
    const url = this.thumbUrls.get(id);
    if (url) URL.revokeObjectURL(url);
    this.thumbUrls.delete(id);
  }

  clear() {
    for (const b of this.cache.values()) b.close?.();
    this.cache.clear();
    for (const url of this.thumbUrls.values()) URL.revokeObjectURL(url);
    this.thumbUrls.clear();
  }

  /** Deletes stored frames of a project that are no longer referenced. */
  async collectGarbage(projectId, keepIds) {
    const keep = new Set(keepIds);
    const keys = await db.keysByIndex('frames', 'projectId', projectId);
    const orphans = keys.filter((k) => !keep.has(k));
    orphans.forEach((id) => this.forget(id));
    await db.del('frames', orphans);
    return orphans.length;
  }
}
