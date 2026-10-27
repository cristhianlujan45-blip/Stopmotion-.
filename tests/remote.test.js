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
