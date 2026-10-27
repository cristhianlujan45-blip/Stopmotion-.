// Keyboard shortcuts: every action has default keys and the user can change
// them (Ayuda › Atajos). Keys are written as combos like "Ctrl+Shift+Z",
// "Enter" or "?". Cmd on a Mac counts as Ctrl.

/** Actions in the order they are listed in Help, grouped. */
export const ACTIONS = [
  { group: 'Captura', id: 'capture', label: 'Capturar fotograma', keys: ['Enter'], noRepeat: true },
  { group: 'Captura', id: 'captureReplace', label: 'Capturar y reemplazar el fotograma actual', keys: ['Shift+Enter'], noRepeat: true },
  { group: 'Captura', id: 'captureInsert', label: 'Capturar e insertar después del actual', keys: ['Alt+Enter'], noRepeat: true },
  // Fixed keys, shown in Help as a single line: Ctrl + 2…9.
  ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ group: 'Captura', id: `captureHold${n}`, label: `Capturar y mantener ${n} cuadros`, keys: [`Ctrl+${n}`], noRepeat: true, studio: true, fixed: true })),
  { group: 'Reproducción', id: 'play', label: 'Reproducir / parar', keys: [' ', '0'], noRepeat: true },
  { group: 'Reproducción', id: 'shortPlay', label: 'Reproducción corta (últimos fotogramas y vivo)', keys: ['6'], noRepeat: true },
  { group: 'Reproducción', id: 'loop', label: 'Bucle', keys: ['8', 'L'] },
  { group: 'Reproducción', id: 'pingpong', label: 'Ping-pong', keys: ['P'] },
  { group: 'Navegación', id: 'prev', label: 'Fotograma anterior', keys: ['1', 'ArrowLeft'] },
  { group: 'Navegación', id: 'next', label: 'Fotograma siguiente', keys: ['3', 'ArrowRight'] },
  { group: 'Navegación', id: 'extendLeft', label: 'Ampliar selección a la izquierda', keys: ['Shift+ArrowLeft'] },
  { group: 'Navegación', id: 'extendRight', label: 'Ampliar selección a la derecha', keys: ['Shift+ArrowRight'] },
  { group: 'Navegación', id: 'toggleLive', label: 'Alternar vivo ↔ último fotograma', keys: ['2', 'Tab'] },
  { group: 'Navegación', id: 'live', label: 'Ir a la cámara en vivo', keys: ['5', 'End'] },
  { group: 'Navegación', id: 'first', label: 'Primer fotograma', keys: ['Home'] },
  { group: 'Ver', id: 'onion', label: 'Papel cebolla', keys: ['O'] },
  { group: 'Ver', id: 'difference', label: 'Modo diferencia', keys: ['D'] },
  { group: 'Ver', id: 'blink', label: 'Parpadeo vivo / último', keys: ['B'] },
  { group: 'Ver', id: 'grid', label: 'Cambiar cuadrícula', keys: ['G'] },
  { group: 'Ver', id: 'peaking', label: 'Focus peaking', keys: ['F'] },
  { group: 'Ver', id: 'loupe', label: 'Lupa', keys: ['Z'] },
  { group: 'Ver', id: 'fullscreen', label: 'Pantalla completa', keys: ['Shift+F'] },
  { group: 'Editar', id: 'delete', label: 'Eliminar fotogramas', keys: ['Delete', 'Backspace'] },
  { group: 'Editar', id: 'duplicate', label: 'Duplicar fotogramas', keys: ['Ctrl+D'] },
  { group: 'Editar', id: 'selectAll', label: 'Seleccionar todo', keys: ['Ctrl+A'] },
  { group: 'Editar', id: 'holdMore', label: 'Alargar el fotograma (un cuadro más)', keys: ['+', '='] },
  { group: 'Editar', id: 'holdLess', label: 'Acortar el fotograma (un cuadro menos)', keys: ['-', '_'] },
  { group: 'Editar', id: 'note', label: 'Escribir una nota en el fotograma', keys: ['N'] },
  { group: 'Editar', id: 'undo', label: 'Deshacer', keys: ['Ctrl+Z'] },
  { group: 'Editar', id: 'redo', label: 'Rehacer', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { group: 'Editar', id: 'save', label: 'Guardar ahora', keys: ['Ctrl+S'] },
  { group: 'General', id: 'help', label: 'Ayuda y atajos', keys: ['?'] },
  { group: 'General', id: 'escape', label: 'Salir del modo actual (dibujo, reproducción…)', keys: ['Escape'] },
];

const NAMED = new Set(['Enter', 'Tab', 'Escape', 'Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown', 'Insert',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]);

/**
 * Normalised combo for a keyboard event. Letters are upper-case. Shift is
 * written for letters, digits and named keys only: for symbols such as "?"
 * the character already reflects it.
 */
export function comboOf(e) {
  let key = e.key;
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;
  if (key.length === 1) key = key.toUpperCase();
  const letterLike = /^[A-Z0-9]$/.test(key) || NAMED.has(key);
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && letterLike) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** Human-readable name of a combo for the help screen. */
export function comboLabel(combo) {
  const names = { ' ': 'Espacio', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Delete: 'Supr', Backspace: 'Retroceso', End: 'Fin', Home: 'Inicio', Escape: 'Esc', Enter: 'Intro', Tab: 'Tab' };
  return combo.split('+').map((p) => names[p] ?? p).join(' + ');
}

export class Keymap {
  /** @param {Record<string, string[]>} saved user changes, by action id */
  constructor(saved = {}) {
    this.keys = new Map(ACTIONS.map((a) => [a.id, [...(saved[a.id] ?? a.keys)]]));
    this.index();
  }

  index() {
    this.byCombo = new Map();
    for (const [id, keys] of this.keys) for (const k of keys) this.byCombo.set(k, id);
  }

  actionFor(combo) {
    return this.byCombo.get(combo) || null;
  }

  /**
   * Assigns `combo` as the only key of `id`. Returns the id of the action
   * that lost that key, if another one had it.
   */
  assign(id, combo) {
    const previous = this.byCombo.get(combo);
    if (previous && previous !== id) this.keys.set(previous, this.keys.get(previous).filter((k) => k !== combo));
    this.keys.set(id, [combo]);
    this.index();
    return previous && previous !== id ? previous : null;
  }

  reset() {
    for (const a of ACTIONS) this.keys.set(a.id, [...a.keys]);
    this.index();
  }

  /** Only the actions whose keys differ from the defaults. */
  changes() {
    const out = {};
    for (const a of ACTIONS) {
      const k = this.keys.get(a.id);
      if (k.join('|') !== a.keys.join('|')) out[a.id] = k;
    }
    return out;
  }
}
