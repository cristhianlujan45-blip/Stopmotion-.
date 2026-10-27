import test from 'node:test';
import assert from 'node:assert/strict';
import { mouthFor, draftMouths } from '../js/lipsync.js';
import { exposureLevels, encodeWav } from '../js/audio.js';
import { mediaIds, remapMedia } from '../js/media.js';

test('lo escrito en la columna Fonema se convierte en una boca', () => {
  assert.equal(mouthFor('A'), 'A');
  assert.equal(mouthFor('b'), 'MBP');
  assert.equal(mouthFor('ma'), 'MBP');
  assert.equal(mouthFor('Sí'), 'CS');
  assert.equal(mouthFor('í'), 'A');
  assert.equal(mouthFor('th'), 'L');
  assert.equal(mouthFor('reposo'), 'rest');
  assert.equal(mouthFor('-'), 'rest');
  assert.equal(mouthFor('  '), null);
  assert.equal(mouthFor('MBP'), 'MBP');
});

// 12 fps, 48 kHz: silence, a loud vowel, a quiet vowel, a hiss, silence.
function speech() {
  const sr = 48000, per = sr / 12;
  const parts = [['silence', 4], ['loud', 4], ['soft', 3], ['hiss', 3], ['silence', 4]];
  const out = [];
  let s = 3;
  const noise = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let t = 0;
  for (const [kind, n] of parts) {
    for (let i = 0; i < n * per; i++, t++) {
      const v = kind === 'loud' ? 0.8 * Math.sin((2 * Math.PI * 180 * t) / sr)
        : kind === 'soft' ? 0.25 * Math.sin((2 * Math.PI * 180 * t) / sr)
          : kind === 'hiss' ? 0.2 * noise() : 0.002 * noise();
      out.push(v);
    }
  }
  return { samples: Float32Array.from(out), sr };
}

test('borrador de bocas a partir del volumen del diálogo', () => {
  const { samples, sr } = speech();
  const levels = exposureLevels(samples, sr, 12);
  assert.equal(levels.length, 18);
  const m = draftMouths(levels);
  assert.deepEqual(m.slice(0, 3), ['rest', 'rest', 'rest']);
  assert.equal(m[3], 'MBP', 'labios cerrados justo antes de hablar');
  assert.deepEqual(m.slice(4, 8), ['A', 'A', 'A', 'A']);
  assert.ok(m.slice(8, 11).every((x) => x === 'O' || x === 'E'), m.slice(8, 11).join());
  assert.deepEqual(m.slice(11, 14), ['CS', 'CS', 'CS']);
  assert.deepEqual(m.slice(14), ['rest', 'rest', 'rest', 'rest']);
});

test('WAV de 16 bits válido', () => {
  const wav = encodeWav([Float32Array.from([0, 1, -1, 2]), Float32Array.from([0.5, -0.5, 0, -2])], 48000);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(v.getUint16(22, true), 2);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(40, true), 16);
  assert.equal(wav.length, 44 + 16);
  assert.equal(v.getInt16(44 + 4 * 1, true), 32767); // 1 → max
  assert.equal(v.getInt16(44 + 4 * 2, true), -32768); // -1 → min
  assert.equal(v.getInt16(44 + 4 * 3 + 2, true), -32768); // -2 clipped
});

test('todos los archivos de un proyecto se copian al empaquetar o migrar', async () => {
  const p = {
    audio: { blobId: 'old', name: 'voz.wav', offset: 3 },
    tracks: [{ id: 't1', blobId: 'a1' }, { id: 't2', blobId: 'gone' }],
    settings: {
      chroma: { bgBlobId: 'bg' }, reference: { blobId: null },
      lipsync: { characters: [{ id: 'c', name: 'Ana', mouths: { A: 'm1', E: 'gone' } }] },
    },
  };
  assert.deepEqual(mediaIds(p).sort(), ['a1', 'bg', 'gone', 'm1', 'old']);
  await remapMedia(p, async (id) => (id === 'gone' ? null : `new-${id}`));
  assert.equal(p.audio.blobId, 'new-old');
  assert.deepEqual(p.tracks.map((t) => t.blobId), ['new-a1']);
  assert.equal(p.settings.chroma.bgBlobId, 'new-bg');
  assert.deepEqual(p.settings.lipsync.characters[0].mouths, { A: 'new-m1' });
});
