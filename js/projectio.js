import * as db from './db.js';
import { uid, extForType, typeForName } from './util.js';
import { createZip, readZip } from './zip.js';

const FORMAT = 'mesora-project';

/** Packs a project with all its images and audio into a single .mesora (ZIP) file. */
export async function exportProjectFile(project, onProgress) {
  const files = [];
  const ids = [...new Set(project.frames.map((f) => f.id))];
  for (let i = 0; i < ids.length; i++) {
    const rec = await db.get('frames', ids[i]);
    if (rec) files.push({ name: `frames/${ids[i]}.${extForType(rec.full.type)}`, data: rec.full });
    onProgress?.((i + 1) / ids.length / 2);
  }
  for (const blobId of [project.audio?.blobId, project.settings?.chroma?.bgBlobId, project.settings?.reference?.blobId]) {
    if (!blobId) continue;
    const rec = await db.get('blobs', blobId);
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

  const project = {
    ...src,
    id: uid(),
    frames: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    settings: {
      ...(src.settings || {}),
      chroma: { ...(src.settings?.chroma || {}), bgBlobId: null },
      reference: { ...(src.settings?.reference || {}), blobId: null },
    },
    audio: null,
  };

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
    await db.put('blobs', { id, projectId: project.id, name, blob: await entry.blob(typeForName(name)) });
    return id;
  };
  const audioId = await copyBlob(src.audio?.blobId);
  if (audioId) project.audio = { ...src.audio, blobId: audioId };
  const bgId = await copyBlob(src.settings?.chroma?.bgBlobId);
  if (bgId) project.settings.chroma.bgBlobId = bgId;
  const refId = await copyBlob(src.settings?.reference?.blobId);
  if (refId) project.settings.reference.blobId = refId;

  await db.put('projects', project);
  return project;
}
