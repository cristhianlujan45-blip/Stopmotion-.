import {
  $, $$, uid, debounce, clamp, sleep, toast, safeFileName, makeCanvas,
  canvasToBlob, getPath, setPath, withDefaults, formatDate, isTypingTarget,
} from './util.js';
import { library } from './library.js';
import { pendingBrowserProjects, migrateProject } from './migrate.js';
import { Camera } from './camera.js';
import { PhoneLink } from './phonecam.js';
import { FrameStore, isRawFile } from './framestore.js';
import { History } from './history.js';
import { AudioMix, TRACK_COLORS, encodeWav, exposureLevels } from './audio.js';
import { MOUTHS, mouthFor, mouthLabel, draftMouths } from './lipsync.js';
import { buildReviewPackage, parseReviewNotes } from './review.js';
import { LEARN_STEPS, currentStep } from './learn.js';
import { Rig, defaultLighting, defaultMoco } from './rig.js';
import { setupI18n, currentLang, saveLang, LANGS, t } from './i18n.js';

// Before anything else is drawn, so the whole interface comes up in the chosen language.
setupI18n();
import { createViewer } from './viewer-gl.js';
import { ACTIONS, Keymap, comboOf, comboLabel } from './shortcuts.js';
import { XSheetView, xsheetToCSV, xsheetFromCSV, xsheetTableHTML } from './xsheet.js';
import { openMonitor } from './monitor.js';
import { ANALYSIS_W, compareFrames, grayOf } from './assistant.js';
import { Timeline } from './timeline.js';
import {
  totalExposures, expandExposures, exposureStart, formatTime, moveItems, computeSpacing,
} from './timing.js';
import { supportedVideoTypes, renderVideo, buildImageSequence, outputSize, streamFrames } from './exporter.js';
import { exportProjectFile, importProjectFile } from './projectio.js';
import { deflickerGains, gradeFilter } from './grading.js';
import { saveFile, isAndroidApp, isDesktopApp, isApp } from './platform.js';

const LS_LAST = 'mesora.lastProject';
const LS_CAMERA = 'mesora.camera';
const LS_WELCOMED = 'mesora.welcomed';
const LS_SECTIONS = 'mesora.sections';
const LS_UPDATE_CHECK = 'mesora.updateCheck';
const LS_KEYS = 'mesora.keys';
const LS_UI_MODE = 'mesora.uiMode';
const LS_WORKSPACE = 'mesora.workspace';
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
    tether: { folder: '', assist: true },
    assistant: { enabled: true, live: true, sensitivity: 'normal' },
    lipsync: { characters: [], active: '', hud: true },
    lighting: defaultLighting(),
    moco: defaultMoco(),
    xsheet: { animator: '', length: 48, plan: {} },
    playSpeed: 1,
    display: 'preview',
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
    frames: [], audio: null, tracks: [], guides: [], settings: defaultSettings(),
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
  hudAssist: $('#hudAssist'),
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
  hudMouth: $('#hudMouth'),
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
const audio = new AudioMix();
const rig = new Rig({
  settings: () => S(),
  save: () => saveSoon(),
  toast,
  nextExposure: () => totalExposures(frames()) + 1,
  onBusy: (text) => { state.rigBusy = text; updateHudFlags(); },
});
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
  p.tracks = normalizeTracks(p);
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
  renderLipSync();
  rig.invalidate();
  rig.render();
  renderTimeline();
  await restoreAudio();
  await restoreChromaBg();
  await restoreReference();
  scheduleGains();
  refresh();
  updateProjectInfo();
  store.collectGarbage(p.id, p.frames.map((f) => f.id)).catch(() => {});
  showRecoveryReport(report);
  applyDisplayKind();
  restoreTether();
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
      if (state.compareTest && state.testShot) {
        v.draw(state.testShot, state.testShot.width, state.testShot.height, { clip: [0.5, 1] });
      } else if (s.onion.enabled && fr.length) drawOnion(fr.length);
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
  coach.played = true;
  refresh();
}

/** Review speed (studio mode): 1, 0.5 or 0.25. The project frame rate does not change. */
const playSpeed = () => (document.body.classList.contains('mode-studio') ? S().playSpeed || 1 : 1);

function playAudioFrom(pos) {
  if (!audio.ready || player.pingpong) return;
  const p = P();
  const speed = playSpeed();
  audio.play((player.startExposure + pos) / p.fps, undefined, speed);
}

function tickPlayer(now) {
  const fps = P().fps * playSpeed();
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
  audio.scrub(exposureStart(fr, index) / p.fps, Math.max(fr[index].hold / p.fps, 0.08));
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
  renderXSheet();
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
  const layers = p.tracks.map((t, i) => ({ peaks: audio.peaksOf(t.blobId), offset: t.offset || 0, color: trackColor(i), muted: t.muted }));
  timeline.drawWave(layers, p.fps, totalExposures(p.frames), audio.duration);
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

async function capture(mode = 'append', { skipDelay = false, hold = 1 } = {}) {
  if (state.busy) return;
  if (!camera.active && state.tether) {
    toast('Dispara con tu cámara o desde su programa: la foto entrará sola en MESORA.', 'info', 4000);
    return;
  }
  if (!camera.active) { toast('Conecta una cámara para capturar', 'warn'); return; }
  if (player.playing) stopPlayback(false);
  const project = P();
  const s = S();
  state.busy = true;
  let canvas;
  try {
    if (s.delay > 0 && !skipDelay) await countdown(s.delay);
    if (!camera.active) return;
    try {
      await rig.prepare(exposureForCapture(mode));
    } catch (err) {
      toast(`No se hizo la foto: la luz o el movimiento no están listos (${err.message})`, 'error', 7000);
      return;
    }
    canvas = await camera.grab({ average: s.average, flipH: s.flipH, flipV: s.flipV, format: s.format, quality: s.quality });
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
    const entry = { key: uid(), id, hold };
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
    assistAfterShot(project, entry.key, canvas);
    readyRigForNext();
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

/** Exposure (1-based) that a capture in `mode` will occupy. */
function exposureForCapture(mode) {
  const fr = frames();
  const at = state.playhead;
  if (mode === 'replace' && at < fr.length) return exposureStart(fr, at) + 1;
  if (mode === 'insert' && at < fr.length) return exposureStart(fr, at) + fr[at].hold + 1;
  return totalExposures(fr) + 1;
}

/** After a photo, lights and axes go to the next exposure while the animator works. */
function readyRigForNext() {
  rig.prepare(totalExposures(frames()) + 1).catch((err) => toast(`Luz o movimiento: ${err.message}`, 'error', 7000));
}

// ---------------------------------------------------------------- photo camera (tethering folder)

const cameraApi = window.mesoraDesktop?.camera;

/** Shows camera photos or the matching video-assist frames (desktop only). */
function applyDisplayKind() {
  store.displayKind = library.kind === 'disk' && S().display === 'assist' ? 'assist' : 'preview';
  state.dirty = true;
}

function updateTetherUI() {
  if (!cameraApi) return;
  const folder = state.tether;
  $('#tetherInfo').textContent = folder ? `Esperando fotos en: ${folder}` : 'No se está vigilando ninguna carpeta.';
  $('#btnTether').textContent = folder ? 'Cambiar carpeta…' : 'Elegir carpeta…';
  $('#btnTetherStop').hidden = !folder;
  updateCamUI();
}

async function watchFolder(folder) {
  try {
    await cameraApi.watch(P().id, folder);
    state.tether = folder;
  } catch (err) {
    state.tether = null;
    toast(`No se puede vigilar la carpeta: ${err.message}`, 'error', 6000);
  }
  updateTetherUI();
}

async function chooseTetherFolder() {
  const folder = await cameraApi.chooseFolder();
  if (!folder) return;
  S().tether.folder = folder;
  saveSoon();
  await watchFolder(folder);
  if (state.tether) toast('Listo: haz fotos con tu cámara y aparecerán aquí.', 'ok', 5000);
}

async function stopTether() {
  await cameraApi.unwatch().catch(() => {});
  S().tether.folder = '';
  state.tether = null;
  saveSoon();
  updateTetherUI();
}

/** On opening a take, keeps watching the folder its scene uses (or stops). */
async function restoreTether() {
  if (!cameraApi) return;
  const folder = S().tether.folder;
  if (folder && folder === state.tether) await cameraApi.retarget(P().id);
  else if (folder) await watchFolder(folder);
  else if (state.tether) { await cameraApi.unwatch().catch(() => {}); state.tether = null; }
  updateTetherUI();
}

/** A new photo arrived from the camera's tethering folder and is already stored on disk. */
function onCameraPhoto({ key, id, display }) {
  const project = P();
  if (!project || project.id !== key) return;
  state.pendingCaptures++;
  updateSaveState();
  const job = saveChain.then(async () => {
    const r = await store.addIngested(key, id, display ? new Blob([display], { type: 'image/jpeg' }) : null);
    if (P() !== project) return;
    if (!frames().length) setProjectSize(r.w, r.h);
    if (S().tether.assist && camera.active) {
      const c = await camera.grab({ flipH: S().flipH, flipV: S().flipV });
      await library.writeAssist(key, id, await canvasToBlob(c, 'image/jpeg', 0.9));
    }
    const entry = { key: uid(), id, hold: 1 };
    commit((fr) => {
      fr.push(entry);
      state.playhead = fr.length;
      state.selection = new Set();
    });
    flash();
    assistAfterShot(project, entry.key);
    readyRigForNext();
  }).catch((err) => {
    console.error(err);
    toast(`No se pudo añadir la foto de la cámara: ${err.message}`, 'error', 6000);
  }).finally(() => {
    state.pendingCaptures--;
    updateSaveState();
  });
  saveChain = job;
}

// ---------------------------------------------------------------- shooting assistant

// Compares each new photo with the previous frame and warns about accidents.
// It only reads images; what to do about a warning is always the user's call.
const analyses = new Map(); // "project:frame" → small grey image, for the last few frames

/** Small grey copy of an image, the size the assistant works at. */
function analysisOf(source, w, h, { flipH = false, flipV = false } = {}) {
  const aw = ANALYSIS_W;
  const ah = Math.max(2, Math.round((aw * h) / w / 2) * 2);
  const c = makeCanvas(aw, ah);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (flipH || flipV) {
    ctx.translate(flipH ? aw : 0, flipV ? ah : 0);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  }
  ctx.drawImage(source, 0, 0, aw, ah);
  return grayOf(ctx.getImageData(0, 0, aw, ah).data, aw, ah);
}

// Frame ids repeat between takes (c000001…), so the cache key includes the take.
const analysisKey = (id) => `${store.projectId}:${id}`;

function rememberAnalysis(id, img) {
  const key = analysisKey(id);
  analyses.delete(key);
  analyses.set(key, img);
  while (analyses.size > 6) analyses.delete(analyses.keys().next().value);
}

async function frameAnalysis(id, remember = true) {
  const key = analysisKey(id);
  if (analyses.has(key)) return analyses.get(key);
  const bmp = await store.decode(id, store.displayKind, { resizeWidth: ANALYSIS_W, resizeQuality: 'medium' });
  if (!bmp) return null;
  const img = analysisOf(bmp, bmp.width, bmp.height);
  bmp.close?.();
  if (remember && key === analysisKey(id)) rememberAnalysis(id, img);
  return img;
}

const assistOptions = (p, checks = null) => ({ sensitivity: p.settings.assistant.sensitivity, widthPx: p.width, checks });

/** Goes to a frame and shows how it differs from the one before it. */
function showDifferenceAt(key) {
  const i = frames().findIndex((f) => f.key === key);
  if (i < 0) return;
  stopPlayback(false);
  state.playhead = i;
  state.selection = new Set([key]);
  if (S().mode !== 'difference') setMode('difference');
  renderTimeline();
  refresh();
}

async function assistAfterShot(project, key, source = null) {
  if (!project.settings.assistant.enabled) return;
  try {
    const fr = project.frames;
    const i = fr.findIndex((f) => f.key === key);
    if (i <= 0 || fr[i - 1].id === fr[i].id) return;
    const b = source ? analysisOf(source, source.width, source.height) : await frameAnalysis(fr[i].id);
    if (source) rememberAnalysis(fr[i].id, b);
    const a = await frameAnalysis(fr[i - 1].id);
    if (!a || !b || a.h !== b.h || P() !== project) return;
    const { issues } = compareFrames(a, b, assistOptions(project));
    if (!issues.length) return;
    const actions = [{ label: 'Ver diferencia', onClick: () => showDifferenceAt(key) }];
    if (issues.some((x) => x.type === 'exposure') && !project.settings.grade.deflicker) {
      actions.push({ label: 'Compensar parpadeo', onClick: () => enableDeflicker(project) });
    }
    toast(`Fotograma ${i + 1}: ${issues.map((x) => x.text).join(' ')}`, 'warn', 9000, actions);
  } catch (err) {
    console.warn('Asistente de rodaje:', err);
  }
}

/** Turns on the deflicker of playback and export (the photos themselves are not changed). */
function enableDeflicker(project) {
  if (P() !== project) return;
  S().grade.deflicker = true;
  applySettingsToUI();
  onSettingChanged('grade.deflicker');
  toast('Compensación de parpadeo activada: iguala la luz al reproducir y exportar. Las fotos no cambian. (Animar › Color y luz)', 'ok', 6000);
}

// Live watch: before shooting, compares the live view with the last frame
// (light and camera position only, so hands at work do not trigger it).
const liveWatch = { busy: false, last: '', streak: 0 };

async function liveAssistTick() {
  const el = els.hudAssist;
  const p = P();
  const fr = frames();
  const on = p?.settings.assistant.live && camera.active && isLive() && !player.playing && fr.length && !document.hidden;
  if (!on) { el.hidden = true; liveWatch.streak = 0; return; }
  if (liveWatch.busy) return;
  liveWatch.busy = true;
  try {
    const a = await frameAnalysis(fr[fr.length - 1].id);
    if (!a || P() !== p || !camera.active) return;
    const b = analysisOf(camera.video, camera.width, camera.height, { flipH: S().flipH, flipV: S().flipV });
    if (a.h !== b.h) { el.hidden = true; return; }
    const { issues } = compareFrames(a, b, assistOptions(p, ['bump', 'exposure']));
    const sig = issues.map((x) => x.type).join();
    // Only report what lasts for two checks in a row.
    liveWatch.streak = sig === liveWatch.last ? liveWatch.streak + 1 : 0;
    liveWatch.last = sig;
    if (liveWatch.streak < 1) return;
    el.hidden = !issues.length;
    el.textContent = issues.map((x) => x.short).join(' · ');
    el.title = issues.map((x) => x.text.replace('respecto al fotograma anterior', 'respecto al último fotograma')).join('\n');
  } catch (err) {
    console.warn('Vigilancia en vivo:', err);
  } finally {
    liveWatch.busy = false;
  }
}

/** Checks every pair of consecutive frames of the take and lists what looks wrong. */
async function reviewTake() {
  const project = P();
  const fr = frames().slice();
  if (fr.length < 2) { toast('Hacen falta al menos 2 fotogramas para revisar la toma', 'info'); return; }
  const btn = $('#btnReviewTake');
  btn.disabled = true;
  const found = [];
  try {
    let prev = null;
    for (let i = 0; i < fr.length; i++) {
      btn.textContent = `Revisando ${i + 1} / ${fr.length}…`;
      const cur = await frameAnalysis(fr[i].id, false);
      if (P() !== project) return;
      if (prev && cur && prev.h === cur.h && fr[i].id !== fr[i - 1].id) {
        const { issues } = compareFrames(prev, cur, assistOptions(project));
        if (issues.length) found.push({ i, f: fr[i], issues });
      }
      prev = cur;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Revisar toda la toma';
  }
  const items = found.map(({ i, f, issues }) => {
    const li = document.createElement('li');
    li.className = 'project-item';
    li.innerHTML = `
      <div class="thumb"></div>
      <div class="info"><div class="name"></div><div class="sub"></div></div>
      <div class="actions"><button class="btn" data-act="show">Ver</button></div>`;
    li.querySelector('.name').textContent = `Fotograma ${i + 1}`;
    li.querySelector('.sub').textContent = issues.map((x) => x.text).join(' ');
    store.thumbUrl(f.id).then((url) => { if (url) li.querySelector('.thumb').style.backgroundImage = `url("${url}")`; });
    li.querySelector('[data-act="show"]').addEventListener('click', () => { closeModal($('#modalList')); showDifferenceAt(f.key); });
    return li;
  });
  showList('Revisión de la toma', found.length
    ? `${found.length} ${found.length === 1 ? 'fotograma puede tener' : 'fotogramas pueden tener'} un problema. No se ha cambiado nada: «Ver» lo muestra en modo diferencia para que decidas.`
    : 'No se encontraron problemas entre fotogramas consecutivos.', items);
}

// ---------------------------------------------------------------- lights and motion control

function wireRig() {
  const fail = (sel) => (err) => rig.status(sel, err.message, true);
  for (const id of ['#lightList', '#lightKeys', '#lookSliders']) {
    $(id).addEventListener('input', (e) => rig.onLightsInput(e));
    $(id).addEventListener('change', (e) => rig.onLightsInput(e));
  }
  $('#lightList').addEventListener('click', (e) => rig.onListClick(e, () => S().lighting.lights, () => rig.renderLights()));
  $('#lightKeys').addEventListener('click', (e) => rig.onListClick(e, () => S().lighting.keys, () => rig.renderLights()));
  $('#btnAddLight').addEventListener('click', () => rig.addLight());
  $('#btnAddLightKey').addEventListener('click', () => rig.addLightKey());
  $('#btnAddLook').addEventListener('click', async () => {
    const name = await askText('Nombre del look', `Look ${S().lighting.looks.length + 1}`);
    if (name?.trim()) rig.addLook(name.trim());
  });
  $('#btnRenameLook').addEventListener('click', async () => {
    const look = S().lighting.looks.find((k) => k.id === rig.editLook);
    const name = look && await askText('Nuevo nombre del look', look.name);
    if (!name?.trim()) return;
    look.name = name.trim();
    rig.changed();
    rig.renderLights();
  });
  $('#lookSelect').addEventListener('change', (e) => {
    rig.editLook = e.target.value;
    rig.renderLights();
    const look = S().lighting.looks.find((k) => k.id === rig.editLook);
    if (look && $('#lookLive').checked && S().lighting.output !== 'none') rig.sendLevels({ ...look.levels }).catch(fail('#dmxStatus'));
  });
  $('#btnDmxConnect').addEventListener('click', () => rig.connectDmx().catch(fail('#dmxStatus')));
  for (const id of ['#axisList', '#axisKeys']) {
    $(id).addEventListener('input', (e) => rig.onAxesInput(e));
    $(id).addEventListener('change', (e) => rig.onAxesInput(e));
    $(id).addEventListener('click', (e) => rig.onAxesClick(e));
  }
  $('#btnAddAxis').addEventListener('click', () => rig.addAxis());
  $('#btnAddAxisKey').addEventListener('click', () => rig.addAxisKeys());
  $('#btnMocoConnect').addEventListener('click', () => rig.connectMoco().catch(fail('#mocoStatus')));
  $('#btnMocoZero').addEventListener('click', () => rig.zero().catch(fail('#mocoStatus')));
}

// ---------------------------------------------------------------- automatic backup (desktop)

const backupApi = window.mesoraDesktop?.backup;
let backupErrorShown = 0;

function updateBackupUI(st) {
  const info = $('#backupInfo');
  $('#btnBackupChoose').textContent = st.folder ? 'Cambiar carpeta…' : 'Elegir carpeta…';
  $('#btnBackupNow').hidden = !st.folder;
  $('#btnBackupOff').hidden = !st.folder;
  $('#btnBackupNow').disabled = st.running;
  const l = st.last;
  info.classList.toggle('error-text', !!l?.error && !st.running);
  if (!st.folder) info.textContent = 'Sin copia de seguridad. Elige una carpeta para activarla.';
  else if (st.running) info.textContent = `Copiando en ${st.target}…`;
  else if (l?.error) info.textContent = `La última copia falló (${formatDate(l.at)}): ${l.error}`;
  else if (l) info.textContent = `Copia en ${st.target} · última: ${formatDate(l.at)}, ${l.copied} de ${l.files} archivos nuevos o cambiados.`;
  else info.textContent = `Copia en ${st.target} · la primera se hará en un momento.`;
  if (l?.error && !st.running && backupErrorShown !== l.at) {
    backupErrorShown = l.at;
    toast(`No se pudo hacer la copia de seguridad: ${l.error}`, 'error', 8000);
  }
}

async function backupAction(fn) {
  try {
    updateBackupUI(await fn());
  } catch (err) {
    toast(err.message, 'error', 7000);
  }
}

// ---------------------------------------------------------------- phone remote / local API (desktop)

const remoteApi = window.mesoraDesktop?.remote;
const remote = { on: false, active: false, lastState: '', previewBusy: false };

async function toggleRemote() {
  const btn = $('#btnRemote');
  btn.disabled = true;
  try {
    if (remote.on) {
      await remoteApi.stop();
      remote.on = false;
      remote.active = false;
    } else {
      const info = await remoteApi.start();
      remote.on = true;
      $('#remoteQr').src = `data:image/svg+xml;base64,${btoa(info.qr)}`;
      $('#remoteUrl').textContent = info.url;
      pushRemoteState(true);
    }
  } catch (err) {
    toast(`No se pudo activar el mando: ${err.message}`, 'error', 6000);
  } finally {
    btn.disabled = false;
    updateRemoteUI();
  }
}

function updateRemoteUI() {
  $('#btnRemote').textContent = remote.on ? 'Desactivar el mando' : 'Activar el mando';
  $('#remoteBox').hidden = !remote.on;
  $('#remoteState').textContent = remote.active ? 'Móvil conectado.' : 'Ningún móvil conectado todavía.';
}

/** What the phone shows: where we are in the take. */
function remoteState() {
  const p = P();
  const fr = frames();
  return {
    project: p.name, take: p.scene ? `${p.scene.name} · ${p.take.name}` : '',
    frames: fr.length, position: Math.min(state.playhead, fr.length - 1) + 1,
    live: isLive(), playing: player.playing, fps: p.fps, camera: camera.active,
  };
}

function pushRemoteState(force = false) {
  if (!remote.on || !P()) return;
  const s = remoteState();
  const json = JSON.stringify(s);
  if (!force && json === remote.lastState) return;
  remote.lastState = json;
  remoteApi.state(s);
}

/** Small copy of the viewer for the phone, only while one is connected. */
async function pushRemotePreview() {
  if (!remote.on || !remote.active || remote.previewBusy) return;
  remote.previewBusy = true;
  try {
    const src = $('#mainCanvas');
    const w = 480;
    const c = makeCanvas(w, (w * src.height) / src.width || 270);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    const blob = await canvasToBlob(c, 'image/jpeg', 0.7);
    remoteApi.preview(new Uint8Array(await blob.arrayBuffer()));
  } catch (err) {
    console.warn('Vista previa para el móvil:', err);
  } finally {
    remote.previewBusy = false;
  }
}

// ---------------------------------------------------------------- phone as a wireless camera (desktop)

const phoneApi = window.mesoraDesktop?.phonecam;
const phone = { on: false, device: '', size: '', seen: false, statsBusy: false };

/** Waits for the phone: shows the QR; when the phone connects, it becomes the camera. */
async function usePhone({ show = true } = {}) {
  if (!phoneApi) return;
  if (!phone.on) {
    try {
      const info = await phoneApi.start();
      phone.on = true;
      $('#phoneQr').src = `data:image/svg+xml;base64,${btoa(info.qr)}`;
      $('#phoneUrl').textContent = info.url;
      $('#phoneOtherUrls').textContent = info.urls.slice(1).join('\n');
      $('#phoneOther').hidden = info.urls.length < 2;
      saveCamPrefs({ deviceId: 'phone' });
    } catch (err) {
      toast(`No se pudo preparar el móvil como cámara: ${err.message}`, 'error', 6000);
      return;
    }
  }
  if (!camera.remote) {
    camera.stop();
    els.stageEmptyMsg.textContent = 'Esperando al móvil: escanea el código de Cámara › Fuente';
    if (show) {
      setWorkspace('camera');
      $('details[data-sec="fuente"]').open = true;
    }
  }
  updateCamUI();
  updatePhoneUI();
}

async function stopPhone() {
  phone.on = false;
  phone.seen = false;
  if (camera.remote) camera.stop();
  await phoneApi?.stop();
  updatePhoneUI();
}

/** A phone has opened the camera page and asks to connect. */
async function phoneOffer({ id, sdp }) {
  if (!phone.on) {
    phoneApi.answer(id, { error: 'En MESORA no está elegido el móvil como cámara (Cámara › Fuente).' });
    return;
  }
  if (camera.remote?.connected) {
    phoneApi.answer(id, { error: 'Ya hay otro móvil conectado como cámara.' });
    return;
  }
  const link = new PhoneLink();
  try {
    phoneApi.answer(id, { sdp: await link.accept(sdp) });
    await link.ready;
  } catch (err) {
    link.close();
    phoneApi.answer(id, { error: err.message });
    if (phone.on && !camera.remote) $('#phoneState').textContent = err.message;
    return;
  }
  if (!phone.on) { link.close(); return; }
  link.onChange = () => phoneChanged();
  await camera.attach(link);
  if (camera.remote !== link) return; // another camera was chosen meanwhile
  await phoneResolution().catch(() => {});
  if ($('#phoneDark').checked) link.request({ type: 'screen', dark: true }).catch(() => {});
  if (camera.remote !== link) return;
  phone.device = link.info.deviceId || '';
  phone.size = `${camera.width}x${camera.height}`;
  await cameraOpened();
  updatePhoneUI();
  toast(phone.seen ? 'Móvil reconectado' : 'El móvil es ahora la cámara', 'ok');
  phone.seen = true;
}

/** The phone opens its camera at the size chosen in Resolución. */
async function phoneResolution() {
  const link = camera.remote;
  if (!link) return;
  const [w, h] = els.camRes.value.split('x').map(Number);
  const s = link.info.settings || {};
  const asked = link.info.want || { width: Math.max(s.width || 0, s.height || 0) };
  if (asked.width === w && asked.height === h) return;
  await link.useCamera({ width: w, height: h });
}

/** The phone says something changed: another camera, size or setting. */
function phoneChanged() {
  const link = camera.remote;
  if (!link) return;
  if (link.info.deviceId !== phone.device) {
    phone.device = link.info.deviceId || '';
    restoreControls().then(buildCamControls);
  }
  const size = `${camera.width}x${camera.height}`;
  if (size !== phone.size) {
    phone.size = size;
    checkCameraSize();
  }
  updateCamUI();
  updatePhoneUI();
}

/** The connection dropped (wifi, phone locked…): the phone tries again by itself. */
function phoneLost() {
  camera.stop();
  stopTimelapse();
  els.stageEmptyMsg.textContent = 'Se perdió la conexión con el móvil. Esperando a que vuelva…';
  toast('Se perdió la conexión con el móvil. Volverá solo en cuanto el móvil reconecte.', 'warn', 6000);
  buildCamControls();
  updateCamUI();
  updatePhoneUI();
  state.dirty = true;
}

function updatePhoneUI() {
  const box = $('#phoneBox');
  if (!box) return;
  const link = camera.remote;
  box.hidden = !phone.on && els.camDevice.value !== 'phone';
  $('#phoneWait').hidden = !!link || !phone.on;
  $('#phoneState').textContent = link ? `Conectado: ${link.info.label || 'cámara del móvil'}`
    : phone.on ? 'Esperando al móvil…' : 'Pulsa Conectar para usar el móvil.';
  const cams = link?.info.cameras || [];
  const sel = $('#phoneCam');
  $('#phoneCamField').hidden = cams.length < 2;
  if (cams.length >= 2 && sel.dataset.list !== JSON.stringify(cams)) {
    sel.dataset.list = JSON.stringify(cams);
    sel.innerHTML = '';
    for (const c of cams) sel.append(new Option(c.label, c.id));
  }
  if (link) sel.value = link.info.deviceId || '';
  $('#phoneDarkField').hidden = !link;
  if (!link) $('#phoneStats').textContent = '';
}

/** Live view quality and delay, measured on this computer. */
async function showPhoneStats() {
  const link = camera.remote;
  if (!link || phone.statsBusy || $('#phoneBox').hidden || document.hidden) return;
  phone.statsBusy = true;
  try {
    const st = await link.stats();
    if (!st || camera.remote !== link) return;
    const ms = (v) => (v == null ? '–' : `${Math.round(v)} ms`);
    $('#phoneStats').textContent = `En vivo ${st.width} × ${st.height} · ${st.fps} fps · ${st.codec}`
      + ` · retardo medido aquí: red ${ms(st.networkMs)}, espera ${ms(st.bufferMs)}, decodificar ${ms(st.decodeMs)}`;
  } catch { /* closed meanwhile */ } finally {
    phone.statsBusy = false;
  }
}

// ---------------------------------------------------------------- test shot (A/B)

/** A photo to check exposure, focus or framing; it is not added to the animation. */
async function takeTestShot() {
  if (!camera.active) { toast('Conecta una cámara para hacer una foto de prueba', 'warn'); return; }
  const c = await camera.grab({ average: S().average, flipH: S().flipH, flipV: S().flipV });
  state.testShot?.close?.();
  state.testShot = await createImageBitmap(c);
  state.compareTest = true;
  $('#btnCompareTest').classList.add('on');
  $('#btnCompareTest').disabled = false;
  state.dirty = true;
  toast('Foto de prueba hecha. A la derecha ves la prueba y a la izquierda la cámara en vivo.', 'ok', 5000);
}

function toggleCompareTest() {
  if (!state.testShot) return;
  state.compareTest = !state.compareTest;
  $('#btnCompareTest').classList.toggle('on', state.compareTest);
  state.dirty = true;
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
  const current = phone.on ? 'phone' : camera.track?.getSettings?.().deviceId || camPrefs().deviceId || '';
  els.camDevice.innerHTML = '';
  // Never the phone by default: it opens a server on the network, so only when chosen.
  if (!devices.length) els.camDevice.append(new Option('Ninguna cámara detectada', ''));
  devices.forEach((d, i) => els.camDevice.append(new Option(d.label || `Cámara ${i + 1}`, d.deviceId)));
  if (phoneApi) els.camDevice.append(new Option('Móvil por wifi', 'phone'));
  if ([...els.camDevice.options].some((o) => o.value === current)) els.camDevice.value = current;
  updatePhoneUI();
}

async function startCamera({ quiet = false } = {}) {
  if (els.camDevice.value === 'phone') { await usePhone(); return; }
  if (phone.on) await stopPhone();
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
    if (!quiet) toast(msg, 'error', 4500);
    updateCamUI();
    return;
  }
  const track = camera.track;
  if (!track || camera.remote) return; // another camera was chosen meanwhile
  await refreshDevices();
  if (camera.track !== track) return;
  saveCamPrefs({ deviceId: track.getSettings?.().deviceId || '', resolution: els.camRes.value });
  await cameraOpened();
}

/** Once a camera (or the phone) gives a picture: its saved controls and the project size. */
async function cameraOpened() {
  await restoreControls();
  checkCameraSize();
  buildCamControls();
  updateCamUI();
  keepAwake(true);
  state.dirty = true;
}

async function restoreControls() {
  const saved = camPrefs().controls?.[camera.track?.getSettings?.().deviceId];
  if (saved && Object.keys(saved).length) {
    await camera.track.applyConstraints({ advanced: [saved] }).catch(() => {});
  }
}

function checkCameraSize() {
  const p = P();
  if (!camera.width || !camera.height) return;
  if (!p.frames.length) setProjectSize(camera.width, camera.height);
  else if (Math.abs(camera.width / camera.height - p.width / p.height) > 0.01) {
    toast('La relación de aspecto de la cámara no coincide con la del proyecto', 'warn', 4500);
  }
}

function stopCamera() {
  if (phone.on) stopPhone().catch(() => {});
  camera.stop();
  keepAwake(false);
  stopTimelapse();
  els.stageEmptyMsg.textContent = 'Cámara desconectada';
  buildCamControls();
  updateCamUI();
  state.dirty = true;
}

camera.onEnded = () => {
  if (camera.remote) { phoneLost(); return; }
  stopCamera();
  reconnectCamera();
};

/** After the camera signal is lost (cable, sleep…), keeps trying to open it again for a minute. */
async function reconnectCamera() {
  if (state.reconnecting) return;
  state.reconnecting = true;
  toast('Se perdió la señal de la cámara. Intentando reconectar…', 'warn', 5000);
  for (let i = 0; i < 30 && state.reconnecting && !camera.active; i++) {
    await sleep(2000);
    if (state.reconnecting) await startCamera({ quiet: true });
  }
  if (!state.reconnecting) return;
  state.reconnecting = false;
  if (camera.active) toast('Cámara reconectada', 'ok');
  else toast('No se pudo reconectar la cámara. Revisa el cable y pulsa Conectar.', 'error', 7000);
}

function updateCamUI() {
  const on = camera.active;
  els.camToggle.textContent = on || phone.on ? 'Desconectar' : 'Conectar';
  els.camInfo.textContent = on ? camera.info() : 'Sin señal';
  els.capture.disabled = !on && !state.tether;
  updateStageEmpty();
}

function updateStageEmpty() {
  els.stageEmpty.hidden = camera.active || !isLive() || player.playing;
  $('#btnStartCam').hidden = phone.on; // waiting for the phone: the QR is in Cámara › Fuente
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
  if (document.body.classList.contains('ws-xsheet')) xsheetView.setCurrent(player.playing ? player.index : isLive() ? -1 : state.playhead);
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
  // Exposure being shot (live) or shown, 1-based like the X-Sheet.
  const at = player.playing ? (exposure ?? player.exposure) : isLive() ? total : exposureStart(fr, state.playhead);
  updateHudMouth(at + 1).catch(() => {});
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
  if (state.rigBusy) flags.push(state.rigBusy);
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
  if (path === 'display') applyDisplayKind();
  if (path.startsWith('xsheet.')) renderXSheet();
  if (path.startsWith('lipsync.')) updateHud();
  if (path.startsWith('lighting.') || path.startsWith('moco.')) {
    rig.invalidate();
    if (path === 'moco.output' || ((path === 'moco.speed' || path === 'moco.accel') && rig.moco)) rig.disconnectMoco();
    rig.updateOutputUI();
  }
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
    viewer.drawLoupe(pos.clientX, pos.clientY, pos.u, pos.v, camera.video, camera.video.videoWidth, camera.video.videoHeight, { flipH: s.flipH, flipV: s.flipV });
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

const trackColor = (i) => TRACK_COLORS[i % TRACK_COLORS.length];

/** Projects from before multitrack sound had a single `audio`; it becomes the first track. */
function normalizeTracks(p) {
  if (Array.isArray(p.tracks)) return p.tracks;
  const a = p.audio;
  p.audio = null;
  return a?.blobId ? [{ id: uid(), blobId: a.blobId, name: (a.name || 'Audio').replace(/\.[^.]+$/, ''), offset: a.offset || 0, volume: 1, muted: false }] : [];
}

async function restoreAudio() {
  const p = P();
  audio.setTracks(p.tracks, p.fps);
  for (const t of p.tracks) {
    if (audio.has(t.blobId)) continue;
    try {
      const rec = await library.getBlob(p.id, t.blobId);
      if (P() !== p) return;
      if (rec) await audio.decode(t.blobId, rec.blob);
      else toast(`No se encuentra el archivo de la pista «${t.name}»`, 'error', 6000);
    } catch (err) {
      toast(`No se pudo cargar la pista «${t.name}»: ${err.message}`, 'error');
    }
  }
  if (P() !== p) return;
  renderTracks();
  drawWave();
}

/** Adds a sound file (dialogue, music, effects) as a new track starting at exposure 1. */
async function addAudioTrack(file) {
  const project = P();
  const blobId = uid();
  try {
    await audio.decode(blobId, file);
  } catch {
    toast(`Formato de audio no soportado: ${file.name}`, 'error');
    return;
  }
  await library.putBlob(project.id, { id: blobId, name: file.name, blob: file });
  if (P() !== project) return;
  project.tracks.push({ id: uid(), blobId, name: file.name.replace(/\.[^.]+$/, ''), offset: 0, volume: 1, muted: false });
  audio.setTracks(project.tracks, project.fps);
  saveSoon();
  renderTracks();
  drawWave();
  toast(`Pista añadida: ${file.name}`, 'ok');
}

function removeTrack(id) {
  const p = P();
  const t = p.tracks.find((x) => x.id === id);
  if (!t || !confirm(`¿Quitar la pista «${t.name}»?`)) return;
  p.tracks.splice(p.tracks.indexOf(t), 1);
  if (!p.tracks.some((x) => x.blobId === t.blobId)) library.deleteBlob(p.id, t.blobId).catch(() => {});
  audio.setTracks(p.tracks, p.fps);
  saveSoon();
  renderTracks();
  drawWave();
}

/** A track setting changed: save, redraw and, while playing, hear it at once. */
function trackChanged() {
  saveSoon();
  drawWave();
  updateAudioInfo();
  if (player.playing && !player.pingpong) playAudioFrom(player.exposure - player.startExposure);
}

function updateAudioInfo() {
  const p = P();
  const n = p.tracks.length;
  els.audioInfo.textContent = n
    ? `${n} ${n === 1 ? 'pista' : 'pistas'} · el sonido termina en ${audio.duration.toFixed(2)} s (exposición ${Math.ceil(audio.duration * p.fps)} a ${p.fps} fps)`
    : 'Sin audio. Añade diálogo, música o efectos: al moverte por los fotogramas escucharás el fragmento correspondiente.';
}

function renderTracks() {
  const p = P();
  const ul = $('#trackList');
  ul.innerHTML = '';
  p.tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = `track${t.muted ? ' muted' : ''}`;
    li.dataset.id = t.id;
    li.innerHTML = `
      <div class="track-head">
        <span class="swatch" style="background:${trackColor(i)}"></span>
        <input class="track-name" data-act="name" maxlength="60" aria-label="Nombre de la pista">
        <button class="btn small toggle${t.muted ? ' active' : ''}" data-act="mute" title="Silenciar esta pista" aria-pressed="${!!t.muted}">Silenciar</button>
        <button class="btn small ghost" data-act="remove" title="Quitar la pista">Quitar</button>
      </div>
      <div class="track-row">
        <label title="Volumen de la pista">Vol. <input type="range" min="0" max="1.5" step="0.05" data-act="volume"></label>
        <label title="Exposición en la que empieza a sonar (0 = desde el principio)">Desde exp. <input type="number" min="0" step="1" data-act="offset"></label>
      </div>
      <div class="muted small track-meta"></div>`;
    li.querySelector('[data-act="name"]').value = t.name;
    li.querySelector('[data-act="volume"]').value = t.volume ?? 1;
    li.querySelector('[data-act="offset"]').value = t.offset || 0;
    const d = audio.durationOf(t.blobId);
    li.querySelector('.track-meta').textContent = d ? `${d.toFixed(2)} s · ${Math.ceil(d * p.fps)} exposiciones` : 'No se pudo cargar';
    ul.append(li);
  });
  updateAudioInfo();
  updateLipTrackSelect();
}

function onTrackInput(e) {
  const li = e.target.closest('.track');
  const t = li && P().tracks.find((x) => x.id === li.dataset.id);
  if (!t) return;
  const act = e.target.dataset.act;
  if (act === 'name') { t.name = e.target.value.trim() || 'Pista'; saveSoon(); updateLipTrackSelect(); }
  if (act === 'volume') { t.volume = Number(e.target.value); trackChanged(); }
  if (act === 'offset' && e.type === 'change') {
    t.offset = Math.max(0, Math.floor(Number(e.target.value) || 0));
    e.target.value = t.offset;
    trackChanged();
  }
}

function onTrackClick(e) {
  const btn = e.target.closest('button[data-act]');
  const li = e.target.closest('.track');
  const t = li && P().tracks.find((x) => x.id === li.dataset.id);
  if (!btn || !t) return;
  if (btn.dataset.act === 'remove') removeTrack(t.id);
  if (btn.dataset.act === 'mute') {
    t.muted = !t.muted;
    li.classList.toggle('muted', t.muted);
    btn.classList.toggle('active', t.muted);
    btn.setAttribute('aria-pressed', String(t.muted));
    trackChanged();
  }
}

// ---------------------------------------------------------------- lip sync

const lip = () => S().lipsync;
const activeCharacter = () => lip().characters.find((c) => c.id === lip().active) || lip().characters[0] || null;
const mouthUrls = new Map(); // blobId → object URL

async function mouthUrl(blobId) {
  if (mouthUrls.has(blobId)) return mouthUrls.get(blobId);
  const rec = await library.getBlob(P().id, blobId).catch(() => null);
  const url = rec ? URL.createObjectURL(rec.blob) : '';
  mouthUrls.set(blobId, url);
  return url;
}

/** The mouth to put on for an exposure (1-based), from the X-Sheet «Fonema» column. */
function mouthAt(exposure) {
  const text = S().xsheet.plan?.[exposure]?.phoneme;
  return mouthFor(text);
}

function renderLipSync() {
  const l = lip();
  const sel = $('#lipCharacter');
  sel.innerHTML = '';
  for (const c of l.characters) sel.add(new Option(c.name, c.id));
  const c = activeCharacter();
  sel.value = c?.id || '';
  sel.disabled = !c;
  $('#btnLipRename').disabled = !c;
  const grid = $('#mouthGrid');
  grid.innerHTML = '';
  grid.hidden = !c;
  if (!c) return;
  for (const m of MOUTHS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mouth';
    b.dataset.mouth = m.id;
    b.title = `${m.label}: ${m.hint}. Pulsa para elegir la imagen de esta boca.`;
    b.innerHTML = '<span class="img"></span><span class="lbl"></span>';
    b.querySelector('.lbl').textContent = m.label;
    const id = c.mouths?.[m.id];
    if (id) mouthUrl(id).then((url) => { if (url) b.querySelector('.img').style.backgroundImage = `url("${url}")`; });
    else b.querySelector('.img').textContent = '+';
    grid.append(b);
  }
}

function updateLipTrackSelect() {
  const sel = $('#lipTrack');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '';
  for (const t of P().tracks) sel.add(new Option(t.name, t.id));
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  $('#btnLipDraft').disabled = !P().tracks.length;
}

async function addCharacter() {
  const name = await askText('Nombre del personaje', `Personaje ${lip().characters.length + 1}`);
  if (!name?.trim()) return;
  const c = { id: uid(), name: name.trim(), mouths: {} };
  lip().characters.push(c);
  lip().active = c.id;
  saveSoon();
  renderLipSync();
  updateHud();
}

async function renameCharacter() {
  const c = activeCharacter();
  if (!c) return;
  const name = await askText('Nuevo nombre del personaje', c.name);
  if (!name?.trim()) return;
  c.name = name.trim();
  saveSoon();
  renderLipSync();
}

let mouthTarget = null;

async function setMouthImage(file) {
  const c = activeCharacter();
  if (!c || !mouthTarget || !file.type.startsWith('image/')) return;
  const project = P();
  const blobId = uid();
  await library.putBlob(project.id, { id: blobId, name: file.name, blob: file });
  if (P() !== project) return;
  c.mouths ??= {};
  c.mouths[mouthTarget] = blobId;
  saveSoon();
  renderLipSync();
  updateHud();
}

/**
 * Fills the empty «Fonema» cells of the X-Sheet with a first draft from the
 * loudness of a track. Cells already written are never changed.
 */
async function draftLipSync() {
  const p = P();
  const t = p.tracks.find((x) => x.id === $('#lipTrack').value) || p.tracks[0];
  if (!t || !audio.has(t.blobId)) { toast('Añade primero la pista de diálogo', 'warn'); return; }
  const { buffer } = audio.decoded.get(t.blobId);
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) mono[i] += d[i] / buffer.numberOfChannels;
  }
  const mouths = draftMouths(exposureLevels(mono, buffer.sampleRate, p.fps));
  const plan = S().xsheet.plan;
  let filled = 0;
  mouths.forEach((m, i) => {
    const exposure = (t.offset || 0) + i + 1;
    if (plan[exposure]?.phoneme) return;
    plan[exposure] = { ...(plan[exposure] || {}), phoneme: m === 'rest' ? '-' : m };
    filled++;
  });
  saveSoon();
  renderXSheet();
  updateHud();
  toast(filled
    ? `Borrador listo: ${filled} exposiciones con boca en el X-Sheet (columna Fonema). Es aproximado, por volumen: corrígelo a mano.`
    : 'Todas las exposiciones de esa pista ya tenían fonema; no se cambió nada.', 'ok', 8000);
}

/** Mouth shown in the viewer for the exposure being shot or reviewed. */
async function updateHudMouth(exposure) {
  const el = els.hudMouth;
  const m = lip().hud ? mouthAt(exposure) : null;
  el.hidden = !m;
  if (!m) return;
  el.querySelector('b').textContent = `Boca: ${mouthLabel(m)}`;
  const blobId = activeCharacter()?.mouths?.[m];
  const img = el.querySelector('img');
  const url = blobId ? await mouthUrl(blobId) : '';
  img.hidden = !url;
  if (url && img.getAttribute('src') !== url) img.src = url;
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
    .filter((f) => f.type.startsWith('image/') || isRawFile(f))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const audios = files.filter((f) => f.type.startsWith('audio/'));
  const projects = files.filter((f) => /\.(mesora|zip)$/i.test(f.name));
  const notes = files.filter((f) => /\.json$/i.test(f.name));
  for (const f of notes) {
    const r = parseReviewNotes(await f.text());
    if (r) applyReviewNotes(r);
    else toast(`«${f.name}» no es un archivo de notas de revisión de MESORA`, 'warn', 6000);
  }
  for (const f of projects) await importProject(f);
  for (const a of audios) await addAudioTrack(a);
  if (images.length) await importImages(images);
  if (!images.length && !audios.length && !projects.length && !notes.length) toast('No se reconoció ningún archivo compatible', 'warn');
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

let projectListRun = 0;

/** Refreshes the projects window; #projectList has aria-busy="true" until the list is current. */
async function renderProjectList() {
  const run = ++projectListRun;
  const ul = $('#projectList');
  ul.setAttribute('aria-busy', 'true');
  try {
    const list = await library.listProjects();
    if (run !== projectListRun) return;
    if (library.kind === 'disk') renderProductionList(list);
    else renderBrowserList(list);
  } finally {
    if (run === projectListRun) ul.setAttribute('aria-busy', 'false');
  }
}

function renderBrowserList(list) {
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
    || { project: await library.createProject(newProject(t('Mi animación'))), report: null };
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

function exportRange(select = '#exRange') {
  const fr = frames();
  if ($(select).value === 'selection') {
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
  // Desktop: into the project's "exports" folder (or where the user picks), like films and image sequences.
  if (exportApi && P()?.storage === 'disk') {
    const r = await exportApi.saveFile(P().id, { name: filename, bytes: await blob.arrayBuffer(), ask: $('#dxAsk').checked });
    if (r) toast(message, 'ok', 8000, [{ label: 'Mostrar', onClick: () => exportApi.reveal(r.target).catch((err) => toast(err.message, 'error')) }]);
    return;
  }
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
      audioOffset: 0,
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

// ---------------------------------------------------------------- desktop export (FFmpeg)

const exportApi = window.mesoraDesktop?.export;

/** Output size for a resolution menu; asks for the height when "Personalizada…" is chosen. */
async function exportSize(select) {
  const p = P();
  let target = Number(select.value);
  if (select.value === 'custom') {
    const answer = await askText('Alto de la imagen en píxeles (por ejemplo 1080)', '1080');
    if (answer == null) return null;
    target = Math.round(Number(answer));
    if (!(target >= 64 && target <= 4320)) { toast('Escribe un alto entre 64 y 4320 píxeles', 'warn'); return null; }
  }
  return outputSize(p.width, p.height, target);
}

/** Film (MP4/ProRes/AVI) or image sequence (PNG/TIFF/JPEG), one picture per exposure, encoded by FFmpeg. */
async function exportWithFFmpeg(kind) {
  const fr = frames();
  if (!fr.length) { toast('No hay fotogramas para exportar', 'warn'); return; }
  const p = P();
  const video = kind === 'video';
  const size = await exportSize(video ? $('#dxRes') : $('#dxImgRes'));
  if (!size) return;
  const [a, b] = exportRange('#dxRange');
  const startExposure = exposureStart(fr, a);
  const filters = (video ? $('#dxGrade') : $('#dxGradeImg')).checked ? await exportFilters(a, b) : null;
  await saveNow();
  let audioWav = null;
  if (video && $('#dxAudio').checked && audio.ready) {
    const mix = await audio.mixdown(startExposure / p.fps, totalExposures(fr.slice(a, b)) / p.fps);
    audioWav = encodeWav([mix.getChannelData(0), mix.getChannelData(1)], mix.sampleRate).buffer;
  }
  let job;
  try {
    job = await exportApi.start(p.id, {
      format: video ? $('#dxFormat').value : $('#dxImgFormat').value,
      width: size.w, height: size.h, fps: p.fps, quality: $('#dxQuality').value,
      name: p.name, ask: $('#dxAsk').checked, audioWav,
    });
  } catch (err) {
    toast(`Error al exportar: ${err.message}`, 'error', 6000);
    return;
  }
  if (!job) return; // the user closed the save dialog
  const controller = new AbortController();
  state.exportAbort = controller;
  stopPlayback(false);
  setExportBusy(true);
  showProgress('Preparando…', 0);
  try {
    const n = await streamFrames({
      frames: fr.slice(a, b), store, width: size.w, height: size.h, filters,
      expand: video || $('#dxExpand').checked, signal: controller.signal,
      write: (bytes, times) => exportApi.frame(job.id, bytes, times),
      onProgress: (v) => showProgress(`${video ? 'Creando la película' : 'Creando las imágenes'}… ${Math.round(v * 100)}%`, v),
    });
    showProgress('Terminando…', 1);
    const { target } = await exportApi.finish(job.id);
    toast(video ? 'Película exportada' : `${n} imágenes exportadas`, 'ok', 9000, [
      { label: 'Mostrar', onClick: () => exportApi.reveal(target).catch((err) => toast(err.message, 'error')) },
    ]);
  } catch (err) {
    await exportApi.cancel(job.id).catch(() => {});
    if (err.name === 'AbortError') toast('Exportación cancelada', 'warn');
    else toast(`Error al exportar: ${err.message}`, 'error', 6000);
  } finally {
    state.exportAbort = null;
    setExportBusy(false);
    hideProgress();
  }
}

/** Mix of every audible track over the exported range, as a WAV file. */
async function exportWav() {
  const p = P();
  if (!audio.ready) { toast('Esta escena no tiene sonido (o todas sus pistas están silenciadas)', 'warn'); return; }
  const fr = frames();
  const [a, b] = exportRange(exportApi && p.storage === 'disk' ? '#dxRange' : undefined);
  const start = fr.length ? exposureStart(fr, a) / p.fps : 0;
  const length = fr.length ? totalExposures(fr.slice(a, b)) / p.fps : audio.duration;
  const mix = await audio.mixdown(start, length);
  const wav = encodeWav([mix.getChannelData(0), mix.getChannelData(1)], mix.sampleRate);
  await deliver(new Blob([wav], { type: 'audio/wav' }), `${safeFileName(p.name)}.wav`, 'Sonido exportado');
}

/** One HTML file with the take for someone to review in any browser and send notes back. */
async function exportReview() {
  const fr = frames();
  if (!fr.length) { toast('No hay fotogramas para revisar', 'warn'); return; }
  const p = P();
  const [a, b] = exportRange(exportApi && p.storage === 'disk' ? '#dxRange' : undefined);
  const sel = fr.slice(a, b);
  setExportBusy(true);
  try {
    let audioWav = null;
    if (audio.ready) {
      showProgress('Mezclando el sonido…', 0);
      const mix = await audio.mixdown(exposureStart(fr, a) / p.fps, totalExposures(sel) / p.fps, 22050);
      const l = mix.getChannelData(0), r = mix.getChannelData(1);
      const mono = new Float32Array(l.length);
      for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2;
      audioWav = encodeWav([mono], 22050);
    }
    const blob = await buildReviewPackage({
      project: p, frames: sel, audioWav,
      decode: (id) => store.decode(id, 'preview'),
      onProgress: (v) => showProgress(`Preparando el paquete de revisión… ${Math.round(v * 100)}%`, v),
    });
    await deliver(blob, `${safeFileName(p.name)}_revision.html`, 'Paquete de revisión listo: envíalo y pide que te devuelvan el archivo de notas');
  } catch (err) {
    toast(`No se pudo crear el paquete de revisión: ${err.message}`, 'error', 6000);
  } finally {
    setExportBusy(false);
    hideProgress();
  }
}

/** Puts the notes written in a review package on their frames (one undoable change). */
function applyReviewNotes(r) {
  const p = P();
  const fr = frames();
  const found = [];
  for (const n of r.notes) {
    let i = fr.findIndex((f) => f.key === n.key);
    if (i < 0) i = fr.findIndex((f) => f.id === n.id);
    if (i >= 0) found.push({ n, i });
  }
  if (!found.length) {
    toast(r.takeId && r.takeId !== p.id
      ? `Estas notas son de otra toma («${r.title}»). Ábrela y vuelve a importarlas.`
      : 'Ninguna nota coincide con los fotogramas de esta toma', 'warn', 7000);
    return;
  }
  const who = r.reviewer ? `${r.reviewer}: ` : 'Revisión: ';
  commit((frs) => {
    for (const { n, i } of found) {
      const text = `${who}${n.text}`;
      const cur = frs[i].note;
      if (cur?.includes(text)) continue;
      frs[i].note = cur ? `${cur} · ${text}` : text;
    }
  });
  const items = found.map(({ n, i }) => {
    const li = document.createElement('li');
    li.className = 'project-item';
    li.innerHTML = `
      <div class="thumb"></div>
      <div class="info"><div class="name"></div><div class="sub"></div></div>
      <div class="actions"><button class="btn" data-act="go">Ir</button></div>`;
    li.querySelector('.name').textContent = `Fotograma ${i + 1}`;
    li.querySelector('.sub').textContent = n.text;
    store.thumbUrl(fr[i].id).then((url) => { if (url) li.querySelector('.thumb').style.backgroundImage = `url("${url}")`; });
    li.querySelector('[data-act="go"]').addEventListener('click', () => { closeModal($('#modalList')); setPlayhead(i); });
    return li;
  });
  const missing = r.notes.length - found.length;
  showList(`Notas de revisión${r.reviewer ? ` de ${r.reviewer}` : ''}`, [
    `${found.length} ${found.length === 1 ? 'nota añadida a su fotograma' : 'notas añadidas a sus fotogramas'} (se pueden deshacer).`,
    missing ? `${missing} no tienen fotograma: se borraron o son de otra toma.` : '',
    r.general ? `Comentario general: ${r.general}` : '',
  ].filter(Boolean).join(' '), items);
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

// ---------------------------------------------------------------- learning mode

const LS_LEARN = 'mesora.learn';
const coach = { on: false, step: 0, played: false, exportOpened: false };

const coachContext = () => ({
  cameraReady: camera.active || !!state.tether, frames: frames().length, played: coach.played, exportOpened: coach.exportOpened,
});

function startCoach() {
  Object.assign(coach, { on: true, step: 0, played: false, exportOpened: false });
  for (const m of $$('.modal')) if (!m.hidden) closeModal(m);
  coachTick(true);
}

function stopCoach() {
  coach.on = false;
  try { localStorage.removeItem(LS_LEARN); } catch { /* private mode */ }
  renderCoach();
}

function coachTick(force = false) {
  if (!coach.on || !P()) return;
  const i = currentStep(coach.step, coachContext());
  if (i === coach.step && !force) return;
  coach.step = i;
  try { localStorage.setItem(LS_LEARN, String(i)); } catch { /* private mode */ }
  renderCoach();
}

function renderCoach() {
  for (const el of $$('.coach-target')) el.classList.remove('coach-target');
  const box = $('#coach');
  box.hidden = !coach.on;
  if (!coach.on) return;
  const step = LEARN_STEPS[coach.step];
  $('#coachStep').textContent = step ? `Paso ${coach.step + 1} de ${LEARN_STEPS.length}` : '¡Hecho!';
  $('#coachTitle').textContent = step ? step.title : 'Ya sabes lo básico';
  $('#coachText').textContent = step
    ? step.text
    : 'Para ir más allá: el modo Estudio (arriba) añade el X-Sheet, el lip sync, más papel cebolla y los atajos. Puedes volver a este tutorial desde Ayuda.';
  $('#btnCoachNext').textContent = step ? 'Siguiente' : 'Terminar';
  $('#btnCoachNext').hidden = !!step && !step.manual;
  $('#btnCoachSkip').hidden = !step || step.manual;
  const target = step?.targets.map((sel) => $(sel)).find((el) => el && el.offsetParent !== null);
  target?.classList.add('coach-target');
}

function coachNext() {
  if (coach.step >= LEARN_STEPS.length) { stopCoach(); return; }
  coach.step++;
  coachTick(true);
}

function showWelcome() {
  for (const m of $$('.modal')) m.hidden = true;
  openModal('#modalWelcome');
}

// ---------------------------------------------------------------- keyboard

const keymap = new Keymap((() => { try { return JSON.parse(localStorage.getItem(LS_KEYS)) || {}; } catch { return {}; } })());

/** What each shortcut action does. */
const ACTION_RUN = {
  capture: () => capture('append'),
  captureReplace: () => capture('replace'),
  captureInsert: () => capture('insert'),
  ...Object.fromEntries([2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`captureHold${n}`, () => capture('append', { hold: n })])),
  play: () => togglePlay(),
  shortPlay: () => shortPlay(),
  loop: () => setSetting('loop', !S().loop),
  pingpong: () => setSetting('pingpong', !S().pingpong),
  prev: () => step(-1),
  next: () => step(1),
  extendLeft: () => extendSelection(-1),
  extendRight: () => extendSelection(1),
  toggleLive: () => toggleLiveLast(),
  live: () => goLive(),
  first: () => setPlayhead(0),
  onion: () => setSetting('onion.enabled', !S().onion.enabled),
  difference: () => setMode('difference'),
  blink: () => toggleBlink(),
  grid: () => setSetting('grid', GRID_CYCLE[(GRID_CYCLE.indexOf(S().grid) + 1) % GRID_CYCLE.length]),
  peaking: () => setSetting('peaking', !S().peaking),
  loupe: () => toggleLoupe(),
  fullscreen: () => toggleFullscreen(),
  delete: () => deleteSelected(),
  duplicate: () => duplicateSelected(),
  selectAll: () => selectAll(),
  holdMore: () => changeHold(1),
  holdLess: () => changeHold(-1),
  note: () => {
    if (els.frameNote.disabled) toast('Elige un fotograma en la línea de tiempo para anotarlo', 'info', 2000);
    else { els.frameNote.focus(); els.frameNote.select(); }
  },
  undo: () => undo(),
  redo: () => redo(),
  save: () => { saveSoon.flush(); toast('Proyecto guardado', 'ok', 1400); },
  help: () => openModal('#modalHelp'),
  escape: () => {
    if (state.drawing) toggleDrawing(false);
    else if (player.playing) stopPlayback(false);
    else if (state.blink) toggleBlink();
  },
};
const ACTION_INFO = new Map(ACTIONS.map((a) => [a.id, a]));

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
  const combo = comboOf(e);
  const action = combo && keymap.actionFor(combo);
  if (!action) return;
  const info = ACTION_INFO.get(action);
  if (info.studio && !document.body.classList.contains('mode-studio')) return;
  e.preventDefault();
  if (e.repeat && info.noRepeat) return;
  ACTION_RUN[action]();
}

/** Help › shortcuts: lists every action with its keys and lets the user change them. */
function renderShortcuts() {
  const root = $('#shortcutList');
  root.innerHTML = '';
  const groups = new Map();
  for (const a of ACTIONS) {
    if (a.studio && !document.body.classList.contains('mode-studio')) continue;
    if (a.fixed && a.id !== 'captureHold2') continue;
    if (!groups.has(a.group)) groups.set(a.group, []);
    groups.get(a.group).push(a);
  }
  for (const [group, actions] of groups) {
    const box = document.createElement('div');
    box.innerHTML = `<h3></h3>`;
    box.querySelector('h3').textContent = group;
    for (const a of actions) {
      const row = document.createElement('div');
      row.className = 'key-row';
      const keys = keymap.keys.get(a.id);
      row.innerHTML = `<span class="what"></span><span class="keys">${keys.map((k) => `<kbd></kbd>`).join(' ')}</span><button class="btn ghost">Cambiar</button>`;
      row.querySelector('.what').textContent = a.label;
      row.querySelectorAll('kbd').forEach((el, i) => { el.textContent = comboLabel(keys[i]); });
      if (!keys.length) row.querySelector('.keys').innerHTML = '<span class="muted small">sin atajo</span>';
      if (a.fixed) {
        row.querySelector('.what').textContent = 'Capturar y mantener 2 a 9 cuadros';
        row.querySelector('.keys').innerHTML = '<kbd>Ctrl + 2 … 9</kbd>';
        row.querySelector('button').remove();
      } else {
        row.querySelector('button').addEventListener('click', () => listenForKey(a, row));
      }
      box.append(row);
    }
    root.append(box);
  }
}

function listenForKey(action, row) {
  row.classList.add('listening');
  row.querySelector('.keys').innerHTML = '<kbd>Pulsa una tecla…</kbd>';
  const onKey = (e) => {
    const combo = comboOf(e);
    if (!combo) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    window.removeEventListener('keydown', onKey, true);
    if (combo !== 'Escape') {
      const lost = keymap.assign(action.id, combo);
      localStorage.setItem(LS_KEYS, JSON.stringify(keymap.changes()));
      if (lost) toast(`«${ACTION_INFO.get(lost).label}» se ha quedado sin atajo`, 'warn', 4000);
    }
    renderShortcuts();
  };
  window.addEventListener('keydown', onKey, true);
}

// ---------------------------------------------------------------- workspaces and interface mode

function setWorkspace(tab) {
  if (!$(`.tab[data-tab="${tab}"]`) || ($(`.tab[data-tab="${tab}"]`).classList.contains('studio-only') && !document.body.classList.contains('mode-studio'))) tab = 'camera';
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.tab === tab);
  for (const p of $$('.tabpanel')) p.classList.toggle('active', p.dataset.panel === tab);
  for (const c of [...document.body.classList]) if (c.startsWith('ws-')) document.body.classList.remove(c);
  document.body.classList.add(`ws-${tab}`);
  localStorage.setItem(LS_WORKSPACE, tab);
  if (tab === 'xsheet') renderXSheet(true);
}

/** Sencillo: the essentials. Estudio: X-Sheet, multi-frame capture keys, review speed and more. */
function setUiMode(mode) {
  const studio = mode === 'studio';
  document.body.classList.toggle('mode-studio', studio);
  for (const b of $$('[data-uimode]')) b.classList.toggle('active', b.dataset.uimode === mode);
  localStorage.setItem(LS_UI_MODE, mode);
  if (!studio && $('.tab.active')?.classList.contains('studio-only')) setWorkspace('view');
  renderShortcuts();
}

// ---------------------------------------------------------------- X-Sheet

const xsheetView = new XSheetView({
  root: $('#xsheet'),
  onSelect: (i) => (i >= 0 ? onTimelineSelect(i, {}) : goLive()),
  onPlan: (exposure, key, value) => {
    const plan = S().xsheet.plan;
    const row = { ...(plan[exposure] || {}) };
    if (value.trim()) row[key] = value; else delete row[key];
    if (Object.keys(row).length) plan[exposure] = row; else delete plan[exposure];
    saveSoon();
    if (key === 'phoneme') updateHud();
  },
  onNote: (i, text) => {
    const f = frames()[i];
    if (!f) return;
    const note = text.trim();
    if ((f.note || '') === note) return;
    commit((fr) => { if (note) fr[i].note = note; else delete fr[i].note; });
  },
});

function renderXSheet(force = false) {
  if (!document.body.classList.contains('ws-xsheet') && !force) return;
  const x = S().xsheet;
  xsheetView.update({ frames: frames(), plan: x.plan, length: Number(x.length) || 48, fps: P().fps, current: isLive() ? -1 : state.playhead });
  xsheetView.reveal(isLive() ? -1 : state.playhead);
}

async function exportXSheetCSV() {
  const x = S().xsheet;
  const csv = xsheetToCSV(frames(), x.plan, Number(x.length) || 48, P().fps);
  const name = `${safeFileName(P().name)}${P().scene ? `_${P().scene.id}_${P().take.id}` : ''}_xsheet.csv`;
  await deliver(new Blob(['﻿', csv], { type: 'text/csv' }), name, 'X-Sheet exportado');
}

async function importXSheetCSV(file) {
  const plan = xsheetFromCSV(await file.text());
  const n = Object.keys(plan).length;
  if (!n) { toast('El CSV no tiene columnas de Acción, Diálogo, Fonema, Cámara o Luz', 'warn', 5000); return; }
  if (Object.keys(S().xsheet.plan).length && !confirm(`¿Sustituir lo planificado en el X-Sheet por las ${n} filas del CSV?`)) return;
  S().xsheet.plan = plan;
  saveSoon();
  renderXSheet(true);
  toast(`${n} filas importadas al X-Sheet`, 'ok');
}

function printXSheet() {
  const p = P();
  const x = S().xsheet;
  $('#xsheetPrint').innerHTML = xsheetTableHTML(frames(), x.plan, Number(x.length) || 48, p.fps, {
    title: `${p.name}${p.scene ? ` · ${p.scene.name} · ${p.take.name}` : ''}`,
    subtitle: `${p.fps} fps${x.animator ? ` · Animación: ${x.animator}` : ''} · ${formatDate(Date.now())}`,
  });
  document.body.classList.add('printing-xsheet');
  window.print();
  document.body.classList.remove('printing-xsheet');
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
  els.camToggle.addEventListener('click', () => {
    state.reconnecting = false;
    if (camera.active || phone.on) stopCamera(); else startCamera();
  });
  els.camDevice.addEventListener('change', () => { if (camera.active || phone.on || els.camDevice.value) startCamera(); });
  els.camRes.addEventListener('change', () => {
    saveCamPrefs({ resolution: els.camRes.value });
    if (camera.remote) phoneResolution().catch((err) => toast(`El móvil no pudo cambiar de tamaño: ${err.message}`, 'error', 5000));
    else if (camera.active) startCamera();
  });
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
  $('#btnTestShot').addEventListener('click', () => takeTestShot().catch((err) => toast(err.message, 'error')));
  $('#btnReviewTake').addEventListener('click', () => reviewTake().catch((err) => toast(`No se pudo revisar la toma: ${err.message}`, 'error')));
  setInterval(liveAssistTick, 900);
  $('#btnCompareTest').addEventListener('click', toggleCompareTest);
  if (cameraApi) {
    $('#btnTether').addEventListener('click', () => chooseTetherFolder().catch((err) => toast(err.message, 'error', 6000)));
    $('#btnTetherStop').addEventListener('click', () => stopTether());
    cameraApi.onPhoto(onCameraPhoto);
    cameraApi.onError((msg) => toast(msg, 'error', 7000));
  }
  if (backupApi) {
    backupApi.onStatus(updateBackupUI);
    backupApi.status().then(updateBackupUI);
    $('#btnBackupChoose').addEventListener('click', () => backupAction(backupApi.choose));
    $('#btnBackupNow').addEventListener('click', () => backupAction(backupApi.run));
    $('#btnBackupOff').addEventListener('click', () => backupAction(backupApi.disable));
  }
  wireRig();
  if (phoneApi) {
    phoneApi.onOffer((offer) => phoneOffer(offer).catch((err) => console.warn('Móvil como cámara:', err)));
    $('#phoneCam').addEventListener('change', () => {
      camera.remote?.useCamera({ deviceId: $('#phoneCam').value })
        .catch((err) => toast(`El móvil no pudo cambiar de cámara: ${err.message}`, 'error', 5000));
    });
    $('#phoneDark').addEventListener('change', () => {
      camera.remote?.request({ type: 'screen', dark: $('#phoneDark').checked }).catch(() => {});
    });
    setInterval(showPhoneStats, 1000);
  }
  if (remoteApi) {
    $('#btnRemote').addEventListener('click', toggleRemote);
    remoteApi.onAction((action) => ACTION_RUN[action]?.());
    remoteApi.onActive((active) => {
      remote.active = active;
      updateRemoteUI();
      if (active) pushRemoteState(true);
    });
    setInterval(() => { pushRemoteState(); pushRemotePreview(); }, 600);
  }
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
    audio.setTracks(P().tracks, P().fps);
    renderTracks();
    drawWave();
  });
  els.projectName.addEventListener('change', () => {
    P().name = els.projectName.value.trim() || t('Sin título');
    els.projectName.value = P().name;
    saveSoon();
  });
  els.projectName.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.projectName.blur(); });

  $('#btnAudio').addEventListener('click', () => $('#fileAudio').click());
  $('#fileAudio').addEventListener('change', async (e) => {
    for (const f of [...e.target.files]) await addAudioTrack(f);
    e.target.value = '';
  });
  $('#trackList').addEventListener('input', onTrackInput);
  $('#trackList').addEventListener('change', onTrackInput);
  $('#trackList').addEventListener('click', onTrackClick);
  $('#lipCharacter').addEventListener('change', (e) => { lip().active = e.target.value; saveSoon(); renderLipSync(); updateHud(); });
  $('#btnLipAddChar').addEventListener('click', addCharacter);
  $('#btnLipRename').addEventListener('click', renameCharacter);
  $('#mouthGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.mouth');
    if (!b) return;
    mouthTarget = b.dataset.mouth;
    $('#fileMouth').click();
  });
  $('#fileMouth').addEventListener('change', (e) => {
    if (e.target.files[0]) setMouthImage(e.target.files[0]).catch((err) => toast(err.message, 'error'));
    e.target.value = '';
  });
  $('#btnLipDraft').addEventListener('click', () => draftLipSync().catch((err) => toast(`No se pudo generar el borrador: ${err.message}`, 'error')));

  els.timelapse.addEventListener('click', toggleTimelapse);
  for (const id of ['#spDist', '#spFrames', '#spEase']) $(id).addEventListener('input', updateSpacing);

  $('#btnImport').addEventListener('click', () => $('#fileImport').click());
  $('#fileImport').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });

  $('#btnProjects').addEventListener('click', () => { renderProjectList(); openModal('#modalProjects'); });
  $('#formNewProject').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = await library.createProject(newProject($('#newProjectName').value.trim() || t('Sin título'), Number($('#newProjectFps').value)));
    $('#newProjectName').value = '';
    closeModal($('#modalProjects'));
    await openProject(p);
    toast(`Proyecto «${p.name}» creado`, 'ok');
  });

  $('#btnExport').addEventListener('click', () => { coach.exportOpened = true; populateExportFormats(); openModal('#modalExport'); });
  $('#btnExportVideo').addEventListener('click', exportVideo);
  $('#btnExportZip').addEventListener('click', exportZip);
  $('#btnDxVideo').addEventListener('click', () => exportWithFFmpeg('video'));
  $('#btnDxImages').addEventListener('click', () => exportWithFFmpeg('images'));
  $('#btnDxConform').addEventListener('click', () => conformTake().catch((err) => toast(err.message, 'error', 6000)));
  $('#btnExportReview').addEventListener('click', () => exportReview());
  $('#btnExportWav').addEventListener('click', () => exportWav().catch((err) => toast(`Error al exportar: ${err.message}`, 'error', 6000)));
  $('#dxFormat').addEventListener('change', () => { $('#dxQualityRow').hidden = $('#dxFormat').value !== 'mp4'; });
  $('#btnExportFrame').addEventListener('click', exportCurrentFrame);
  $('#btnExportProject').addEventListener('click', () => exportProject());
  $('#btnExportCancel').addEventListener('click', () => state.exportAbort?.abort());

  $('#btnHelp').addEventListener('click', () => openModal('#modalHelp'));
  $('#btnShowWelcome').addEventListener('click', showWelcome);
  $('#btnWelcomeHelp').addEventListener('click', () => { closeModal($('#modalWelcome')); openModal('#modalHelp'); });
  for (const sel of $$('.lang-select')) {
    sel.innerHTML = Object.entries(LANGS).map(([code, name]) => `<option value="${code}">${name}</option>`).join('');
    sel.value = currentLang();
    sel.addEventListener('change', async () => {
      saveLang(sel.value);
      await saveNow().catch(() => {});
      location.reload();
    });
  }
  $('#btnWelcomeLearn').addEventListener('click', startCoach);
  $('#btnLearn').addEventListener('click', startCoach);
  $('#btnCoachNext').addEventListener('click', coachNext);
  $('#btnCoachSkip').addEventListener('click', coachNext);
  $('#btnCoachClose').addEventListener('click', stopCoach);
  setInterval(() => coachTick(), 500);
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

  for (const tab of $$('.tab')) tab.addEventListener('click', () => setWorkspace(tab.dataset.tab));
  for (const b of $$('[data-uimode]')) b.addEventListener('click', () => setUiMode(b.dataset.uimode));
  setUiMode(localStorage.getItem(LS_UI_MODE) === 'studio' ? 'studio' : 'simple');
  setWorkspace(localStorage.getItem(LS_WORKSPACE) || 'camera');
  $('#btnResetKeys').addEventListener('click', () => {
    keymap.reset();
    localStorage.removeItem(LS_KEYS);
    renderShortcuts();
    toast('Atajos restablecidos', 'ok');
  });
  $('#btnMonitor').addEventListener('click', () => {
    if (!openMonitor($('#mainCanvas'))) toast('Permite las ventanas emergentes para usar la segunda pantalla', 'warn', 5000);
  });
  $('#btnXsCsv').addEventListener('click', () => exportXSheetCSV().catch((err) => toast(err.message, 'error')));
  $('#btnXsImport').addEventListener('click', () => $('#fileXsCsv').click());
  $('#fileXsCsv').addEventListener('change', (e) => { if (e.target.files[0]) importXSheetCSV(e.target.files[0]); e.target.value = ''; });
  $('#btnXsPrint').addEventListener('click', printXSheet);
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

/** Desktop builds with FFmpeg get the professional export section instead of the browser one. */
async function detectFFmpeg() {
  const ok = !!(await exportApi?.available().catch(() => false));
  document.body.classList.toggle('has-ffmpeg', ok);
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
  detectFFmpeg();
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
  if (!opened) opened = { project: await library.createProject(newProject(t('Mi primera animación'))), report: null };
  await openProject(opened.project, opened.report);
  buildCamControls();
  updateCamUI();
  await refreshDevices();
  requestAnimationFrame(loop);

  if (window.mesoraDesktop?.app) setTimeout(checkForUpdates, 15000);

  if (!localStorage.getItem(LS_WELCOMED)) {
    localStorage.setItem(LS_WELCOMED, '1');
    showWelcome();
  } else {
    // The learning mode continues where it was left.
    const learning = Number(localStorage.getItem(LS_LEARN));
    if (localStorage.getItem(LS_LEARN) != null && learning >= 0) Object.assign(coach, { on: true, step: learning });
    coachTick(true);
  }

  if (els.camDevice.value === 'phone') usePhone({ show: false });
  else {
    try {
      const perm = await navigator.permissions?.query({ name: 'camera' });
      if (perm?.state === 'granted') startCamera();
    } catch { /* permissions API unavailable */ }
  }

  // Offline cache for the web version; the apps already ship their files.
  if ('serviceWorker' in navigator && !isApp && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();

// Exposed for debugging from the console.
window.mesora = { state, player, camera, store, audio, viewer };
