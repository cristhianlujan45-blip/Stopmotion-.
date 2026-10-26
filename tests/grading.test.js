import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflickerGains, meanLuma, gradeFilter } from '../js/grading.js';

test('deflicker evens out a single flickering frame', () => {
  const gains = deflickerGains([100, 100, 130, 100, 100]);
  assert.ok(Math.abs(gains[2] * 130 - 100) < 1e-9);
  for (const i of [0, 1, 3, 4]) assert.equal(gains[i], 1);
});

test('deflicker keeps a gradual fade, including at the ends', () => {
  const ramp = [60, 70, 80, 90, 100, 110, 120, 130, 140];
  const gains = deflickerGains(ramp);
  for (let i = 0; i < ramp.length; i++) assert.ok(Math.abs(gains[i] - 1) < 1e-9, `frame ${i}`);
});

test('deflicker strongly reduces alternating flicker', () => {
  const lumas = [100, 130, 100, 130, 100, 130, 100, 130, 100, 130];
  const out = deflickerGains(lumas).map((g, i) => g * lumas[i]);
  const spread = Math.max(...out) / Math.min(...out);
  assert.ok(spread < 1.08, `spread ${spread}`);
});

test('deflicker gains are clamped and ignore black frames', () => {
  const gains = deflickerGains([100, 100, 10, 100, 0], 2, 1.5);
  assert.equal(gains[2], 1.5);
  assert.equal(gains[4], 1);
});

test('meanLuma', () => {
  assert.equal(meanLuma(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])), 127.5);
});

test('gradeFilter', () => {
  assert.equal(gradeFilter({}), 'none');
  assert.equal(gradeFilter({ brightness: 1 }, 1.1), 'brightness(1.1000)');
  assert.equal(gradeFilter({ contrast: 1.2, saturation: 0 }), 'contrast(1.2000) saturate(0.0000)');
});
