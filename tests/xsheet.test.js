import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xsheetRows, xsheetToCSV, xsheetFromCSV } from '../js/xsheet.js';

const frames = [{ key: 'a', id: '1', hold: 2, note: 'entra' }, { key: 'b', id: '2', hold: 1 }];

test('una fila por exposición; los holds ocupan varias filas', () => {
  const rows = xsheetRows(frames, {}, 6);
  assert.equal(rows.length, 6, 'longitud de escena mínima');
  assert.deepEqual(rows.slice(0, 4).map((r) => [r.exposure, r.frameIndex, r.first]), [[1, 0, true], [2, 0, false], [3, 1, true], [4, -1, false]]);
  assert.equal(rows[0].note, 'entra');
  assert.equal(rows[1].note, '');
  assert.equal(xsheetRows(frames, { 10: { dialog: 'hola' } }, 4).length, 10, 'llega hasta lo planificado');
  assert.equal(xsheetRows(frames, {}, 1).length, 4, 'siempre muestra la siguiente por capturar');
});

test('CSV de ida y vuelta conserva el plan (comas, comillas y acentos)', () => {
  const plan = { 1: { action: 'Entra, mira', dialog: '«Hola»' }, 3: { phoneme: 'O', camera: 'zoom "lento"' }, 5: { light: 'atardecer' } };
  const csv = xsheetToCSV(frames, plan, 5, 12);
  assert.match(csv.split('\r\n')[0], /^Exposición,Tiempo,Fotograma,Acción,Diálogo,Fonema,Cámara,Luz,Notas$/);
  assert.match(csv, /"Entra, mira"/);
  assert.match(csv, /"zoom ""lento"""/);
  assert.deepEqual(xsheetFromCSV(csv), plan);
});

test('CSV con punto y coma (Excel en español) y sin columna de exposición', () => {
  const plan = xsheetFromCSV('Acción;Fonema\r\nSalta;A\r\n;\r\n;M\r\n');
  assert.deepEqual(plan, { 1: { action: 'Salta', phoneme: 'A' }, 3: { phoneme: 'M' } });
});
