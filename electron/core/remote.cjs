// Phone as a remote control, and the local API: a small HTTP server on the
// local network, off until the user turns it on. Every request needs the
// session token (in the QR code); a new token is made each time it starts.
// It can only run the actions listed in ACTIONS: it never reads or changes files.
const http = require('node:http');
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
const ACTIVE_MS = 5000;
const MAX_BODY = 4096;

/** IPv4 addresses of this computer on the local network. */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

class RemoteServer {
  /**
   * @param {{ onAction: (action: string) => void, getState: () => object, log?: Function }} opts
   */
  constructor({ onAction, getState, log = () => {} }) {
    Object.assign(this, { onAction, getState, log });
    this.server = null;
    this.token = null;
    this.preview = null;
    this.lastSeen = 0;
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
    await new Promise((resolve, reject) => {
      const onError = (err) => {
        // The usual port is taken: let the system choose a free one.
        if (err.code === 'EADDRINUSE' && port !== 0) { port = 0; server.listen(0, host); return; }
        reject(err);
      };
      server.on('error', onError);
      server.listen(port, host, () => { server.off('error', onError); resolve(); });
    });
    this.server = server;
    return this.info();
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
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    }
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
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; base-uri 'none'; form-action 'none'");
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
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Petición demasiado grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = { RemoteServer, ACTIONS, lanAddresses };
