// Lip sync: a small set of mouth shapes, how to read what the animator types
// in the X-Sheet «Fonema» column, and a rough first draft from the loudness of
// a dialogue track. The draft does not understand words: it only says when the
// mouth is shut, open or very open, for the animator to correct.

/** Mouth shapes, in the order they are shown. `letters` are what maps to each one. */
export const MOUTHS = [
  { id: 'A', label: 'A · I', hint: 'Boca muy abierta', letters: ['A', 'I', 'AI', 'AH'] },
  { id: 'E', label: 'E', hint: 'Abierta y estirada', letters: ['E', 'EH'] },
  { id: 'O', label: 'O', hint: 'Redonda', letters: ['O'] },
  { id: 'U', label: 'U · W', hint: 'Redonda y pequeña', letters: ['U', 'W', 'OO', 'Q'] },
  { id: 'MBP', label: 'M · B · P', hint: 'Labios cerrados', letters: ['M', 'B', 'P', 'MB', 'MBP'] },
  { id: 'FV', label: 'F · V', hint: 'Dientes sobre el labio de abajo', letters: ['F', 'V', 'FV'] },
  { id: 'L', label: 'L · D · T · N', hint: 'Lengua tras los dientes de arriba', letters: ['L', 'D', 'T', 'N', 'TH', 'LL'] },
  { id: 'CS', label: 'C · S · R…', hint: 'Dientes juntos, labios entreabiertos', letters: ['C', 'S', 'R', 'Z', 'G', 'K', 'J', 'Y', 'CH', 'SH', 'RR', 'CS'] },
  { id: 'rest', label: 'Reposo', hint: 'Sin hablar, boca relajada', letters: ['REPOSO', 'REST', '-', '.', '_', 'X'] },
];

const BY_LETTER = new Map(MOUTHS.flatMap((m) => m.letters.map((l) => [l, m.id])));
const IDS = new Set(MOUTHS.map((m) => m.id));

/**
 * Mouth shape for what was typed in a «Fonema» cell: an id (A, MBP, rest…),
 * one of its letters (B → MBP) or the first letters of a syllable («ma» → MBP).
 * Returns null for an empty cell.
 */
export function mouthFor(text) {
  const t = String(text ?? '').trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!t) return null;
  if (t === 'REST') return 'rest';
  if (IDS.has(t)) return t;
  if (BY_LETTER.has(t)) return BY_LETTER.get(t);
  if (BY_LETTER.has(t.slice(0, 2))) return BY_LETTER.get(t.slice(0, 2));
  return BY_LETTER.get(t[0]) || null;
}

export const mouthLabel = (id) => MOUTHS.find((m) => m.id === id)?.label || id;

const quantile = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0;
};

/**
 * First draft of the mouth shape of each exposure from the loudness of a
 * dialogue track (see exposureLevels): silence → rest, the exposure before a
 * word → MBP, hissing sounds → CS, and the louder the voice, the more open
 * the mouth (O, E, A). One-exposure flickers are smoothed out.
 * @param {{ rms: number, zcr: number }[]} levels
 * @returns {string[]} one mouth id per exposure
 */
export function draftMouths(levels) {
  if (!levels.length) return [];
  const loud = quantile(levels.map((l) => l.rms), 0.95) || 1;
  const floor = quantile(levels.map((l) => l.rms), 0.1);
  const silence = Math.max(loud * 0.1, floor * 1.6);
  const voiced = levels.map((l) => l.rms >= silence);
  const out = levels.map((l, i) => {
    if (!voiced[i]) return voiced[i + 1] ? 'MBP' : 'rest';
    const r = l.rms / loud;
    if (l.zcr > 0.15 && r < 0.6) return 'CS';
    if (r > 0.65) return 'A';
    if (r > 0.35) return 'E';
    return 'O';
  });
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i] !== out[i - 1] && out[i - 1] === out[i + 1] && out[i] !== 'MBP') out[i] = out[i - 1];
  }
  return out;
}
