// Where projects, frames and media are stored.
// - Desktop app: production folders on disk (Producción › Escena › Toma), managed
//   by the main process (electron/core/library.cjs).
// - Browser and Android: IndexedDB, as before.
// The editor only talks to this module, never to the storage directly.
import * as db from './db.js';
import { uid } from './util.js';

const bridge = window.mesoraDesktop?.library;

const sortRecent = (list) => list.sort((a, b) => b.updatedAt - a.updatedAt);
const totalExposures = (frames = []) => frames.reduce((n, f) => n + (f.hold || 1), 0);
const bytesOf = (blob) => blob.arrayBuffer();

/** IndexedDB storage (browser and Android). */
const browserLibrary = {
  kind: 'browser',

  async init() {
    await db.openDB();
    db.persist();
  },

  async listProjects() {
    return sortRecent((await db.getAll('projects')).map((p) => ({
      id: p.id,
      name: p.name,
      fps: p.fps,
      frameCount: p.frames?.length || 0,
      exposures: totalExposures(p.frames),
      firstFrameId: p.frames?.[0]?.id || null,
      updatedAt: p.updatedAt,
    })));
  },

  async getProject(id) {
    const project = await db.get('projects', id);
    return project ? { project, report: null } : null;
  },

  async createProject(project) {
    await db.put('projects', project);
    return project;
  },

  saveProject(project) {
    return db.put('projects', project);
  },

  async renameProject(id, name) {
    const p = await db.get('projects', id);
    if (p) await db.put('projects', { ...p, name });
  },

  async deleteProject(id) {
    await db.del('frames', await db.keysByIndex('frames', 'projectId', id));
    await db.del('blobs', await db.keysByIndex('blobs', 'projectId', id));
    await db.del('projects', id);
  },

  async addFrame(projectId, { full, preview, thumb, w, h, luma }) {
    const id = uid();
    await db.put('frames', { id, projectId, full, preview, thumb, w, h, luma, created: Date.now() });
    return id;
  },

  async getFrame(_projectId, id, kind) {
    return (await db.get('frames', id))?.[kind] || null;
  },

  async getFrameMeta(_projectId, id) {
    const rec = await db.get('frames', id);
    return rec ? { w: rec.w, h: rec.h, luma: rec.luma } : null;
  },

  async setFrameMeta(_projectId, id, patch) {
    const rec = await db.get('frames', id);
    if (rec) await db.put('frames', { ...rec, ...patch });
  },

  /** Deletes stored frames of a project that are no longer referenced. Returns the deleted ids. */
  async collectGarbage(projectId, keepIds) {
    const keep = new Set(keepIds);
    const orphans = (await db.keysByIndex('frames', 'projectId', projectId)).filter((k) => !keep.has(k));
    await db.del('frames', orphans);
    return orphans;
  },

  putBlob(projectId, { id, name, blob }) {
    return db.put('blobs', { id, projectId, name, blob });
  },

  async getBlob(_projectId, id) {
    const rec = await db.get('blobs', id);
    return rec ? { name: rec.name, blob: rec.blob } : null;
  },

  deleteBlob(_projectId, id) {
    return db.del('blobs', id);
  },

  async addRawFile() {
    throw new Error('Los archivos RAW solo se pueden importar en la app de escritorio');
  },
};

/** Production folders on disk (desktop app). */
const diskLibrary = {
  kind: 'disk',

  async init() {},

  async listProjects() {
    return (await bridge.call('listTakes')).map((t) => ({
      ...t,
      name: t.production.name,
    }));
  },

  getProject(id) {
    return bridge.call('getProject', id);
  },

  async createProject(project) {
    const { project: created } = await bridge.call('createProduction', {
      name: project.name, fps: project.fps, width: project.width, height: project.height,
      settings: project.settings || null,
    });
    return created;
  },

  saveProject(project) {
    return bridge.call('saveProject', project);
  },

  renameProject(id, name) {
    return bridge.call('rename', id, 'production', name);
  },

  /** Takes are never erased: the folder goes to the system trash. */
  deleteProject(id) {
    return bridge.trash(id, 'take');
  },

  /** Sends the whole project folder (all scenes and takes) to the system trash. */
  deleteProduction(id) {
    return bridge.trash(id, 'production');
  },

  async addFrame(projectId, { full, preview, thumb, w, h, luma }) {
    const [fullBytes, previewBytes, thumbBytes] = await Promise.all([full, preview, thumb].map((b) => b && bytesOf(b)));
    const { id } = await bridge.call('ingestCapture', projectId, {
      full: { bytes: fullBytes, type: full.type, name: full.name || '' },
      preview: previewBytes && { bytes: previewBytes },
      thumb: thumbBytes && { bytes: thumbBytes },
      meta: { w, h, luma },
    });
    return id;
  },

  async getFrame(projectId, id, kind) {
    const { bytes, type } = await bridge.call('readCapture', projectId, id, kind);
    return new Blob([bytes], { type });
  },

  async getFrameMeta(projectId, id) {
    return bridge.call('readMeta', projectId, id);
  },

  setFrameMeta(projectId, id, patch) {
    return bridge.call('writeMeta', projectId, id, patch);
  },

  /** On disk nothing is collected: unused captures are the take's trash. */
  async collectGarbage() {
    return [];
  },

  async putBlob(projectId, { id, name, blob }) {
    await bridge.call('putBlob', projectId, { id, name, bytes: await bytesOf(blob) });
  },

  async getBlob(projectId, id) {
    const rec = await bridge.call('getBlob', projectId, id);
    return rec ? { name: rec.name, blob: new Blob([rec.bytes], { type: rec.type }) } : null;
  },

  /** Replaced media stay in the production's media folder: another scene may use them. */
  async deleteBlob() {},

  /** Imports an image file the browser cannot display by itself (camera RAW). Returns { id, display }. */
  async addRawFile(projectId, file) {
    const r = await bridge.call('ingestCapture', projectId, { full: { bytes: await bytesOf(file), type: file.type, name: file.name } });
    return { id: r.id, display: r.display ? new Blob([r.display.bytes], { type: 'image/jpeg' }) : null };
  },

  async writeProxies(projectId, id, { preview, thumb, w, h, luma }) {
    const [p, t] = await Promise.all([preview, thumb].map((b) => b && bytesOf(b)));
    await bridge.call('writeProxies', projectId, id, { preview: p && { bytes: p }, thumb: t && { bytes: t }, meta: { w, h, luma } });
  },

  async writeAssist(projectId, id, blob) {
    await bridge.call('writeAssist', projectId, id, { bytes: await bytesOf(blob) });
  },

  // Production features that only exist on disk.
  createScene: (prodId, opts) => bridge.call('createScene', prodId, opts),
  createTake: (key, opts) => bridge.call('createTake', key, opts),
  duplicateScene: (key, opts) => bridge.call('duplicateScene', key, opts),
  rename: (key, level, name) => bridge.call('rename', key, level, name),
  listTrash: (key) => bridge.call('listTrash', key),
  listHistory: (key) => bridge.call('listHistory', key),
  restoreHistory: (key, version) => bridge.call('restoreHistory', key, version),
  conform: (key, opts) => bridge.call('conform', key, opts),
  markMigrated: (key, fromId) => bridge.call('markMigrated', key, fromId),
  reveal: (key, level) => bridge.reveal(key, level),
  revealPath: (dir) => bridge.revealPath(dir),
  root: () => bridge.root(),
};

export const library = bridge ? diskLibrary : browserLibrary;
export const browserStore = browserLibrary;
