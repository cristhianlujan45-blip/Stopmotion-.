// End-to-end test of the desktop app (Electron) with production folders on disk.
// Run with: npm run build:web && npm run test:e2e   (on Linux without a display: xvfb-run -a npm run test:e2e)
// Uses Chromium's fake camera and a temporary library and profile; it never touches Documents/MESORA.
// Optional: MESORA_E2E_SHOTS=<folder> saves screenshots.
const { _electron: electron } = require('playwright-core');
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
    args: [repo, '--no-sandbox', `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', ...GPU_ARGS],
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
  await win.waitForTimeout(1500);
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
  for (let i = 0; i < 3; i++) { await win.click('#btnCapture'); await win.waitForTimeout(600); }
  await win.waitForFunction(() => window.mesora.state.project.frames.length === 3 && window.mesora.state.pendingCaptures === 0, null, { timeout: 15000 });
  await win.evaluate(() => window.mesora.state.project && document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })));
  await win.waitForTimeout(800);
  let take = listTakes().find((t) => t.prod === 'Corto E2E');
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
  await win.waitForTimeout(900);
  check(listTakes().find((t) => t.prod === 'Corto E2E').edl.frames.length === 3, '«Deshacer» del aviso devuelve el fotograma');
  const deletedId = await selectSecond();
  await win.keyboard.press('Delete');
  await win.waitForTimeout(900);
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
  await win.waitForTimeout(900);
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
  await win.waitForTimeout(1500);
  const exportsDir = path.join(libDir, 'Corto E2E', 'exports');
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
  await win.waitForTimeout(800);
  const sceneJson = () => JSON.parse(fs.readFileSync(path.join(libDir, 'Corto E2E', 'scenes', 'sc010', 'scene.json')));
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
  await win.waitForSelector('.prod-group');
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
  await win.waitForSelector('#modalProjects:not([hidden]) .take-row');
  const group = win.locator('.prod-group.current');
  // The list is refreshed from the disk after the window opens.
  await win.waitForFunction(() => document.querySelectorAll('.prod-group.current .take-row').length === 2, null, { timeout: 5000 }).catch(() => {});
  check(await group.locator('.take-row').count() === 2, 'el proyecto muestra sus 2 tomas');
  await group.locator('.take-row', { hasText: 'Toma 1' }).locator('[data-act="open"]').click();
  await win.waitForFunction(() => window.mesora.state.project.take?.name === 'Toma 1' && window.mesora.state.project.frames.length === 3);
  log('OK la etiqueta lleva a las tomas y se vuelve a la toma 1 con sus 3 fotogramas');

  // 11) Un proyecto de una sola toma ofrece «Eliminar proyecto»: la carpeta va a la papelera del sistema.
  await win.click('#btnProjects');
  const oldGroup = win.locator('.prod-group', { hasText: 'Proyecto antiguo' });
  await oldGroup.locator('summary').click();
  const delBtn = oldGroup.locator('.menu-list .danger');
  check(await delBtn.textContent() === 'Eliminar proyecto', 'con una sola toma, el menú dice «Eliminar proyecto»');
  win.once('dialog', (d) => d.accept());
  await delBtn.click();
  await win.waitForTimeout(1500);
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
