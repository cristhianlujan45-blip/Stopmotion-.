// IPC for the phone remote / local API: the page turns it on and off, sends
// what the phone shows (state and a small preview) and receives the actions.
const qrcode = require('qrcode-generator');
const { RemoteServer } = require('./core/remote.cjs');

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

function serveRemote({ ipcMain, getWindow, fromApp, log }) {
  let state = {};
  let active = false;
  let timer = null;
  const server = new RemoteServer({
    onAction: (action) => getWindow()?.webContents.send('remote:action', action),
    getState: () => state,
    log,
  });
  const guard = (event) => { if (!fromApp(event)) throw new Error('Origen no permitido'); };
  // Tells the page whether a phone is connected, so it only prepares previews when someone looks.
  const tick = () => {
    const now = server.running && server.clientsActive;
    if (now !== active) {
      active = now;
      getWindow()?.webContents.send('remote:active', active);
    }
  };

  ipcMain.handle('remote:start', async (event) => {
    guard(event);
    const info = await server.start();
    timer ??= setInterval(tick, 1000);
    const url = info.urls[0] || info.localUrl;
    log('info', 'Mando remoto activado en el puerto', info.port);
    return { ...info, url, qr: qrSvg(url) };
  });

  ipcMain.handle('remote:stop', async (event) => {
    guard(event);
    clearInterval(timer);
    timer = null;
    await server.stop();
    tick();
  });

  ipcMain.on('remote:state', (event, s) => { if (fromApp(event)) state = s; });
  ipcMain.on('remote:preview', (event, bytes) => { if (fromApp(event)) server.setPreview(bytes); });

  return { stop: () => { clearInterval(timer); return server.stop(); } };
}

module.exports = { serveRemote };
