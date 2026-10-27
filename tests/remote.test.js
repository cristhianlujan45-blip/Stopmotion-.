import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { RemoteServer } = require('../electron/core/remote.cjs');

test('mando remoto: código obligatorio, acciones permitidas y vista previa', async () => {
  const actions = [];
  const srv = new RemoteServer({ onAction: (a) => actions.push(a), getState: () => ({ project: 'Corto', frames: 3, live: true }) });
  const info = await srv.start({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${info.port}`;
  const h = { 'X-Mesora-Token': info.token };
  try {
    assert.equal((await fetch(`${base}/api/state`)).status, 403, 'sin código');
    assert.equal((await fetch(`${base}/api/state`, { headers: { 'X-Mesora-Token': 'x'.repeat(32) } })).status, 403, 'código falso');
    const page = await fetch(`${base}/?t=${info.token}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(await page.text(), /CAPTURAR/);
    assert.deepEqual(await (await fetch(`${base}/api/state`, { headers: h })).json(), { project: 'Corto', frames: 3, live: true });
    const ok = await fetch(`${base}/api/action`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'capture' }) });
    assert.equal(ok.status, 200);
    const bad = await fetch(`${base}/api/action`, { method: 'POST', headers: h, body: JSON.stringify({ action: 'delete' }) });
    assert.equal(bad.status, 400, 'borrar no se puede pedir desde fuera');
    assert.deepEqual(actions, ['capture']);
    assert.equal((await fetch(`${base}/api/preview.jpg`, { headers: h })).status, 204);
    srv.setPreview(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const jpg = await fetch(`${base}/api/preview.jpg`, { headers: h });
    assert.equal(jpg.headers.get('content-type'), 'image/jpeg');
    assert.equal((await jpg.arrayBuffer()).byteLength, 4);
    assert.ok(srv.clientsActive);
    assert.ok((await (await fetch(`${base}/api`, { headers: h })).json()).actions.includes('capture'));
  } finally {
    await srv.stop();
  }
  await assert.rejects(fetch(`${base}/api/state`, { headers: h }), 'apagado: ya no responde');
  const again = await srv.start({ port: 0, host: '127.0.0.1' });
  assert.notEqual(again.token, info.token, 'cada vez un código nuevo');
  await srv.stop();
});

test('cámara del móvil: https, código propio, página y oferta WebRTC', async () => {
  const { selfSignedCert } = require('../electron/core/cert.cjs');
  const offers = [];
  const srv = new RemoteServer({
    onAction: () => {}, getState: () => ({}),
    onCameraOffer: async (sdp) => { offers.push(sdp); return 'v=0\r\nrespuesta'; },
  });
  const identity = { ...selfSignedCert(), token: 'c'.repeat(32) };
  const info = await srv.startCamera(identity, { port: 0, host: '127.0.0.1' });
  assert.match(info.localUrl, /^https:\/\/127\.0\.0\.1:\d+\/camera\?t=c{32}$/);
  const https = require('node:https');
  const call = (method, pathname, { token = identity.token, body } = {}) => new Promise((resolve, reject) => {
    const req = https.request({
      host: '127.0.0.1', port: info.port, path: pathname, method, ca: identity.cert,
      headers: { ...(token ? { 'X-Mesora-Token': token } : {}), 'Content-Type': 'application/json' },
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
    });
    req.on('error', reject);
    req.end(body);
  });
  try {
    assert.equal((await call('GET', '/camera', { token: '' })).status, 403, 'sin código');
    assert.equal((await call('GET', '/api/camera/status', { token: 'x'.repeat(32) })).status, 403, 'código falso');
    const page = await call('GET', '/camera');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);
    assert.match(page.body, /RTCPeerConnection/);
    assert.deepEqual(JSON.parse((await call('GET', '/api/camera/status')).body), { ready: true, name: 'MESORA Studio' });
    assert.equal((await call('POST', '/api/camera/offer', { body: JSON.stringify({ sdp: 'hola' }) })).status, 400, 'no es una oferta');
    const answer = await call('POST', '/api/camera/offer', { body: JSON.stringify({ sdp: 'v=0\r\noferta' }) });
    assert.equal(answer.status, 200);
    assert.equal(JSON.parse(answer.body).sdp, 'v=0\r\nrespuesta');
    assert.deepEqual(offers, ['v=0\r\noferta']);
    // Too big: refused (the server cuts the connection, or answers 413 if it gets to).
    const big = await call('POST', '/api/camera/offer', { body: JSON.stringify({ sdp: `v=0${'x'.repeat(70 * 1024)}` }) }).catch((err) => err);
    assert.ok(big instanceof Error || big.status === 413, `oferta enorme rechazada (${big.status || big.code})`);
    assert.equal(offers.length, 1);
    // The remote control's own code does not open the camera, nor the other way round.
    assert.equal((await call('GET', '/api/camera/status', { token: 'r'.repeat(32) })).status, 403);
  } finally {
    await srv.stopCamera();
  }
});
