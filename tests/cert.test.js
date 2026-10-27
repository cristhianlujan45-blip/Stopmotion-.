import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';

const require = createRequire(import.meta.url);
const { selfSignedCert, loadIdentity } = require('../electron/core/cert.cjs');

test('certificado propio: válido, firmado por sí mismo y aceptado en una conexión https', async () => {
  const { key, cert } = selfSignedCert({ hosts: ['localhost', '127.0.0.1', '192.168.1.40'] });
  const x = new crypto.X509Certificate(cert);
  assert.ok(x.verify(x.publicKey), 'firma correcta');
  assert.equal(x.checkIP('192.168.1.40'), '192.168.1.40');
  assert.equal(x.checkHost('localhost'), 'localhost');
  assert.equal(x.ca, false);
  const days = (Date.parse(x.validTo) - Date.now()) / 86400e3;
  assert.ok(days > 390 && days <= 397, `vigencia que aceptan los iPhone (${days.toFixed(1)} días)`);
  const server = https.createServer({ key, cert }, (_req, res) => res.end('hola')).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    const body = await new Promise((resolve, reject) => {
      https.get({ host: '127.0.0.1', port: server.address().port, path: '/', ca: cert }, (res) => {
        let b = '';
        res.on('data', (d) => { b += d; });
        res.on('end', () => resolve(b));
      }).on('error', reject);
    });
    assert.equal(body, 'hola');
  } finally {
    server.close();
  }
});

test('identidad del móvil: se guarda y se reutiliza (el móvil acepta el aviso una sola vez)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mesora-cert-'));
  try {
    const a = loadIdentity(dir, ['localhost']);
    assert.match(a.token, /^[0-9a-f]{32}$/);
    const b = loadIdentity(dir, ['localhost', '10.0.0.9']);
    assert.equal(b.cert, a.cert, 'mismo certificado');
    assert.equal(b.token, a.token, 'mismo código');
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'phone-camera.json')).mode & 0o777, 0o600, 'solo lo lee el usuario');
    // Damaged file: a new identity instead of an error.
    require('node:fs').writeFileSync(join(dir, 'phone-camera.json'), '{roto');
    const c = loadIdentity(dir, ['localhost']);
    assert.notEqual(c.token, a.token);
    assert.ok(JSON.parse(readFileSync(join(dir, 'phone-camera.json'), 'utf8')).cert.includes('BEGIN CERTIFICATE'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
