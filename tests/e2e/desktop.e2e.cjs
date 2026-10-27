// End-to-end test of the desktop app (Electron) with production folders on disk.
// Run with: npm run build:web && npm run test:e2e   (on Linux without a display: xvfb-run -a npm run test:e2e)
// Uses Chromium's fake camera and a temporary library and profile; it never touches Documents/MESORA.
// Optional: MESORA_E2E_SHOTS=<folder> saves screenshots.
const { _electron: electron, chromium } = require('playwright-core');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const repo = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mesora-e2e-'));
const libDir = path.join(work, 'Documentos-MESORA');
const profile = path.join(work, 'perfil');
const shots = process.env.MESORA_E2E_SHOTS;
const log = (...a) => console.log('·', ...a);
const check = (cond, msg) => { if (!cond) throw new Error(`FALLO: ${msg}`); log('OK', msg); };

// GPU by software on Linux and Windows, so the WebGL2 viewer is exercised even on machines without a
// graphics card. macOS runners have a virtual Metal GPU, and SwiftShader is not available there.
const GPU_ARGS = process.platform === 'darwin' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const current = {}; // the running app, for the failure report

async function launch() {
  const app = await electron.launch({
    // require('electron') returns the binary path and downloads it first if needed (Electron 45 has no postinstall).
    executablePath: require('electron'),
    // Spanish interface (the test machines are usually set to English); section 20 checks English.
    args: [repo, '--no-sandbox', '--lang=es', `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...GPU_ARGS],
    env: { ...process.env, MESORA_LIBRARY: libDir, MESORA_TEST: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  Object.assign(current, { app, win, errors });
  await win.waitForFunction(() => window.mesora?.state?.project, null, { timeout: 20000 });
  return { app, win, errors };
}

/**
 * Waits until `cond()` holds (usually something on disk written by the app), for slow
 * machines; the checks that follow stay the same. Returns false after the timeout.
 */
async function eventually(cond, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    try { if (await cond()) return true; } catch { /* not written yet */ }
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 200));
  }
}
const readJSON = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts)));

/** Width and height written in a JPEG file. */
function jpegSize(buf) {
  for (let i = 2; i + 9 < buf.length;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** A browser that plays the phone (its own fake camera): Playwright's Chromium, or Chrome where that is what is installed. */
async function launchPhone() {
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  try { return await chromium.launch({ args }); } catch { return chromium.launch({ channel: 'chrome', args }); }
}

const httpsStatus = (url) => new Promise((resolve, reject) => {
  https.get(url, { rejectUnauthorized: false }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});
const takeOf = (prod) => listTakes().find((t) => t.prod === prod);

// The projects window is refreshed from the disk after it opens.
const projectsReady = (win) => win.waitForSelector('#modalProjects:not([hidden]) #projectList[aria-busy="false"]');

const listTakes = () => {
  const out = [];
  for (const prod of fs.readdirSync(libDir)) {
    const p = path.join(libDir, prod);
    if (!fs.existsSync(path.join(p, 'production.json'))) continue;
    for (const sc of fs.readdirSync(path.join(p, 'scenes'))) {
      for (const tk of fs.readdirSync(path.join(p, 'scenes', sc, 'takes'))) {
        const dir = path.join(p, 'scenes', sc, 'takes', tk);
        out.push({ prod, sc, tk, dir, edl: JSON.parse(fs.readFileSync(path.join(dir, 'edl.json'))), files: fs.readdirSync(path.join(dir, 'capture', 'X1')) });
      }
    }
  }
  return out;
};

(async () => {
  // 1) Primer arranque: la app crea su primera producción en disco.
  let { app, win, errors } = await launch();
  check(await win.evaluate(() => !document.querySelector('#diskTools').hidden), 'los controles de producción en disco están visibles');
  check(await win.evaluate(() => window.mesora.viewer.kind) === 'gpu', 'el visor usa la GPU (WebGL2)');
  check(listTakes().length === 1, 'primer arranque: una producción con sc010/tk01 en la carpeta');

  // 2) Proyecto en el formato antiguo (IndexedDB) → se migra al reiniciar.
  await win.evaluate(async () => {
    const db = await import('./js/db.js');
    const jpeg = async (color) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 48;
      const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, 64, 48);
      return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
    };
    for (const [id, color] of [['f1', '#c33'], ['f2', '#3c3']]) {
      const b = await jpeg(color);
      await db.put('frames', { id, projectId: 'old1', full: b, preview: b, thumb: b, w: 64, h: 48, luma: 0.3 });
    }
    await db.put('blobs', { id: 'audio-old-1', projectId: 'old1', name: 'voz.wav', blob: new Blob([new Uint8Array(1000)], { type: 'audio/wav' }) });
    await db.put('projects', {
      id: 'old1', name: 'Proyecto antiguo', fps: 15, width: 64, height: 48, guides: [],
      frames: [{ key: 'k1', id: 'f1', hold: 2, note: 'hola' }, { key: 'k2', id: 'f2', hold: 1 }, { key: 'k3', id: 'f1', hold: 1 }],
      settings: {}, audio: { blobId: 'audio-old-1', name: 'voz.wav', offset: 3 }, createdAt: 1, updatedAt: 2,
    });
  });
  await app.close();
  ({ app, win, errors } = await launch());
  await eventually(() => readJSON(libDir, 'Proyecto antiguo', 'production.json').migratedFrom === 'old1');
  const migrated = listTakes().find((t) => t.prod === 'Proyecto antiguo');
  check(migrated, 'el proyecto antiguo aparece como carpeta de producción');
  check(migrated.files.length === 2, 'migración: 2 capturas originales (f1 se reutiliza dos veces en el timeline)');
  check(migrated.edl.frames.length === 3 && migrated.edl.frames[0].hold === 2 && migrated.edl.frames[0].note === 'hola', 'migración: orden, holds y notas conservados');
  check(fs.readdirSync(path.join(libDir, 'Proyecto antiguo', 'media')).some((n) => n.endsWith('voz.wav')), 'migración: el audio se copió');
  const prodJson = JSON.parse(fs.readFileSync(path.join(libDir, 'Proyecto antiguo', 'production.json')));
  check(prodJson.migratedFrom === 'old1', 'migración: marcada como completa');
  check(await win.evaluate(async () => (await (await import('./js/db.js')).get('projects', 'old1'))?.name === 'Proyecto antiguo'), 'migración: el proyecto antiguo sigue intacto en IndexedDB');
  await app.close();
  ({ app, win, errors } = await launch());
  check(listTakes().filter((t) => t.prod.startsWith('Proyecto antiguo')).length === 1, 'reiniciar no vuelve a migrar');

  // 3) Nueva producción desde la interfaz y 3 capturas con la cámara (falsa, de Chromium).
  await win.click('#btnProjects');
  await win.fill('#newProjectName', 'Corto E2E');
  await win.selectOption('#newProjectFps', '24');
  await win.click('#formNewProject button[type=submit]');
  await win.waitForFunction(() => window.mesora.state.project.name === 'Corto E2E');
  await win.keyboard.press('Escape');
  // The camera may already be on (permission granted at start); only connect it if it is not.
  await win.waitForTimeout(1500);
  if (!(await win.evaluate(() => window.mesora.camera.active))) await win.evaluate(() => document.querySelector('#btnCamToggle').click());
  await win.waitForFunction(() => window.mesora.camera.active, null, { timeout: 15000 }).catch(async (e) => {
    console.log('camInfo:', await win.evaluate(() => document.querySelector('#camInfo').textContent), errors);
    throw e;
  });
  // One photo at a time: while a photo is being taken the app ignores the button (no double shots).
  for (let i = 0; i < 3; i++) {
    await win.waitForFunction(() => !window.mesora.state.busy, null, { timeout: 15000 });
    await win.click('#btnCapture');
    await win.waitForFunction((n) => window.mesora.state.project.frames.length === n, i + 1, { timeout: 20000 }).catch(async (e) => {
      console.log('estado:', await win.evaluate(() => ({ frames: window.mesora.state.project.frames.length, pending: window.mesora.state.pendingCaptures, busy: window.mesora.state.busy, camera: window.mesora.camera.active })));
      throw e;
    });
  }
  await win.waitForFunction(() => window.mesora.state.project.frames.length === 3 && window.mesora.state.pendingCaptures === 0, null, { timeout: 15000 });
  await win.evaluate(() => window.mesora.state.project && document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })));
  await eventually(() => takeOf('Corto E2E').edl.frames.length === 3);
  let take = takeOf('Corto E2E');
  check(take && take.files.length === 3 && take.edl.frames.length === 3, 'captura: 3 originales en capture/X1 y 3 fotogramas en edl.json');
  check(take.files.every((f) => /^sc010_tk01_X1_c00000[1-3]\.jpg$/.test(f)), `nombres de archivo: ${take.files.join(', ')}`);
  check(await win.evaluate(() => document.querySelector('#takeLabel').textContent) === 'Escena 010 · Toma 1', 'la cabecera muestra escena y toma');
  if (shots) await win.screenshot({ path: path.join(shots, 'mesora-escritorio-produccion.png') });

  // 4) Borrar el fotograma 2: el aviso ofrece «Deshacer»; después se borra de verdad.
  const selectSecond = () => win.evaluate(() => {
    const st = window.mesora.state;
    st.selection = new Set([st.project.frames[1].key]);
    st.playhead = 1;
    return st.project.frames[1].id;
  });
  await selectSecond();
  await win.keyboard.press('Delete');
  const undoBtn = win.locator('.toast .toast-actions button', { hasText: 'Deshacer' });
  check(await win.locator('.toast .toast-actions button', { hasText: 'Ver papelera' }).count() === 1, 'el aviso de borrado ofrece «Deshacer» y «Ver papelera»');
  await undoBtn.click();
  await eventually(() => takeOf('Corto E2E').edl.frames.length === 3);
  check(listTakes().find((t) => t.prod === 'Corto E2E').edl.frames.length === 3, '«Deshacer» del aviso devuelve el fotograma');
  const deletedId = await selectSecond();
  await win.keyboard.press('Delete');
  await eventually(() => takeOf('Corto E2E').edl.frames.length === 2);
  take = listTakes().find((t) => t.prod === 'Corto E2E');
  check(take.edl.frames.length === 2 && take.files.length === 3, 'borrar: 2 fotogramas en el timeline, 3 originales en el disco');

  // 5) Papelera → restaurar.
  await win.click('.tab[data-tab="tools"]');
  await win.click('#btnTrash');
  await win.waitForSelector('#modalListItems [data-act="restore"]');
  const listed = await win.$$eval('#modalListItems .name', (els) => els.map((e) => e.textContent));
  check(listed.length === 1 && listed[0].includes(deletedId), `la papelera muestra ${listed}`);
  if (shots) await win.screenshot({ path: path.join(shots, 'mesora-escritorio-papelera.png') });
  await win.click('#modalListItems [data-act="restore"]');
  await win.keyboard.press('Escape');
  await eventually(() => takeOf('Corto E2E').edl.frames.length === 3);
  take = listTakes().find((t) => t.prod === 'Corto E2E');
  check(take.edl.frames.length === 3, 'restaurar: vuelve a haber 3 fotogramas');

  // 6) Historial: hay al menos la versión anterior al borrado.
  await win.click('#btnHistory');
  await win.waitForTimeout(500);
  const versions = await win.$$eval('#modalListItems .sub', (els) => els.map((e) => e.textContent));
  check(versions.some((v) => v.startsWith('3 ')), `historial con versiones: ${versions.join(' | ')}`);
  await win.keyboard.press('Escape');

  // 7) Conform.
  await win.click('#btnConform');
  const exportsDir = path.join(libDir, 'Corto E2E', 'exports');
  await eventually(() => {
    const dir = fs.readdirSync(exportsDir).find((n) => n.startsWith('conform_sc010_tk01_'));
    return dir && fs.readdirSync(path.join(exportsDir, dir)).filter((n) => !n.endsWith('.partial')).length === 3;
  });
  const conformDir = fs.readdirSync(exportsDir).find((n) => n.startsWith('conform_sc010_tk01_'));
  check(conformDir && fs.readdirSync(path.join(exportsDir, conformDir)).length === 3, 'conform: 3 imágenes numeradas en exports/');

  // 7b) Exportación profesional con FFmpeg: película MP4 y secuencia PNG, una imagen por exposición.
  await win.evaluate(() => { const st = window.mesora.state; st.project.frames[0].hold = 2; });
  await win.keyboard.press('Control+s');
  await win.click('#btnExport');
  check(await win.isVisible('#btnDxVideo') && !(await win.isVisible('#btnExportVideo')), 'la ventana Exportar muestra la exportación profesional (FFmpeg)');
  const exportsBefore = new Set(fs.readdirSync(path.join(libDir, 'Corto E2E', 'exports')));
  await win.selectOption('#dxRes', '720');
  await win.click('#btnDxVideo');
  await win.waitForSelector('.toast.ok:has-text("Película exportada")', { timeout: 60000 });
  await win.click('#btnDxImages');
  await win.waitForSelector('.toast.ok:has-text("imágenes exportadas")', { timeout: 60000 });
  await win.keyboard.press('Escape');
  const created = fs.readdirSync(path.join(libDir, 'Corto E2E', 'exports')).filter((n) => !exportsBefore.has(n));
  const mp4 = created.find((n) => n.endsWith('.mp4'));
  const seq = created.find((n) => !n.includes('.'));
  const ffmpeg = require('ffmpeg-static');
  const probe = require('node:child_process').spawnSync(ffmpeg, ['-hide_banner', '-i', path.join(libDir, 'Corto E2E', 'exports', mp4), '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const nFrames = Number([...probe.matchAll(/frame=\s*(\d+)/g)].pop()?.[1]);
  check(/Video: h264.*1280x720/.test(probe) && nFrames === 4, `MP4 H.264 1280×720 con 4 imágenes (3 fotogramas, uno con hold 2): ${nFrames}`);
  check(seq && fs.readdirSync(path.join(libDir, 'Corto E2E', 'exports', seq)).length === 4, 'secuencia PNG con 4 imágenes en su propia carpeta');

  // 7c) Cámara de fotos por su programa de tethering: la carpeta vigilada recibe RAW + JPEG y RAW solo.
  const { spawnSync } = require('node:child_process');
  const ffmpegBin = require('ffmpeg-static');
  const makeJpeg = (w, h, color) => spawnSync(ffmpegBin, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], { maxBuffer: 1 << 26 }).stdout;
  const fakeRaw = (color) => Buffer.concat([Buffer.from('II*\0'), require('node:crypto').randomBytes(4000), makeJpeg(960, 540, color), require('node:crypto').randomBytes(2000)]);
  const tether = path.join(work, 'EOS Utility');
  fs.mkdirSync(tether);
  await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, tether);
  await win.click('.tab[data-tab="camera"]');
  await win.click('#btnTether');
  await win.waitForSelector('#tetherInfo:has-text("Esperando fotos")');
  const before = await win.evaluate(() => window.mesora.state.project.frames.length);
  fs.writeFileSync(path.join(tether, 'IMG_0001.CR3'), fakeRaw('blue'));
  fs.writeFileSync(path.join(tether, 'IMG_0001.JPG'), makeJpeg(960, 540, 'blue'));
  await win.waitForFunction((n) => window.mesora.state.project.frames.length === n + 1, before, { timeout: 15000 });
  fs.writeFileSync(path.join(tether, 'IMG_0002.NEF'), fakeRaw('yellow'));
  await win.waitForFunction((n) => window.mesora.state.project.frames.length === n + 2, before, { timeout: 15000 });
  await win.waitForFunction(() => window.mesora.state.pendingCaptures === 0);
  take = listTakes().find((t) => t.prod === 'Corto E2E');
  check(take.files.includes('sc010_tk01_X1_c000004.cr3') && take.files.includes('sc010_tk01_X1_c000004.jpg') && take.files.includes('sc010_tk01_X1_c000005.nef'),
    `carpeta vigilada: RAW + JPEG como una sola foto y RAW solo (${take.files.slice(-3).join(', ')})`);
  check(fs.readdirSync(tether).length === 3, 'las fotos de la carpeta de la cámara siguen ahí (se copian, no se mueven)');
  const rawShown = await win.evaluate(async () => {
    const fr = window.mesora.state.project.frames;
    const bmp = await window.mesora.store.load(fr[fr.length - 1].id);
    return bmp ? `${bmp.width}x${bmp.height}` : null;
  });
  check(rawShown === '960x540', `el RAW se ve con su JPEG incrustado (${rawShown})`);
  check(fs.existsSync(path.join(take.dir, 'proxy', 'c000005.assist.jpg')), 'se guardó el video assist de la cámara en vivo junto a la foto');
  await win.selectOption('[data-setting="display"]', 'assist');
  check(await win.evaluate(() => window.mesora.store.displayKind) === 'assist', 'el visor puede mostrar el video assist en lugar de las fotos');
  await win.selectOption('[data-setting="display"]', 'preview');
  await win.click('#btnTetherStop');

  // RAW importado arrastrándolo (aquí, con el selector de archivos).
  const rawFile = path.join(work, 'DSC_0009.ARW');
  fs.writeFileSync(rawFile, fakeRaw('green'));
  await win.setInputFiles('#fileImport', rawFile);
  await win.waitForFunction((n) => window.mesora.state.project.frames.length === n + 3, before, { timeout: 15000 });
  check(listTakes().find((t) => t.prod === 'Corto E2E').files.includes('sc010_tk01_X1_c000006.arw'), 'importar un RAW lo guarda tal cual y lo muestra');

  // Reconexión automática si se pierde la señal de la cámara.
  await win.evaluate(() => window.mesora.camera.track.dispatchEvent(new Event('ended')));
  await win.waitForSelector('.toast:has-text("Cámara reconectada")', { timeout: 20000 });
  check(await win.evaluate(() => window.mesora.camera.active), 'la cámara se reconecta sola tras perder la señal');
  // Deja la toma como estaba para las comprobaciones siguientes.
  await win.evaluate(() => { const p = window.mesora.state.project; p.frames.splice(3); });
  await win.keyboard.press('Control+s');
  await win.waitForTimeout(800);

  // 7d) Espacios de trabajo, modo estudio, X-Sheet, atajos y segunda pantalla.
  check(!(await win.isVisible('.tab[data-tab="xsheet"]')), 'en modo sencillo no aparece el X-Sheet');
  await win.click('[data-uimode="studio"]');
  await win.click('.tab[data-tab="xsheet"]');
  check(await win.evaluate(() => document.body.classList.contains('ws-xsheet')), 'modo estudio: espacio de trabajo X-Sheet');
  await win.fill('.xs-row[data-exposure="2"] input[data-key="dialog"]', 'Hola');
  await win.fill('.xs-row[data-exposure="2"] input[data-key="phoneme"]', 'O');
  await win.click('#viewerArea');
  await win.keyboard.press('Control+s');
  const sceneJson = () => JSON.parse(fs.readFileSync(path.join(libDir, 'Corto E2E', 'scenes', 'sc010', 'scene.json')));
  await eventually(() => sceneJson().settings.xsheet.plan['2'].dialog === 'Hola');
  check(sceneJson().settings.xsheet.plan['2'].dialog === 'Hola', 'el plan del X-Sheet se guarda en la escena');
  // Duplicating frame 1 shifts the pictures, not the dialogue: it stays at exposure 2.
  await win.evaluate(() => { const st = window.mesora.state; st.selection = new Set([st.project.frames[0].key]); st.playhead = 0; });
  await win.keyboard.press('Control+d');
  await win.waitForTimeout(300);
  check(await win.inputValue('.xs-row[data-exposure="2"] input[data-key="dialog"]') === 'Hola', 'el diálogo sigue en su exposición aunque cambien los fotogramas');
  await win.keyboard.press('Control+z');
  await win.click('#btnXsCsv');
  await win.waitForSelector('.toast.ok:has-text("X-Sheet exportado")');
  const csvName = fs.readdirSync(path.join(libDir, 'Corto E2E', 'exports')).find((n) => n.endsWith('_xsheet.csv'));
  check(csvName && fs.readFileSync(path.join(libDir, 'Corto E2E', 'exports', csvName), 'utf8').includes(',Hola,O,'), 'CSV del X-Sheet en «exports» con lo planificado');

  // Custom shortcut: onion skin on K.
  await win.keyboard.press('?');
  const onionRow = win.locator('.key-row', { hasText: 'Papel cebolla' });
  await onionRow.locator('button').click();
  await win.keyboard.press('k');
  await win.keyboard.press('Escape');
  const onionBefore = await win.evaluate(() => window.mesora.state.project.settings.onion.enabled);
  await win.keyboard.press('k');
  check(await win.evaluate(() => window.mesora.state.project.settings.onion.enabled) === !onionBefore, 'un atajo personalizado (K = papel cebolla) funciona');
  await win.keyboard.press('k');
  await win.keyboard.press('?');
  await win.click('#btnResetKeys');
  await win.keyboard.press('Escape');

  // Ctrl+3 (studio): captures one frame held for 3 exposures.
  const nBefore = await win.evaluate(() => window.mesora.state.project.frames.length);
  await win.keyboard.press('Control+3');
  await win.waitForFunction((n) => window.mesora.state.project.frames.length === n + 1 && window.mesora.state.pendingCaptures === 0, nBefore, { timeout: 15000 });
  check(await win.evaluate(() => window.mesora.state.project.frames.at(-1).hold) === 3, 'Ctrl+3 captura un fotograma que dura 3 cuadros');
  await win.keyboard.press('Control+z');

  // Second screen.
  const [monitor] = await Promise.all([app.waitForEvent('window'), win.click('#btnMonitor')]);
  await monitor.waitForFunction(() => document.getElementById('monitor')?.srcObject?.getVideoTracks().length === 1, null, { timeout: 10000 });
  log('OK la segunda pantalla recibe la imagen del visor');
  await monitor.close();
  await win.click('[data-uimode="simple"]');
  check(!(await win.evaluate(() => document.body.classList.contains('ws-xsheet'))), 'al volver al modo sencillo se sale del X-Sheet');

  // 8) Proyectos agrupados: un grupo por proyecto y una fila por toma.
  await win.click('#btnProjects');
  await projectsReady(win);
  const groups = await win.$$eval('.prod-group .prod-title .name', (els) => els.map((e) => e.textContent));
  check(groups.includes('Corto E2E') && groups.includes('Proyecto antiguo'), `la ventana de proyectos agrupa por proyecto: ${groups.join(', ')}`);
  const currentRow = win.locator('.take-row.current');
  check(await currentRow.locator('.name').textContent() === 'Escena 010 · Toma 1', 'la toma abierta aparece marcada');
  check(await currentRow.locator('[data-act="open"]').isDisabled(), 'su botón dice «Abierta» y no se puede pulsar');
  if (shots) await win.screenshot({ path: path.join(shots, 'mesora-escritorio-proyectos.png') });

  // 9) «⋯» → Nueva toma: se abre la toma 2 vacía con los mismos ajustes de escena.
  await currentRow.locator('summary').click();
  await currentRow.locator('[data-act="newtake"]').click();
  await win.waitForFunction(() => window.mesora.state.project.take?.name === 'Toma 2');
  check(await win.evaluate(() => document.querySelector('#takeLabel').textContent) === 'Escena 010 · Toma 2' && await win.evaluate(() => window.mesora.state.project.frames.length) === 0, 'nueva toma desde el menú: «Escena 010 · Toma 2», vacía');
  check(await win.evaluate(() => window.mesora.state.project.fps) === 24, 'la toma nueva conserva los 24 fps de la escena');

  // 10) La etiqueta de toma abre la lista y permite volver a la toma 1.
  await win.click('#takeLabel');
  await projectsReady(win);
  const group = win.locator('.prod-group.current');
  check(await group.locator('.take-row').count() === 2, 'el proyecto muestra sus 2 tomas');
  await group.locator('.take-row', { hasText: 'Toma 1' }).locator('[data-act="open"]').click();
  await win.waitForFunction(() => window.mesora.state.project.take?.name === 'Toma 1' && window.mesora.state.project.frames.length === 3);
  log('OK la etiqueta lleva a las tomas y se vuelve a la toma 1 con sus 3 fotogramas');

  // 11) Un proyecto de una sola toma ofrece «Eliminar proyecto»: la carpeta va a la papelera del sistema.
  await win.click('#btnProjects');
  await projectsReady(win);
  const oldGroup = win.locator('.prod-group', { hasText: 'Proyecto antiguo' });
  await oldGroup.locator('summary').click();
  const delBtn = oldGroup.locator('.menu-list .danger');
  check(await delBtn.textContent() === 'Eliminar proyecto', 'con una sola toma, el menú dice «Eliminar proyecto»');
  win.once('dialog', (d) => d.accept());
  await delBtn.click();
  // Moving a folder to the system trash can take a while (Windows): wait for the app's notice.
  await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.classList.contains('error') || t.textContent.includes('se movió a la papelera del sistema')), null, { timeout: 30000 });
  const trashErr = await win.$$eval('.toast.error', (els) => els.map((e) => e.textContent));
  if (trashErr.length) log(`AVISO: la papelera del sistema no está disponible en este entorno: ${trashErr.join(' | ')}`);
  else check(!fs.existsSync(path.join(libDir, 'Proyecto antiguo')), '«Eliminar proyecto» manda la carpeta a la papelera del sistema');
  await win.keyboard.press('Escape');

  // 12) Cerrar y reabrir: la toma vuelve tal cual.
  await app.close();
  ({ app, win, errors } = await launch());
  const reopened = await win.evaluate(() => ({ name: window.mesora.state.project.name, n: window.mesora.state.project.frames.length }));
  check(reopened.name === 'Corto E2E' && reopened.n === 3, 'reabrir: se abre la última toma con sus 3 fotogramas');
  const shown = await win.evaluate(async () => !!(await window.mesora.store.load(window.mesora.state.project.frames[0].id)));
  check(shown, 'reabrir: la vista previa del primer fotograma se carga desde el disco');

  // 13) Asistente de rodaje: «Revisar toda la toma» encuentra la cámara movida, el cambio de luz y el doble disparo.
  await win.click('#btnProjects');
  await win.fill('#newProjectName', 'Asistente E2E');
  await win.click('#formNewProject button[type=submit]');
  await win.waitForFunction(() => window.mesora.state.project.name === 'Asistente E2E');
  await win.keyboard.press('Escape');
  const pngs = await win.evaluate(async () => {
    const W = 640, H = 360;
    const draw = ({ dx = 0, puppet = 280, gain = 1 }) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      let seed = 11;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      x.fillStyle = '#5a5a5a'; x.fillRect(0, 0, W, H);
      for (let i = 0; i < 90; i++) {
        const v = Math.round(40 + rnd() * 160);
        x.fillStyle = `rgb(${v},${v},${v})`;
        x.beginPath(); x.arc(rnd() * W + dx, rnd() * H, 8 + rnd() * 18, 0, Math.PI * 2); x.fill();
      }
      x.fillStyle = '#e6e6e6'; x.fillRect(puppet + dx, 140, 60, 100);
      if (gain !== 1) {
        const d = x.getImageData(0, 0, W, H);
        for (let i = 0; i < d.data.length; i += 4) for (let k = 0; k < 3; k++) d.data[i + k] = Math.min(255, d.data[i + k] * gain);
        x.putImageData(d, 0, 0);
      }
      return c.toDataURL('image/png').split(',')[1];
    };
    return [draw({}), draw({ puppet: 292 }), draw({ dx: 8, puppet: 304 }), draw({ dx: 8, puppet: 316, gain: 1.15 }), draw({ dx: 8, puppet: 316, gain: 1.15 })];
  });
  await win.setInputFiles('#fileImport', pngs.map((b, i) => ({ name: `asist_${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(b, 'base64') })));
  await win.waitForFunction(() => window.mesora.state.project.frames.length === 5, null, { timeout: 20000 });
  await win.click('.tab[data-tab="camera"]');
  await win.click('#btnReviewTake');
  await win.waitForSelector('#modalList:not([hidden])', { timeout: 20000 });
  const review = await win.$$eval('#modalListItems li', (els) => els.map((li) => `${li.querySelector('.name').textContent}: ${li.querySelector('.sub').textContent}`));
  log('revisión:', review.join(' | '));
  check(review.length === 3, 'la revisión marca 3 fotogramas (de 5)');
  check(/Fotograma 3: La cámara se movió/.test(review[0]), 'fotograma 3: la cámara se movió');
  check(/Fotograma 4: La luz cambió \+1[45] %/.test(review[1]), 'fotograma 4: la luz cambió ≈ +15 %');
  check(/Fotograma 5: No se ve ningún cambio/.test(review[2]), 'fotograma 5: doble disparo');
  await win.locator('#modalListItems li').nth(0).locator('[data-act="show"]').click();
  check(await win.evaluate(() => window.mesora.state.playhead === 2 && window.mesora.state.project.settings.mode === 'difference'), '«Ver» lleva al fotograma 3 en modo diferencia');
  check(listTakes().find((t) => t.prod === 'Asistente E2E').files.length === 5, 'la revisión no cambia ni borra fotos');

  // 14) Audio multipista y lip sync.
  // Voz: 0,25 s de silencio, 0,5 s de tono fuerte, silencio hasta 1 s. Música: 1 s de tono suave.
  const wavFile = (fn, seconds, sr = 24000) => {
    const n = Math.round(seconds * sr);
    const b = Buffer.alloc(44 + n * 2);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28);
    b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(fn(i / sr) * 32767), 44 + i * 2);
    return b;
  };
  const voice = wavFile((t) => (t >= 0.25 && t < 0.75 ? 0.8 * Math.sin(2 * Math.PI * 200 * t) : 0), 1);
  const music = wavFile((t) => 0.3 * Math.sin(2 * Math.PI * 440 * t), 1);
  await win.click('.tab[data-tab="audio"]');
  await win.setInputFiles('#fileAudio', [
    { name: 'voz.wav', mimeType: 'audio/wav', buffer: voice },
    { name: 'musica.wav', mimeType: 'audio/wav', buffer: music },
  ]);
  await win.waitForFunction(() => window.mesora.state.project.tracks.length === 2 && document.querySelectorAll('#trackList .track').length === 2);
  check(await win.evaluate(() => window.mesora.state.project.tracks.map((t) => t.name).join()) === 'voz,musica', 'dos pistas de audio: voz y música');
  await win.fill('#trackList .track:nth-child(2) [data-act="offset"]', '4');
  await win.press('#trackList .track:nth-child(2) [data-act="offset"]', 'Tab');
  await win.click('#trackList .track:nth-child(1) [data-act="mute"]');
  const trackState = await win.evaluate(() => window.mesora.state.project.tracks.map((t) => ({ offset: t.offset, muted: t.muted })));
  check(trackState[0].muted && !trackState[1].muted && trackState[1].offset === 4, 'la voz silenciada y la música empieza en la exposición 4');
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })));
  await eventually(() => readJSON(takeOf('Asistente E2E').dir, '..', '..', 'scene.json').tracks?.[1]?.offset === 4);
  const asistTake = listTakes().find((t) => t.prod === 'Asistente E2E');
  const asistScene = JSON.parse(fs.readFileSync(path.join(asistTake.dir, '..', '..', 'scene.json')));
  check(asistScene.tracks?.length === 2 && asistScene.tracks[1].offset === 4, 'las pistas se guardan en scene.json');

  // WAV: mezcla de lo que suena (solo la música, desde la exposición 4) en el tramo de los 5 fotogramas.
  await win.click('#btnExport');
  await win.click('#btnExportWav');
  await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.startsWith('Sonido exportado')), null, { timeout: 15000 });
  const asistExports = path.join(libDir, 'Asistente E2E', 'exports');
  const wavName = fs.readdirSync(asistExports).find((n) => n.endsWith('.wav'));
  const mixWav = fs.readFileSync(path.join(asistExports, wavName));
  const takeFps = await win.evaluate(() => window.mesora.state.project.fps);
  const mixSamples = (mixWav.length - 44) / 4;
  check(Math.abs(mixSamples - Math.round((5 / takeFps) * 48000)) <= 1, `WAV estéreo de ${(5 / takeFps).toFixed(3)} s (5 exposiciones a ${takeFps} fps)`);
  const sampleAt = (i) => mixWav.readInt16LE(44 + i * 4);
  const startMusic = Math.round((4 / takeFps) * 48000);
  let silent = true, loud = 0;
  for (let i = 0; i < startMusic - 50; i++) if (sampleAt(i) !== 0) { silent = false; break; }
  for (let i = startMusic + 50; i < mixSamples; i++) loud = Math.max(loud, Math.abs(sampleAt(i)));
  check(silent && loud > 5000, `la voz silenciada no suena y la música entra en la exposición 4 (pico ${loud})`);

  // Película con sonido (FFmpeg): lleva pista AAC.
  await win.selectOption('#dxFormat', 'mp4');
  await win.click('#btnDxVideo');
  await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.startsWith('Película exportada')), null, { timeout: 30000 });
  const filmName = fs.readdirSync(asistExports).find((n) => n.endsWith('.mp4'));
  const probeOut = require('node:child_process').spawnSync(require('ffmpeg-static'), ['-hide_banner', '-i', path.join(asistExports, filmName)], { encoding: 'utf8' }).stderr;
  check(/Audio: aac/.test(probeOut), 'la película lleva el sonido mezclado (AAC)');
  await win.keyboard.press('Escape');

  // Lip sync: personaje con boca «A», borrador de fonemas desde la voz y la boca en el visor.
  await win.click('[data-uimode="studio"]');
  await win.click('.tab[data-tab="audio"]');
  await win.click('#btnLipAddChar');
  await win.fill('#askInput', 'Ana');
  await win.press('#askInput', 'Enter');
  await win.waitForSelector('#mouthGrid .mouth[data-mouth="A"]');
  const [chooser] = await Promise.all([win.waitForEvent('filechooser'), win.click('#mouthGrid .mouth[data-mouth="A"]')]);
  await chooser.setFiles({ name: 'boca-a.png', mimeType: 'image/png', buffer: Buffer.from(pngs[0], 'base64') });
  await win.waitForFunction(() => window.mesora.state.project.settings.lipsync.characters[0]?.mouths?.A);
  await win.selectOption('#lipTrack', { label: 'voz' });
  await win.click('#btnLipDraft');
  const lipPlan = await win.evaluate(() => window.mesora.state.project.settings.xsheet.plan);
  const ph = (e) => lipPlan[e]?.phoneme;
  log('fonemas:', Array.from({ length: 12 }, (_, i) => ph(i + 1) || '·').join(' '));
  check(ph(1) === '-' && ph(3) === 'MBP' && ph(4) === 'A' && ph(10) === '-', 'borrador: reposo, labios cerrados antes de hablar, boca abierta al hablar');
  await win.evaluate(() => { const st = window.mesora.state; st.playhead = st.project.frames.length; });
  await win.click('.tab[data-tab="xsheet"]');
  await win.fill('.xs-row[data-exposure="6"] input[data-key="phoneme"]', 'a');
  await win.waitForFunction(() => !document.querySelector('#hudMouth').hidden && document.querySelector('#hudMouth b').textContent === 'Boca: A · I');
  check(await win.evaluate(() => { const img = document.querySelector('#hudMouth img'); return !img.hidden && img.src.startsWith('blob:'); }), 'en vivo, el visor muestra la boca «A» de Ana para la exposición 6');
  await win.click('[data-uimode="simple"]');
  // 15) Móvil como mando / API local (solo la cámara falsa de Chromium).
  {
    await win.click('.tab[data-tab="tools"]');
    await win.evaluate(() => { document.querySelector('[data-sec="movil-como-mando"]').open = true; });
    await win.click('#btnRemote');
    await win.waitForSelector('#remoteBox:not([hidden])');
    check((await win.getAttribute('#remoteQr', 'src')).startsWith('data:image/svg+xml;base64,'), 'al activar el mando aparece su código QR');
    const remoteUrl = new URL(await win.textContent('#remoteUrl'));
    const api = `http://127.0.0.1:${remoteUrl.port}`;
    const rh = { 'X-Mesora-Token': remoteUrl.searchParams.get('t') };
    check((await fetch(`${api}/api/state`)).status === 403, 'la API local rechaza peticiones sin el código');
    const page = await (await fetch(`${api}/?t=${rh['X-Mesora-Token']}`)).text();
    check(page.includes('CAPTURAR'), 'la página del mando se abre con el código del QR');
    if (!(await win.evaluate(() => window.mesora.camera.active))) await win.evaluate(() => document.querySelector('#btnCamToggle').click());
    await win.waitForFunction(() => window.mesora.camera.active, null, { timeout: 15000 });
    const before = await win.evaluate(() => window.mesora.state.project.frames.length);
    await win.waitForTimeout(800);
    const st = await (await fetch(`${api}/api/state`, { headers: rh })).json();
    check(st.frames === before && st.project === 'Asistente E2E', `la API local da el estado: ${JSON.stringify(st)}`);
    const shot = await fetch(`${api}/api/action`, { method: 'POST', headers: rh, body: JSON.stringify({ action: 'capture' }) });
    check(shot.status === 200, 'el móvil pide una captura');
    await win.waitForFunction((n) => window.mesora.state.project.frames.length === n + 1 && window.mesora.state.pendingCaptures === 0, before, { timeout: 15000 });
    log('OK la captura pedida desde el móvil entra en el timeline');
    await fetch(`${api}/api/action`, { method: 'POST', headers: rh, body: JSON.stringify({ action: 'prev' }) });
    await win.waitForFunction((n) => window.mesora.state.playhead === n, before, { timeout: 5000 });
    log('OK «anterior» desde el móvil mueve el cabezal');
    check((await fetch(`${api}/api/action`, { method: 'POST', headers: rh, body: JSON.stringify({ action: 'delete' }) })).status === 400, 'borrar no se puede pedir desde el móvil');
    let preview = null;
    for (let i = 0; i < 20 && !preview; i++) {
      const r = await fetch(`${api}/api/preview.jpg`, { headers: rh });
      if (r.status === 200) preview = Buffer.from(await r.arrayBuffer());
      else await win.waitForTimeout(300);
    }
    check(preview && preview[0] === 0xff && preview[1] === 0xd8, `el móvil recibe la vista previa del visor (${preview?.length} bytes)`);
    // The app updates this once a second from the phone's last request (a slow photo can leave a gap of a few seconds).
    check(await win.waitForFunction(() => document.querySelector('#remoteState').textContent === 'Móvil conectado.', null, { timeout: 5000 }).then(() => true, () => false),
      'la app indica que hay un móvil conectado');
    await win.click('#btnRemote');
    await win.waitForSelector('#remoteBox[hidden]', { state: 'attached' });
    check(await fetch(`${api}/api/state`, { headers: rh }).then(() => false, () => true), 'al desactivarlo, el mando deja de responder');
  }

  // 16) Copia de seguridad automática en otra carpeta (el diálogo se sustituye en la prueba).
  {
    const backupDir = path.join(work, 'Disco externo');
    fs.mkdirSync(backupDir);
    await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }); }, backupDir);
    await win.click('.tab[data-tab="tools"]');
    await win.click('#btnBackupChoose');
    await win.waitForFunction(() => /última:/.test(document.querySelector('#backupInfo').textContent), null, { timeout: 30000 });
    const copy = path.join(backupDir, 'MESORA (copia)');
    const take = listTakes().find((t) => t.prod === 'Asistente E2E');
    const rel = path.relative(libDir, take.dir);
    check(fs.readdirSync(path.join(copy, rel, 'capture', 'X1')).length === take.files.length, `la copia tiene las ${take.files.length} fotos de la toma`);
    check(fs.existsSync(path.join(copy, rel, 'edl.json')) && fs.existsSync(path.join(copy, 'LEEME.txt')), 'la copia tiene el timeline y un LEEME');
    check(!fs.existsSync(path.join(copy, 'Asistente E2E', 'exports')), 'las películas exportadas no se copian');
    await win.click('#btnBackupNow');
    await win.waitForFunction(() => / 0 de \d+ archivos/.test(document.querySelector('#backupInfo').textContent), null, { timeout: 30000 });
    log('OK «Copiar ahora» sin cambios no vuelve a copiar nada');
    await win.click('#btnBackupOff');
    await win.waitForFunction(() => document.querySelector('#btnBackupNow').hidden);
    check(fs.existsSync(path.join(copy, rel, 'edl.json')), 'desactivar no borra la copia');
  }

  // 17) Paquete de revisión: HTML para otra persona; sus notas vuelven a los fotogramas.
  {
    await win.click('#btnExport');
    await win.click('#btnExportReview');
    await win.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.startsWith('Paquete de revisión listo')), null, { timeout: 30000 });
    await win.keyboard.press('Escape');
    const exp = path.join(libDir, 'Asistente E2E', 'exports');
    const html = path.join(exp, fs.readdirSync(exp).find((n) => n.endsWith('_revision.html')));
    log(`paquete de revisión: ${(fs.statSync(html).size / 1024).toFixed(0)} KB`);
    const [rev] = await Promise.all([
      app.waitForEvent('window'),
      app.evaluate(({ BrowserWindow }, file) => { new BrowserWindow({ width: 1100, height: 760, show: true }).loadFile(file); }, html),
    ]);
    await rev.waitForSelector('#strip img');
    const nFrames = await win.evaluate(() => window.mesora.state.project.frames.length);
    check(await rev.$$eval('#strip img', (els) => els.length) === nFrames, `el paquete muestra los ${nFrames} fotogramas`);
    check(await rev.evaluate(() => !!document.querySelector('#snd').src), 'el paquete lleva el sonido');
    await rev.click('#strip img:nth-child(2)');
    await rev.fill('#note', 'el brazo salta');
    await rev.click('#strip img:nth-child(4)');
    await rev.fill('#note', 'más luz aquí');
    await rev.fill('#reviewer', 'Dirección');
    await rev.fill('#general', 'Buen ritmo');
    await rev.evaluate(() => {
      const make = URL.createObjectURL;
      URL.createObjectURL = (blob) => { window.notesBlob = blob; return make(blob); };
      HTMLAnchorElement.prototype.click = () => {};
    });
    await rev.click('#save');
    const notesJson = await rev.evaluate(() => window.notesBlob.text());
    await rev.close();
    await win.setInputFiles('#fileImport', { name: 'notas-revision.json', mimeType: 'application/json', buffer: Buffer.from(notesJson) });
    await win.waitForSelector('#modalList:not([hidden]) #modalListItems li');
    const notes = await win.evaluate(() => window.mesora.state.project.frames.map((f) => f.note || ''));
    check(notes[1] === 'Dirección: el brazo salta' && notes[3] === 'Dirección: más luz aquí', `las notas de revisión vuelven a sus fotogramas: ${notes[1]} | ${notes[3]}`);
    check((await win.textContent('#modalListHint')).includes('Buen ritmo'), 'se muestra el comentario general');
    await win.keyboard.press('Escape');
    await win.keyboard.press('Control+z');
    await win.waitForFunction(() => !window.mesora.state.project.frames[1].note);
    log('OK las notas importadas se pueden deshacer');
  }

  // 18) Modo aprendizaje: avanza al hacer cada cosa.
  {
    await win.click('#btnHelp');
    await win.click('#btnLearn');
    await win.waitForSelector('#coach:not([hidden])');
    const title = () => win.textContent('#coachTitle');
    check(await title() === 'Fíjate en el papel cebolla', 'con cámara y fotos hechas, el tutorial salta a lo que falta');
    await win.click('#btnCoachNext');
    await win.waitForFunction(() => document.querySelector('#coachTitle').textContent === 'Mira tu animación');
    check(await win.evaluate(() => document.querySelector('#tPlay').classList.contains('coach-target')), 'el tutorial señala el botón de reproducir');
    await win.click('#tPlay');
    await win.waitForFunction(() => document.querySelector('#coachTitle').textContent === '¿Va muy rápido o muy lento?', null, { timeout: 5000 });
    log('OK al reproducir, el tutorial pasa al siguiente paso');
    await win.keyboard.press('Escape');
    await win.click('#btnCoachNext');
    await win.click('#btnExport');
    await win.waitForFunction(() => document.querySelector('#coachStep').textContent === '¡Hecho!', null, { timeout: 5000 });
    await win.keyboard.press('Escape');
    await win.click('#btnCoachNext');
    check(await win.evaluate(() => document.querySelector('#coach').hidden && !document.querySelector('.coach-target')), 'al terminar, el tutorial se cierra');
  }

  // 19) Luz DMX y motion control, solo con simuladores (y Art-Net a un socket de este mismo ordenador).
  {
    const dgram = require('node:dgram');
    const { parseArtnet } = await import('../../js/dmx.js');
    const setVal = (sel, v) => win.evaluate(([q, val]) => { const el = document.querySelector(q); el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, String(v)]);
    await win.click('[data-uimode="studio"]');
    await win.click('.tab[data-tab="light"]');
    await win.selectOption('select[data-setting="lighting.output"]', 'sim');
    await win.click('#btnAddLight');
    await win.click('#btnAddLight');
    await setVal('#lightList li:nth-child(2) [data-f="channel"]', 5);
    await win.click('#btnAddLook'); await win.fill('#askInput', 'Día'); await win.press('#askInput', 'Enter');
    await win.waitForSelector('#lookSliders .look-row');
    await win.click('#btnAddLightKey');
    await setVal('#lightKeys li [data-f="exposure"]', 1);
    await win.click('#btnAddLook'); await win.fill('#askInput', 'Noche'); await win.press('#askInput', 'Enter');
    await win.waitForFunction(() => document.querySelector('#lookSelect').selectedOptions[0]?.textContent === 'Noche');
    await setVal('#lookSliders .look-row:nth-child(1) input', 10);
    await setVal('#lookSliders .look-row:nth-child(2) input', 0);
    await win.click('#btnAddLightKey');
    const L = await win.evaluate(() => window.mesora.state.project.settings.lighting);
    const next = await win.evaluate(() => window.mesora.state.project.frames.reduce((n, f) => n + f.hold, 0) + 1);
    check(L.lights.length === 2 && L.looks.length === 2 && L.keys.length === 2 && L.keys.some((k) => k.exposure === next), `programa de luz: Día desde la 1, Noche desde la ${next}`);

    // Art-Net real hacia 127.0.0.1:6454 (el puerto oficial), recibido por la prueba.
    const sock = dgram.createSocket('udp4');
    const packet = new Promise((resolve) => sock.on('message', (m) => resolve(parseArtnet(m))));
    await new Promise((r) => sock.bind(6454, '127.0.0.1', r));
    await win.selectOption('select[data-setting="lighting.output"]', 'artnet');
    await win.fill('input[data-setting="lighting.artnetHost"]', '127.0.0.1');
    await win.press('input[data-setting="lighting.artnetHost"]', 'Tab');
    const before = await win.evaluate(() => window.mesora.state.project.frames.length);
    await win.click('#btnCapture');
    await win.waitForFunction((n) => window.mesora.state.project.frames.length === n + 1 && window.mesora.state.pendingCaptures === 0, before, { timeout: 15000 });
    const art = await Promise.race([packet, new Promise((r) => setTimeout(() => r(null), 5000))]);
    sock.close();
    check(art && art.data[0] === 26 && art.data[4] === 0, `antes de la foto se envió el look «Noche» por Art-Net (canal 1 = ${art?.data[0]}, canal 5 = ${art?.data[4]})`);
    check((await win.textContent('#lightView')).includes('10 %'), 'la vista de luces muestra el nivel enviado');
    await win.selectOption('select[data-setting="lighting.output"]', 'none');

    // Motion control con el simulador: claves, curva y espera antes de disparar.
    await win.click('.tab[data-tab="motion"]');
    await win.selectOption('select[data-setting="moco.output"]', 'sim');
    await win.click('#btnAddAxis');
    await win.click('#btnMocoConnect');
    await win.waitForFunction(() => /Simulador conectado/.test(document.querySelector('#mocoStatus').textContent));
    const shoot = await win.evaluate(() => window.mesora.state.project.frames.reduce((n, f) => n + f.hold, 0) + 1);
    await win.click('#btnAddAxisKey');
    await setVal('#axisKeys li [data-f="exposure"]', shoot - 4);
    await setVal('#axisList li [data-go]', 40);
    await win.click('#axisList li [data-act="go"]');
    await win.waitForFunction(() => /40\.0 mm/.test(document.querySelector('#axisView').textContent), null, { timeout: 10000 });
    log('OK «Ir a 40» mueve el eje del simulador');
    await win.click('#btnAddAxisKey');
    await setVal(`#axisKeys li:nth-child(2) [data-f="exposure"]`, shoot + 2);
    const n0 = await win.evaluate(() => window.mesora.state.project.frames.length);
    const sawMoving = win.waitForFunction(() => /Moviendo/.test(document.querySelector('#hudFlags').textContent), null, { timeout: 10000 }).then(() => true, () => false);
    await win.click('#btnCapture');
    check(await sawMoving, 'antes de la foto el visor indica «Moviendo…»');
    await win.waitForFunction((n) => window.mesora.state.project.frames.length === n + 1 && window.mesora.state.pendingCaptures === 0, n0, { timeout: 15000 });
    const axisText = await win.textContent('#axisView');
    check(axisText.includes('31.1 mm'), `la foto se hizo con el carro en su posición calculada (acelerar y frenar): ${axisText.trim()}`);
    await win.selectOption('select[data-setting="moco.output"]', 'none');
    await win.click('[data-uimode="simple"]');
  }

  // 20) Interfaz en inglés: se elige en Ayuda y la app se recarga en ese idioma.
  {
    await win.click('#btnHelp');
    await Promise.all([win.waitForEvent('load'), win.selectOption('#modalHelp .lang-select', 'en')]);
    await win.waitForFunction(() => window.mesora?.state?.project, null, { timeout: 20000 });
    await win.waitForTimeout(800);
    const en = await win.evaluate(() => ({
      lang: document.documentElement.lang,
      capture: document.querySelector('#btnCapture').textContent.trim(),
      projects: document.querySelector('#btnProjects').textContent.trim(),
      hud: document.querySelector('#hudMode').textContent.trim(),
      frame: document.querySelector('#hudFrame').textContent.trim(),
      tab: document.querySelector('.tab[data-tab="camera"]').textContent.trim(),
      tip: document.querySelector('#tPlay').title,
      take: document.querySelector('#takeLabel').textContent.trim(),
    }));
    log('inglés:', JSON.stringify(en));
    check(en.lang === 'en' && en.capture === 'Capture' && en.projects === 'Projects' && en.tab === 'Camera' && en.tip === 'Play (0 / Space)', 'botones, pestañas y ayudas en inglés');
    check(/^(LIVE|REVIEW)$/.test(en.hud) && /^(Next: frame \d+|Frame \d+ \/ \d+)$/.test(en.frame), 'el visor también: estado y fotograma');
    check(/^Scene \d+ · Take \d+$/.test(en.take), 'los nombres de escena y toma se muestran en inglés');
    await win.click('#btnExport');
    check(await win.textContent('#btnDxVideo') === 'Export film', 'la ventana de exportar en inglés');
    await win.keyboard.press('Escape');
    await win.click('#btnHelp');
    await Promise.all([win.waitForEvent('load'), win.selectOption('#modalHelp .lang-select', 'es')]);
    await win.waitForFunction(() => window.mesora?.state?.project, null, { timeout: 20000 });
    check(await win.evaluate(() => document.querySelector('#btnCapture').textContent.trim()) === 'Capturar', 'y se vuelve al español');
  }

  // 21) Móvil como cámara por wifi: otro navegador hace de móvil (con su cámara falsa) y se conecta por WebRTC.
  {
    await win.click('#btnProjects');
    await win.fill('#newProjectName', 'Móvil E2E');
    await win.click('#formNewProject button[type=submit]');
    await win.waitForFunction(() => window.mesora.state.project.name === 'Móvil E2E');
    await win.keyboard.press('Escape');
    await win.click('.tab[data-tab="camera"]');
    await win.selectOption('#camRes', '1920x1080');
    await win.selectOption('#camDevice', 'phone');
    await win.waitForSelector('#phoneBox:not([hidden]) #phoneUrl:not(:empty)');
    check((await win.getAttribute('#phoneQr', 'src')).startsWith('data:image/svg+xml;base64,'), 'al elegir «Móvil por wifi» aparece el QR');
    const camUrl = new URL(await win.textContent('#phoneUrl'));
    check(camUrl.protocol === 'https:' && camUrl.pathname === '/camera', `el enlace es https (los móviles solo dan la cámara a páginas seguras): ${camUrl.origin}`);
    camUrl.hostname = '127.0.0.1'; // the "phone" is on this computer
    check(await httpsStatus(`${camUrl.origin}/api/camera/status`) === 403, 'sin el código del QR no se puede usar');
    const browser = await launchPhone();
    // If the "phone" does not connect, say why: what the phone page shows, what the app shows and the phone's console.
    const phoneLog = [];
    const phoneConnected = async (page, what) => {
      const t0 = Date.now();
      try {
        await win.waitForFunction(() => window.mesora.camera.remote && window.mesora.camera.active, null, { timeout: 45000 });
      } catch (err) {
        const status = await page.textContent('#status').catch(() => '?');
        const app = await win.evaluate(() => ({ estado: document.querySelector('#phoneState').textContent, remote: !!window.mesora.camera.remote, video: window.mesora.camera.video.videoWidth })).catch(() => ({}));
        console.error(`El móvil no se conectó (${what}). Móvil: «${status}». App: ${JSON.stringify(app)}. Consola del móvil:\n${phoneLog.slice(-25).join('\n')}`);
        throw err;
      }
      log(`${what}: conectado en ${Date.now() - t0} ms`);
    };
    try {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 412, height: 860 } });
      const phonePage = await ctx.newPage();
      phonePage.on('console', (m) => phoneLog.push(`${m.type()}: ${m.text()}`));
      await phonePage.goto(camUrl.href);
      await phoneConnected(phonePage, 'móvil');
      await phonePage.waitForFunction(() => document.getElementById('status').className === 'ok', null, { timeout: 10000 });
      log('OK el móvil se conecta: la app lo usa como cámara');
      const size = await win.evaluate(() => [window.mesora.camera.width, window.mesora.camera.height, window.mesora.state.project.width, window.mesora.state.project.height]);
      check(size[0] === 1920 && size[1] === 1080 && size[2] === 1920 && size[3] === 1080, `la cámara del móvil abre a la resolución elegida y el proyecto la toma: ${size.join(' × ')}`);
      let best = 0;
      for (let i = 0; i < 8 && best < 1920; i++) {
        await win.waitForTimeout(400);
        const st = await win.evaluate(() => window.mesora.camera.remote.stats());
        if (st) best = Math.max(best, st.width);
      }
      check(best >= 960, `la imagen en vivo llega nítida desde los primeros segundos (${best} px de ancho)`);
      const st = await win.evaluate(() => window.mesora.camera.remote.stats());
      log(`en vivo: ${st.width}×${st.height} · ${st.fps} fps · ${st.codec} · red ${st.networkMs?.toFixed(1)} ms · búfer ${st.bufferMs?.toFixed(1)} ms · decodificar ${st.decodeMs?.toFixed(1)} ms`);
      check(st.bufferMs != null && st.bufferMs < 100, `la app no acumula imágenes en espera (búfer ${st.bufferMs?.toFixed(1)} ms)`);

      // Photo: full resolution, even when the live view travels smaller.
      const n0 = await win.evaluate(() => window.mesora.state.project.frames.length);
      const t0 = Date.now();
      await win.click('#btnCapture');
      await win.waitForFunction((n) => window.mesora.state.project.frames.length === n + 1 && window.mesora.state.pendingCaptures === 0, n0, { timeout: 20000 });
      log(`foto del móvil en el timeline en ${Date.now() - t0} ms`);
      await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })));
      await eventually(() => takeOf('Móvil E2E').files.length === 1);
      const shot = takeOf('Móvil E2E');
      const dims = jpegSize(fs.readFileSync(path.join(shot.dir, 'capture', 'X1', shot.files[0])));
      check(dims?.width === 1920 && dims?.height === 1080, `la foto original tiene la resolución completa del móvil: ${dims?.width} × ${dims?.height}`);

      // PNG: the phone encodes it without loss and that file is the original (no second compression).
      await win.selectOption('select[data-setting="format"]', 'png');
      await win.waitForFunction(() => !window.mesora.state.busy);
      await win.click('#btnCapture');
      await win.waitForFunction((n) => window.mesora.state.project.frames.length === n + 2 && window.mesora.state.pendingCaptures === 0, n0, { timeout: 20000 });
      await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })));
      await eventually(() => takeOf('Móvil E2E').files.length === 2);
      const pngShot = takeOf('Móvil E2E');
      const pngName = pngShot.files.find((f) => f.endsWith('.png'));
      const png = pngName && fs.readFileSync(path.join(pngShot.dir, 'capture', 'X1', pngName));
      check(png && png.readUInt32BE(0) === 0x89504e47 && png.readUInt32BE(16) === 1920 && png.readUInt32BE(20) === 1080, `en PNG la foto del móvil llega sin pérdida y a resolución completa (${pngName})`);
      await win.selectOption('select[data-setting="format"]', 'jpeg');

      // Another size: the phone reopens its camera without reconnecting.
      await win.selectOption('#camRes', '1280x720');
      await win.waitForFunction(() => window.mesora.camera.width === 1280 && window.mesora.camera.height === 720, null, { timeout: 15000 });
      const still = await win.evaluate(async () => { const c = await window.mesora.camera.grab({ average: 2 }); return [c.width, c.height]; });
      check(still[0] === 1280 && still[1] === 720, 'al cambiar la resolución el móvil la aplica (y promedia cuadros si se pide)');
      await win.selectOption('#camRes', '1920x1080');

      await win.check('#phoneDark');
      await phonePage.waitForSelector('#black:not([hidden])', { timeout: 5000 });
      log('OK la pantalla del móvil se apaga desde la app (no ilumina la escena)');
      await win.uncheck('#phoneDark');

      // The phone goes away (closed, no wifi…): the app notices within seconds and waits for it.
      await ctx.close();
      await win.waitForFunction(() => !window.mesora.camera.remote && !window.mesora.camera.active, null, { timeout: 12000 });
      check(await win.textContent('#phoneState') === 'Esperando al móvil…', 'si el móvil se va, la app lo nota y lo espera');

      // Delay from the phone to the screen: the "phone" paints its clock as black and white squares,
      // the app reads them from each frame it shows. Both clocks are this computer's.
      const lagCtx = await browser.newContext({ ignoreHTTPSErrors: true });
      await lagCtx.addInitScript(() => {
        navigator.mediaDevices.getUserMedia = async () => {
          const c = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
          const g = c.getContext('2d');
          const paint = () => {
            const t = Date.now() & 0xffffff;
            g.fillStyle = '#808080';
            g.fillRect(0, 0, 1280, 720);
            for (let i = 0; i < 24; i++) {
              g.fillStyle = (t >> i) & 1 ? '#fff' : '#000';
              g.fillRect(40 + (i % 12) * 100, 200 + Math.floor(i / 12) * 160, 80, 80);
            }
            requestAnimationFrame(paint);
          };
          paint();
          return c.captureStream(30);
        };
      });
      const lagPage = await lagCtx.newPage();
      lagPage.on('console', (m) => phoneLog.push(`${m.type()}: ${m.text()}`));
      await lagPage.goto(camUrl.href);
      await phoneConnected(lagPage, 'móvil que mide el retardo');
      await win.waitForTimeout(1500);
      const lag = await win.evaluate(() => new Promise((resolve) => {
        const v = window.mesora.camera.video;
        const c = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
        const g = c.getContext('2d', { willReadFrequently: true });
        const out = [];
        const step = () => {
          const now = Date.now();
          g.drawImage(v, 0, 0, 1280, 720);
          const d = g.getImageData(0, 0, 1280, 720).data;
          let t = 0;
          for (let i = 0; i < 24; i++) {
            const x = 80 + (i % 12) * 100, y = 240 + Math.floor(i / 12) * 160;
            if (d[(y * 1280 + x) * 4] > 128) t |= 1 << i;
          }
          const ms = ((now & 0xffffff) - t + 0x1000000) % 0x1000000;
          if (ms < 5000) out.push(ms);
          if (out.length >= 90) {
            out.sort((a, b) => a - b);
            resolve({ n: out.length, min: out[0], median: out[out.length >> 1], p95: out[Math.floor(out.length * 0.95)] });
          } else v.requestVideoFrameCallback(step);
        };
        v.requestVideoFrameCallback(step);
      }));
      log(`retardo móvil → pantalla de la app (sin la wifi ni el sensor del móvil): mediana ${lag.median} ms, p95 ${lag.p95} ms, mínimo ${lag.min} ms (${lag.n} cuadros)`);
      check(lag.median < 300, `la imagen en vivo llega sin retraso apreciable (mediana ${lag.median} ms)`);
      await lagCtx.close();
    } finally {
      await browser.close();
    }
    // Another camera: the phone page stops being served.
    await win.selectOption('#camDevice', { index: 0 });
    await win.waitForFunction(() => window.mesora.camera.active && !window.mesora.camera.remote, null, { timeout: 15000 });
    check(await httpsStatus(`${camUrl.origin}/api/camera/status`).then(() => false, () => true), 'al elegir otra cámara, la página del móvil deja de estar disponible');
  }

  check(errors.length === 0, `sin errores en la consola${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  await app.close();
  fs.rmSync(work, { recursive: true, force: true });
  console.log('\nTODO OK');
})().catch(async (e) => {
  console.error(e);
  // What the app saw: page errors, visible notices and the end of its log file.
  const { app, win, errors } = current;
  if (errors?.length) console.error('Errores de la página:', errors.join('\n'));
  const toasts = await win?.$$eval('.toast', (els) => els.map((t) => t.textContent)).catch(() => []);
  if (toasts?.length) console.error('Avisos en pantalla:', toasts.join(' | '));
  const logFile = await app?.evaluate(({ app: a }) => require('node:path').join(a.getPath('logs'), 'mesora.log')).catch(() => null);
  if (logFile && fs.existsSync(logFile)) console.error('Final del registro:\n', fs.readFileSync(logFile, 'utf8').split('\n').slice(-40).join('\n'));
  await app?.close().catch(() => {});
  process.exit(1);
});
