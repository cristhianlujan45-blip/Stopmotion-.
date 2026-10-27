// IPC for automatic backups: the user picks a folder once; the library is then
// mirrored there every few minutes and on demand.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { mirror } = require('./core/backup.cjs');

const EVERY_MS = 10 * 60 * 1000;
const FIRST_RUN_MS = 60 * 1000;
const FOLDER_NAME = 'MESORA (copia)';

function serveBackup({ ipcMain, dialog, app, library, getWindow, fromApp, log }) {
  const configFile = path.join(app.getPath('userData'), 'backup.json');
  let config = {};
  try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { /* no backup set up yet */ }
  let running = null;

  const guard = (event) => { if (!fromApp(event)) throw new Error('Origen no permitido'); };
  const target = () => (config.folder ? path.join(config.folder, FOLDER_NAME) : null);
  const status = () => ({ folder: config.folder || null, target: target(), last: config.last || null, running: !!running });
  const save = () => fsp.writeFile(configFile, JSON.stringify(config, null, 1)).catch((err) => log('error', 'backup.json', err));
  const notify = () => getWindow()?.webContents.send('backup:status', status());

  function run() {
    if (!config.folder) return Promise.resolve(status());
    if (running) return running;
    running = (async () => {
      const started = Date.now();
      try {
        const r = await mirror(library.root, target());
        config.last = { at: Date.now(), copied: r.copied, bytes: r.bytes, files: r.files, ms: Date.now() - started };
      } catch (err) {
        config.last = { at: Date.now(), error: err.message };
        log('error', 'Copia de seguridad', err);
      }
      await save();
    })().finally(() => {
      running = null;
      notify();
    }).then(status);
    notify();
    return running;
  }

  ipcMain.handle('backup:status', (event) => { guard(event); return status(); });
  ipcMain.handle('backup:run', (event) => { guard(event); return run(); });
  ipcMain.handle('backup:choose', async (event) => {
    guard(event);
    const r = await dialog.showOpenDialog(getWindow(), {
      title: 'Elige dónde guardar la copia de seguridad (un disco externo o una carpeta en la nube)',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return status();
    const folder = path.resolve(r.filePaths[0]);
    const rel = path.relative(path.resolve(library.root), folder);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) throw new Error('Elige una carpeta fuera de la biblioteca de MESORA (mejor en otro disco)');
    config = { folder };
    await save();
    return run();
  });
  ipcMain.handle('backup:disable', async (event) => {
    guard(event);
    config = {};
    await save();
    return status();
  });

  const first = setTimeout(run, FIRST_RUN_MS);
  const timer = setInterval(run, EVERY_MS);
  return { stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { serveBackup };
