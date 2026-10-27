// Lighting and motion control from the desktop app: Art-Net packets go out
// over UDP from here; USB devices (ENTTEC DMX USB Pro, MESORA-Moco) use the
// page's Web Serial, and this file only shows the dialog to pick the port.
const dgram = require('node:dgram');
const net = require('node:net');

const ARTNET_PORT = 6454;

function serveRig({ ipcMain, dialog, session, getWindow, fromApp, log }) {
  let socket = null;
  const udp = () => {
    if (!socket) {
      socket = dgram.createSocket('udp4');
      socket.on('error', (err) => log('error', 'Art-Net', err));
      socket.bind(() => socket.setBroadcast(true));
    }
    return socket;
  };

  ipcMain.handle('rig:artnet', async (event, host, bytes) => {
    if (!fromApp(event)) throw new Error('Origen no permitido');
    if (!net.isIPv4(String(host))) throw new Error(`Dirección IP no válida: ${host}`);
    const data = Buffer.from(bytes);
    if (data.length < 20 || data.length > 530 || data.toString('latin1', 0, 7) !== 'Art-Net') throw new Error('Paquete Art-Net no válido');
    await new Promise((resolve, reject) => udp().send(data, ARTNET_PORT, host, (err) => (err ? reject(err) : resolve())));
  });

  // Web Serial asks the app which port to open: the user chooses in a dialog.
  session.defaultSession.on('select-serial-port', async (event, ports, _wc, callback) => {
    event.preventDefault();
    if (!ports.length) {
      dialog.showMessageBox(getWindow(), { type: 'info', message: 'No hay ningún dispositivo USB serie conectado', detail: 'Conecta el controlador (ENTTEC DMX USB Pro, Arduino con MESORA-Moco…) y vuelve a intentarlo.' });
      callback('');
      return;
    }
    const labels = ports.map((p) => [p.displayName, p.portName].filter(Boolean).join(' · ') || p.portId);
    const r = await dialog.showMessageBox(getWindow(), {
      type: 'question', message: 'Elige el dispositivo', detail: 'Puerto USB serie del controlador de luces o de movimiento.',
      buttons: [...labels, 'Cancelar'], cancelId: labels.length, noLink: true,
    });
    callback(r.response < ports.length ? ports[r.response].portId : '');
  });
  session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === 'serial' && details.origin === 'app://mesora');

  return { stop: () => { socket?.close(); socket = null; } };
}

module.exports = { serveRig };
