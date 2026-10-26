import {
  $, $$, uid, debounce, clamp, sleep, toast, safeFileName, makeCanvas,
  canvasToBlob, getPath, setPath, withDefaults, formatDate, isTypingTarget,
} from './util.js';
import { library } from './library.js';
import { pendingBrowserProjects, migrateProject } from './migrate.js';
import { Camera } from './camera.js';
import { FrameStore } from './framestore.js';
import { History } from './history.js';
import { AudioTrack } from './audio.js';
import { createViewer } from './viewer-gl.js';
import { Timeline } from './timeline.js';
import {
  totalExposures, expandExposures, exposureStart, formatTime, moveItems, computeSpacing,
} from './timing.js';
import { supportedVideoTypes, renderVideo, buildImageSequence, outputSize } from './exporter.js';
import { exportProjectFile, importProjectFile } from './projectio.js';
import { deflickerGains, gradeFilter } from './grading.js';
import { saveFile, isAndroidApp, isDesktopApp, isApp } from './platform.js';

const LS_LAST = 'mesora.lastProject';
const LS_CAMERA = 'mesora.camera';
const LS_WELCOMED = 'mesora.welcomed';
const LS_SECTIONS = 'mesora.sections';
const LS_UPDATE_CHECK = 'mesora.updateCheck';
const GRID_CYCLE = ['none', 'thirds', 'quarters', 'fine', 'center'];

function defaultSettings() {
  return {
    onion: { enabled: true, count: 1, opacity: 0.4, next: 0, colors: false, blend: 'normal' },
    mode: 'normal',
    blinkRate: 4,
    chroma: { color: '#00b140', threshold: 0.12, softness: 0.06, bgBlobId: null },
    grid: 'none',
    mask: 'none',
    safe: false,
    peaking: false,
    peakingThreshold: 60,
    histogram: false,
    guidesVisible: true,
    guideColor: '#ffcc00',
    guideWidth: 3,
    flipH: false,
    flipV: false,
    average: 1,
    format: 'jpeg',
    quality: 0.95,
    delay: 0,
    shutterSound: true,
    shortPlay: 6,
    loop: false,
    pingpong: false,
    timelapseInterval: 5,
    zoom: 72,
    grade: { brightness: 1, contrast: 1, saturation: 1, deflicker: false },
    reference: { blobId: null, name: '', opacity: 0.5, offset: 0, visible: true },
  };
}

function newProject(name, fps = 12) {
  const now = Date.now();
  return {
    id: uid(), name, fps, width: 1920, height: 1080,
    frames: [], audio: null, guides: [], settings: defaultSettings(),
    createdAt: now, updatedAt: now,
  };
}

// ---------------------------------------------------------------- elements

const els = {
  area: $('#viewerArea'),
  stage: $('#stage'),
  stageEmpty: $('#stageEmpty'),
  stageEmptyMsg: $('#stageEmptyMsg'),
  countdown: $('#countdown'),
  flash: $('#flash'),
  loupe: $('#loupe'),
  guides: $('#guidesCanvas'),
  hudMode: $('#hudMode'),
  hudFrame: $('#hudFrame'),
  hudTime: $('#hudTime'),
  hudFlags: $('#hudFlags'),
  dropHint: $('#dropHint'),
  projectName: $('#projectName'),
  takeLabel: $('#takeLabel'),
  saveState: $('#saveState'),
  hudNote: $('#hudNote'),
  frameNote: $('#frameNote'),
  refInfo: $('#refInfo'),
  camDevice: $('#camDevice'),
  camRes: $('#camRes'),
  camToggle: $('#btnCamToggle'),
  camInfo: $('#camInfo'),
  camControls: $('#camControls'),
  histogram: $('#histogram'),
  capture: $('#btnCapture'),
  play: $('#tPlay'),
  live: $('#tLive'),
  loop: $('#tLoop'),
  pingpong: $('#tPingpong'),
  holdVal: $('#holdVal'),
  undo: $('#tUndo'),
  redo: $('#tRedo'),
  fps: $('#fpsSelect'),
  projectInfo: $('#projectInfo'),
  audioInfo: $('#audioInfo'),
  audioOffset: $('#audioOffset'),
  blink: $('#btnBlink'),
  draw: $('#btnDraw'),
  loupeChk: $('#chkLoupe'),
  timelapse: $('#btnTimelapse'),
  timelapseInfo: $('#timelapseInfo'),
};

// ---------------------------------------------------------------- core objects

const state = {
  project: null,
  playhead: 0,
  selection: new Set(),
  anchor: -1,
  busy: false,
  dirty: true,
  blink: false,
  loupe: false,
  loupePos: null,
  drawing: false,
  activeStroke: null,
  timelapseTimer: 0,
  timelapseCount: 0,
  chromaBg: null,
  exportAbort: null,
  lastHist: 0,
  gains: new Map(),
  ref: null,
  pendingCaptures: 0,
  saving: false,
};

const player = {
  playing: false, exposures: [], t0: 0, startExposure: 0, step: -1, index: -1, exposure: 0,
  loop: false, pingpong: false, thenLive: false, returnTo: 0,
};

const camera = new Camera($('#video'));
const store = new FrameStore({ onLoad: () => { state.dirty = true; } });
const history = new History();
const audio = new AudioTrack();
const viewer = createViewer({
  area: els.area, stage: els.stage, main: $('#mainCanvas'), overlay: $('#overlayCanvas'),
  guides: els.guides, loupe: els.loupe,
});
const timeline = new Timeline({
  wrap: $('#timelineWrap'), root: $('#timeline'), ruler: $('#ruler'), wave: $('#waveform'), store,
  onSelect: onTimelineSelect,
  onLive: () => goLive(),
  onMove: (target) => moveSelected(target),
  onScrub: (i) => setPlayhead(i),
  onZoom: (dir) => setSetting('zoom', clamp(Math.round(S().zoom * (dir > 0 ? 1.15 : 1 / 1.15)), 28, 180)),
});

const P = () => state.project;
const S = () => state.project.settings;
const frames = () => state.project.frames;
const isLive = () => state.playhead >= frames().length;

// ---------------------------------------------------------------- persistence

function saveNow() {
  const p = P();
  if (!p) return Promise.resolve();
  p.updatedAt = Date.now();
  state.saving = true;
  updateSaveState();
  return library.saveProject(p)
    .then(() => { state.saving = false; updateSaveState(); })
    .catch((err) => {
      state.saving = false;
      updateSaveState(err);
      toast(`No se pudo guardar: ${err.message}`, 'error');
    });
}
const saveSoon = debounce(saveNow, 400);

function updateSaveState(error) {
  const el = els.saveState;
  const label = el.querySelector('span');
  el.classList.toggle('error', !!error);
  const busy = state.saving || state.pendingCaptures > 0;
  el.classList.toggle('saving', busy && !error);
  if (error) label.textContent = 'Error al guardar';
  else if (state.pendingCaptures > 1) label.textContent = `Guardando ${state.pendingCaptures} capturas…`;
  else if (busy) label.textContent = 'Guardando…';
  else label.textContent = 'Guardado';
}

async function openProject(p, report = null) {
  stopPlayback(false);
  stopTimelapse();
  if (P()) saveSoon.flush();
  store.clear(p.id);
  history.clear();
  p.settings = withDefaults(p.settings, defaultSettings());
  p.guides ??= [];
  p.frames = (p.frames || []).map((f) => ({ key: f.key || uid(), id: f.id, hold: f.hold || 1, ...(f.note ? { note: f.note } : {}) }));
  state.gains = new Map();
  state.project = p;
  state.playhead = p.frames.length;
  state.selection = new Set();
  state.anchor = -1;
  localStorage.setItem(LS_LAST, p.id);

  els.projectName.value = p.name;
  updateTakeLabel();
  setFpsUI(p.fps);
  if (!p.frames.length && camera.active) { p.width = camera.width; p.height = camera.height; }
  viewer.setSize(p.width, p.height);
  applySettingsToUI();
  renderTimeline();
  await restoreAudio();
  await restoreChromaBg();
  await restoreReference();
  scheduleGains();
  refresh();
  updateProjectInfo();
  store.collectGarbage(p.id, p.frames.map((f) => f.id)).catch(() => {});
  showRecoveryReport(report);
}

function updateTakeLabel() {
  const p = P();
  els.takeLabel.hidden = !p.scene;
  if (p.scene) els.takeLabel.textContent = `${p.scene.name} · ${p.take.name}`;
}

/** Tells the user what crash recovery found when a take was opened. */
function showRecoveryReport(report) {
  if (!report) return;
  if (report.recovered.length) {
    const n = report.recovered.length;
    toast(`Se recuperaron ${n} ${n === 1 ? 'captura que no llegó' : 'capturas que no llegaron'} a guardarse en el timeline. Están al final, con una nota.`, 'warn', 9000);
  }
  if (report.missing.length) {
    toast(`Faltan en el disco ${report.missing.length} archivos originales de esta toma. ¿Se movieron o borraron fuera de MESORA?`, 'error', 9000);
  }
  if (report.partials.length) console.warn('Archivos de escrituras interrumpidas (no se han borrado):', report.partials);
}

function setProjectSize(w, h) {
  const p = P();
  if (p.width === w && p.height === h) return;
  p.width = w;
  p.height = h;
  viewer.setSize(w, h);
  saveSoon();
}

// ---------------------------------------------------------------- rendering

function loop(now) {
  requestAnimationFrame(loop);
  if (!P()) return;
  if (player.playing) tickPlayer(now);
  const liveCam = isLive() && camera.active && !player.playing;
  if (!state.dirty && !liveCam && !state.blink) return;
  state.dirty = false;
  compose(now);
  viewer.flush();
  const s = S();
  if (s.histogram && now - state.lastHist > 200) {
    state.lastHist = now;
    viewer.histogram(els.histogram);
  }
  if (state.loupe && state.loupePos) updateLoupe();
}

/** Colour grade + deflicker gain for the frame at `index`, or null when nothing changes. */
function frameGrade(index) {
  const g = S().grade;
  const f = frames()[index];
  const gain = g.deflicker && f ? state.gains.get(f.key) ?? 1 : 1;
  const grade = { brightness: g.brightness * gain, contrast: g.contrast, saturation: g.saturation };
  return gradeFilter(grade) === 'none' ? null : grade;
}

/** Canvas filter string of the same grade, used when exporting. */
function frameFilter(index) {
  return gradeFilter(frameGrade(index) || {});
}

const ONION_PREV_TINT = [1, 0.5, 0.5];
const ONION_NEXT_TINT = [0.5, 1, 0.6];

/**
 * Onion skin around `current` (the frame shown, or frames().length when live):
 * earlier frames, and later ones when reviewing. Nearer frames are more opaque.
 */
function drawOnion(current) {
  const s = S().onion;
  const fr = frames();
  const op = s.blend === 'lighten' || s.blend === 'darken' ? s.blend : 'source-over';
  const layer = (idx, k, n, tint) => {
    const bmp = store.peek(fr[idx].id);
    if (bmp) viewer.draw(bmp, bmp.width, bmp.height, { alpha: (s.opacity * (n - k)) / n, op, tint: s.colors ? tint : null });
  };
  for (let k = s.count - 1; k >= 0; k--) if (current - 1 - k >= 0) layer(current - 1 - k, k, s.count, ONION_PREV_TINT);
  if (current < fr.length) {
    for (let k = s.next - 1; k >= 0; k--) if (current + 1 + k < fr.length) layer(current + 1 + k, k, s.next, ONION_NEXT_TINT);
  }
}

function compose(now) {
  const s = S();
  const fr = frames();
  const v = viewer;
  const video = camera.video;
  const flip = { flipH: s.flipH, flipV: s.flipV };
  let keyed = s.mode === 'chroma';

  if (player.playing) {
    const f = fr[player.index];
    const bmp = f && store.peek(f.id);
    if (!bmp) return;
    v.clear();
    v.draw(bmp, bmp.width, bmp.height, { grade: frameGrade(player.index) });
    if (keyed) v.chroma(s.chroma, state.chromaBg);
    drawReference(player.exposure);
    return;
  }

  if (isLive()) {
    const last = fr.length ? store.peek(fr[fr.length - 1].id) : null;
    const showLast = state.blink && fr.length && Math.floor((now * s.blinkRate) / 1000) % 2 === 1;
    if (showLast || !camera.active) {
      v.clear();
      if (last) v.draw(last, last.width, last.height);
      else keyed = false;
    } else if (s.mode === 'difference' && last) {
      v.clear();
      v.draw(last, last.width, last.height);
      v.draw(video, camera.width, camera.height, { ...flip, op: 'difference' });
    } else {
      v.clear();
      v.draw(video, camera.width, camera.height, flip);
      if (s.onion.enabled && fr.length) drawOnion(fr.length);
    }
  } else {
    const i = state.playhead;
    const bmp = store.peek(fr[i].id);
    if (!bmp) return;
    v.clear();
    const prev = i > 0 ? store.peek(fr[i - 1].id) : null;
    if (s.mode === 'difference' && prev) {
      v.draw(prev, prev.width, prev.height);
      v.draw(bmp, bmp.width, bmp.height, { op: 'difference' });
    } else {
      v.draw(bmp, bmp.width, bmp.height, { grade: frameGrade(i) });
      if (s.onion.enabled) drawOnion(i);
    }
  }
  if (keyed) v.chroma(s.chroma, state.chromaBg);
  if (s.peaking) v.peaking(s.peakingThreshold);
  drawReference(isLive() ? totalExposures(fr) : exposureStart(fr, state.playhead));
}

/** Reference (rotoscope) layer, kept in sync with the exposure being shown. */
function drawReference(exposure) {
  const ref = state.ref;
  const r = S().reference;
  if (!ref || !r.visible) return;
  if (ref.kind === 'image') {
    viewer.draw(ref.el, ref.el.width, ref.el.height, { alpha: r.opacity });
    return;
  }
  const video = ref.el;
  const t = (exposure - r.offset) / P().fps;
  if (t < 0 || !(video.duration > 0) || t > video.duration) return;
  if (Math.abs(video.currentTime - t) > 0.5 / P().fps && !video.seeking) video.currentTime = t;
  if (video.readyState >= 2) viewer.draw(video, video.videoWidth, video.videoHeight, { alpha: r.opacity });
}

function drawOverlays() {
  viewer.drawOverlays(S());
}

function drawGuides() {
  viewer.drawGuides(P().guides, S().guidesVisible || state.drawing, state.activeStroke);
}

viewer.onResize = () => {
  if (!P()) return;
  drawOverlays();
  drawGuides();
  state.dirty = true;
};

// ---------------------------------------------------------------- playback

function startPlayback({ start = 0, end = frames().length, loop = S().loop, pingpong = S().pingpong, thenLive = false } = {}) {
  const fr = frames();
  if (!fr.length) { toast('Todavía no hay fotogramas', 'warn'); return; }
  stopPlayback(false);
  const exposures = expandExposures(fr, start, end);
  if (!exposures.length) return;
  Object.assign(player, {
    playing: true, exposures, t0: performance.now(), startExposure: exposureStart(fr, start),
    step: -1, index: exposures[0], exposure: exposureStart(fr, start), loop, pingpong, thenLive, returnTo: state.playhead,
  });
  playAudioFrom(0);
  for (let k = 0; k < Math.min(24, exposures.length); k++) store.load(fr[exposures[k]].id);
  refresh();
}

function playAudioFrom(pos) {
  if (!audio.ready || player.pingpong) return;
  const p = P();
  audio.play((player.startExposure + pos - (p.audio?.offset || 0)) / p.fps);
}

function tickPlayer(now) {
  const fps = P().fps;
  const n = player.exposures.length;
  let step = Math.floor(((now - player.t0) * fps) / 1000);
  let pos;
  if (player.pingpong && n > 1) {
    const cycle = 2 * n - 2;
    if (!player.loop && step >= cycle) { stopPlayback(true); return; }
    const s = step % cycle;
    pos = s < n ? s : cycle - s;
  } else {
    if (step >= n) {
      if (!player.loop) { stopPlayback(true); return; }
      const cycles = Math.floor(step / n);
      player.t0 += (cycles * n * 1000) / fps;
      step -= cycles * n;
      playAudioFrom(step);
    }
    pos = step;
  }
  if (step === player.step) return;
  player.step = step;
  player.index = player.exposures[pos];
  player.exposure = player.startExposure + pos;
  state.dirty = true;
  const fr = frames();
  for (let k = 1; k <= 12; k++) {
    const e = player.exposures[(pos + k) % n];
    if (e != null) store.load(fr[e].id);
  }
  timeline.update({ playhead: state.playhead, selection: state.selection, playingIndex: player.index });
  updateHud(player.startExposure + pos);
}

function stopPlayback(finished) {
  if (!player.playing) return;
  player.playing = false;
  audio.stop();
  if (finished) state.playhead = player.thenLive ? frames().length : player.returnTo;
  else {
    state.playhead = player.index;
    const f = frames()[player.index];
    if (f) { state.selection = new Set([f.key]); state.anchor = player.index; }
  }
  player.index = -1;
  refresh();
}

function togglePlay() {
  if (player.playing) { stopPlayback(false); return; }
  const fr = frames();
  const sel = selectedIndices(true);
  if (sel.length > 1) { startPlayback({ start: sel[0], end: sel[sel.length - 1] + 1 }); return; }
  const startAt = isLive() || state.playhead >= fr.length - 1 ? 0 : state.playhead;
  startPlayback({ start: startAt });
}

function shortPlay() {
  const len = frames().length;
  if (!len) return;
  startPlayback({ start: Math.max(0, len - S().shortPlay), end: len, loop: false, pingpong: false, thenLive: true });
}

// ---------------------------------------------------------------- navigation & selection

function selectedIndices(strict = false) {
  const fr = frames();
  const out = [];
  fr.forEach((f, i) => { if (state.selection.has(f.key)) out.push(i); });
  if (!out.length && !strict && state.playhead < fr.length) out.push(state.playhead);
  return out;
}

function setPlayhead(i, { scrub = true } = {}) {
  if (player.playing) stopPlayback(false);
  const fr = frames();
  i = clamp(i, 0, fr.length);
  state.playhead = i;
  state.selection = i < fr.length ? new Set([fr[i].key]) : new Set();
  state.anchor = i < fr.length ? i : -1;
  if (scrub && i < fr.length) scrubAudio(i);
  refresh();
}

const step = (d) => setPlayhead(state.playhead + d);
const goLive = () => setPlayhead(frames().length);

function extendSelection(d) {
  const fr = frames();
  if (!fr.length) return;
  if (state.anchor < 0) state.anchor = Math.min(state.playhead, fr.length - 1);
  const i = clamp(state.playhead + d, 0, fr.length - 1);
  selectRange(state.anchor, i);
  state.playhead = i;
  refresh();
}

function selectRange(a, b) {
  const fr = frames();
  const [lo, hi] = a < b ? [a, b] : [b, a];
  state.selection = new Set(fr.slice(lo, hi + 1).map((f) => f.key));
}

function toggleLiveLast() {
  const len = frames().length;
  if (!len) return;
  setPlayhead(isLive() ? len - 1 : len);
}

function selectAll() {
  state.selection = new Set(frames().map((f) => f.key));
  refresh();
}

function onTimelineSelect(index, e) {
  if (player.playing) stopPlayback(false);
  const fr = frames();
  const key = fr[index]?.key;
  if (!key) return;
  if (e.dragStart) {
    if (!state.selection.has(key)) { state.selection = new Set([key]); state.anchor = index; }
    state.playhead = index;
  } else if (e.shiftKey && state.anchor >= 0) {
    selectRange(state.anchor, index);
    state.playhead = index;
  } else if (e.ctrlKey || e.metaKey) {
    if (state.selection.has(key)) state.selection.delete(key);
    else state.selection.add(key);
    state.anchor = index;
    state.playhead = index;
  } else {
    setPlayhead(index);
    return;
  }
  refresh();
}

function scrubAudio(index) {
  if (!audio.ready) return;
  const p = P();
  const fr = frames();
  const t = (exposureStart(fr, index) - (p.audio?.offset || 0)) / p.fps;
  audio.scrub(t, Math.max(fr[index].hold / p.fps, 0.08));
}

// ---------------------------------------------------------------- editing

const snapshot = () => ({ frames: frames().map((f) => ({ ...f })), playhead: state.playhead });

function commit(mutate) {
  history.push(snapshot());
  mutate(frames());
  afterFramesChanged();
}

function afterFramesChanged() {
  const fr = frames();
  state.playhead = clamp(state.playhead, 0, fr.length);
  const keys = new Set(fr.map((f) => f.key));
  for (const k of state.selection) if (!keys.has(k)) state.selection.delete(k);
  renderTimeline();
  saveSoon();
  scheduleGains();
  refresh();
  updateProjectInfo();
}

function renderTimeline() {
  timeline.render(frames(), S().zoom, P().fps);
  drawWave();
}

// Deflicker gains depend on the whole sequence, so they are recomputed after edits.
let gainsRun = 0;
const scheduleGains = debounce(async () => {
  const p = P();
  if (!p || !p.settings.grade.deflicker) return;
  const run = ++gainsRun;
  const fr = p.frames.slice();
  const lumas = [];
  for (const f of fr) lumas.push(await store.luma(f.id));
  if (run !== gainsRun || P() !== p) return;
  const gains = deflickerGains(lumas);
  state.gains = new Map(fr.map((f, i) => [f.key, gains[i]]));
  state.dirty = true;
}, 250);

function drawWave() {
  const p = P();
  timeline.drawWave(audio, p.fps, p.audio?.offset || 0, totalExposures(p.frames));
}

function deleteSelected() {
  const idx = selectedIndices();
  if (!idx.length) return;
  commit((fr) => {
    const set = new Set(idx);
    P().frames = fr.filter((_, i) => !set.has(i));
    const next = Math.min(idx[0], P().frames.length);
    state.playhead = next;
    state.selection = next < P().frames.length ? new Set([P().frames[next].key]) : new Set();
    state.anchor = next;
  });
  const disk = library.kind === 'disk';
  const msg = idx.length === 1 ? 'Fotograma eliminado.' : `${idx.length} fotogramas eliminados.`;
  toast(disk ? `${msg} La foto original sigue guardada.` : msg, 'info', 6000, [
    { label: 'Deshacer', onClick: undo },
    ...(disk ? [{ label: 'Ver papelera', onClick: () => openTrash().catch((err) => toast(err.message, 'error')) }] : []),
  ]);
}

function duplicateSelected() {
  const idx = selectedIndices();
  if (!idx.length) return;
  commit((fr) => {
    const copies = idx.map((i) => ({ ...fr[i], key: uid() }));
    const at = idx[idx.length - 1] + 1;
    fr.splice(at, 0, ...copies);
    state.selection = new Set(copies.map((c) => c.key));
    state.playhead = at;
    state.anchor = at;
  });
}

function changeHold(delta) {
  const idx = selectedIndices();
  if (!idx.length) return;
  commit((fr) => { for (const i of idx) fr[i].hold = clamp(fr[i].hold + delta, 1, 99); });
}

function moveSelected(target) {
  const idx = selectedIndices();
  if (!idx.length) return;
  const keys = idx.map((i) => frames()[i].key);
  commit((fr) => {
    P().frames = moveItems(fr, idx, target);
    const first = P().frames.findIndex((f) => f.key === keys[0]);
    state.playhead = first;
    state.anchor = first;
    state.selection = new Set(keys);
  });
}

function undo() {
  const snap = history.undo(snapshot());
  if (!snap) return;
  P().frames = snap.frames;
  state.playhead = snap.playhead;
  state.selection = new Set();
  afterFramesChanged();
}

function redo() {
  const snap = history.redo(snapshot());
  if (!snap) return;
  P().frames = snap.frames;
  state.playhead = snap.playhead;
  state.selection = new Set();
  afterFramesChanged();
}

// ---------------------------------------------------------------- capture

async function countdown(seconds) {
  els.countdown.hidden = false;
  for (let s = seconds; s > 0; s--) {
    els.countdown.textContent = s;
    await sleep(1000);
  }
  els.countdown.hidden = true;
}

function flash() {
  els.flash.classList.remove('go');
  void els.flash.offsetWidth;
  els.flash.classList.add('go');
}

// Grabbing is instant; encoding and storing run in order in the background,
// so rapid captures are never dropped.
let saveChain = Promise.resolve();

async function capture(mode = 'append', { skipDelay = false } = {}) {
  if (state.busy) return;
  if (!camera.active) { toast('Conecta una cámara para capturar', 'warn'); return; }
  if (player.playing) stopPlayback(false);
  const project = P();
  const s = S();
  state.busy = true;
  let canvas;
  try {
    if (s.delay > 0 && !skipDelay) await countdown(s.delay);
    if (!camera.active) return;
    canvas = await camera.grab({ average: s.average, flipH: s.flipH, flipV: s.flipV });
  } catch (err) {
    toast(`Error al capturar: ${err.message}`, 'error', 4500);
    return;
  } finally {
    els.countdown.hidden = true;
    state.busy = false;
  }
  flash();
  if (s.shutterSound) audio.shutter();

  state.pendingCaptures++;
  updateSaveState();
  const job = saveChain.then(async () => {
    if (P() !== project) return;
    if (!frames().length) setProjectSize(canvas.width, canvas.height);
    const { id } = await store.addFromCanvas(project.id, canvas, { format: s.format, quality: s.quality });
    if (P() !== project) return;
    const entry = { key: uid(), id, hold: 1 };
    commit((fr) => {
      const at = state.playhead;
      if (mode === 'replace' && at < fr.length) {
        entry.hold = fr[at].hold;
        if (fr[at].note) entry.note = fr[at].note;
        fr.splice(at, 1, entry);
        state.selection = new Set([entry.key]);
      } else if (mode === 'insert' && at < fr.length) {
        fr.splice(at + 1, 0, entry);
        state.playhead = at + 1;
        state.selection = new Set([entry.key]);
      } else {
        fr.push(entry);
        state.playhead = fr.length;
        state.selection = new Set();
      }
    });
  }).catch((err) => {
    console.error(err);
    const quota = err?.name === 'QuotaExceededError';
    toast(quota ? 'No queda espacio de almacenamiento en el navegador' : `Error al guardar la captura: ${err.message}`, 'error', 4500);
  }).finally(() => {
    state.pendingCaptures--;
    updateSaveState();
  });
  saveChain = job;
  return job;
}

// ---------------------------------------------------------------- camera

function camPrefs() {
  try { return JSON.parse(localStorage.getItem(LS_CAMERA)) || {}; } catch { return {}; }
}

function saveCamPrefs(patch) {
  localStorage.setItem(LS_CAMERA, JSON.stringify({ ...camPrefs(), ...patch }));
}

async function refreshDevices() {
  const devices = await Camera.listDevices().catch(() => []);
  const current = camera.track?.getSettings?.().deviceId || camPrefs().deviceId || '';
  els.camDevice.innerHTML = '';
  if (!devices.length) {
    els.camDevice.append(new Option('Ninguna cámara detectada', ''));
    return;
  }
  devices.forEach((d, i) => els.camDevice.append(new Option(d.label || `Cámara ${i + 1}`, d.deviceId)));
  if (devices.some((d) => d.deviceId === current)) els.camDevice.value = current;
}

async function startCamera() {
  if (!Camera.supported) {
    toast('Este navegador no permite usar la cámara (se necesita HTTPS o localhost)', 'error', 5000);
    return;
  }
  const prefs = camPrefs();
  const [w, h] = els.camRes.value.split('x').map(Number);
  els.stageEmptyMsg.textContent = 'Conectando cámara…';
  try {
    await camera.start({ deviceId: els.camDevice.value || prefs.deviceId, width: w, height: h });
  } catch (err) {
    const msg = err.name === 'NotAllowedError' ? 'Permiso de cámara denegado'
      : err.name === 'NotFoundError' ? 'No se encontró ninguna cámara'
      : err.name === 'NotReadableError' ? 'La cámara está en uso por otra aplicación'
      : `No se pudo abrir la cámara: ${err.message}`;
    els.stageEmptyMsg.textContent = msg;
    toast(msg, 'error', 4500);
    updateCamUI();
    return;
  }
  await refreshDevices();
  const deviceId = camera.track.getSettings?.().deviceId || '';
  saveCamPrefs({ deviceId, resolution: els.camRes.value });
  const saved = prefs.controls?.[deviceId];
  if (saved && Object.keys(saved).length) {
    await camera.track.applyConstraints({ advanced: [saved] }).catch(() => {});
  }
  const p = P();
  if (!p.frames.length) setProjectSize(camera.width, camera.height);
  else if (Math.abs(camera.width / camera.height - p.width / p.height) > 0.01) {
    toast('La relación de aspecto de la cámara no coincide con la del proyecto', 'warn', 4500);
  }
  buildCamControls();
  updateCamUI();
  keepAwake(true);
  state.dirty = true;
}

function stopCamera() {
  camera.stop();
  keepAwake(false);
  stopTimelapse();
  els.stageEmptyMsg.textContent = 'Cámara desconectada';
  buildCamControls();
  updateCamUI();
  state.dirty = true;
}

camera.onEnded = () => {
  toast('Se perdió la señal de la cámara', 'error');
  stopCamera();
};

function updateCamUI() {
  const on = camera.active;
  els.camToggle.textContent = on ? 'Desconectar' : 'Conectar';
  els.camInfo.textContent = on ? camera.info() : 'Sin señal';
  els.capture.disabled = !on;
  updateStageEmpty();
}

function updateStageEmpty() {
  els.stageEmpty.hidden = camera.active || !isLive() || player.playing;
}

function rememberControl(key, value) {
  const deviceId = camera.track?.getSettings?.().deviceId;
  if (!deviceId) return;
  const prefs = camPrefs();
  const controls = prefs.controls || {};
  controls[deviceId] = { ...(controls[deviceId] || {}), [key]: value };
  saveCamPrefs({ controls });
}

function rememberAllControls(reset = false) {
  const deviceId = camera.track?.getSettings?.().deviceId;
  if (!deviceId) return;
  const prefs = camPrefs();
  const controls = prefs.controls || {};
  if (reset) delete controls[deviceId];
  else {
    const s = camera.settings();
    const saved = {};
    for (const c of camera.describeControls()) if (s[c.key] != null) saved[c.key] = s[c.key];
    controls[deviceId] = saved;
  }
  saveCamPrefs({ controls });
}

function buildCamControls() {
  const root = els.camControls;
  root.innerHTML = '';
  if (!camera.active) {
    root.innerHTML = '<p class="muted small">Conecta una cámara para ver sus controles.</p>';
    return;
  }
  const controls = camera.describeControls();
  if (!controls.length) {
    root.innerHTML = '<p class="muted small">Esta cámara no expone controles manuales al navegador. Usa el software del fabricante para fijar exposición y balance.</p>';
    return;
  }
  for (const c of controls) {
    const label = document.createElement('label');
    label.className = c.type === 'toggle' ? 'check' : 'field';
    if (c.type === 'select') {
      label.innerHTML = `<span>${c.label}</span>`;
      const sel = document.createElement('select');
      for (const o of c.options) sel.append(new Option(o.label, o.value));
      sel.value = c.value;
      sel.addEventListener('change', async () => {
        try {
          await camera.applyControl(c.key, sel.value);
          rememberControl(c.key, sel.value);
          buildCamControls();
        } catch (err) { toast(`No se pudo aplicar: ${err.message}`, 'error'); }
      });
      label.append(sel);
    } else if (c.type === 'range') {
      label.innerHTML = `<span>${c.label} <output>${fmtNum(c.value)}</output></span>`;
      const input = document.createElement('input');
      Object.assign(input, { type: 'range', min: c.min, max: c.max, step: c.step, value: c.value });
      const out = label.querySelector('output');
      const apply = debounce(async (v) => {
        try {
          await camera.applyControl(c.key, v);
          rememberControl(c.key, v);
        } catch (err) { toast(`No se pudo aplicar: ${err.message}`, 'error'); }
      }, 60);
      input.addEventListener('input', () => { out.textContent = fmtNum(Number(input.value)); apply(Number(input.value)); });
      label.append(input);
    } else {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = c.value;
      input.addEventListener('change', () => camera.applyControl(c.key, input.checked).catch(() => {}));
      label.append(input, document.createTextNode(` ${c.label}`));
    }
    root.append(label);
  }
}

const fmtNum = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100);

// ---------------------------------------------------------------- HUD & transport

function refresh() {
  state.dirty = true;
  timeline.update({ playhead: state.playhead, selection: state.selection, playingIndex: player.playing ? player.index : -1 });
  updateHud();
  updateTransport();
  updateStageEmpty();
  updateNoteUI();
}

// ---------------------------------------------------------------- frame notes (X-sheet)

function updateNoteUI() {
  const f = isLive() ? null : frames()[state.playhead];
  els.frameNote.disabled = !f;
  if (document.activeElement !== els.frameNote) els.frameNote.value = f?.note || '';
  els.frameNote.placeholder = f ? 'Nota o fonema (N)' : 'Elige un fotograma';
}

function setNote(text) {
  const i = state.playhead;
  const f = frames()[i];
  if (!f) return;
  const note = text.trim();
  if ((f.note || '') === note) return;
  commit((fr) => {
    if (note) fr[i].note = note;
    else delete fr[i].note;
  });
}

function updateHud(exposure) {
  const fr = frames();
  const shown = player.playing ? fr[player.index] : fr[state.playhead];
  els.hudNote.hidden = !shown?.note;
  els.hudNote.textContent = shown?.note || '';
  const fps = P().fps;
  const total = totalExposures(fr);
  if (player.playing) {
    els.hudMode.className = 'badge play';
    els.hudMode.textContent = 'REPRODUCIENDO';
    els.hudFrame.textContent = `Fotograma ${player.index + 1} / ${fr.length}`;
    els.hudTime.textContent = `${formatTime(exposure ?? player.startExposure, fps)} / ${formatTime(total, fps)}`;
  } else if (isLive()) {
    els.hudMode.className = 'badge live';
    els.hudMode.textContent = 'EN VIVO';
    els.hudFrame.textContent = `Siguiente: fotograma ${fr.length + 1}`;
    els.hudTime.textContent = formatTime(total, fps);
  } else {
    els.hudMode.className = 'badge review';
    els.hudMode.textContent = 'REVISIÓN';
    els.hudFrame.textContent = `Fotograma ${state.playhead + 1} / ${fr.length}`;
    els.hudTime.textContent = `${formatTime(exposureStart(fr, state.playhead), fps)} / ${formatTime(total, fps)}`;
  }
}

function updateHudFlags() {
  const s = S();
  const flags = [];
  if (s.onion.enabled) flags.push(`Cebolla ×${s.onion.count}${s.onion.next ? ` +${s.onion.next}` : ''}`);
  if (s.mode === 'difference') flags.push('Diferencia');
  if (s.mode === 'chroma') flags.push('Croma');
  if (state.blink) flags.push('Parpadeo');
  if (s.peaking) flags.push('Peaking');
  if (s.average > 1) flags.push(`Promedio ×${s.average}`);
  if (s.delay > 0) flags.push(`Retardo ${s.delay}s`);
  if (state.timelapseTimer) flags.push(`Intervalómetro ${s.timelapseInterval}s`);
  if (state.drawing) flags.push('Dibujando guías');
  els.hudFlags.innerHTML = '';
  for (const f of flags) {
    const span = document.createElement('span');
    span.textContent = f;
    els.hudFlags.append(span);
  }
}

function updateTransport() {
  const s = S();
  els.play.classList.toggle('on', player.playing);
  els.play.querySelector('use').setAttribute('href', player.playing ? '#i-pause' : '#i-play');
  els.live.classList.toggle('on', isLive() && !player.playing);
  els.loop.classList.toggle('on', s.loop);
  els.pingpong.classList.toggle('on', s.pingpong);
  els.undo.disabled = !history.canUndo;
  els.redo.disabled = !history.canRedo;
  const idx = selectedIndices();
  const holds = [...new Set(idx.map((i) => frames()[i].hold))];
  els.holdVal.textContent = holds.length === 1 ? `×${holds[0]}` : holds.length ? '×…' : '—';
}

function updateProjectInfo() {
  const p = P();
  const total = totalExposures(p.frames);
  els.projectInfo.textContent = `${p.frames.length} fotogramas · ${total} exposiciones · ${formatTime(total, p.fps)} · ${p.width} × ${p.height}`;
}

function setFpsUI(fps) {
  if (![...els.fps.options].some((o) => Number(o.value) === fps)) els.fps.insertBefore(new Option(`${fps} fps`, fps), els.fps.querySelector('[value="custom"]'));
  els.fps.value = String(fps);
}

// ---------------------------------------------------------------- settings binding

function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'range' || el.type === 'number' || el.dataset.type === 'number') return Number(el.value);
  return el.value;
}

function bindSettings() {
  for (const el of $$('[data-setting]')) {
    const path = el.dataset.setting;
    const live = el.type === 'range' || el.type === 'color';
    el.addEventListener(live ? 'input' : 'change', () => {
      const v = readInput(el);
      if (typeof v === 'number' && !Number.isFinite(v)) return;
      setPath(S(), path, v);
      onSettingChanged(path);
    });
  }
}

function applySettingsToUI() {
  const s = S();
  for (const el of $$('[data-setting]')) {
    const v = getPath(s, el.dataset.setting);
    if (el.type === 'checkbox') el.checked = !!v;
    else if (v != null) el.value = String(v);
  }
  updateOutputs();
  updateModeUI();
  els.histogram.hidden = !s.histogram;
  drawOverlays();
  drawGuides();
  updateHudFlags();
}

function updateOutputs() {
  const s = S();
  for (const out of $$('[data-out]')) {
    const path = out.dataset.out;
    const v = getPath(s, path);
    if (/opacity|quality|grade\./.test(path)) out.textContent = `${Math.round(v * 100)}%`;
    else if (path === 'blinkRate') out.textContent = `${v} /s`;
    else if (path.startsWith('chroma.')) out.textContent = v.toFixed(3);
    else if (path === 'guideWidth') out.textContent = `${v}px`;
    else out.textContent = v;
  }
}

function onSettingChanged(path) {
  saveSoon();
  state.dirty = true;
  updateOutputs();
  if (['grid', 'mask', 'safe'].includes(path)) drawOverlays();
  if (path.startsWith('guide')) drawGuides();
  if (path === 'histogram') els.histogram.hidden = !S().histogram;
  if (path === 'zoom') renderTimeline();
  if (path === 'timelapseInterval' && state.timelapseTimer) { stopTimelapse(); startTimelapse(); }
  if (path === 'grade.deflicker') { state.gains = new Map(); scheduleGains(); }
  updateHudFlags();
  updateTransport();
}

function setSetting(path, value) {
  setPath(S(), path, value);
  const el = $(`[data-setting="${path}"]`);
  if (el) {
    if (el.type === 'checkbox') el.checked = !!value;
    else el.value = String(value);
  }
  onSettingChanged(path);
}

function setMode(mode) {
  S().mode = S().mode === mode && mode !== 'normal' ? 'normal' : mode;
  updateModeUI();
  onSettingChanged('mode');
}

function updateModeUI() {
  for (const b of $$('#modeSeg button')) b.classList.toggle('active', b.dataset.mode === S().mode);
}

function toggleBlink() {
  state.blink = !state.blink;
  els.blink.classList.toggle('on', state.blink);
  if (state.blink && !isLive()) goLive();
  state.dirty = true;
  updateHudFlags();
}

function toggleLoupe(force) {
  state.loupe = force ?? !state.loupe;
  els.loupeChk.checked = state.loupe;
  els.stage.classList.toggle('loupe-on', state.loupe);
  if (!state.loupe) els.loupe.hidden = true;
  else toast('Lupa activa: pasa el cursor sobre la imagen', 'info', 1800);
}

// ---------------------------------------------------------------- loupe

els.stage.addEventListener('pointermove', (e) => {
  if (!state.loupe) return;
  const r = els.stage.getBoundingClientRect();
  state.loupePos = {
    clientX: e.clientX, clientY: e.clientY,
    u: clamp((e.clientX - r.left) / r.width, 0, 1),
    v: clamp((e.clientY - r.top) / r.height, 0, 1),
  };
  updateLoupe();
});
els.stage.addEventListener('pointerleave', () => {
  state.loupePos = null;
  els.loupe.hidden = true;
});

function updateLoupe() {
  const pos = state.loupePos;
  if (!pos) return;
  els.loupe.hidden = false;
  const s = S();
  if (isLive() && camera.active && !player.playing) {
    viewer.drawLoupe(pos.clientX, pos.clientY, pos.u, pos.v, camera.video, camera.width, camera.height, { flipH: s.flipH, flipV: s.flipV });
    return;
  }
  const fr = frames();
  const i = player.playing ? player.index : state.playhead;
  const f = fr[i];
  const bmp = f && (store.peek(f.id, 'full') || store.peek(f.id));
  viewer.drawLoupe(pos.clientX, pos.clientY, pos.u, pos.v, bmp, bmp?.width, bmp?.height);
}

// ---------------------------------------------------------------- guides drawing

function toggleDrawing(force) {
  state.drawing = force ?? !state.drawing;
  els.guides.classList.toggle('drawing', state.drawing);
  els.draw.classList.toggle('on', state.drawing);
  els.draw.textContent = state.drawing ? 'Terminar de dibujar' : 'Dibujar guías';
  drawGuides();
  updateHudFlags();
}

function guidePoint(e) {
  const r = els.guides.getBoundingClientRect();
  return [
    Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 10000) / 10000,
    Math.round(clamp((e.clientY - r.top) / r.height, 0, 1) * 10000) / 10000,
  ];
}

els.guides.addEventListener('pointerdown', (e) => {
  if (!state.drawing) return;
  els.guides.setPointerCapture(e.pointerId);
  state.activeStroke = { color: S().guideColor, width: S().guideWidth, points: [guidePoint(e)] };
  drawGuides();
});
els.guides.addEventListener('pointermove', (e) => {
  const st = state.activeStroke;
  if (!st) return;
  const p = guidePoint(e);
  const last = st.points[st.points.length - 1];
  if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) return;
  st.points.push(p);
  drawGuides();
});
const endStroke = () => {
  if (!state.activeStroke) return;
  P().guides.push(state.activeStroke);
  state.activeStroke = null;
  saveSoon();
  drawGuides();
};
els.guides.addEventListener('pointerup', endStroke);
els.guides.addEventListener('pointercancel', endStroke);

// ---------------------------------------------------------------- audio

async function restoreAudio() {
  audio.clear();
  const a = P().audio;
  if (a?.blobId) {
    try {
      const rec = await library.getBlob(P().id, a.blobId);
      if (rec) await audio.load(rec.blob);
    } catch (err) {
      toast(`No se pudo cargar el audio: ${err.message}`, 'error');
    }
  }
  updateAudioUI();
  drawWave();
}

async function loadAudioFile(file) {
  const project = P();
  try {
    await audio.load(file);
  } catch {
    toast('Formato de audio no soportado', 'error');
    return;
  }
  const id = uid();
  await library.putBlob(project.id, { id, name: file.name, blob: file });
  if (project.audio?.blobId) library.deleteBlob(P().id, project.audio.blobId).catch(() => {});
  project.audio = { blobId: id, name: file.name, offset: 0 };
  saveSoon();
  updateAudioUI();
  drawWave();
  toast(`Audio cargado: ${file.name}`, 'ok');
}

function clearAudio() {
  const p = P();
  if (p.audio?.blobId) library.deleteBlob(P().id, p.audio.blobId).catch(() => {});
  p.audio = null;
  audio.clear();
  saveSoon();
  updateAudioUI();
  drawWave();
}

function updateAudioUI() {
  const a = P().audio;
  if (a && audio.ready) {
    els.audioInfo.textContent = `${a.name} · ${audio.duration.toFixed(2)} s (${Math.ceil(audio.duration * P().fps)} exposiciones a ${P().fps} fps)`;
  } else {
    els.audioInfo.textContent = 'Sin pista de audio. Al moverte por los fotogramas escucharás el fragmento correspondiente.';
  }
  els.audioOffset.value = a?.offset || 0;
}

// ---------------------------------------------------------------- chroma background

async function restoreChromaBg() {
  state.chromaBg?.close?.();
  state.chromaBg = null;
  const id = S().chroma.bgBlobId;
  if (!id) return;
  const rec = await library.getBlob(P().id, id).catch(() => null);
  if (rec) state.chromaBg = await createImageBitmap(rec.blob).catch(() => null);
  state.dirty = true;
}

async function setChromaBg(file) {
  const project = P();
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) { toast('No se pudo leer la imagen', 'error'); return; }
  const id = uid();
  await library.putBlob(project.id, { id, name: file.name, blob: file });
  const old = S().chroma.bgBlobId;
  if (old) library.deleteBlob(P().id, old).catch(() => {});
  S().chroma.bgBlobId = id;
  state.chromaBg?.close?.();
  state.chromaBg = bmp;
  if (S().mode !== 'chroma') setMode('chroma');
  saveSoon();
  state.dirty = true;
}

function clearChromaBg() {
  const old = S().chroma.bgBlobId;
  if (old) library.deleteBlob(P().id, old).catch(() => {});
  S().chroma.bgBlobId = null;
  state.chromaBg?.close?.();
  state.chromaBg = null;
  saveSoon();
  state.dirty = true;
}

// ---------------------------------------------------------------- reference layer (rotoscope)

function releaseReference() {
  const ref = state.ref;
  if (!ref) return;
  if (ref.kind === 'video') {
    ref.el.removeAttribute('src');
    ref.el.load();
  } else ref.el.close?.();
  URL.revokeObjectURL(ref.url || '');
  state.ref = null;
}

async function openReference(blob) {
  releaseReference();
  if (blob.type.startsWith('image/')) {
    state.ref = { kind: 'image', el: await createImageBitmap(blob) };
  } else {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    Object.assign(video, { muted: true, playsInline: true, preload: 'auto', src: url });
    await new Promise((resolve, reject) => {
      video.onloadeddata = resolve;
      video.onerror = () => reject(new Error('Formato de video no soportado'));
    });
    video.addEventListener('seeked', () => { state.dirty = true; });
    state.ref = { kind: 'video', el: video, url };
  }
  state.dirty = true;
}

async function restoreReference() {
  releaseReference();
  const id = S().reference.blobId;
  if (id) {
    const rec = await library.getBlob(P().id, id).catch(() => null);
    if (rec) await openReference(rec.blob).catch(() => {});
  }
  updateReferenceUI();
}

async function setReference(file) {
  const project = P();
  try {
    await openReference(file);
  } catch (err) {
    toast(`No se pudo cargar la referencia: ${err.message}`, 'error');
    return;
  }
  const id = uid();
  await library.putBlob(project.id, { id, name: file.name, blob: file });
  const r = S().reference;
  if (r.blobId) library.deleteBlob(P().id, r.blobId).catch(() => {});
  Object.assign(r, { blobId: id, name: file.name, visible: true });
  applySettingsToUI();
  saveSoon();
  updateReferenceUI();
  toast(`Referencia cargada: ${file.name}`, 'ok');
}

function clearReference() {
  const r = S().reference;
  if (r.blobId) library.deleteBlob(P().id, r.blobId).catch(() => {});
  Object.assign(r, { blobId: null, name: '' });
  releaseReference();
  saveSoon();
  updateReferenceUI();
  state.dirty = true;
}

function updateReferenceUI() {
  const ref = state.ref;
  const r = S().reference;
  if (!ref) { els.refInfo.textContent = 'Sin referencia'; return; }
  const extra = ref.kind === 'video' ? ` · ${ref.el.duration.toFixed(1)} s (${Math.ceil(ref.el.duration * P().fps)} cuadros)` : ' · imagen';
  els.refInfo.textContent = `${r.name}${extra}`;
}

// ---------------------------------------------------------------- time-lapse

function startTimelapse() {
  if (!camera.active) { toast('Conecta una cámara para usar el intervalómetro', 'warn'); return; }
  const sec = Math.max(1, S().timelapseInterval);
  state.timelapseTimer = setInterval(async () => {
    if (state.busy) return;
    await capture('append', { skipDelay: true });
    state.timelapseCount++;
    updateTimelapseUI();
  }, sec * 1000);
  updateTimelapseUI();
}

function stopTimelapse() {
  if (!state.timelapseTimer) return;
  clearInterval(state.timelapseTimer);
  state.timelapseTimer = 0;
  updateTimelapseUI();
}

function toggleTimelapse() {
  if (state.timelapseTimer) stopTimelapse();
  else { state.timelapseCount = 0; startTimelapse(); }
}

function updateTimelapseUI() {
  const on = !!state.timelapseTimer;
  els.timelapse.textContent = on ? 'Detener intervalómetro' : 'Iniciar intervalómetro';
  els.timelapse.classList.toggle('on', on);
  els.timelapseInfo.textContent = on || state.timelapseCount
    ? `${state.timelapseCount} capturas${on ? ` · una cada ${S().timelapseInterval} s` : ''}`
    : '';
  if (P()) updateHudFlags();
}

// ---------------------------------------------------------------- spacing calculator

function updateSpacing() {
  const dist = Number($('#spDist').value) || 0;
  const n = clamp(Math.floor(Number($('#spFrames').value) || 1), 1, 500);
  const rows = computeSpacing(dist, n, $('#spEase').value);
  const table = $('#spTable');
  const fmt = (v) => v.toFixed(2);
  table.innerHTML = '<thead><tr><th>Fotograma</th><th>Posición (mm)</th><th>Mover (mm)</th></tr></thead>';
  const body = document.createElement('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.frame}</td><td>${fmt(r.position)}</td><td>${r.frame ? `+${fmt(r.delta)}` : '—'}</td>`;
    body.append(tr);
  }
  table.append(body);

  const c = $('#spChart');
  const ctx = c.getContext('2d');
  const W = c.width, H = c.height, padX = 10, mid = H / 2;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath(); ctx.moveTo(padX, mid); ctx.lineTo(W - padX, mid); ctx.stroke();
  ctx.fillStyle = '#ffb020';
  for (const r of rows) {
    const x = padX + (dist ? r.position / dist : r.frame / n) * (W - padX * 2);
    ctx.fillRect(Math.round(x) - 1, mid - 10, 2, 20);
  }
  ctx.fillStyle = '#ff4d3d';
  ctx.beginPath(); ctx.arc(padX, mid, 4, 0, Math.PI * 2); ctx.arc(W - padX, mid, 4, 0, Math.PI * 2); ctx.fill();
}

// ---------------------------------------------------------------- import

async function importFiles(fileList) {
  const files = [...fileList];
  const images = files
    .filter((f) => f.type.startsWith('image/'))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const audios = files.filter((f) => f.type.startsWith('audio/'));
  const projects = files.filter((f) => /\.(mesora|zip)$/i.test(f.name));
  for (const f of projects) await importProject(f);
  if (audios[0]) await loadAudioFile(audios[0]);
  if (images.length) await importImages(images);
  if (!images.length && !audios.length && !projects.length) toast('No se reconoció ningún archivo compatible', 'warn');
}

async function importImages(images) {
  const project = P();
  const added = [];
  let skipped = 0;
  toast(`Importando ${images.length} imágenes…`);
  for (const file of images) {
    try {
      const r = await store.addFromBlob(project.id, file);
      if (P() !== project) return;
      if (!frames().length && !added.length) setProjectSize(r.w, r.h);
      added.push({ key: uid(), id: r.id, hold: 1 });
    } catch {
      skipped++;
    }
  }
  if (!added.length) { toast('No se pudo importar ninguna imagen', 'error'); return; }
  commit((fr) => {
    const at = isLive() ? fr.length : state.playhead + 1;
    fr.splice(at, 0, ...added);
    state.selection = new Set(added.map((a) => a.key));
    state.playhead = at;
    state.anchor = at;
  });
  toast(`${added.length} imágenes importadas${skipped ? ` (${skipped} omitidas)` : ''}`, 'ok');
}

async function importProject(file) {
  toast(`Importando proyecto ${file.name}…`);
  try {
    const p = await importProjectFile(file, store, () => {});
    await openProject(p);
    toast(`Proyecto «${p.name}» importado`, 'ok');
  } catch (err) {
    toast(`No se pudo importar: ${err.message}`, 'error', 5000);
  }
}

// ---------------------------------------------------------------- projects modal

const modalUrls = [];

function openModal(id) {
  $(id).hidden = false;
}

function closeModal(modal) {
  if (modal.id === 'modalAsk') { $('#btnAskCancel').onclick?.(); return; }
  modal.hidden = true;
  if (modal.id === 'modalProjects') {
    modalUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  }
}

async function renderProjectList() {
  const list = await library.listProjects();
  const disk = library.kind === 'disk';
  if (disk) return renderProductionList(list);
  const ul = $('#projectList');
  ul.innerHTML = '';
  for (const p of list) {
    const li = document.createElement('li');
    li.className = `project-item${p.id === P().id ? ' current' : ''}`;
    li.innerHTML = `
      <div class="thumb">${p.frameCount ? '' : 'Sin fotogramas'}</div>
      <div class="info">
        <div class="name"></div>
        <div class="sub">${p.frameCount} fotogramas · ${formatTime(p.exposures, p.fps)} · ${p.fps} fps</div>
        <div class="sub">${formatDate(p.updatedAt)}</div>
      </div>
      <div class="actions">
        <button class="btn" data-act="open">Abrir</button>
        <button class="btn ghost" data-act="rename">Renombrar</button>
        <button class="btn ghost" data-act="export">Exportar</button>
        <button class="btn ghost danger" data-act="delete">Eliminar</button>
      </div>`;
    li.querySelector('.name').textContent = p.name;
    if (p.firstFrameId) {
      library.getFrame(p.id, p.firstFrameId, 'preview').then((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        modalUrls.push(url);
        li.querySelector('.thumb').style.backgroundImage = `url("${url}")`;
      }).catch(() => {});
    }
    li.querySelector('.thumb').addEventListener('click', () => switchProject(p.id));
    li.querySelector('.actions').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) projectAction(act, p).catch((err) => toast(err.message, 'error', 6000));
    });
    ul.append(li);
  }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Desktop: one group per project with a row per scene/take; secondary actions live in a "⋯" menu. */
function renderProductionList(list) {
  const ul = $('#projectList');
  ul.className = 'prod-list';
  ul.innerHTML = '';
  const groups = new Map();
  for (const t of list) {
    if (!groups.has(t.production.id)) groups.set(t.production.id, []);
    groups.get(t.production.id).push(t);
  }
  for (const takes of groups.values()) {
    const latest = takes[0]; // the list comes most recent first
    takes.sort((a, b) => a.scene.id.localeCompare(b.scene.id) || a.take.id.localeCompare(b.take.id));
    const single = takes.length === 1;
    const scenes = new Set(takes.map((t) => t.scene.id)).size;
    const group = document.createElement('li');
    group.className = `prod-group${takes.some((t) => t.id === P().id) ? ' current' : ''}`;
    group.innerHTML = `
      <div class="prod-head">
        <div class="prod-title"><div class="name"></div><div class="sub"></div></div>
        <button class="btn ghost small-btn" data-act="rename">Renombrar</button>
        <button class="btn ghost small-btn" data-act="newscene" title="Añade una escena nueva a este proyecto, con los mismos ajustes de cámara y visor">+ Escena</button>
        <button class="btn ghost small-btn" data-act="revealproject" title="Abre la carpeta de este proyecto">Carpeta</button>
      </div>
      <ul class="take-list"></ul>`;
    group.querySelector('.name').textContent = latest.name;
    group.querySelector('.sub').textContent = `${plural(scenes, 'escena', 'escenas')} · ${plural(takes.length, 'toma', 'tomas')} · ${formatDate(latest.updatedAt)}`;
    group.querySelector('.prod-head').addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) projectAction(act, latest).catch((err) => toast(err.message, 'error', 6000));
    });
    const rows = group.querySelector('.take-list');
    for (const t of takes) {
      const current = t.id === P().id;
      const li = document.createElement('li');
      li.className = `take-row${current ? ' current' : ''}`;
      li.innerHTML = `
        <div class="thumb">${t.frameCount ? '' : 'Vacía'}</div>
        <div class="info"><div class="name"></div><div class="sub">${plural(t.frameCount, 'fotograma', 'fotogramas')} · ${formatTime(t.exposures, t.fps)} · ${t.fps} fps</div></div>
        <button class="btn small-btn ${current ? '' : 'primary'}" data-act="open" ${current ? 'disabled' : ''}>${current ? 'Abierta' : 'Abrir'}</button>
        <details class="menu">
          <summary class="btn ghost small-btn" title="Más acciones" aria-label="Más acciones">⋯</summary>
          <div class="menu-list">
            <button data-act="newtake">Nueva toma de esta escena</button>
            <button data-act="dupscene">Duplicar escena (con sus fotos)</button>
            <button data-act="export">Exportar copia (.mesora)</button>
            <button class="danger" data-act="${single ? 'deleteproject' : 'delete'}">${single ? 'Eliminar proyecto' : 'Eliminar esta toma'}</button>
          </div>
        </details>`;
      li.querySelector('.name').textContent = `${t.scene.name} · ${t.take.name}`;
      if (t.firstFrameId) {
        library.getFrame(t.id, t.firstFrameId, 'thumb').then((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          modalUrls.push(url);
          li.querySelector('.thumb').style.backgroundImage = `url("${url}")`;
        }).catch(() => {});
      }
      li.querySelector('.thumb').addEventListener('click', () => switchProject(t.id));
      li.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        btn.closest('details')?.removeAttribute('open');
        projectAction(btn.dataset.act, t).catch((err) => toast(err.message, 'error', 6000));
      });
      rows.append(li);
    }
    ul.append(group);
  }
}

/** Opens the most recent take, or a new project when none is left. */
async function openMostRecent() {
  const [recent] = await library.listProjects();
  const opened = (recent && await library.getProject(recent.id).catch(() => null))
    || { project: await library.createProject(newProject('Mi animación')), report: null };
  state.project = null;
  await openProject(opened.project, opened.report);
}

async function projectAction(act, p) {
  const isCurrent = p.id === P().id;
  if (act === 'open') return switchProject(p.id);
  if (act === 'rename') {
    const name = (await askText('Renombrar proyecto', p.name))?.trim();
    if (!name) return;
    const sameProduction = isCurrent || (p.production && p.production.id === P().production?.id);
    if (sameProduction) { P().name = name; els.projectName.value = name; await saveNow(); }
    if (!isCurrent) await library.renameProject(p.id, name);
    return renderProjectList();
  }
  if (act === 'export') {
    if (isCurrent) return exportProject(P());
    const opened = await library.getProject(p.id);
    return exportProject(opened.project);
  }
  if (act === 'delete') {
    const msg = library.kind === 'disk'
      ? `¿Eliminar la toma «${p.scene.name} · ${p.take.name}» de «${p.name}»?\n\nSu carpeta, con todas las fotos originales, irá a la papelera del sistema, desde donde se puede recuperar.`
      : `¿Eliminar «${p.name}» y todos sus fotogramas? Esta acción no se puede deshacer.`;
    if (!confirm(msg)) return;
    await deleteProject(p.id);
    return renderProjectList();
  }
  if (act === 'deleteproject') {
    if (!confirm(`¿Eliminar el proyecto «${p.name}»?\n\nSu carpeta, con todas las fotos originales, irá a la papelera del sistema, desde donde se puede recuperar.`)) return;
    const isOpen = p.production.id === P().production?.id;
    if (isOpen) saveSoon.cancel();
    await library.deleteProduction(p.id);
    if (isOpen) await openMostRecent();
    toast(`«${p.name}» se movió a la papelera del sistema`, 'ok');
    return renderProjectList();
  }
  if (act === 'revealproject') return library.reveal(p.id, 'production');
  if (isCurrent) await saveNow();
  let opened = null;
  if (act === 'newtake') {
    opened = await library.createTake(p.id);
    toast(`${opened.project.take.name} creada en ${opened.project.scene.name}`, 'ok');
  } else if (act === 'newscene') {
    opened = await library.createScene(p.production.id, { copySettingsFrom: p.scene.id });
    toast(`${opened.project.scene.name} creada`, 'ok');
  } else if (act === 'dupscene') {
    const name = (await askText('Nombre de la escena copiada', `${p.scene.name} (copia)`))?.trim();
    if (!name) return;
    toast('Copiando la escena…');
    opened = await library.duplicateScene(p.id, { name });
    toast(`Escena copiada: ${opened.project.scene.name}`, 'ok');
  }
  if (opened) {
    closeModal($('#modalProjects'));
    await openProject(opened.project, opened.report);
  }
}

async function switchProject(id) {
  if (id === P().id) { closeModal($('#modalProjects')); return; }
  let opened;
  try {
    opened = await library.getProject(id);
  } catch (err) {
    toast(`No se pudo abrir: ${err.message}`, 'error', 6000);
    return;
  }
  if (!opened) return;
  closeModal($('#modalProjects'));
  await openProject(opened.project, opened.report);
}

async function deleteProject(id) {
  if (id === P().id) saveSoon.cancel();
  await library.deleteProject(id);
  if (id === P().id) await openMostRecent();
}

// ---------------------------------------------------------------- production tools (desktop)

function showList(title, hint, items) {
  $('#modalListTitle').textContent = title;
  $('#modalListHint').textContent = hint;
  const ul = $('#modalListItems');
  ul.innerHTML = '';
  ul.append(...items);
  openModal('#modalList');
}

async function openTrash() {
  const project = P();
  await saveNow();
  const ids = await library.listTrash(project.id);
  const items = ids.map((id) => {
    const li = document.createElement('li');
    li.className = 'project-item';
    li.innerHTML = `
      <div class="thumb"></div>
      <div class="info"><div class="name"></div></div>
      <div class="actions"><button class="btn primary" data-act="restore">Restaurar</button></div>`;
    li.querySelector('.name').textContent = `Captura ${id}`;
    store.thumbUrl(id).then((url) => { if (url) li.querySelector('.thumb').style.backgroundImage = `url("${url}")`; });
    li.querySelector('[data-act="restore"]').addEventListener('click', () => {
      if (P() !== project) return;
      commit((fr) => {
        const at = isLive() ? fr.length : state.playhead + 1;
        const entry = { key: uid(), id, hold: 1 };
        fr.splice(at, 0, entry);
        state.selection = new Set([entry.key]);
        state.playhead = at;
      });
      li.remove();
      toast(`Captura ${id} restaurada en el timeline`, 'ok');
    });
    return li;
  });
  showList('Papelera de la toma', ids.length
    ? 'Fotogramas borrados de esta toma. Sus originales nunca se han borrado del disco. «Restaurar» los vuelve a poner después del fotograma actual.'
    : 'La papelera está vacía.', items);
}

async function openHistory() {
  const project = P();
  await saveNow();
  const versions = await library.listHistory(project.id);
  const items = versions.map((v) => {
    const li = document.createElement('li');
    li.className = 'project-item';
    li.innerHTML = `
      <div class="info"><div class="name"></div><div class="sub"></div></div>
      <div class="actions"><button class="btn" data-act="restore">Restaurar esta versión</button></div>`;
    li.querySelector('.name').textContent = formatDate(v.updatedAt);
    li.querySelector('.sub').textContent = `${v.frameCount} fotogramas`;
    li.querySelector('[data-act="restore"]').addEventListener('click', async () => {
      if (P() !== project) return;
      if (!confirm('¿Volver a esta versión del timeline? La versión actual se guarda antes en el historial.')) return;
      saveSoon.cancel();
      const opened = await library.restoreHistory(project.id, v.version);
      closeModal($('#modalList'));
      state.project = null;
      await openProject(opened.project, opened.report);
      toast('Versión restaurada', 'ok');
    });
    return li;
  });
  showList('Historial del timeline', versions.length
    ? 'MESORA guarda una versión antes de cada cambio que quita fotogramas y, además, una por minuto mientras trabajas. Restaurar no borra ninguna foto.'
    : 'Todavía no hay versiones anteriores de esta toma.', items);
}

async function conformTake() {
  await saveNow();
  toast('Copiando las fotos originales en orden…');
  const { dir, count } = await library.conform(P().id, { expandHolds: true });
  toast(`${count} fotos copiadas en orden, numeradas desde 0001.`, 'ok', 9000, [
    { label: 'Abrir carpeta', onClick: () => library.revealPath(dir).catch((err) => toast(err.message, 'error')) },
  ]);
}

// ---------------------------------------------------------------- migration from the old storage

async function migrateOldProjects() {
  let pending;
  try {
    pending = await pendingBrowserProjects();
  } catch (err) {
    console.warn('No se pudo revisar el almacenamiento anterior', err);
    return;
  }
  if (!pending.length) return;
  toast(`Pasando ${pending.length} ${pending.length === 1 ? 'proyecto' : 'proyectos'} a carpetas de producción…`, 'info', 6000);
  let ok = 0;
  for (const old of pending) {
    try {
      const { missing } = await migrateProject(old);
      ok++;
      if (missing) toast(`«${old.name}»: ${missing} fotogramas no tenían imagen y no se copiaron`, 'warn', 8000);
    } catch (err) {
      toast(`No se pudo pasar «${old.name}» a carpetas: ${err.message}. Se volverá a intentar en el próximo inicio.`, 'error', 9000);
    }
  }
  if (ok) toast(`${ok} ${ok === 1 ? 'proyecto copiado' : 'proyectos copiados'} a ${await library.root()}. Los originales anteriores no se han tocado.`, 'ok', 9000);
}

// ---------------------------------------------------------------- export

function showProgress(text, value) {
  $('#exProgress').hidden = false;
  $('#exProgressText').textContent = text;
  $('#exProgressFill').style.width = `${Math.round(value * 100)}%`;
}

function hideProgress() {
  $('#exProgress').hidden = true;
}

function setExportBusy(busy) {
  for (const b of $$('#modalExport .modal-body > .group button')) b.disabled = busy;
}

function exportRange() {
  const fr = frames();
  if ($('#exRange').value === 'selection') {
    const idx = selectedIndices(true);
    if (idx.length) return [idx[0], idx[idx.length - 1] + 1];
  }
  return [0, fr.length];
}

/** Grade filters for frames [a, b), indexed relative to `a`. */
async function exportFilters(a, b) {
  if (S().grade.deflicker) {
    scheduleGains.flush();
    // wait for the gains of every frame in range
    for (let tries = 0; tries < 200 && frames().slice(a, b).some((f) => !state.gains.has(f.key)); tries++) await sleep(50);
  }
  const out = [];
  for (let i = a; i < b; i++) out.push(frameFilter(i));
  return out.every((f) => f === 'none') ? null : out;
}

async function deliver(blob, filename, message) {
  const where = await saveFile(blob, filename);
  toast(where ? `${message} en ${where}` : message, 'ok', 4000);
}

async function exportVideo() {
  const types = supportedVideoTypes();
  const type = types[Number($('#exFormat').value)] || types[0];
  if (!type) { toast('Este navegador no puede grabar video', 'error'); return; }
  const fr = frames();
  if (!fr.length) { toast('No hay fotogramas para exportar', 'warn'); return; }
  const p = P();
  const [a, b] = exportRange();
  const { w, h } = outputSize(p.width, p.height, Number($('#exRes').value));
  const controller = new AbortController();
  state.exportAbort = controller;
  stopPlayback(false);
  setExportBusy(true);
  showProgress('Preparando…', 0);
  try {
    const blob = await renderVideo({
      frames: fr.slice(a, b), fps: p.fps, store, width: w, height: h, type,
      filters: $('#exGrade').checked ? await exportFilters(a, b) : null,
      bitrate: Number($('#exBitrate').value),
      audio: $('#exAudio').checked && audio.ready ? audio : null,
      audioOffset: p.audio?.offset || 0,
      startExposure: exposureStart(fr, a),
      signal: controller.signal,
      onProgress: (v) => showProgress(`Grabando video… ${Math.round(v * 100)}%`, v),
    });
    await deliver(blob, `${safeFileName(p.name)}.${type.ext}`, 'Video exportado');
  } catch (err) {
    if (err.name === 'AbortError') toast('Exportación cancelada', 'warn');
    else toast(`Error al exportar: ${err.message}`, 'error', 5000);
  } finally {
    state.exportAbort = null;
    setExportBusy(false);
    hideProgress();
  }
}

async function exportZip() {
  const fr = frames();
  if (!fr.length) { toast('No hay fotogramas para exportar', 'warn'); return; }
  const [a, b] = exportRange();
  setExportBusy(true);
  try {
    const blob = await buildImageSequence({
      frames: fr.slice(a, b), store, expand: $('#exExpand').checked,
      filters: $('#exGradeZip').checked ? await exportFilters(a, b) : null,
      baseName: safeFileName(P().name).replace(/\s+/g, '_'),
      onProgress: (v) => showProgress(`Empaquetando imágenes… ${Math.round(v * 100)}%`, v),
    });
    await deliver(blob, `${safeFileName(P().name)}_secuencia.zip`, 'Secuencia exportada');
  } catch (err) {
    toast(`Error al exportar: ${err.message}`, 'error', 5000);
  } finally {
    setExportBusy(false);
    hideProgress();
  }
}

async function exportCurrentFrame() {
  const fr = frames();
  let canvas;
  if (!isLive()) {
    const bmp = await store.decode(fr[state.playhead].id, 'full');
    canvas = makeCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
  } else if (camera.active) {
    canvas = await camera.grab({ flipH: S().flipH, flipV: S().flipV });
  } else if (fr.length) {
    const bmp = await store.decode(fr[fr.length - 1].id, 'full');
    canvas = makeCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close?.();
  } else {
    toast('No hay imagen para exportar', 'warn');
    return;
  }
  const n = isLive() ? fr.length + 1 : state.playhead + 1;
  await deliver(await canvasToBlob(canvas, 'image/png'), `${safeFileName(P().name)}_${String(n).padStart(4, '0')}.png`, 'Fotograma exportado');
}

async function exportProject(project = P()) {
  if (project === P()) await saveNow();
  setExportBusy(true);
  toast('Empaquetando proyecto…');
  try {
    const blob = await exportProjectFile(project, (v) => showProgress(`Empaquetando proyecto… ${Math.round(v * 100)}%`, v));
    await deliver(blob, `${safeFileName(project.name)}.mesora`, 'Proyecto exportado');
  } catch (err) {
    toast(`Error al exportar: ${err.message}`, 'error', 5000);
  } finally {
    setExportBusy(false);
    hideProgress();
  }
}

function populateExportFormats() {
  const sel = $('#exFormat');
  sel.innerHTML = '';
  const types = supportedVideoTypes();
  types.forEach((t, i) => sel.append(new Option(t.label, i)));
  if (!types.length) sel.append(new Option('No disponible en este navegador', ''));
  $('#btnExportVideo').disabled = !types.length;
}

// ---------------------------------------------------------------- fullscreen, panels, welcome

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast('Pantalla completa no disponible', 'warn'));
}

function initSections() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(LS_SECTIONS)) || {}; } catch { /* ignore */ }
  for (const d of $$('details[data-sec]')) {
    if (d.dataset.sec in saved) d.open = saved[d.dataset.sec];
    d.addEventListener('toggle', () => {
      saved[d.dataset.sec] = d.open;
      localStorage.setItem(LS_SECTIONS, JSON.stringify(saved));
    });
  }
}

/** In-app text dialog (window.prompt is not available in the desktop app). */
function askText(title, value = '') {
  const modal = $('#modalAsk');
  const input = $('#askInput');
  $('#askTitle').textContent = title;
  input.value = value;
  openModal('#modalAsk');
  input.focus();
  input.select();
  return new Promise((resolve) => {
    const finish = (result) => {
      modal.hidden = true;
      $('#formAsk').onsubmit = null;
      $('#btnAskCancel').onclick = null;
      resolve(result);
    };
    $('#formAsk').onsubmit = (e) => { e.preventDefault(); finish(input.value); };
    $('#btnAskCancel').onclick = () => finish(null);
  });
}

// Keep the screen awake while the camera is on (phones and laptops dim otherwise).
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
    }
  } catch { /* not allowed right now */ }
}

function showWelcome() {
  for (const m of $$('.modal')) m.hidden = true;
  openModal('#modalWelcome');
}

// ---------------------------------------------------------------- keyboard

function onKeyDown(e) {
  const modal = $$('.modal').reverse().find((m) => !m.hidden);
  if (isTypingTarget(e.target)) {
    if (e.key === 'Escape') {
      if (modal?.contains(e.target)) closeModal(modal);
      else e.target.blur();
    }
    return;
  }
  if (modal) {
    if (e.key === 'Escape') closeModal(modal);
    return;
  }
  const k = e.key;
  if (e.ctrlKey || e.metaKey) {
    switch (k.toLowerCase()) {
      case 'z': if (e.shiftKey) redo(); else undo(); break;
      case 'y': redo(); break;
      case 'd': duplicateSelected(); break;
      case 'a': selectAll(); break;
      case 's': saveSoon.flush(); toast('Proyecto guardado', 'ok', 1400); break;
      default: return;
    }
    e.preventDefault();
    return;
  }
  if (e.repeat && ['Enter', ' ', '0', '6'].includes(k)) { e.preventDefault(); return; }
  switch (k) {
    case 'Enter': capture(e.shiftKey ? 'replace' : e.altKey ? 'insert' : 'append'); break;
    case ' ': case '0': togglePlay(); break;
    case '1': step(-1); break;
    case '3': step(1); break;
    case 'ArrowLeft': if (e.shiftKey) extendSelection(-1); else step(-1); break;
    case 'ArrowRight': if (e.shiftKey) extendSelection(1); else step(1); break;
    case '2': case 'Tab': toggleLiveLast(); break;
    case '5': case 'End': goLive(); break;
    case 'Home': setPlayhead(0); break;
    case '6': shortPlay(); break;
    case '8': case 'l': case 'L': setSetting('loop', !S().loop); break;
    case 'p': case 'P': setSetting('pingpong', !S().pingpong); break;
    case 'o': case 'O': setSetting('onion.enabled', !S().onion.enabled); break;
    case 'd': case 'D': setMode('difference'); break;
    case 'b': case 'B': toggleBlink(); break;
    case 'g': case 'G': setSetting('grid', GRID_CYCLE[(GRID_CYCLE.indexOf(S().grid) + 1) % GRID_CYCLE.length]); break;
    case 'f': case 'F':
      if (e.shiftKey) toggleFullscreen();
      else setSetting('peaking', !S().peaking);
      break;
    case 'n': case 'N':
      if (els.frameNote.disabled) toast('Elige un fotograma en la línea de tiempo para anotarlo', 'info', 2000);
      else { els.frameNote.focus(); els.frameNote.select(); }
      break;
    case 'z': case 'Z': toggleLoupe(); break;
    case 'Delete': case 'Backspace': deleteSelected(); break;
    case '+': case '=': changeHold(1); break;
    case '-': case '_': changeHold(-1); break;
    case '?': openModal('#modalHelp'); break;
    case 'Escape':
      if (state.drawing) toggleDrawing(false);
      else if (player.playing) stopPlayback(false);
      else if (state.blink) toggleBlink();
      break;
    default: return;
  }
  e.preventDefault();
}

// ---------------------------------------------------------------- UI wiring

function bindUI() {
  document.body.classList.toggle('is-android', isAndroidApp);
  document.body.classList.toggle('is-desktop-app', isDesktopApp);
  $('#onionColorsRow').hidden = viewer.kind !== 'gpu';
  if (library.kind === 'disk') {
    $('#diskTools').hidden = false;
    els.saveState.title = 'Tu trabajo se guarda automáticamente en la carpeta de la producción (Documentos/MESORA)';
    $('#welcomeStorage').textContent = 'Todo se guarda automáticamente en carpetas dentro de Documentos/MESORA: tus fotos originales se pueden abrir con cualquier programa.';
    const run = (fn) => () => fn().catch((err) => toast(err.message, 'error', 6000));
    $('#btnTrash').addEventListener('click', run(openTrash));
    $('#btnHistory').addEventListener('click', run(openHistory));
    $('#btnConform').addEventListener('click', run(conformTake));
    $('#btnRevealTake').addEventListener('click', run(() => library.reveal(P().id)));
    $('#projectsHint').hidden = false;
    $('#btnRevealLibrary').addEventListener('click', run(() => library.reveal()));
    els.takeLabel.addEventListener('click', () => { renderProjectList(); openModal('#modalProjects'); });
    // Close an open "⋯" menu when clicking anywhere else.
    document.addEventListener('click', (e) => {
      for (const menu of document.querySelectorAll('details.menu[open]')) if (!menu.contains(e.target)) menu.removeAttribute('open');
    });
  }
  bindSettings();
  initSections();
  document.addEventListener('keydown', onKeyDown);
  // Keep keyboard shortcuts working after clicking buttons.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !b.closest('.modal')) b.blur();
  });
  // Browsers require a gesture before audio can play.
  const unlock = () => { audio.context(); };
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });

  $('#btnStartCam').addEventListener('click', startCamera);
  els.camToggle.addEventListener('click', () => (camera.active ? stopCamera() : startCamera()));
  els.camDevice.addEventListener('change', () => { if (camera.active || els.camDevice.value) startCamera(); });
  els.camRes.addEventListener('change', () => { saveCamPrefs({ resolution: els.camRes.value }); if (camera.active) startCamera(); });
  $('#btnCamLock').addEventListener('click', async () => {
    try {
      const ok = await camera.lockAuto();
      if (ok) { rememberAllControls(); buildCamControls(); toast('Exposición, foco y balance bloqueados', 'ok'); }
      else toast('Esta cámara no permite bloquear los automáticos desde el navegador', 'warn', 4000);
    } catch (err) { toast(`No se pudo bloquear: ${err.message}`, 'error'); }
  });
  $('#btnCamAuto').addEventListener('click', async () => {
    try {
      await camera.resetAuto();
      rememberAllControls(true);
      buildCamControls();
      toast('Controles automáticos restablecidos');
    } catch (err) { toast(`No se pudo restablecer: ${err.message}`, 'error'); }
  });

  els.capture.addEventListener('click', () => capture());
  els.play.addEventListener('click', togglePlay);
  $('#tFirst').addEventListener('click', () => setPlayhead(0));
  $('#tPrev').addEventListener('click', () => step(-1));
  $('#tNext').addEventListener('click', () => step(1));
  els.live.addEventListener('click', goLive);
  els.loop.addEventListener('click', () => setSetting('loop', !S().loop));
  els.pingpong.addEventListener('click', () => setSetting('pingpong', !S().pingpong));
  $('#tShort').addEventListener('click', shortPlay);
  $('#tHoldMinus').addEventListener('click', () => changeHold(-1));
  $('#tHoldPlus').addEventListener('click', () => changeHold(1));
  $('#tDup').addEventListener('click', duplicateSelected);
  $('#tDel').addEventListener('click', deleteSelected);
  els.undo.addEventListener('click', undo);
  els.redo.addEventListener('click', redo);

  for (const b of $$('#modeSeg button')) b.addEventListener('click', () => setMode(b.dataset.mode));
  els.blink.addEventListener('click', toggleBlink);
  els.loupeChk.addEventListener('change', () => toggleLoupe(els.loupeChk.checked));
  $('#btnChromaBg').addEventListener('click', () => $('#fileChromaBg').click());
  $('#fileChromaBg').addEventListener('change', (e) => { if (e.target.files[0]) setChromaBg(e.target.files[0]); e.target.value = ''; });
  $('#btnChromaBgClear').addEventListener('click', clearChromaBg);

  els.draw.addEventListener('click', () => toggleDrawing());
  $('#btnGuideUndo').addEventListener('click', () => { P().guides.pop(); saveSoon(); drawGuides(); });
  $('#btnGuideClear').addEventListener('click', () => {
    if (!P().guides.length || !confirm('¿Borrar todas las guías?')) return;
    P().guides = [];
    saveSoon();
    drawGuides();
  });

  els.fps.addEventListener('change', async () => {
    if (els.fps.value === 'custom') {
      const answer = await askText('Fotogramas por segundo (1 a 60)', String(P().fps));
      const fps = Math.round(Number(String(answer ?? '').replace(',', '.')));
      if (!(fps >= 1 && fps <= 60)) { setFpsUI(P().fps); if (answer != null) toast('Escribe un número entre 1 y 60', 'warn'); return; }
      setFpsUI(fps);
    }
    P().fps = Number(els.fps.value);
    saveSoon();
    renderTimeline();
    updateReferenceUI();
    updateHud();
    updateProjectInfo();
    updateAudioUI();
  });
  els.projectName.addEventListener('change', () => {
    P().name = els.projectName.value.trim() || 'Sin título';
    els.projectName.value = P().name;
    saveSoon();
  });
  els.projectName.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.projectName.blur(); });

  $('#btnAudio').addEventListener('click', () => $('#fileAudio').click());
  $('#fileAudio').addEventListener('change', (e) => { if (e.target.files[0]) loadAudioFile(e.target.files[0]); e.target.value = ''; });
  $('#btnAudioClear').addEventListener('click', clearAudio);
  els.audioOffset.addEventListener('change', () => {
    if (!P().audio) { els.audioOffset.value = 0; return; }
    P().audio.offset = Math.max(0, Math.floor(Number(els.audioOffset.value) || 0));
    saveSoon();
    drawWave();
  });

  els.timelapse.addEventListener('click', toggleTimelapse);
  for (const id of ['#spDist', '#spFrames', '#spEase']) $(id).addEventListener('input', updateSpacing);

  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });

  $('#btnProjects').addEventListener('click', () => { renderProjectList(); openModal('#modalProjects'); });
  $('#formNewProject').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = await library.createProject(newProject($('#newProjectName').value.trim() || 'Sin título', Number($('#newProjectFps').value)));
    $('#newProjectName').value = '';
    closeModal($('#modalProjects'));
    await openProject(p);
    toast(`Proyecto «${p.name}» creado`, 'ok');
  });
  $('#btnImportProject').addEventListener('click', () => $('#fileImport').click());

  $('#btnExport').addEventListener('click', () => { populateExportFormats(); openModal('#modalExport'); });
  $('#btnExportVideo').addEventListener('click', exportVideo);
  $('#btnExportZip').addEventListener('click', exportZip);
  $('#btnExportFrame').addEventListener('click', exportCurrentFrame);
  $('#btnExportProject').addEventListener('click', () => exportProject());
  $('#btnExportCancel').addEventListener('click', () => state.exportAbort?.abort());

  $('#btnHelp').addEventListener('click', () => openModal('#modalHelp'));
  $('#btnShowWelcome').addEventListener('click', showWelcome);
  $('#btnWelcomeHelp').addEventListener('click', () => { closeModal($('#modalWelcome')); openModal('#modalHelp'); });
  $('#btnWelcomeStart').addEventListener('click', () => {
    closeModal($('#modalWelcome'));
    if (!camera.active) startCamera();
  });
  $('#btnFullscreen').addEventListener('click', toggleFullscreen);

  els.frameNote.addEventListener('change', () => setNote(els.frameNote.value));
  els.frameNote.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); els.frameNote.blur(); }
    else if (e.key === 'Escape') {
      els.frameNote.value = frames()[state.playhead]?.note || '';
      els.frameNote.blur();
    }
    e.stopPropagation();
  });

  $('#btnGradeReset').addEventListener('click', () => {
    Object.assign(S().grade, { brightness: 1, contrast: 1, saturation: 1, deflicker: false });
    applySettingsToUI();
    onSettingChanged('grade');
  });
  $('#btnRef').addEventListener('click', () => $('#fileRef').click());
  $('#fileRef').addEventListener('change', (e) => { if (e.target.files[0]) setReference(e.target.files[0]); e.target.value = ''; });
  $('#btnRefClear').addEventListener('click', clearReference);
  for (const m of $$('.modal')) {
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.closest('[data-close]')) {
        if (m.id === 'modalExport' && state.exportAbort) return;
        closeModal(m);
      }
    });
  }

  for (const tab of $$('.tab')) {
    tab.addEventListener('click', () => {
      for (const t of $$('.tab')) t.classList.toggle('active', t === tab);
      for (const p of $$('.tabpanel')) p.classList.toggle('active', p.dataset.panel === tab.dataset.tab);
    });
  }
  $('#btnPanel').addEventListener('click', () => $('#sidepanel').classList.toggle('open'));

  // Drag & drop files from the OS.
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; dragDepth++; els.dropHint.hidden = false; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--dragDepth <= 0) { dragDepth = 0; els.dropHint.hidden = true; } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    els.dropHint.hidden = true;
    importFiles(e.dataTransfer.files);
  });

  const flush = () => { if (P()) saveSoon.flush(); };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
    else if (camera.active) keepAwake(true);
  });
  window.addEventListener('pagehide', flush);
}

// ---------------------------------------------------------------- desktop: version, log, updates

/** Once a day, tells the user when a newer download exists. Never installs anything by itself. */
async function checkForUpdates() {
  const last = Number(localStorage.getItem(LS_UPDATE_CHECK) || 0);
  if (Date.now() - last < 24 * 3600 * 1000) return;
  localStorage.setItem(LS_UPDATE_CHECK, String(Date.now()));
  const r = await window.mesoraDesktop.app.checkUpdate().catch(() => null);
  if (r?.available) {
    toast('Hay una versión nueva de MESORA Studio. Tus proyectos se conservan al actualizar.', 'info', 15000, [
      { label: 'Descargar', onClick: () => window.open(r.url) },
    ]);
  }
}

async function showAppInfo() {
  const api = window.mesoraDesktop?.app;
  if (!api) return;
  const info = await api.info().catch(() => null);
  if (!info) return;
  $('#appInfo').hidden = false;
  $('#appVersion').textContent = `MESORA Studio ${info.version}${info.commit ? ` · compilación ${info.commit.slice(0, 7)}` : ''}`;
  $('#btnOpenLog').onclick = () => api.openLog().catch((err) => toast(err.message, 'error'));
}

// ---------------------------------------------------------------- init

async function init() {
  bindUI();
  showAppInfo();
  updateSpacing();
  const prefs = camPrefs();
  if (prefs.resolution) els.camRes.value = prefs.resolution;
  try {
    await library.init();
  } catch (err) {
    toast(`El almacenamiento local no está disponible: ${err.message}`, 'error', 8000);
    return;
  }
  if (library.kind === 'disk') await migrateOldProjects();
  let opened = null;
  const last = localStorage.getItem(LS_LAST);
  if (last) opened = await library.getProject(last).catch(() => null);
  if (!opened) {
    const [recent] = await library.listProjects();
    if (recent) opened = await library.getProject(recent.id).catch(() => null);
  }
  if (!opened) opened = { project: await library.createProject(newProject('Mi primera animación')), report: null };
  await openProject(opened.project, opened.report);
  buildCamControls();
  updateCamUI();
  await refreshDevices();
  requestAnimationFrame(loop);

  if (window.mesoraDesktop?.app) setTimeout(checkForUpdates, 15000);

  if (!localStorage.getItem(LS_WELCOMED)) {
    localStorage.setItem(LS_WELCOMED, '1');
    showWelcome();
  }

  try {
    const perm = await navigator.permissions?.query({ name: 'camera' });
    if (perm?.state === 'granted') startCamera();
  } catch { /* permissions API unavailable */ }

  // Offline cache for the web version; the apps already ship their files.
  if ('serviceWorker' in navigator && !isApp && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();

// Exposed for debugging from the console.
window.mesora = { state, player, camera, store, audio, viewer };
