import test from 'node:test';
import assert from 'node:assert/strict';
import { compareFrames, lightRatio, cameraShift } from '../js/assistant.js';

const W = 320, H = 180;

// A textured "set": smooth random blobs, so shifts and blur are measurable.
function scene({ dx = 0, dy = 0, gain = 1, puppetX = 140, blur = 0, hand = false, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 60 }, () => ({ x: rnd() * W, y: rnd() * H, r: 4 + rnd() * 10, v: 40 + rnd() * 160 }));
  let g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = x - dx, sy = y - dy;
      let v = 90 + 30 * Math.sin(sx / 13) * Math.cos(sy / 9);
      for (const b of blobs) if ((sx - b.x) ** 2 + (sy - b.y) ** 2 < b.r * b.r) v = b.v;
      if (sx > puppetX && sx < puppetX + 30 && sy > 70 && sy < 120) v = 230; // the puppet
      if (hand && x < 30 && y > 50 && y < 140) v = 20;
      g[y * W + x] = Math.min(255, v * gain);
    }
  }
  for (let k = 0; k < blur; k++) {
    const out = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      out[i] = (g[i] * 4 + g[i - 1] + g[i + 1] + g[i - W] + g[i + W]) / 8;
    }
    g = out;
  }
  return { g, w: W, h: H };
}

const types = (r) => r.issues.map((i) => i.type).sort();

test('animar la marioneta no genera avisos', () => {
  const r = compareFrames(scene(), scene({ puppetX: 146 }));
  assert.deepEqual(types(r), []);
});

test('detecta que la cámara se movió y en qué dirección', () => {
  const r = compareFrames(scene(), scene({ dx: 4, puppetX: 146 }), { widthPx: 1920 });
  assert.deepEqual(types(r), ['bump']);
  assert.match(r.issues[0].text, /izquierda/);
  const px = Number(/unos (\d+) px/.exec(r.issues[0].text)[1]);
  assert.ok(px >= 18 && px <= 30, `≈24 px a 1920: ${px}`);
  const shift = cameraShift(scene(), scene({ dy: -3 }));
  assert.ok(Math.abs(shift.y * H + 3) < 0.8, `desplazamiento vertical ${shift.y * H}`);
});

test('detecta un cambio de luz y su signo', () => {
  const r = compareFrames(scene(), scene({ gain: 1.12, puppetX: 146 }));
  assert.deepEqual(types(r), ['exposure']);
  assert.match(r.issues[0].text, /\+12 %/);
  assert.ok(Math.abs(lightRatio(scene(), scene({ gain: 0.9 })) - 0.9) < 0.01);
});

test('detecta un doble disparo (sin cambios)', () => {
  assert.deepEqual(types(compareFrames(scene(), scene())), ['duplicate']);
});

test('detecta algo nuevo en el borde del encuadre', () => {
  const r = compareFrames(scene(), scene({ hand: true, puppetX: 146 }));
  assert.deepEqual(types(r), ['edge']);
  assert.match(r.issues[0].text, /izquierda/);
});

test('detecta la pérdida de foco', () => {
  const r = compareFrames(scene(), scene({ blur: 3, puppetX: 146 }));
  assert.ok(types(r).includes('focus'), JSON.stringify(r.issues));
});

test('la sensibilidad baja ignora cambios pequeños y se pueden elegir las comprobaciones', () => {
  assert.deepEqual(types(compareFrames(scene(), scene({ gain: 1.07, puppetX: 146 }), { sensitivity: 'low' })), []);
  assert.deepEqual(types(compareFrames(scene(), scene({ gain: 1.07, puppetX: 146 }), { sensitivity: 'normal' })), ['exposure']);
  assert.deepEqual(types(compareFrames(scene(), scene(), { checks: ['bump'] })), []);
});
