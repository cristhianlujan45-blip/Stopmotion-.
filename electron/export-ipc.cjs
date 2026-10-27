// IPC for offline exports with FFmpeg. The page composes frames and streams
// them here; the files land in the project's "exports" folder unless the user
// picks another place.
const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');
const { FORMATS, buildArgs, ExportJob, bundledFFmpeg } = require('./core/ffmpeg.cjs');
const { safeName, writeAtomic } = require('./core/fsutil.cjs');

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

function serveExport({ ipcMain, dialog, shell, library, getWindow, fromApp, log }) {
  const ffmpeg = bundledFFmpeg();
  const jobs = new Map();
  const outputs = new Set(); // files and folders created by exports, which the page may reveal
  let nextId = 1;

  const guard = (event) => { if (!fromApp(event)) throw new Error('Origen no permitido'); };

  /** Asks where to save when requested; returns the chosen path, or the default one, or null if cancelled. */
  async function chooseTarget({ ask, isFolder, defaultPath, ext }) {
    if (!ask) return defaultPath;
    if (isFolder) {
      const r = await dialog.showOpenDialog(getWindow(), {
        title: 'Elige la carpeta donde crear la secuencia', defaultPath: path.dirname(defaultPath),
        properties: ['openDirectory', 'createDirectory'],
      });
      return r.canceled || !r.filePaths[0] ? null : path.join(r.filePaths[0], path.basename(defaultPath));
    }
    const r = await dialog.showSaveDialog(getWindow(), { title: 'Guardar como', defaultPath, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    return r.canceled || !r.filePath ? null : r.filePath;
  }

  ipcMain.handle('export:available', (event) => { guard(event); return !!ffmpeg; });

  ipcMain.handle('export:start', async (event, key, spec) => {
    guard(event);
    if (!ffmpeg) throw new Error('FFmpeg no está disponible en esta instalación');
    const f = FORMATS[spec.format];
    if (!f) throw new Error(`Formato desconocido: ${spec.format}`);
    const { dir, prefix } = await library.exportTarget(key);
    const base = `${safeName(spec.name, 'mesora')}_${prefix}_${stamp()}`;
    const isFolder = f.kind === 'images';
    const target = await chooseTarget({ ask: spec.ask, isFolder, defaultPath: path.join(dir, isFolder ? base : `${base}.${f.ext}`), ext: f.ext });
    if (!target) return null;
    let out = target;
    if (isFolder) {
      await fsp.mkdir(target, { recursive: false });
      out = path.join(target, `${path.basename(target)}_%05d.${f.ext}`);
    }
    const id = nextId++;
    // The sound comes already mixed (all tracks, from the first exported exposure) as WAV.
    let audio = null;
    if (spec.audioWav && f.kind === 'video') {
      audio = { file: path.join(os.tmpdir(), `mesora-mezcla-${process.pid}-${id}.wav`), startSeconds: 0 };
      await fsp.writeFile(audio.file, Buffer.from(spec.audioWav));
    }
    const args = buildArgs({ format: spec.format, width: spec.width, height: spec.height, fps: spec.fps, quality: spec.quality, out, audio });
    const removeMix = () => (audio ? fsp.rm(audio.file, { force: true }) : Promise.resolve());
    const cleanup = () => Promise.all([fsp.rm(target, { recursive: true, force: true }), removeMix()]);
    const job = new ExportJob(ffmpeg, args, { cleanup });
    jobs.set(id, { job, target, removeMix });
    log('info', 'Exportación iniciada', spec.format, target);
    return { id, target };
  });

  ipcMain.handle('export:frame', (event, id, bytes, times = 1) => {
    guard(event);
    const entry = jobs.get(id);
    if (!entry) throw new Error('Exportación no encontrada');
    return entry.job.write(bytes, times);
  });

  ipcMain.handle('export:finish', async (event, id) => {
    guard(event);
    const entry = jobs.get(id);
    if (!entry) throw new Error('Exportación no encontrada');
    jobs.delete(id);
    try {
      await entry.job.finish();
    } catch (err) {
      log('error', 'Exportación fallida', err);
      await entry.job.cleanup?.().catch(() => {});
      throw err;
    }
    await entry.removeMix();
    outputs.add(entry.target);
    return { target: entry.target };
  });

  ipcMain.handle('export:cancel', async (event, id) => {
    guard(event);
    const entry = jobs.get(id);
    jobs.delete(id);
    await entry?.job.cancel();
  });

  /** Any other file made by the editor (ZIP, PNG, CSV, .mesora…), saved next to the other exports. */
  ipcMain.handle('export:saveFile', async (event, key, spec) => {
    guard(event);
    const { dir } = await library.exportTarget(key);
    const name = safeName(spec.name, 'archivo');
    const ext = (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] || 'bin').toLowerCase();
    let target = await chooseTarget({ ask: spec.ask, isFolder: false, defaultPath: path.join(dir, name), ext });
    if (!target) return null;
    if (!spec.ask) {
      // Never overwrite an earlier export with the same name.
      const stem = target.slice(0, target.length - ext.length - 1);
      for (let i = 2; await fsp.access(target).then(() => true, () => false); i++) target = `${stem} (${i}).${ext}`;
    }
    await writeAtomic(target, Buffer.from(spec.bytes));
    outputs.add(target);
    return { target };
  });

  ipcMain.handle('export:reveal', (event, target) => {
    guard(event);
    if (!outputs.has(target)) throw new Error('Solo se pueden mostrar archivos exportados en esta sesión');
    shell.showItemInFolder(target);
  });

  return { cancelAll: () => Promise.all([...jobs.values()].map((e) => e.job.cancel())) };
}

module.exports = { serveExport };
