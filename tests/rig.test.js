import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { levelsAt, dmxFrame, artnetPacket, enttecPacket, parseArtnet } from '../js/dmx.js';
import { positionsAt, toSteps, MocoHost, MocoSimulator, lineSplitter } from '../js/moco.js';

const lighting = {
  lights: [{ id: 'key', name: 'Principal', channel: 1 }, { id: 'fill', name: 'Relleno', channel: 5 }],
  looks: [{ id: 'day', levels: { key: 100, fill: 40 } }, { id: 'night', levels: { key: 10, fill: 0 } }],
  keys: [{ exposure: 1, lookId: 'day' }, { exposure: 11, lookId: 'night', fade: true }, { exposure: 20, lookId: 'day' }],
};

test('luz: looks por exposición con fundido y cortes', () => {
  assert.deepEqual(levelsAt(lighting, 1), { key: 100, fill: 40 });
  assert.deepEqual(levelsAt(lighting, 6), { key: 55, fill: 20 }, 'a mitad del fundido');
  assert.deepEqual(levelsAt(lighting, 11), { key: 10, fill: 0 });
  assert.deepEqual(levelsAt(lighting, 19), { key: 10, fill: 0 }, 'sin fundido: corte en la exposición 20');
  assert.deepEqual(levelsAt(lighting, 20), { key: 100, fill: 40 });
  assert.deepEqual(levelsAt({ lights: lighting.lights, looks: [], keys: [] }, 5), { key: 0, fill: 0 });
  const data = dmxFrame(lighting, levelsAt(lighting, 6));
  assert.equal(data.length, 512);
  assert.equal(data[0], 140); // 55 % → 140
  assert.equal(data[4], 51);  // 20 % → 51
});

test('Art-Net ArtDmx y ENTTEC DMX USB Pro', () => {
  const data = new Uint8Array(512); data[0] = 255; data[511] = 7;
  const a = artnetPacket(data, { universe: 0x123, sequence: 9 });
  assert.equal(a.length, 18 + 512);
  assert.equal(String.fromCharCode(...a.subarray(0, 8)), 'Art-Net\0');
  assert.deepEqual([...a.subarray(8, 12)], [0x00, 0x50, 0, 14]);
  assert.deepEqual([...a.subarray(14, 18)], [0x23, 0x01, 0x02, 0x00]);
  const back = parseArtnet(a);
  assert.equal(back.universe, 0x123);
  assert.equal(back.sequence, 9);
  assert.equal(back.data[511], 7);
  const e = enttecPacket(data);
  assert.equal(e.length, 518);
  assert.deepEqual([...e.subarray(0, 5)], [0x7e, 6, 0x01, 0x02, 0]);
  assert.equal(e[5], 255);
  assert.equal(e[516], 7);
  assert.equal(e[517], 0xe7);
});

test('Art-Net llega por UDP (solo en este ordenador, sin luces reales)', async () => {
  const sock = dgram.createSocket('udp4');
  await new Promise((r) => sock.bind(0, '127.0.0.1', r));
  const got = new Promise((r) => sock.once('message', (m) => r(m)));
  const out = dgram.createSocket('udp4');
  const data = dmxFrame(lighting, levelsAt(lighting, 1));
  await new Promise((r, j) => out.send(artnetPacket(data), sock.address().port, '127.0.0.1', (err) => (err ? j(err) : r())));
  const msg = parseArtnet(await got);
  assert.equal(msg.data[0], 255);
  assert.equal(msg.data[4], 102);
  out.close(); sock.close();
});

const moco = {
  axes: [
    { id: 'slide', stepsPerUnit: 80, keys: [{ exposure: 1, position: 0 }, { exposure: 11, position: 100, ease: 'easeInOut' }] },
    { id: 'pan', stepsPerUnit: 10, keys: [{ exposure: 1, position: 0 }, { exposure: 21, position: 90 }] },
  ],
};

test('movimiento: posición de cada eje por exposición con suavizado', () => {
  assert.deepEqual(positionsAt(moco, 1), { slide: 0, pan: 0 });
  assert.equal(positionsAt(moco, 6).slide, 50, 'mitad exacta con ease-in-out');
  assert.ok(positionsAt(moco, 3).slide < 20 * 0.5, 'arranca despacio');
  assert.equal(positionsAt(moco, 11).pan, 45);
  assert.deepEqual(positionsAt(moco, 40), { slide: 100, pan: 90 }, 'después de la última clave se queda quieto');
  assert.equal(toSteps(moco.axes[0], positionsAt(moco, 11).slide), 8000);
});

test('protocolo MESORA-Moco con el simulador: mover, esperar, posición, errores', async () => {
  const sim = new MocoSimulator({ axes: 2, timeScale: 0.01 });
  const host = new MocoHost(sim.transport());
  assert.deepEqual(await host.hello(), { version: '1', axes: 2 });
  await host.setSpeed(4000, 8000);
  const t0 = Date.now();
  assert.deepEqual(await host.moveTo([8000, 450]), [8000, 450]);
  assert.ok(Date.now() - t0 >= 15, 'espera a que el movimiento termine');
  assert.deepEqual(await host.position(), [8000, 450]);
  await host.zero();
  assert.deepEqual(await host.position(), [0, 0]);
  await assert.rejects(host.moveTo([1, 2, 3]), /orden no válida/);
  host.close();
});

test('separar líneas de un puerto serie', () => {
  const lines = [];
  const feed = lineSplitter((l) => lines.push(l));
  feed('MESORA-MO'); feed('CO 1 axes=3\r\nok g'); feed('o\ndone 1 2 3\n');
  assert.deepEqual(lines, ['MESORA-MOCO 1 axes=3', 'ok go', 'done 1 2 3']);
});
