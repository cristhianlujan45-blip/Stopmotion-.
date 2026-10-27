// Stored files a project refers to besides its frames (sound tracks, mouth
// images, chroma background, reference video), so that copying, packing or
// migrating a project never forgets one.

function* refs(project) {
  if (project.audio?.blobId) yield [project.audio, 'blobId']; // before multitrack sound
  for (const t of project.tracks || []) yield [t, 'blobId'];
  const s = project.settings || {};
  if (s.chroma?.bgBlobId) yield [s.chroma, 'bgBlobId'];
  if (s.reference?.blobId) yield [s.reference, 'blobId'];
  for (const c of s.lipsync?.characters || []) for (const k of Object.keys(c.mouths || {})) yield [c.mouths, k];
}

/** Ids of every stored file the project uses. */
export function mediaIds(project) {
  return [...new Set([...refs(project)].map(([o, k]) => o[k]).filter(Boolean))];
}

/**
 * Replaces every stored-file id of `project` (in place) with `await map(id)`;
 * references whose file could not be copied (null) are dropped.
 */
export async function remapMedia(project, map) {
  const done = new Map();
  for (const [o, k] of [...refs(project)]) {
    if (!done.has(o[k])) done.set(o[k], (await map(o[k])) ?? null);
    o[k] = done.get(o[k]);
  }
  if (project.audio && !project.audio.blobId) project.audio = null;
  if (project.tracks) project.tracks = project.tracks.filter((t) => t.blobId);
  for (const c of project.settings?.lipsync?.characters || []) {
    for (const k of Object.keys(c.mouths || {})) if (!c.mouths[k]) delete c.mouths[k];
  }
  return project;
}
