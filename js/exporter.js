import { makeCanvas, fitContain, extForType, pad, sleep, canvasToBlob } from './util.js';
import { expandExposures } from './timing.js';
import { createZip } from './zip.js';

const VIDEO_TYPES = [
  { mime: 'video/mp4;codecs=avc1.640028', audio: 'mp4a.40.2', label: 'MP4 (H.264)', ext: 'mp4' },
  { mime: 'video/mp4;codecs=avc1.42E01F', audio: 'mp4a.40.2', label: 'MP4 (H.264 Baseline)', ext: 'mp4' },
  { mime: 'video/mp4', audio: null, label: 'MP4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', audio: 'opus', label: 'WebM (VP9)', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', audio: 'opus', label: 'WebM (VP8)', ext: 'webm' },
  { mime: 'video/webm', audio: null, label: 'WebM', ext: 'webm' },
];

export function supportedVideoTypes() {
  if (typeof MediaRecorder === 'undefined') return [];
  const out = [];
  const seen = new Set();
  for (const t of VIDEO_TYPES) {
    if (!MediaRecorder.isTypeSupported(t.mime)) continue;
    const family = t.label.split(' ')[0];
    if (seen.has(family)) continue;
    seen.add(family);
    out.push(t);
  }
  return out;
}

function mimeWithAudio(type) {
  if (!type.audio) return type.mime;
  const withAudio = `${type.mime},${type.audio}`;
  return MediaRecorder.isTypeSupported(withAudio) ? withAudio : type.mime;
}

export function outputSize(srcW, srcH, targetH) {
  let w = srcW, h = srcH;
  if (targetH && targetH < srcH) { h = targetH; w = Math.round((srcW * targetH) / srcH); }
  // H.264 encoders need even dimensions
  return { w: w - (w % 2), h: h - (h % 2) };
}

/**
 * Records the sequence in real time to a video file through MediaRecorder.
 * Each exposure becomes one video frame at the project frame rate.
 */
export async function renderVideo({
  frames, fps, store, width, height, type, bitrate, audio, audioOffset = 0, startExposure = 0,
  filters = null, onProgress, signal,
}) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  const stream = canvas.captureStream(0);
  const vtrack = stream.getVideoTracks()[0];

  let audioDest = null;
  if (audio?.ready) {
    const actx = audio.context();
    audioDest = actx.createMediaStreamDestination();
    audioDest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }
  const mimeType = audioDest ? mimeWithAudio(type) : type.mime;
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: bitrate });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  const exposures = expandExposures(frames);
  const order = [];
  for (const idx of exposures) if (order[order.length - 1] !== idx) order.push(idx);

  // Decode ahead (already scaled to the output size) so drawing never waits on the disk.
  const decodeFrame = async (idx) => {
    const rec = await store.original(frames[idx].id);
    if (!rec) return null;
    const f = fitContain(rec.w, rec.h, width, height);
    return createImageBitmap(rec.full, {
      resizeWidth: Math.max(1, Math.round(f.w)),
      resizeHeight: Math.max(1, Math.round(f.h)),
      resizeQuality: 'high',
    });
  };
  const ahead = new Map();
  let nextToDecode = 0;
  const fill = () => {
    while (nextToDecode < order.length && ahead.size < 6) {
      const idx = order[nextToDecode++];
      if (!ahead.has(idx)) ahead.set(idx, decodeFrame(idx));
    }
  };
  fill();
  if (order.length) await ahead.get(order[0]);

  const frameMs = 1000 / fps;
  recorder.start(1000);
  if (audioDest) audio.play((startExposure - audioOffset) / fps, audioDest);
  const t0 = performance.now();
  let current = -1;
  let bmp = null;
  try {
    for (let e = 0; e < exposures.length; e++) {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      const idx = exposures[e];
      if (idx !== current) {
        bmp?.close?.();
        bmp = await ahead.get(idx);
        ahead.delete(idx);
        current = idx;
        fill();
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        if (bmp) {
          const f = fitContain(bmp.width, bmp.height, width, height);
          ctx.imageSmoothingQuality = 'high';
          ctx.filter = filters?.[idx] || 'none';
          ctx.drawImage(bmp, f.x, f.y, f.w, f.h);
          ctx.filter = 'none';
        }
      }
      vtrack.requestFrame?.();
      onProgress?.((e + 1) / exposures.length);
      const wait = t0 + (e + 1) * frameMs - performance.now();
      if (wait > 0) await sleep(wait);
    }
    await sleep(frameMs);
  } finally {
    bmp?.close?.();
    for (const p of ahead.values()) p.then((b) => b?.close?.());
    if (audioDest) audio.stop();
    if (recorder.state !== 'inactive') recorder.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
  }
  return new Blob(chunks, { type: mimeType.split(';')[0] });
}

/** Re-encodes an image with a canvas filter applied (colour grade / deflicker). */
async function applyFilter(blob, filter) {
  const bmp = await createImageBitmap(blob);
  const c = makeCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d');
  ctx.filter = filter;
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const type = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvasToBlob(c, type, 0.95);
}

/**
 * ZIP with one image per frame (or per exposure). Without `filters` the
 * original captures are copied untouched.
 */
export async function buildImageSequence({ frames, store, expand = true, baseName = 'frame', filters = null, onProgress }) {
  const indices = expand ? expandExposures(frames) : frames.map((_, i) => i);
  const files = [];
  const cache = new Map();
  for (let n = 0; n < indices.length; n++) {
    const idx = indices[n];
    let data = cache.get(idx);
    if (!data) {
      const rec = await store.original(frames[idx].id);
      const filter = filters?.[idx] || 'none';
      data = filter === 'none' ? rec.full : await applyFilter(rec.full, filter);
      cache.clear();
      cache.set(idx, data);
    }
    files.push({ name: `${baseName}_${pad(n + 1, 5)}.${extForType(data.type)}`, data });
    onProgress?.((n + 1) / indices.length / 2);
  }
  return createZip(files, (done, total) => onProgress?.(0.5 + done / total / 2));
}
