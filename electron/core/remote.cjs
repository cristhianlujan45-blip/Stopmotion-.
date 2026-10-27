// Phone as a remote control, and the local API: a small HTTP server on the
// local network, off until the user turns it on. Every request needs the
// session token (in the QR code); a new token is made each time it starts.
// It can only run the actions listed in ACTIONS: it never reads or changes files.
//
// The phone as a wireless camera uses a second server, https (phones only give
// the camera to secure pages), with its own access code kept between sessions.
// It only serves the camera page and passes the phone's WebRTC offer to the app:
// the video then goes straight from the phone to the app, not through here.
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

/** What a phone or another program may ask for (same names as the keyboard shortcuts). */
const ACTIONS = new Set([
  'capture', 'play', 'shortPlay', 'prev', 'next', 'first', 'live', 'toggleLive',
  'undo', 'redo', 'onion', 'loop', 'holdMore', 'holdLess',
]);

const PAGE = path.join(__dirname, '..', 'remote', 'page.html');
const CAMERA_PAGE = path.join(__dirname, '..', 'remote', 'camera.html');
const ACTIVE_MS = 5000;
const MAX_BODY = 4096;
const MAX_OFFER = 64 * 1024;
const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'self'; base-uri 'none'; form-action 'none'";

// Virtual network adapters (virtual machines, WSL, Docker…) are not where the phone is.
const VIRTUAL = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|veth|br-|utun|tailscale|zerotier|loopback/i;

/** IPv4 addresses of this computer on the local network, the likeliest home or studio wifi first. */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ ip: a.address, name });
    }
  }
  const rank = ({ ip, name }) => (VIRTUAL.test(name) ? 10 : 0)
    + (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b)).map((a) => a.ip);
}

/** Listens on the port, or on any free one if it is taken. */
function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === 'EADDRINUSE' && port !== 0) { port = 0; server.listen(0, host); return; }
      reject(err);
    };
    server.on('error', onError);
    server.listen(port, host, () => { server.off('error', onError); resolve(); });
  });
}

async function close(server) {
  if (!server) return;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(() => resolve()));
}

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

class RemoteServer {
  /**
   * @param {{ onAction: (action: string) => void, getState: () => object,
   *   onCameraOffer?: (sdp: string) => Promise<string>, log?: Function }} opts
   */
  constructor({ onAction, getState, onCameraOffer = null, log = () => {} }) {
    Object.assign(this, { onAction, getState, onCameraOffer, log });
    this.server = null;
    this.token = null;
    this.preview = null;
    this.lastSeen = 0;
    this.camera = null; // https server for the phone camera
    this.cameraToken = null;
  }

  get running() { return !!this.server; }
  /** True while a phone or program has asked for something in the last few seconds. */
  get clientsActive() { return Date.now() - this.lastSeen < ACTIVE_MS; }

  async start({ port = 8765, host = '0.0.0.0' } = {}) {
    if (this.server) return this.info();
    this.token = crypto.randomBytes(16).toString('hex');
    const server = http.createServer((req, res) => this.handle(req, res).catch((err) => {
      this.log('error', 'Mando remoto', err);
      if (!res.headersSent) this.send(res, 500, { error: 'Error interno' });
    }));
    await listen(server, port, host);
    this.server = server;
    return this.info();
  }

  /**
   * Starts the phone camera page (https). `identity` is the certificate, its
   * key and the access code (see core/cert.cjs).
   */
  async startCamera({ key, cert, token }, { port = 8766, host = '0.0.0.0' } = {}) {
    if (this.camera) return this.cameraInfo();
    this.cameraToken = token;
    const server = https.createServer({ key, cert }, (req, res) => this.handleCamera(req, res).catch((err) => {
      this.log('error', 'Cámara del móvil', err);
      if (!res.headersSent) this.send(res, err.status || 500, { error: err.status ? err.message : 'Error interno' });
    }));
    // Phones that drop the connection halfway (bad wifi) must not leave errors behind.
    server.on('tlsClientError', () => {});
    await listen(server, port, host);
    this.camera = server;
    return this.cameraInfo();
  }

  cameraInfo() {
    const { port } = this.camera.address();
    const url = (ip) => `https://${ip}:${port}/camera?t=${this.cameraToken}`;
    return { port, urls: lanAddresses().map(url), localUrl: url('127.0.0.1') };
  }

  async stopCamera() {
    const server = this.camera;
    this.camera = null;
    this.cameraToken = null;
    await close(server);
  }

  info() {
    const { port } = this.server.address();
    const urls = lanAddresses().map((ip) => `http://${ip}:${port}/?t=${this.token}`);
    return { port, token: this.token, urls, localUrl: `http://127.0.0.1:${port}/?t=${this.token}` };
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.token = null;
    this.preview = null;
    await close(server);
  }

  setPreview(bytes) { this.preview = bytes ? Buffer.from(bytes) : null; }

  send(res, status, body, type = 'application/json; charset=utf-8') {
    const data = Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(data);
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://mesora.local');
    const token = req.headers['x-mesora-token'] || url.searchParams.get('t');
    if (!this.token || !sameToken(token, this.token)) {
      this.send(res, 403, { error: 'Falta el código de acceso o no es válido. Vuelve a escanear el QR en MESORA.' });
      return;
    }
    this.lastSeen = Date.now();
    const route = `${req.method} ${url.pathname}`;

    if (route === 'GET /') {
      res.setHeader('Content-Security-Policy', PAGE_CSP);
      this.send(res, 200, await fs.promises.readFile(PAGE), 'text/html; charset=utf-8');
    } else if (route === 'GET /api') {
      this.send(res, 200, {
        name: 'MESORA Studio · API local',
        endpoints: {
          'GET /api/state': 'Estado: proyecto, fotogramas, posición, reproducción, cámara.',
          'POST /api/action': 'Ejecuta una acción. Cuerpo JSON: {"action": "capture"}.',
          'GET /api/preview.jpg': 'Imagen reducida del visor (si la app está enviando vista previa).',
        },
        actions: [...ACTIONS],
        auth: 'Cabecera X-Mesora-Token o parámetro ?t= con el código del QR.',
      });
    } else if (route === 'GET /api/state') {
      this.send(res, 200, this.getState() || {});
    } else if (route === 'GET /api/preview.jpg') {
      if (this.preview) this.send(res, 200, this.preview, 'image/jpeg');
      else { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); }
    } else if (route === 'POST /api/action') {
      const body = await readBody(req);
      let action;
      try { ({ action } = JSON.parse(body || '{}')); } catch { /* handled below */ }
      if (!ACTIONS.has(action)) {
        this.send(res, 400, { error: `Acción no permitida: ${action}`, actions: [...ACTIONS] });
        return;
      }
      this.onAction(action);
      this.send(res, 200, { ok: true, action });
    } else {
      this.send(res, 404, { error: 'No existe', see: '/api' });
    }
  }

  async handleCamera(req, res) {
    const url = new URL(req.url, 'https://mesora.local');
    const token = req.headers['x-mesora-token'] || url.searchParams.get('t');
    if (!this.cameraToken || !sameToken(token, this.cameraToken)) {
      this.send(res, 403, { error: 'Falta el código de acceso o no es válido. Vuelve a escanear el QR en MESORA.' });
      return;
    }
    const route = `${req.method} ${url.pathname}`;
    if (route === 'GET /camera') {
      res.setHeader('Content-Security-Policy', PAGE_CSP);
      res.setHeader('Permissions-Policy', 'camera=(self)');
      this.send(res, 200, await fs.promises.readFile(CAMERA_PAGE), 'text/html; charset=utf-8');
    } else if (route === 'GET /api/camera/status') {
      this.send(res, 200, { ready: true, name: 'MESORA Studio' });
    } else if (route === 'POST /api/camera/offer') {
      const body = await readBody(req, MAX_OFFER);
      let sdp;
      try { ({ sdp } = JSON.parse(body)); } catch { /* handled below */ }
      if (typeof sdp !== 'string' || !sdp.startsWith('v=0')) {
        this.send(res, 400, { error: 'Oferta WebRTC no válida' });
        return;
      }
      const answer = await this.onCameraOffer(sdp);
      this.send(res, 200, { sdp: answer });
    } else {
      this.send(res, 404, { error: 'No existe' });
    }
  }
}

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('Petición demasiado grande'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = { RemoteServer, ACTIONS, lanAddresses };
