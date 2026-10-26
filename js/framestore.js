import { library } from './library.js';
import { makeCanvas, canvasToBlob } from './util.js';
import { meanLuma } from './grading.js';

export const PREVIEW_MAX = 1280;
export const THUMB_H = 72;

/**
 * Persists captured frames (full image + preview + thumbnail) and keeps a
 * bounded LRU cache of decoded ImageBitmaps for fast drawing.
 */
export class FrameStore {
  constructor({ maxCache = 72, onLoad = () => {} } = {}) {
    this.projectId = null;
    this.cache = new Map();
    this.pending = new Map();
    this.thumbUrls = new Map();
    this.lumas = new Map();
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
    const pw = Math.min(PREVIEW_MAX, w);
    const ph = Math.round((h * pw) / w);
    const pc = makeCanvas(pw, ph);
    const pctx = pc.getContext('2d');
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(source, 0, 0, pw, ph);
    const th = THUMB_H;
    const tw = Math.round((w * th) / h);
    const tc = makeCanvas(tw, th);
    const tctx = tc.getContext('2d', { willReadFrequently: true });
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(pc, 0, 0, tw, th);
    const luma = meanLuma(tctx.getImageData(0, 0, tw, th).data);
    const [preview, thumb, bitmap] = await Promise.all([
      canvasToBlob(pc, 'image/jpeg', 0.88),
      canvasToBlob(tc, 'image/jpeg', 0.78),
      createImageBitmap(pc),
    ]);
    const id = await library.addFrame(projectId, { full, preview, thumb, w, h, luma });
    this.lumas.set(id, luma);
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
        const blob = await library.getFrame(this.projectId, id, kind);
        if (!blob) return null;
        const bmp = await createImageBitmap(blob);
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
    const blob = await library.getFrame(this.projectId, id, kind);
    if (!blob) return null;
    return options ? createImageBitmap(blob, options) : createImageBitmap(blob);
  }

  /** Mean brightness of a frame (measured on its thumbnail). */
  async luma(id) {
    if (this.lumas.has(id)) return this.lumas.get(id);
    const meta = await library.getFrameMeta(this.projectId, id);
    if (!meta) return 0;
    let luma = meta.luma;
    if (luma == null) {
      const bmp = await createImageBitmap(await library.getFrame(this.projectId, id, 'thumb'));
      const c = makeCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      bmp.close?.();
      luma = meanLuma(ctx.getImageData(0, 0, c.width, c.height).data);
      library.setFrameMeta(this.projectId, id, { luma }).catch(() => {});
    }
    this.lumas.set(id, luma);
    return luma;
  }

  /** Original image of a frame and its size, for export. */
  async original(id) {
    const [full, meta] = await Promise.all([
      library.getFrame(this.projectId, id, 'full'),
      library.getFrameMeta(this.projectId, id),
    ]);
    if (!full) return null;
    let { w, h } = meta || {};
    if (!w || !h) {
      const bmp = await createImageBitmap(full);
      ({ width: w, height: h } = bmp);
      bmp.close?.();
    }
    return { full, w, h };
  }

  async thumbUrl(id) {
    if (this.thumbUrls.has(id)) return this.thumbUrls.get(id);
    const blob = await library.getFrame(this.projectId, id, 'thumb').catch(() => null);
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
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

  /** Empties the caches and points the store at another project. */
  clear(projectId = null) {
    this.projectId = projectId;
    this.lumas.clear();
    for (const b of this.cache.values()) b.close?.();
    this.cache.clear();
    for (const url of this.thumbUrls.values()) URL.revokeObjectURL(url);
    this.thumbUrls.clear();
  }

  /** Deletes stored frames of a project that are no longer referenced. */
  async collectGarbage(projectId, keepIds) {
    const orphans = await library.collectGarbage(projectId, keepIds);
    orphans.forEach((id) => this.forget(id));
    return orphans.length;
  }
}
