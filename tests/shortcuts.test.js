import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, Keymap, comboOf, comboLabel } from '../js/shortcuts.js';

const ev = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('combinaciones normalizadas', () => {
  assert.equal(comboOf(ev('l')), 'L');
  assert.equal(comboOf(ev('F', { shiftKey: true })), 'Shift+F');
  assert.equal(comboOf(ev('?', { shiftKey: true })), '?', 'en los símbolos el carácter ya incluye Mayús');
  assert.equal(comboOf(ev('+', { shiftKey: true })), '+');
  assert.equal(comboOf(ev('z', { metaKey: true, shiftKey: true })), 'Ctrl+Shift+Z', 'Cmd cuenta como Ctrl');
  assert.equal(comboOf(ev('Enter', { altKey: true })), 'Alt+Enter');
  assert.equal(comboOf(ev('3', { ctrlKey: true })), 'Ctrl+3');
  assert.equal(comboOf(ev(' ')), ' ');
  assert.equal(comboOf(ev('Shift', { shiftKey: true })), null);
  assert.equal(comboLabel('Ctrl+ArrowLeft'), 'Ctrl + ←');
});

test('las teclas por defecto no chocan entre acciones', () => {
  const seen = new Map();
  for (const a of ACTIONS) for (const k of a.keys) {
    assert.ok(!seen.has(k), `«${k}» está en ${seen.get(k)} y en ${a.id}`);
    seen.set(k, a.id);
  }
  const km = new Keymap();
  assert.equal(km.actionFor('Enter'), 'capture');
  assert.equal(km.actionFor('Ctrl+4'), 'captureHold4');
  assert.equal(km.actionFor('X'), null);
});

test('reasignar quita la tecla a la acción que la tenía y se puede restablecer', () => {
  const km = new Keymap();
  const lost = km.assign('onion', 'D');
  assert.equal(lost, 'difference');
  assert.equal(km.actionFor('D'), 'onion');
  assert.equal(km.actionFor('O'), null);
  assert.deepEqual(km.changes(), { onion: ['D'], difference: [] });
  const restored = new Keymap(km.changes());
  assert.equal(restored.actionFor('D'), 'onion');
  km.reset();
  assert.deepEqual(km.changes(), {});
  assert.equal(km.actionFor('D'), 'difference');
});
