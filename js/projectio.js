import { library } from './library.js';
import { uid, extForType, typeForName } from './util.js';
import { createZip, readZip } from './zip.js';
import { mediaIds, remapMedia } from './media.js';

const FORMAT = 'mesora-project';

/** Packs a project with all its images and audio into a single .mesora (ZIP) file. */
export async function exportProjectFile(project, onProgress) {
  const files = [];
  const ids = [...new Set(project.frames.map((f) => f.id))];
  for (let i = 0; i < ids.length; i++) {
    const full = await library.getFrame(project.id, ids[i], 'full').catch(() => null);
    if (full) files.push({ name: `frames/${ids[i]}.${extForType(full.type)}`, data: full });
    onProgress?.((i + 1) / ids.length / 2);
  }
  for (const blobId of mediaIds(project)) {
    const rec = await library.getBlob(project.id, blobId).catch(() => null);
    if (rec) files.push({ name: `blobs/${blobId}__${rec.name || 'archivo'}`, data: rec.blob });
  }
  files.unshift({ name: 'project.json', data: JSON.stringify({ format: FORMAT, version: 1, project }, null, 1) });
  return createZip(files, (d, t) => onProgress?.(0.5 + d / t / 2));
}

/** Imports a .mesora file as a brand-new project. Returns the saved project. */
export async function importProjectFile(file, store, onProgress) {
  const entries = await readZip(file);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const manifest = byName.get('project.json');
  if (!manifest) throw new Error('No es un proyecto MESORA (falta project.json)');
  const data = JSON.parse(await (await manifest.blob()).text());
  if (data.format !== FORMAT || !data.project) throw new Error('Formato de proyecto desconocido');
  const src = data.project;

  const project = await library.createProject({
    ...src, id: uid(), frames: [], createdAt: Date.now(), updatedAt: Date.now(), settings: null, audio: null, tracks: null,
  });
  project.guides = src.guides || [];

  const frameEntry = new Map();
  for (const e of entries) {
    const m = /^frames\/([^.]+)\./.exec(e.name);
    if (m) frameEntry.set(m[1], e);
  }
  const idMap = new Map();
  const unique = [...new Set(src.frames.map((f) => f.id))];
  for (let i = 0; i < unique.length; i++) {
    const entry = frameEntry.get(unique[i]);
    if (!entry) continue;
    const blob = await entry.blob(typeForName(entry.name));
    idMap.set(unique[i], (await store.addFromBlob(project.id, blob)).id);
    onProgress?.((i + 1) / unique.length);
  }
  project.frames = src.frames
    .filter((f) => idMap.has(f.id))
    .map((f) => ({ key: uid(), id: idMap.get(f.id), hold: f.hold || 1, ...(f.note ? { note: f.note } : {}) }));

  const findBlob = (oldId) => entries.find((e) => e.name.startsWith(`blobs/${oldId}__`));
  const copyBlob = async (oldId) => {
    const entry = oldId && findBlob(oldId);
    if (!entry) return null;
    const name = entry.name.slice(`blobs/${oldId}__`.length);
    const id = uid();
    await library.putBlob(project.id, { id, name, blob: await entry.blob(typeForName(name)) });
    return id;
  };
  const media = await remapMedia(structuredClone({ audio: src.audio || null, tracks: src.tracks || null, settings: src.settings || {} }), copyBlob);
  Object.assign(project, media);

  await library.saveProject(project);
  return project;
}
