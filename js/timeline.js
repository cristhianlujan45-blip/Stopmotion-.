/**
 * Horizontal exposure-sheet timeline: one cell per frame whose width is
 * proportional to its exposures, so the waveform below lines up in time.
 */
export class Timeline {
  constructor({ wrap, root, wave, store, onSelect, onLive, onMove }) {
    this.wrap = wrap;
    this.root = root;
    this.wave = wave;
    this.store = store;
    this.onSelect = onSelect;
    this.onLive = onLive;
    this.onMove = onMove;
    this.cells = new Map();
    this.frames = [];
    this.zoom = 72;
    this.dragging = false;
    this.dropTarget = null;
    this.dropEl = null;
    this.lastCurrent = null;

    this.liveCell = document.createElement('div');
    this.liveCell.className = 'cell live';
    this.liveCell.innerHTML = '<div class="inner"><svg class="ic"><use href="#i-camera"/></svg>EN VIVO</div>';

    root.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      if (cell === this.liveCell) this.onLive();
      else this.onSelect(Number(cell.dataset.index), e);
    });

    root.addEventListener('dragstart', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || cell === this.liveCell) { e.preventDefault(); return; }
      this.dragging = true;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-mesora-frames', cell.dataset.index);
      this.onSelect(Number(cell.dataset.index), { dragStart: true });
      requestAnimationFrame(() => {
        for (const el of this.root.querySelectorAll('.cell.selected')) el.classList.add('dragging');
      });
    });
    root.addEventListener('dragover', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const cell = e.target.closest('.cell');
      if (!cell) return;
      let target, cls;
      if (cell === this.liveCell) { target = this.frames.length; cls = 'drop-before'; }
      else {
        const r = cell.getBoundingClientRect();
        const after = e.clientX > r.left + r.width / 2;
        target = Number(cell.dataset.index) + (after ? 1 : 0);
        cls = after ? 'drop-after' : 'drop-before';
      }
      this.setDrop(cell, cls, target);
    });
    root.addEventListener('drop', (e) => {
      if (!this.dragging) return;
      e.preventDefault();
      e.stopPropagation();
      const target = this.dropTarget;
      this.endDrag();
      if (target != null) this.onMove(target);
    });
    root.addEventListener('dragend', () => this.endDrag());
  }

  setDrop(el, cls, target) {
    if (this.dropEl && (this.dropEl !== el || !this.dropEl.classList.contains(cls))) {
      this.dropEl.classList.remove('drop-before', 'drop-after');
    }
    el.classList.add(cls);
    this.dropEl = el;
    this.dropTarget = target;
  }

  endDrag() {
    this.dragging = false;
    this.dropEl?.classList.remove('drop-before', 'drop-after');
    this.dropEl = null;
    this.dropTarget = null;
    for (const el of this.root.querySelectorAll('.dragging')) el.classList.remove('dragging');
  }

  createCell(f) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.draggable = true;
    el.innerHTML = '<div class="inner"><img alt="" draggable="false"><div class="meta"><span class="num"></span><span class="hold"></span></div></div>';
    const img = el.querySelector('img');
    this.store.thumbUrl(f.id).then((url) => { if (url) img.src = url; });
    this.cells.set(f.key, el);
    return el;
  }

  render(frames, zoom) {
    this.frames = frames;
    this.zoom = zoom;
    const keys = new Set();
    let i = 0;
    for (const f of frames) {
      keys.add(f.key);
      const el = this.cells.get(f.key) || this.createCell(f);
      el.dataset.index = i;
      el.style.width = `${zoom * f.hold}px`;
      el.querySelector('.num').textContent = i + 1;
      el.querySelector('.hold').textContent = `×${f.hold}`;
      el.classList.toggle('hold-1', f.hold === 1);
      if (this.root.children[i] !== el) this.root.insertBefore(el, this.root.children[i] || null);
      i++;
    }
    for (const [key, el] of this.cells) {
      if (!keys.has(key)) { el.remove(); this.cells.delete(key); }
    }
    this.liveCell.style.width = `${Math.max(zoom, 76)}px`;
    if (this.root.lastElementChild !== this.liveCell) this.root.appendChild(this.liveCell);
    this.lastCurrent = null;
  }

  update({ playhead, selection, playingIndex = -1 }) {
    const frames = this.frames;
    let current = null;
    for (let i = 0; i < frames.length; i++) {
      const el = this.cells.get(frames[i].key);
      if (!el) continue;
      const isCurrent = playingIndex >= 0 ? i === playingIndex : i === playhead;
      el.classList.toggle('selected', selection.has(frames[i].key));
      el.classList.toggle('current', isCurrent && playingIndex < 0);
      el.classList.toggle('playing', isCurrent && playingIndex >= 0);
      if (isCurrent) current = el;
    }
    const liveCurrent = playingIndex < 0 && playhead >= frames.length;
    this.liveCell.classList.toggle('current', liveCurrent);
    if (liveCurrent) current = this.liveCell;
    if (current && current !== this.lastCurrent) this.scrollIntoView(current);
    this.lastCurrent = current;
  }

  scrollIntoView(el) {
    const wrap = this.wrap;
    const left = el.offsetLeft - this.root.offsetLeft;
    const right = left + el.offsetWidth;
    const pad = 40;
    if (left < wrap.scrollLeft + pad) wrap.scrollLeft = Math.max(0, left - pad);
    else if (right > wrap.scrollLeft + wrap.clientWidth - pad) wrap.scrollLeft = right - wrap.clientWidth + pad;
  }

  drawWave(audio, fps, offset, totalExposures) {
    if (!audio?.ready) { this.wave.hidden = true; return; }
    this.wave.hidden = false;
    const exposuresShown = Math.max(totalExposures, offset + Math.ceil(audio.duration * fps));
    const cssWidth = Math.max(this.root.scrollWidth, exposuresShown * this.zoom + Math.max(this.zoom, 76));
    audio.drawWaveform(this.wave, this.zoom, fps, offset, cssWidth);
  }
}
