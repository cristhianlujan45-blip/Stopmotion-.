// Exposure sheet (X-Sheet): one row per exposure (one picture of the film),
// like a paper dope sheet. Planning columns (action, dialogue, phoneme,
// camera, light) belong to the time, i.e. the exposure number, so inserting or
// deleting frames never shifts the dialogue. Notes belong to the frame.
import { formatTime } from './timing.js';

export const XS_COLUMNS = [
  { key: 'action', label: 'Acción', hint: 'Qué hace el personaje' },
  { key: 'dialog', label: 'Diálogo', hint: 'Texto o sílaba que se oye' },
  { key: 'phoneme', label: 'Fonema', hint: 'Boca: A, E, O, M, F…' },
  { key: 'camera', label: 'Cámara', hint: 'Movimiento o ajuste de cámara' },
  { key: 'light', label: 'Luz', hint: 'Cambio de iluminación' },
];
const ROW_H = 28;
const OVERSCAN = 12;

/**
 * Rows of the sheet: shot exposures, the next one to shoot and the planned
 * scene length. Each row: { exposure (1-based), frameIndex (-1 if not shot),
 * first (first exposure of its frame), hold, note }.
 */
export function xsheetRows(frames, plan = {}, length = 48) {
  const rows = [];
  frames.forEach((f, i) => {
    for (let k = 0; k < (f.hold || 1); k++) {
      rows.push({ exposure: rows.length + 1, frameIndex: i, first: k === 0, hold: f.hold || 1, note: k === 0 ? f.note || '' : '' });
    }
  });
  const planned = Object.keys(plan).map(Number).filter((n) => n > 0);
  const total = Math.max(rows.length + 1, length, ...planned);
  while (rows.length < total) rows.push({ exposure: rows.length + 1, frameIndex: -1, first: false, hold: 0, note: '' });
  return rows;
}

const csvCell = (v) => (/[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** The whole sheet as CSV (opens in Excel, Numbers, LibreOffice or Google Sheets). */
export function xsheetToCSV(frames, plan, length, fps) {
  const head = ['Exposición', 'Tiempo', 'Fotograma', ...XS_COLUMNS.map((c) => c.label), 'Notas'];
  const lines = [head.join(',')];
  for (const r of xsheetRows(frames, plan, length)) {
    const p = plan[r.exposure] || {};
    lines.push([
      r.exposure, formatTime(r.exposure - 1, fps), r.first ? r.frameIndex + 1 : '',
      ...XS_COLUMNS.map((c) => p[c.key] || ''), r.note,
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/** Minimal CSV parser (quotes, commas or semicolons, CRLF). */
function parseCSV(text) {
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * Planning columns read from a CSV with the same headers (e.g. one exported
 * before, or prepared in a spreadsheet). Returns a plan: { exposure: { action, … } }.
 */
export function xsheetFromCSV(text) {
  const [head, ...rows] = parseCSV(text.replace(/^﻿/, ''));
  if (!head) return {};
  const norm = (s) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const col = (label) => head.findIndex((h) => norm(h) === norm(label));
  const expCol = col('Exposición');
  const plan = {};
  rows.forEach((r, i) => {
    const exposure = expCol >= 0 ? Number(r[expCol]) : i + 1;
    if (!(exposure > 0)) return;
    const entry = {};
    for (const c of XS_COLUMNS) {
      const j = col(c.label);
      if (j >= 0 && r[j]?.trim()) entry[c.key] = r[j].trim();
    }
    if (Object.keys(entry).length) plan[exposure] = entry;
  });
  return plan;
}

/** Printable HTML table of the whole sheet. */
export function xsheetTableHTML(frames, plan, length, fps, header) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rows = xsheetRows(frames, plan, length).map((r) => {
    const p = plan[r.exposure] || {};
    return `<tr class="${r.frameIndex < 0 ? 'todo' : ''}"><td>${r.exposure}</td><td>${formatTime(r.exposure - 1, fps)}</td><td>${r.first ? r.frameIndex + 1 : r.frameIndex >= 0 ? '│' : ''}</td>${
      XS_COLUMNS.map((c) => `<td>${esc(p[c.key])}</td>`).join('')}<td>${esc(r.note)}</td></tr>`;
  }).join('');
  return `<h1>${esc(header.title)}</h1><p>${esc(header.subtitle)}</p>
    <table><thead><tr><th>Exp.</th><th>Tiempo</th><th>Fot.</th>${XS_COLUMNS.map((c) => `<th>${c.label}</th>`).join('')}<th>Notas</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** Scrollable sheet that only builds the rows in view, so long takes stay fast. */
export class XSheetView {
  constructor({ root, onSelect, onPlan, onNote }) {
    Object.assign(this, { root, onSelect, onPlan, onNote });
    root.classList.add('xsheet');
    root.innerHTML = `
      <div class="xs-head"><span title="Número de exposición (cuadro de la película)">Exp.</span><span title="Segundos:cuadro">Tiempo</span><span title="Fotograma capturado">Fot.</span>${XS_COLUMNS.map((c) => `<span title="${c.hint}">${c.label}</span>`).join('')}<span>Notas</span></div>
      <div class="xs-body"><div class="xs-spacer"></div><div class="xs-rows"></div></div>`;
    this.body = root.querySelector('.xs-body');
    this.spacer = root.querySelector('.xs-spacer');
    this.rowsEl = root.querySelector('.xs-rows');
    this.rows = [];
    this.range = [-1, -1];
    this.body.addEventListener('scroll', () => this.paint());
    new ResizeObserver(() => this.paint(true)).observe(this.body);
    // Planning text is saved as it is typed; a frame note is one undoable change when the cell is left.
    this.rowsEl.addEventListener('input', (e) => {
      const input = e.target.closest('input');
      if (!input || input.dataset.key === 'note') return;
      this.onPlan(Number(input.closest('.xs-row').dataset.exposure), input.dataset.key, input.value);
    });
    this.rowsEl.addEventListener('change', (e) => {
      const input = e.target.closest('input[data-key="note"]');
      if (input) this.onNote(Number(input.closest('.xs-row').dataset.frame), input.value);
    });
    this.rowsEl.addEventListener('focusout', () => {
      if (!this.deferred) return;
      this.deferred = false;
      setTimeout(() => { if (!this.rowsEl.contains(document.activeElement)) this.paint(true); });
    });
    this.rowsEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Escape') e.target.blur?.();
      e.stopPropagation(); // typing in the sheet never triggers shortcuts
    });
    this.rowsEl.addEventListener('click', (e) => {
      if (e.target.closest('input')) return;
      const row = e.target.closest('.xs-row');
      if (row) this.onSelect(Number(row.dataset.frame));
    });
  }

  /** @param {{ frames, plan, length, fps, current }} data — current: frame index shown, or -1 for live */
  update(data) {
    this.data = data;
    this.rows = xsheetRows(data.frames, data.plan, data.length);
    this.spacer.style.height = `${this.rows.length * ROW_H}px`;
    this.paint(true);
  }

  paint(force = false) {
    if (!this.data) return;
    const top = this.body.scrollTop;
    const start = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    const end = Math.min(this.rows.length, Math.ceil((top + this.body.clientHeight) / ROW_H) + OVERSCAN);
    if (!force && start === this.range[0] && end === this.range[1]) return;
    // Never rebuild under the cell being typed in; catch up when the user leaves it.
    if (this.rowsEl.contains(document.activeElement)) { this.deferred = true; return; }
    this.range = [start, end];
    const { plan, fps, current } = this.data;
    const next = this.rows.findIndex((r) => r.frameIndex < 0);
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let html = '';
    for (let i = start; i < end; i++) {
      const r = this.rows[i];
      const p = plan[r.exposure] || {};
      const cls = ['xs-row', r.frameIndex >= 0 ? 'shot' : 'todo', i === next ? 'next' : '', r.frameIndex >= 0 && r.frameIndex === current ? 'current' : '', r.first ? 'first' : ''].join(' ');
      const frameCell = r.first ? r.frameIndex + 1 : r.frameIndex >= 0 ? '│' : i === next ? '●' : '';
      html += `<div class="${cls}" data-exposure="${r.exposure}" data-frame="${r.frameIndex}" style="top:${i * ROW_H}px">
        <span class="mono">${r.exposure}</span><span class="mono muted">${formatTime(r.exposure - 1, fps).slice(3)}</span><span class="mono fr">${frameCell}</span>${
        XS_COLUMNS.map((c) => `<input data-key="${c.key}" value="${esc(p[c.key])}" spellcheck="false" aria-label="${c.label}, exposición ${r.exposure}">`).join('')}${
        r.first ? `<input data-key="note" value="${esc(r.note)}" maxlength="80" aria-label="Nota del fotograma ${r.frameIndex + 1}">` : '<span></span>'}</div>`;
    }
    this.rowsEl.innerHTML = html;
  }

  /** Moves the highlight to another frame (-1: live) without rebuilding the sheet. */
  setCurrent(frameIndex) {
    if (!this.data || this.data.current === frameIndex) return;
    this.data.current = frameIndex;
    this.reveal(frameIndex);
    this.paint(true);
  }

  /** Scrolls so that the row of `frameIndex` (or the next one to shoot) is visible. */
  reveal(frameIndex) {
    if (!this.rows.length) return;
    let i = frameIndex >= 0 ? this.rows.findIndex((r) => r.frameIndex === frameIndex) : this.rows.findIndex((r) => r.frameIndex < 0);
    if (i < 0) i = 0;
    const y = i * ROW_H;
    if (y < this.body.scrollTop || y + ROW_H > this.body.scrollTop + this.body.clientHeight) {
      this.body.scrollTop = Math.max(0, y - this.body.clientHeight / 3);
    }
    this.paint();
  }
}
