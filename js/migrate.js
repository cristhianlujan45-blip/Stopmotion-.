// Desktop app: copies projects saved by earlier versions (IndexedDB inside the
// app) into production folders on disk. The old copies are left untouched, and
// a project only counts as migrated once every frame and file has been copied.
import * as db from './db.js';
import { library } from './library.js';
import { remapMedia } from './media.js';

/** Projects still stored in IndexedDB that have no production folder yet. */
export async function pendingBrowserProjects() {
  if (library.kind !== 'disk') return [];
  await db.openDB();
  const old = await db.getAll('projects');
  if (!old.length) return [];
  const done = new Set((await library.listProjects()).map((t) => t.production.migratedFrom).filter(Boolean));
  return old.filter((p) => !done.has(p.id)).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

/** Copies one project. Returns { project, missing } where missing counts frames whose image was not found. */
export async function migrateProject(old, onProgress) {
  const project = await library.createProject(old);
  const ids = [...new Set((old.frames || []).map((f) => f.id))];
  const idMap = new Map();
  for (let i = 0; i < ids.length; i++) {
    const rec = await db.get('frames', ids[i]);
    if (rec?.full) idMap.set(ids[i], await library.addFrame(project.id, rec));
    onProgress?.((i + 1) / ids.length);
  }

  const copyBlob = async (blobId) => {
    if (!blobId) return null;
    const rec = await db.get('blobs', blobId);
    if (!rec) return null;
    await library.putBlob(project.id, { id: blobId, name: rec.name, blob: rec.blob });
    return blobId;
  };
  const media = await remapMedia(structuredClone({ audio: old.audio || null, tracks: old.tracks || null, settings: old.settings || {} }), copyBlob);

  Object.assign(project, {
    name: old.name,
    fps: old.fps,
    width: old.width,
    height: old.height,
    frames: (old.frames || [])
      .filter((f) => idMap.has(f.id))
      .map((f) => ({ key: f.key, id: idMap.get(f.id), hold: f.hold || 1, ...(f.note ? { note: f.note } : {}) })),
    guides: old.guides || [],
    settings: media.settings,
    audio: media.audio,
    tracks: media.tracks,
  });
  await library.saveProject(project);
  await library.markMigrated(project.id, old.id);
  return { project, missing: (old.frames || []).length - project.frames.length };
}
