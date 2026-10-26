import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  totalExposures, expandExposures, exposureStart, formatTime, moveItems, computeSpacing, EASINGS,
} from '../js/timing.js';

const frames = [{ hold: 1 }, { hold: 2 }, { hold: 3 }];

test('exposures', () => {
  assert.equal(totalExposures(frames), 6);
  assert.deepEqual(expandExposures(frames), [0, 1, 1, 2, 2, 2]);
  assert.deepEqual(expandExposures(frames, 1, 2), [1, 1]);
  assert.equal(exposureStart(frames, 0), 0);
  assert.equal(exposureStart(frames, 2), 3);
  assert.equal(exposureStart(frames, 3), 6);
});

test('formatTime', () => {
  assert.equal(formatTime(0, 12), '00:00:00');
  assert.equal(formatTime(13, 12), '00:01:01');
  assert.equal(formatTime(24 * 75 + 5, 24), '01:15:05');
});

test('moveItems', () => {
  const a = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(moveItems(a, [0], 3), ['b', 'c', 'a', 'd', 'e']);
  assert.deepEqual(moveItems(a, [3, 4], 0), ['d', 'e', 'a', 'b', 'c']);
  assert.deepEqual(moveItems(a, [1, 3], 5), ['a', 'c', 'e', 'b', 'd']);
  assert.deepEqual(moveItems(a, [2], 2), a);
  assert.deepEqual(moveItems(a, [2], 3), a);
});

test('computeSpacing', () => {
  const lin = computeSpacing(100, 4, 'linear');
  assert.equal(lin.length, 5);
  assert.deepEqual(lin.map((r) => r.position), [0, 25, 50, 75, 100]);
  assert.ok(lin.slice(1).every((r) => Math.abs(r.delta - 25) < 1e-9));

  for (const name of Object.keys(EASINGS)) {
    const rows = computeSpacing(80, 10, name);
    assert.equal(rows[0].position, 0, name);
    assert.ok(Math.abs(rows[10].position - 80) < 1e-9, name);
    const sum = rows.reduce((s, r) => s + r.delta, 0);
    assert.ok(Math.abs(sum - 80) < 1e-9, name);
  }
  const eio = computeSpacing(100, 10, 'easeInOut');
  assert.ok(eio[1].delta < eio[5].delta && eio[10].delta < eio[5].delta);
});
