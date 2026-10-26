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

async function launch() {
  const app = await electron.launch({
    // require('electron') returns the binary path and downloads it first if needed (Electron 45 has no postinstall).
    executablePath: require('electron'),
    args: [repo, '--no-sandbox', `--user-data-dir=${profile}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      // GPU by software, so the WebGL2 viewer is exercised even on machines without a graphics card.
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    env: { ...process.env, MESORA_LIBRARY: libDir, MESORA_TEST: '1' },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
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
})().catch((e) => { console.error(e); process.exit(1); });
