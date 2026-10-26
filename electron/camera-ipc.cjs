// IPC for photo cameras connected through their own tethering software:
// MESORA watches the folder where that software saves each photo and adds
// every new photo (RAW, JPEG or both) to the open take.
const { FolderWatcher } = require('./core/folderwatch.cjs');

function serveCamera({ ipcMain, dialog, library, getWindow, fromApp, log }) {
  let watcher = null;
  let watchKey = null;
  const guard = (event) => { if (!fromApp(event)) throw new Error('Origen no permitido'); };
  const send = (channel, data) => getWindow()?.webContents.send(channel, data);

  const stop = () => {
    watcher?.stop();
    watcher = null;
    watchKey = null;
  };

  ipcMain.handle('camera:chooseFolder', async (event) => {
    guard(event);
    const r = await dialog.showOpenDialog(getWindow(), {
      title: 'Carpeta donde el programa de tu cámara guarda las fotos',
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('camera:watch', async (event, key, dir) => {
    guard(event);
    stop();
    const w = new FolderWatcher(dir, {
      onCapture: async (files) => {
        const key = watchKey;
        if (!key) return;
        try {
          const r = await library.ingestFiles(key, files);
          log('info', 'Foto de la cámara', files.map((f) => f.name).join(' + '), '→', r.id);
          send('camera:photo', { key, id: r.id, display: r.display?.bytes ?? null, names: files.map((f) => f.name) });
        } catch (err) {
          log('error', 'No se pudo importar la foto', files.map((f) => f.path), err);
          send('camera:error', `No se pudo importar ${files.map((f) => f.name).join(' + ')}: ${err.message}`);
        }
      },
      onError: (err) => {
        log('error', 'Carpeta vigilada', err);
        send('camera:error', err.message);
      },
    });
    await w.start();
    watcher = w;
    watchKey = key;
    log('info', 'Vigilando la carpeta', dir);
    return true;
  });

  /** New photos go to another take (the user switched takes) while the same folder stays watched. */
  ipcMain.handle('camera:retarget', (event, key) => {
    guard(event);
    if (watcher) watchKey = key;
  });

  ipcMain.handle('camera:unwatch', (event) => {
    guard(event);
    stop();
  });

  return { stop };
}

module.exports = { serveCamera };
