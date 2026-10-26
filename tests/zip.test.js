import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { crc32, createZip, readZip } from '../js/zip.js';

test('crc32 known value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('zip round trip', async () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);
  const zip = await createZip([
    { name: 'project.json', data: '{"a":1}' },
    { name: 'frames/ñandú.png', data: new Blob([png], { type: 'image/png' }) },
  ]);
  const entries = await readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ['project.json', 'frames/ñandú.png']);
  assert.equal(await (await entries[0].blob()).text(), '{"a":1}');
  const back = new Uint8Array(await (await entries[1].blob('image/png')).arrayBuffer());
  assert.deepEqual(back, png);
});

test('reads deflate entries', async () => {
  // Hand-build a one-entry ZIP using deflate (method 8).
  const data = new TextEncoder().encode('hola hola hola hola');
  const comp = deflateRawSync(data);
  const name = new TextEncoder().encode('a.txt');
  const crc = crc32(data);
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
  lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
  cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28);
  cd.writeUInt32LE(0, 42);
  const cdOffset = 30 + name.length + comp.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOffset, 16);
  const zip = new Blob([lh, name, comp, cd, name, end]);
  const [entry] = await readZip(zip);
  assert.equal(entry.name, 'a.txt');
  assert.equal(await (await entry.blob()).text(), 'hola hola hola hola');
});
