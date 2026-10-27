// IPC for the phone remote / local API: the page turns it on and off, sends
// what the phone shows (state and a small preview) and receives the actions.
// Also the phone as a wireless camera: the phone's WebRTC offer is passed to
// the page, which answers it and then receives the video directly.
const qrcode = require('qrcode-generator');
const { RemoteServer, lanAddresses } = require('./core/remote.cjs');
const { loadIdentity } = require('./core/cert.cjs');

const OFFER_TIMEOUT = 15000;

function qrSvg(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

function serveRemote({ ipcMain, getWindow, fromApp, log, dataDir }) {
  let state = {};
  let active = false;
  let timer = null;
  let offerId = 0;
  const offers = new Map();
  const failed = (message) => Object.assign(new Error(message), { status: 503 });
  // The page answers each offer from a phone; without an answer in time the phone tries again.
  const onCameraOffer = (sdp) => new Promise((resolve, reject) => {
    const win = getWindow();
    if (!win) { reject(failed('MESORA no está listo')); return; }
    const id = ++offerId;
    const timer = setTimeout(() => { offers.delete(id); reject(failed('MESORA no respondió a tiempo')); }, OFFER_TIMEOUT);
    offers.set(id, { resolve, reject, timer });
    win.webContents.send('phonecam:offer', { id, sdp });
  });
  const server = new RemoteServer({
    onAction: (action) => getWindow()?.webContents.send('remote:action', action),
    getState: () => state,
    onCameraOffer,
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

  ipcMain.handle('phonecam:start', async (event) => {
    guard(event);
    const identity = loadIdentity(dataDir, ['localhost', '127.0.0.1', ...lanAddresses()]);
    const info = await server.startCamera(identity);
    const url = info.urls[0] || info.localUrl;
    log('info', 'Cámara del móvil esperando en el puerto', info.port);
    return { ...info, url, qr: qrSvg(url) };
  });

  ipcMain.handle('phonecam:stop', async (event) => {
    guard(event);
    for (const [id, o] of offers) { clearTimeout(o.timer); o.reject(failed('El móvil ya no es la cámara de MESORA')); offers.delete(id); }
    await server.stopCamera();
  });

  ipcMain.on('phonecam:answer', (event, id, result) => {
    if (!fromApp(event)) return;
    const o = offers.get(id);
    if (!o) return;
    offers.delete(id);
    clearTimeout(o.timer);
    if (typeof result?.sdp === 'string') o.resolve(result.sdp);
    else o.reject(failed(String(result?.error || 'MESORA no aceptó la conexión')));
  });

  return { stop: () => { clearInterval(timer); return Promise.all([server.stop(), server.stopCamera()]); } };
}

module.exports = { serveRemote };
