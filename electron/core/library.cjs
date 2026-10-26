// Production library on disk: Production › Scene › Take.
//
// Rules this module guarantees:
// - Original captures are written once, atomically, and are never renamed,
//   overwritten or deleted by the app.
// - Frame editing is virtual: a take's edl.json lists which captures are used,
//   in which order and for how long. Captures no longer referenced stay on
//   disk and are listed in the take's trash.
// - Captures written but not yet recorded in edl.json (e.g. the app crashed
//   right after shooting) are found when the take is opened and appended to
//   the end of the timeline with a note.
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  PARTIAL, writeAtomic, writeNew, writeJSON, readJSON, exists, copyNew, safeName,
} = require('./fsutil.cjs');

const VERSION = 1;
const EXPOSURE = 'X1';
const HISTORY_EVERY_MS = 60_000;
const HISTORY_KEEP = 50;
const RECOVERED_NOTE = 'Recuperado tras un cierre inesperado';

const IMAGE_EXT = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/tiff': 'tif', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/bmp': 'bmp', 'image/gif': 'gif',
};
const EXT_TYPE = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', gif: 'image/gif',
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
};

const uid = () => crypto.randomBytes(9).toString('base64url');
const capNum = (id) => Number(id.slice(1));
const capId = (n) => `c${String(n).padStart(6, '0')}`;
const pad = (n, w) => String(n).padStart(w, '0');

function extFor(type, name) {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(name || '')?.[1]?.toLowerCase();
  const ext = IMAGE_EXT[type] || fromName || 'bin';
  if (!/^[a-z0-9]{1,5}$/.test(ext)) throw new Error(`Extensión no válida: ${ext}`);
  return ext;
}
const typeFor = (file) => EXT_TYPE[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';

function frameFromDisk(f) {
  return { key: f.key, id: f.capture, hold: f.hold || 1, ...(f.note ? { note: f.note } : {}) };
}
function frameToDisk(f) {
  return { key: f.key || uid(), capture: f.id, hold: Math.max(1, Math.round(f.hold || 1)), ...(f.note ? { note: String(f.note) } : {}) };
}

function checkVersion(doc, what) {
  if ((doc?.version || 1) > VERSION) {
    throw new Error(`${what} fue creado con una versión más nueva de MESORA. Actualiza la aplicación para abrirlo.`);
  }
}

class Library {
  /** @param {string} root folder that contains the productions */
  constructor(root) {
    this.root = root;
    this.prodDirs = new Map();
    this.takes = new Map();
    this.locks = new Map();
  }

  // ------------------------------------------------------------ keys & paths

  static takeKey(prodId, sceneId, takeId) { return `${prodId}/${sceneId}/${takeId}`; }

  static parseKey(key) {
    const m = /^([\w-]+)\/(sc\d{3,})\/(tk\d{2,})$/.exec(String(key));
    if (!m) throw new Error(`Identificador de toma no válido: ${key}`);
    return { prodId: m[1], sceneId: m[2], takeId: m[3] };
  }

  async _scan() {
    this.prodDirs.clear();
    await fsp.mkdir(this.root, { recursive: true });
    for (const ent of await fsp.readdir(this.root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const dir = path.join(this.root, ent.name);
      const prod = await readJSON(path.join(dir, 'production.json'), null).catch(() => null);
      if (prod?.format === 'mesora-production' && prod.id) this.prodDirs.set(prod.id, dir);
    }
    return this.prodDirs;
  }

  async _prodDir(prodId) {
    if (!this.prodDirs.has(prodId)) await this._scan();
    const dir = this.prodDirs.get(prodId);
    if (!dir) throw new Error('No se encontró la producción. ¿Se movió o se borró su carpeta?');
    return dir;
  }

  _sceneDir(prodDir, sceneId) { return path.join(prodDir, 'scenes', sceneId); }
  _takeDir(prodDir, sceneId, takeId) { return path.join(prodDir, 'scenes', sceneId, 'takes', takeId); }

  _lock(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(key, next);
    next.finally(() => { if (this.locks.get(key) === next) this.locks.delete(key); }).catch(() => {});
    return next;
  }

  // ------------------------------------------------------------ take state

  async _take(key, { fresh = false } = {}) {
    if (!fresh && this.takes.has(key)) return this.takes.get(key);
    const { prodId, sceneId, takeId } = Library.parseKey(key);
    const prodDir = await this._prodDir(prodId);
    const dir = this._takeDir(prodDir, sceneId, takeId);
    const edl = await readJSON(path.join(dir, 'edl.json'));
    checkVersion(edl, 'Esta toma');
    const captures = new Map();
    const capDir = path.join(dir, 'capture', EXPOSURE);
    const re = new RegExp(`_${EXPOSURE}_(c\\d{6,})\\.([a-z0-9]{1,5})$`, 'i');
    for (const name of await fsp.readdir(capDir).catch(() => [])) {
      const m = re.exec(name);
      if (!m) continue;
      const entry = captures.get(m[1]) || { files: [] };
      entry.files.push(name);
      captures.set(m[1], entry);
    }
    let next = 1;
    for (const id of captures.keys()) next = Math.max(next, capNum(id) + 1);
    // Captures ingested in this session but not saved to edl.json yet are
    // known, not crash orphans.
    const prev = this.takes.get(key);
    const st = {
      key, prodId, sceneId, takeId, prodDir, dir, capDir, captures, next: Math.max(next, prev?.next || 1),
      known: new Set([...(edl.known || []), ...(prev?.known || [])]),
      lastHistoryAt: prev?.lastHistoryAt || 0,
    };
    this.takes.set(key, st);
    return st;
  }

  _capturePath(st, id) {
    const entry = st.captures.get(id);
    if (!entry) return null;
    // A RAW+JPEG pair shares the id; prefer a file the app can display.
    const shown = entry.files.find((f) => /\.(jpe?g|png|tiff?|webp|heic|heif|bmp|gif)$/i.test(f)) || entry.files[0];
    return path.join(st.capDir, shown);
  }

  // ------------------------------------------------------------ listing

  async listTakes() {
    await this._scan();
    const out = [];
    for (const [prodId, prodDir] of this.prodDirs) {
      const prod = await readJSON(path.join(prodDir, 'production.json'));
      const scenesDir = path.join(prodDir, 'scenes');
      for (const sceneId of (await fsp.readdir(scenesDir).catch(() => [])).sort()) {
        const scene = await readJSON(path.join(scenesDir, sceneId, 'scene.json'), null).catch(() => null);
        if (!scene) continue;
        const takesDir = path.join(scenesDir, sceneId, 'takes');
        for (const takeId of (await fsp.readdir(takesDir).catch(() => [])).sort()) {
          const edl = await readJSON(path.join(takesDir, takeId, 'edl.json'), null).catch(() => null);
          if (!edl) continue;
          out.push({
            id: Library.takeKey(prodId, sceneId, takeId),
            name: prod.name,
            production: { id: prodId, name: prod.name, migratedFrom: prod.migratedFrom || null },
            scene: { id: sceneId, name: scene.name },
            take: { id: takeId, name: edl.name },
            fps: scene.fps || prod.fps,
            frameCount: edl.frames.length,
            exposures: edl.frames.reduce((n, f) => n + (f.hold || 1), 0),
            firstFrameId: edl.frames[0]?.capture || null,
            updatedAt: Math.max(edl.updatedAt || 0, scene.updatedAt || 0, prod.updatedAt || 0),
            dir: path.join(takesDir, takeId),
          });
        }
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // ------------------------------------------------------------ create

  async _uniqueDir(name) {
    await fsp.mkdir(this.root, { recursive: true });
    const base = safeName(name, 'Producción');
    for (let i = 1; ; i++) {
      const dir = path.join(this.root, i === 1 ? base : `${base} (${i})`);
      if (!(await exists(dir))) return dir;
    }
  }

  async createProduction({ name = 'Mi producción', fps = 12, width = 1920, height = 1080, settings = null } = {}) {
    const dir = await this._uniqueDir(name);
    const now = Date.now();
    const prod = {
      format: 'mesora-production', version: VERSION, id: uid(), name, fps, width, height,
      createdAt: now, updatedAt: now,
    };
    for (const sub of ['scenes', 'media', 'exports']) await fsp.mkdir(path.join(dir, sub), { recursive: true });
    await writeJSON(path.join(dir, 'production.json'), prod);
    this.prodDirs.set(prod.id, dir);
    const sceneId = await this._writeScene(dir, 'sc010', { name: 'Escena 010', fps, settings });
    const key = await this._writeTake(dir, prod.id, sceneId, 'tk01');
    return this.getProject(key);
  }

  async _writeScene(prodDir, sceneId, { name, fps, settings = null, audio = null }) {
    const now = Date.now();
    await writeJSON(path.join(this._sceneDir(prodDir, sceneId), 'scene.json'), {
      format: 'mesora-scene', version: VERSION, id: sceneId, name, fps, settings, audio, createdAt: now, updatedAt: now,
    });
    return sceneId;
  }

  async _writeTake(prodDir, prodId, sceneId, takeId, base = {}) {
    const dir = this._takeDir(prodDir, sceneId, takeId);
    await fsp.mkdir(path.join(dir, 'capture', EXPOSURE), { recursive: true });
    await fsp.mkdir(path.join(dir, 'proxy'), { recursive: true });
    const now = Date.now();
    await writeJSON(path.join(dir, 'edl.json'), {
      format: 'mesora-take', version: VERSION, id: takeId, name: `Toma ${Number(takeId.slice(2))}`,
      frames: [], guides: [], known: [], createdAt: now, updatedAt: now, ...base,
    });
    return Library.takeKey(prodId, sceneId, takeId);
  }

  async _nextId(dir, prefix, width, step) {
    const used = (await fsp.readdir(dir).catch(() => []))
      .map((n) => new RegExp(`^${prefix}(\\d+)$`).exec(n)?.[1]).filter(Boolean).map(Number);
    const n = used.length ? Math.max(...used) + step : step;
    return `${prefix}${pad(n, width)}`;
  }

  /** New scene in a production; scene settings (camera, guides, fps…) can be copied from another scene. */
  async createScene(prodId, { name, copySettingsFrom } = {}) {
    const prodDir = await this._prodDir(prodId);
    const prod = await readJSON(path.join(prodDir, 'production.json'));
    const sceneId = await this._nextId(path.join(prodDir, 'scenes'), 'sc', 3, 10);
    let fps = prod.fps; let settings = null;
    if (copySettingsFrom) {
      const src = await readJSON(path.join(this._sceneDir(prodDir, copySettingsFrom), 'scene.json'));
      fps = src.fps; settings = src.settings;
    }
    await this._writeScene(prodDir, sceneId, { name: name || `Escena ${sceneId.slice(2)}`, fps, settings });
    const key = await this._writeTake(prodDir, prodId, sceneId, 'tk01');
    return this.getProject(key);
  }

  /** New take in the scene of `key`. With copyFrames the take starts as a copy of that take. */
  async createTake(key, { copyFrames = false } = {}) {
    const src = await this._take(key);
    const takesDir = path.join(src.prodDir, 'scenes', src.sceneId, 'takes');
    const takeId = await this._nextId(takesDir, 'tk', 2, 1);
    const newKey = await this._writeTake(src.prodDir, src.prodId, src.sceneId, takeId);
    if (copyFrames) await this._copyTakeContents(src, this._takeDir(src.prodDir, src.sceneId, takeId), src.sceneId, takeId);
    return this.getProject(newKey);
  }

  /** Copies a whole scene (all takes and their captures), like Dragonframe's Duplicate Scene. */
  async duplicateScene(key, { name } = {}) {
    const { prodId, sceneId } = Library.parseKey(key);
    const prodDir = await this._prodDir(prodId);
    const srcScene = await readJSON(path.join(this._sceneDir(prodDir, sceneId), 'scene.json'));
    const newId = await this._nextId(path.join(prodDir, 'scenes'), 'sc', 3, 10);
    await this._writeScene(prodDir, newId, {
      name: name || `${srcScene.name} (copia)`, fps: srcScene.fps, settings: srcScene.settings, audio: srcScene.audio,
    });
    const takesDir = path.join(this._sceneDir(prodDir, sceneId), 'takes');
    let firstKey = null;
    for (const takeId of (await fsp.readdir(takesDir)).sort()) {
      const src = await this._take(Library.takeKey(prodId, sceneId, takeId), { fresh: true });
      const newKey = await this._writeTake(prodDir, prodId, newId, takeId);
      await this._copyTakeContents(src, this._takeDir(prodDir, newId, takeId), newId, takeId);
      firstKey ??= newKey;
    }
    return this.getProject(firstKey);
  }

  async _copyTakeContents(src, destDir, sceneId, takeId) {
    const edl = await readJSON(path.join(src.dir, 'edl.json'));
    for (const [id, entry] of src.captures) {
      for (const file of entry.files) {
        const ext = path.extname(file);
        await copyNew(path.join(src.capDir, file), path.join(destDir, 'capture', EXPOSURE, `${sceneId}_${takeId}_${EXPOSURE}_${id}${ext}`));
      }
      for (const suffix of ['.preview.jpg', '.thumb.jpg', '.json']) {
        const from = path.join(src.dir, 'proxy', `${id}${suffix}`);
        if (await exists(from)) await copyNew(from, path.join(destDir, 'proxy', `${id}${suffix}`));
      }
    }
    const known = [...new Set([...(edl.known || []), ...src.captures.keys()])];
    const now = Date.now();
    await writeJSON(path.join(destDir, 'edl.json'), {
      ...edl, id: takeId, name: `Toma ${Number(takeId.slice(2))}`, known, createdAt: now, updatedAt: now,
    });
    this.takes.delete(Library.takeKey(src.prodId, sceneId, takeId));
  }

  // ------------------------------------------------------------ open & save

  /**
   * Opens a take as the project object the editor works with, after running
   * crash recovery. Returns { project, report }.
   */
  getProject(key) {
    return this._lock(key, async () => {
      const st = await this._take(key, { fresh: true });
      const prod = await readJSON(path.join(st.prodDir, 'production.json'));
      checkVersion(prod, 'Esta producción');
      const sceneDir = this._sceneDir(st.prodDir, st.sceneId);
      const scene = await readJSON(path.join(sceneDir, 'scene.json'));
      const edlPath = path.join(st.dir, 'edl.json');
      const edl = await readJSON(edlPath);

      const report = { recovered: [], missing: [], partials: [] };
      const orphans = [...st.captures.keys()].filter((id) => !st.known.has(id)).sort((a, b) => capNum(a) - capNum(b));
      if (orphans.length) {
        for (const id of orphans) {
          edl.frames.push({ key: uid(), capture: id, hold: 1, note: RECOVERED_NOTE });
          st.known.add(id);
        }
        edl.known = [...st.known];
        edl.updatedAt = Date.now();
        await writeJSON(edlPath, edl);
        report.recovered = orphans;
      }
      report.missing = [...new Set(edl.frames.map((f) => f.capture).filter((id) => !st.captures.has(id)))];
      report.partials = await this._findPartials(st.dir);

      return {
        project: {
          id: key,
          storage: 'disk',
          name: prod.name,
          fps: scene.fps || prod.fps,
          width: prod.width,
          height: prod.height,
          frames: edl.frames.map(frameFromDisk),
          guides: edl.guides || [],
          settings: scene.settings || null,
          audio: scene.audio || null,
          createdAt: edl.createdAt,
          updatedAt: Math.max(edl.updatedAt || 0, scene.updatedAt || 0, prod.updatedAt || 0),
          production: { id: st.prodId, name: prod.name },
          scene: { id: st.sceneId, name: scene.name },
          take: { id: st.takeId, name: edl.name },
          folder: st.dir,
        },
        report,
      };
    });
  }

  async _findPartials(dir) {
    const found = [];
    const walk = async (d) => {
      for (const ent of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) await walk(p);
        else if (ent.name.endsWith(PARTIAL)) found.push(path.relative(dir, p));
      }
    };
    await walk(dir);
    return found;
  }

  /** Saves the editor's project object back to production.json, scene.json and edl.json. */
  saveProject(project) {
    return this._lock(project.id, async () => {
      const st = await this._take(project.id);
      for (const f of project.frames || []) {
        if (!st.captures.has(f.id)) throw new Error(`El fotograma ${f.id} no existe en esta toma; no se guarda para no corromperla.`);
      }
      const now = Date.now();

      const prodPath = path.join(st.prodDir, 'production.json');
      const prod = await readJSON(prodPath);
      checkVersion(prod, 'Esta producción');
      if (prod.name !== project.name || prod.width !== project.width || prod.height !== project.height) {
        await writeJSON(prodPath, { ...prod, name: String(project.name || prod.name), width: project.width, height: project.height, updatedAt: now });
      }

      const scenePath = path.join(this._sceneDir(st.prodDir, st.sceneId), 'scene.json');
      const scene = await readJSON(scenePath);
      const nextScene = { ...scene, fps: project.fps, settings: project.settings ?? null, audio: project.audio ?? null };
      if (JSON.stringify(nextScene) !== JSON.stringify(scene)) await writeJSON(scenePath, { ...nextScene, updatedAt: now });

      const edlPath = path.join(st.dir, 'edl.json');
      const edl = await readJSON(edlPath);
      checkVersion(edl, 'Esta toma');
      const nextEdl = {
        ...edl,
        frames: (project.frames || []).map(frameToDisk),
        guides: project.guides || [],
        known: [...st.known],
      };
      if (JSON.stringify(nextEdl) === JSON.stringify(edl)) return { updatedAt: edl.updatedAt };
      // Keep the previous timeline whenever frames are removed, and otherwise once a minute.
      const kept = new Set(nextEdl.frames.map((f) => f.capture));
      const removes = edl.frames.some((f) => !kept.has(f.capture));
      if (removes || now - st.lastHistoryAt > HISTORY_EVERY_MS) {
        await this._snapshotHistory(st, edlPath);
        st.lastHistoryAt = now;
      }
      await writeJSON(edlPath, { ...nextEdl, updatedAt: now });
      return { updatedAt: now };
    });
  }

  async _snapshotHistory(st, edlPath) {
    const histDir = path.join(st.dir, 'history');
    await fsp.mkdir(histDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await copyNew(edlPath, path.join(histDir, `edl-${stamp}.json`)).catch((err) => { if (err.code !== 'EEXIST') throw err; });
    const old = (await fsp.readdir(histDir)).filter((n) => n.startsWith('edl-')).sort();
    for (const name of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) await fsp.rm(path.join(histDir, name));
  }

  /** Lists the take's saved timeline versions, newest first. */
  async listHistory(key) {
    const st = await this._take(key);
    const histDir = path.join(st.dir, 'history');
    const names = (await fsp.readdir(histDir).catch(() => [])).filter((n) => n.startsWith('edl-')).sort().reverse();
    const out = [];
    for (const name of names) {
      const edl = await readJSON(path.join(histDir, name), null).catch(() => null);
      if (edl) out.push({ version: name, updatedAt: edl.updatedAt, frameCount: edl.frames.length });
    }
    return out;
  }

  /** Brings back an older timeline. The current one is kept in the history first. */
  restoreHistory(key, version) {
    if (!/^edl-[\w-]+\.json$/.test(version)) throw new Error('Versión no válida');
    return this._lock(key, async () => {
      const st = await this._take(key);
      const old = await readJSON(path.join(st.dir, 'history', version));
      const edlPath = path.join(st.dir, 'edl.json');
      const edl = await readJSON(edlPath);
      await this._snapshotHistory(st, edlPath);
      st.lastHistoryAt = Date.now();
      const frames = old.frames.filter((f) => st.captures.has(f.capture));
      await writeJSON(edlPath, { ...edl, frames, guides: old.guides || [], known: [...st.known], updatedAt: Date.now() });
    }).then(() => this.getProject(key));
  }

  async rename(key, level, name) {
    const st = await this._take(key);
    const clean = String(name || '').trim();
    if (!clean) throw new Error('El nombre no puede estar vacío');
    const file = {
      production: path.join(st.prodDir, 'production.json'),
      scene: path.join(this._sceneDir(st.prodDir, st.sceneId), 'scene.json'),
      take: path.join(st.dir, 'edl.json'),
    }[level];
    if (!file) throw new Error(`Nivel desconocido: ${level}`);
    await this._lock(key, async () => {
      const doc = await readJSON(file);
      await writeJSON(file, { ...doc, name: clean, updatedAt: Date.now() });
    });
  }

  /** Records that a production is a complete copy of a project from the old browser storage. */
  async markMigrated(key, fromId) {
    const st = await this._take(key);
    const file = path.join(st.prodDir, 'production.json');
    await this._lock(key, async () => {
      const prod = await readJSON(file);
      await writeJSON(file, { ...prod, migratedFrom: String(fromId) });
    });
  }

  // ------------------------------------------------------------ captures

  /**
   * Stores a new original capture. Resolves only when the original is safely
   * on disk. preview/thumb are optional JPEG proxies for fast playback.
   */
  async ingestCapture(key, { full, preview, thumb, meta = {} }) {
    const st = await this._take(key);
    if (!full?.bytes?.byteLength) throw new Error('La captura está vacía');
    const id = capId(st.next++);
    const ext = extFor(full.type, full.name);
    const name = `${st.sceneId}_${st.takeId}_${EXPOSURE}_${id}.${ext}`;
    await writeNew(path.join(st.capDir, name), Buffer.from(full.bytes));
    st.captures.set(id, { files: [name] });
    st.known.add(id);
    // Proxies and metadata can always be regenerated from the original.
    const proxy = path.join(st.dir, 'proxy');
    try {
      if (preview?.bytes) await writeAtomic(path.join(proxy, `${id}.preview.jpg`), Buffer.from(preview.bytes));
      if (thumb?.bytes) await writeAtomic(path.join(proxy, `${id}.thumb.jpg`), Buffer.from(thumb.bytes));
      await writeJSON(path.join(proxy, `${id}.json`), {
        w: meta.w, h: meta.h, luma: meta.luma ?? null, source: full.name || null, type: full.type || typeFor(name), created: Date.now(),
      });
    } catch (err) {
      console.warn('No se pudieron guardar las vistas previas de', id, err);
    }
    return { id, file: path.join(st.capDir, name) };
  }

  /** Reads a capture: kind 'full' (original), 'preview' or 'thumb' (proxies, falling back to the original). */
  async readCapture(key, id, kind = 'full') {
    const st = await this._take(key);
    if (kind !== 'full') {
      const p = path.join(st.dir, 'proxy', `${id}.${kind}.jpg`);
      if (await exists(p)) return { bytes: await fsp.readFile(p), type: 'image/jpeg' };
    }
    const file = this._capturePath(st, id);
    if (!file) throw new Error(`No se encuentra la captura ${id}`);
    return { bytes: await fsp.readFile(file), type: typeFor(file) };
  }

  async readMeta(key, id) {
    const st = await this._take(key);
    return readJSON(path.join(st.dir, 'proxy', `${id}.json`), {});
  }

  async writeMeta(key, id, patch) {
    const st = await this._take(key);
    if (!st.captures.has(id)) throw new Error(`No se encuentra la captura ${id}`);
    const file = path.join(st.dir, 'proxy', `${id}.json`);
    await writeJSON(file, { ...(await readJSON(file, {})), ...patch });
  }

  /** Captures of the take that are not used in its timeline (deleted frames), newest first. */
  async listTrash(key) {
    const st = await this._take(key);
    const edl = await readJSON(path.join(st.dir, 'edl.json'));
    const used = new Set(edl.frames.map((f) => f.capture));
    return [...st.captures.keys()].filter((id) => !used.has(id)).sort((a, b) => capNum(b) - capNum(a));
  }

  // ------------------------------------------------------------ media (audio, references, backgrounds)

  async putBlob(key, { id, name, bytes }) {
    const st = await this._take(key);
    if (!/^[\w-]{4,64}$/.test(id)) throw new Error('Identificador de archivo no válido');
    const file = path.join(st.prodDir, 'media', `${id}__${safeName(name, 'archivo')}`);
    await writeNew(file, Buffer.from(bytes));
    return { id };
  }

  async _findBlob(st, id) {
    if (!/^[\w-]{4,64}$/.test(String(id))) return null;
    const dir = path.join(st.prodDir, 'media');
    const name = (await fsp.readdir(dir).catch(() => [])).find((n) => n.startsWith(`${id}__`));
    return name ? { dir, name } : null;
  }

  async getBlob(key, id) {
    const st = await this._take(key);
    const found = await this._findBlob(st, id);
    if (!found) return null;
    const file = path.join(found.dir, found.name);
    return { id, name: found.name.slice(id.length + 2), type: typeFor(file), bytes: await fsp.readFile(file) };
  }

  // ------------------------------------------------------------ conform

  /**
   * Copies the take's originals in timeline order into a new folder, numbered
   * 0001, 0002… Holds are repeated when expandHolds is true. Originals are untouched.
   */
  conform(key, { expandHolds = true } = {}) {
    return this._lock(key, async () => {
      const st = await this._take(key);
      const edl = await readJSON(path.join(st.dir, 'edl.json'));
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const dest = path.join(st.prodDir, 'exports', `conform_${st.sceneId}_${st.takeId}_${stamp}`);
      await fsp.mkdir(dest, { recursive: false });
      let n = 0;
      for (const f of edl.frames) {
        const entry = st.captures.get(f.capture);
        if (!entry) throw new Error(`Falta la captura ${f.capture}; el conform se detiene sin tocar nada más.`);
        const repeat = expandHolds ? Math.max(1, f.hold || 1) : 1;
        for (let r = 0; r < repeat; r++) {
          n++;
          for (const file of entry.files) {
            await copyNew(path.join(st.capDir, file), path.join(dest, `${st.sceneId}_${st.takeId}_${pad(n, 4)}${path.extname(file)}`));
          }
        }
      }
      return { dir: dest, count: n };
    });
  }

  /** Folder to send to the system trash when a take or production is deleted. */
  async pathFor(key, level) {
    const st = await this._take(key);
    if (level === 'production') return st.prodDir;
    if (level === 'take') return st.dir;
    throw new Error(`Nivel desconocido: ${level}`);
  }

  /** Drops cached state after a take (or its whole production) was moved away. */
  forget(key, level = 'take') {
    const { prodId } = Library.parseKey(key);
    for (const k of [...this.takes.keys()]) {
      if (k === key || (level === 'production' && k.startsWith(`${prodId}/`))) this.takes.delete(k);
    }
    this.prodDirs.clear();
  }
}

module.exports = { Library, VERSION, RECOVERED_NOTE };
