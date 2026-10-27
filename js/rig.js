// Lights (DMX) and motion control in the editor: outputs (simulators, Art-Net,
// ENTTEC DMX USB Pro, MESORA-Moco over USB), editing of lights, looks, axes
// and keys, and getting the set ready before each photo. Nothing is sent to a
// device until the user picks an output and connects it.
import { levelsAt, dmxFrame, artnetPacket, enttecPacket } from './dmx.js';
import { positionsAt, toSteps, MocoHost, MocoSimulator, lineSplitter } from './moco.js';
import { uid, sleep } from './util.js';

const desktopRig = window.mesoraDesktop?.rig;
const EASE_LABELS = {
  linear: 'Constante', easeIn: 'Acelerar', easeOut: 'Frenar', easeInOut: 'Acelerar y frenar',
  easeInCubic: 'Acelerar fuerte', easeOutCubic: 'Frenar fuerte', easeInOutCubic: 'Acelerar y frenar fuerte',
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (sel) => document.querySelector(sel);

export const defaultLighting = () => ({ output: 'none', artnetHost: '255.255.255.255', universe: 0, settleMs: 300, lights: [], looks: [], keys: [] });
export const defaultMoco = () => ({ output: 'none', speed: 2000, accel: 4000, axes: [] });

/** A serial port as text lines (MESORA-Moco) or raw bytes (ENTTEC), with Web Serial. */
async function openSerial(baudRate) {
  if (!navigator.serial) throw new Error('Este navegador no puede usar dispositivos USB serie (usa la app de escritorio, Chrome o Edge)');
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate });
  const writer = port.writable.getWriter();
  let reader = null;
  return {
    port,
    write: (bytes) => writer.write(bytes),
    lines(onLine) {
      const feed = lineSplitter(onLine);
      const decoder = new TextDecoder();
      reader = port.readable.getReader();
      (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            feed(decoder.decode(value, { stream: true }));
          }
        } catch { /* port closed */ }
      })();
    },
    async close() {
      try { await reader?.cancel(); } catch { /* already closed */ }
      reader?.releaseLock();
      writer.releaseLock();
      await port.close().catch(() => {});
    },
  };
}

export class Rig {
  /**
   * @param {{ settings: () => object, save: () => void, toast: Function, nextExposure: () => number, onBusy: (text: string|null) => void }} opts
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.enttec = null;
    this.moco = null;          // { host, sim, serial }
    this.positions = [];       // motor steps last reported
    this.levels = {};          // light levels last sent
    this.sequence = 0;
    this.prepared = null;      // { exposure, promise }
    this.editLook = null;
  }

  get L() { return this.settings().lighting; }
  get M() { return this.settings().moco; }
  get lightsOn() { return this.L.output !== 'none' && this.L.lights.length > 0; }
  get mocoOn() { return this.M.output !== 'none' && this.M.axes.length > 0; }

  /** Lights, axes or keys changed: the next photo must prepare the set again. */
  invalidate() { this.prepared = null; }

  changed() {
    this.invalidate();
    this.save();
  }

  // ------------------------------------------------------------ lights

  async sendLevels(levels) {
    this.levels = levels;
    this.renderLightView();
    const L = this.L;
    const data = dmxFrame(L, levels);
    if (L.output === 'artnet') {
      if (!desktopRig) throw new Error('Art-Net solo está disponible en la app de escritorio');
      this.sequence = (this.sequence % 255) + 1;
      await desktopRig.artnet(L.artnetHost, artnetPacket(data, { universe: L.universe, sequence: this.sequence }));
    } else if (L.output === 'enttec') {
      if (!this.enttec) throw new Error('Conecta primero el ENTTEC DMX USB Pro');
      await this.enttec.write(enttecPacket(data));
    }
  }

  async connectDmx() {
    await this.enttec?.close();
    this.enttec = null;
    this.enttec = await openSerial(57600);
    this.status('#dmxStatus', 'ENTTEC DMX USB Pro conectado.');
  }

  // ------------------------------------------------------------ motion control

  async connectMoco() {
    await this.disconnectMoco();
    const M = this.M;
    let host, sim = null, serial = null;
    if (M.output === 'sim') {
      sim = new MocoSimulator({ axes: Math.max(1, M.axes.length) });
      sim.onMove = () => this.animateSim();
      host = new MocoHost(sim.transport());
    } else if (M.output === 'serial') {
      serial = await openSerial(115200);
      let listener = () => {};
      serial.lines((l) => listener(l));
      host = new MocoHost({ write: (line) => serial.write(new TextEncoder().encode(`${line}\n`)), onLine: (cb) => { listener = cb; }, close: () => serial.close() });
    } else {
      throw new Error('Elige un controlador');
    }
    try {
      const hello = await host.hello();
      if (hello.axes < M.axes.length) throw new Error(`El controlador tiene ${hello.axes} ejes y has definido ${M.axes.length}`);
      await host.setSpeed(M.speed, M.accel);
      this.positions = await host.position();
    } catch (err) {
      host.close();
      throw err;
    }
    this.moco = { host, sim, serial };
    this.status('#mocoStatus', M.output === 'sim' ? 'Simulador conectado: los movimientos tardan lo mismo que con motores, pero no se mueve nada.' : 'MESORA-Moco conectado.');
    this.renderAxisView();
  }

  async disconnectMoco() {
    this.moco?.host.close();
    this.moco = null;
  }

  async ensureMoco() {
    // The simulator connects by itself; a real controller only with «Conectar» (the port picker needs a click).
    const needsSim = this.M.output === 'sim' && (!this.moco?.sim || this.moco.sim.positions.length < this.M.axes.length);
    if (needsSim) await this.connectMoco();
    if (!this.moco || (this.M.output === 'serial' && !this.moco.serial)) throw new Error('Pulsa «Conectar» en Movimiento');
    if (this.positions.length < this.M.axes.length) throw new Error(`El controlador tiene ${this.positions.length} ejes y la escena usa ${this.M.axes.length}`);
    return this.moco.host;
  }

  /** Moves to absolute step positions (one per axis of the controller). */
  async moveSteps(steps) {
    const host = await this.ensureMoco();
    const target = this.positions.map((p, i) => (steps[i] ?? p));
    const far = Math.max(1, ...target.map((t, i) => Math.abs(t - (this.positions[i] || 0))));
    this.onBusy('Moviendo…');
    try {
      this.positions = await host.moveTo(target, 10000 + (far / Math.max(1, this.M.speed)) * 3000);
    } finally {
      this.onBusy(null);
      this.renderAxisView();
    }
  }

  stepsFor(exposure) {
    const pos = positionsAt(this.M, exposure);
    return this.M.axes.map((a) => toSteps(a, pos[a.id]));
  }

  async zero() {
    const host = await this.ensureMoco();
    await host.zero();
    this.positions = await host.position();
    this.renderAxisView();
  }

  // ------------------------------------------------------------ before each photo

  /** Gets lights and axes ready for an exposure (1-based). Resolves when the set is ready. */
  prepare(exposure) {
    if (!this.lightsOn && !this.mocoOn) return Promise.resolve();
    if (this.prepared?.exposure === exposure) return this.prepared.promise;
    const promise = (async () => {
      const t0 = performance.now();
      if (this.lightsOn) await this.sendLevels(levelsAt(this.L, exposure));
      if (this.mocoOn) await this.moveSteps(this.stepsFor(exposure));
      if (this.lightsOn) await sleep(Math.max(0, (this.L.settleMs || 0) - (performance.now() - t0)));
    })();
    this.prepared = { exposure, promise };
    promise.catch(() => { if (this.prepared?.promise === promise) this.prepared = null; });
    return promise;
  }

  // ------------------------------------------------------------ views

  status(sel, text, error = false) {
    const el = $(sel);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('error-text', error);
  }

  renderLightView() {
    const el = $('#lightView');
    if (!el) return;
    el.innerHTML = this.L.lights.map((l) => {
      const v = Math.round(this.levels[l.id] ?? 0);
      return `<div class="lamp" title="${esc(l.name)} · canal ${l.channel}"><span class="bulb" style="background:${esc(l.color)};opacity:${0.12 + 0.88 * (v / 100)};box-shadow:0 0 ${4 + v / 4}px ${esc(l.color)}"></span><span>${esc(l.name)}</span><b>${v} %</b></div>`;
    }).join('') || '<p class="muted small">Añade luces para verlas aquí.</p>';
  }

  animateSim() {
    // The simulator jumps at the end of each move; show the axes travelling meanwhile.
    clearInterval(this.simTimer);
    const sim = this.moco?.sim;
    if (!sim) return;
    this.simTimer = setInterval(() => {
      if (!sim.moving) { clearInterval(this.simTimer); this.renderAxisView(); return; }
      this.renderAxisView(true);
    }, 120);
  }

  renderAxisView(moving = false) {
    const el = $('#axisView');
    if (!el) return;
    el.innerHTML = this.M.axes.map((a, i) => {
      const steps = this.positions[i] ?? 0;
      const keys = a.keys.map((k) => k.position);
      const lo = Math.min(0, ...keys), hi = Math.max(1, ...keys);
      const pos = steps / (a.stepsPerUnit || 1);
      const pct = Math.max(0, Math.min(100, ((pos - lo) / (hi - lo || 1)) * 100));
      return `<div class="axis-bar${moving ? ' moving' : ''}"><span>${esc(a.name)}</span><div class="track"><i style="left:${pct}%"></i></div><b>${pos.toFixed(1)} ${esc(a.unit)}</b></div>`;
    }).join('') || '<p class="muted small">Añade ejes para verlos aquí.</p>';
  }

  // ------------------------------------------------------------ editing: lights and looks

  renderLights() {
    const L = this.L;
    $('#lightList').innerHTML = L.lights.map((l) => `
      <li data-id="${l.id}">
        <input type="color" data-f="color" value="${esc(l.color)}" aria-label="Color de ${esc(l.name)}">
        <input data-f="name" value="${esc(l.name)}" aria-label="Nombre de la luz" class="grow">
        <label>Canal <input type="number" data-f="channel" min="1" max="512" value="${l.channel}"></label>
        <button class="btn small ghost" data-act="remove" title="Quitar la luz">×</button>
      </li>`).join('');
    if (!L.looks.some((k) => k.id === this.editLook)) this.editLook = L.looks[0]?.id || null;
    $('#lookSelect').innerHTML = L.looks.map((k) => `<option value="${k.id}">${esc(k.name)}</option>`).join('');
    $('#lookSelect').value = this.editLook || '';
    $('#btnRenameLook').disabled = !this.editLook;
    const look = L.looks.find((k) => k.id === this.editLook);
    $('#lookSliders').innerHTML = look ? L.lights.map((l) => `
      <label class="look-row" data-id="${l.id}"><span>${esc(l.name)}</span>
        <input type="range" min="0" max="100" step="1" value="${look.levels[l.id] ?? 0}"><b>${look.levels[l.id] ?? 0} %</b></label>`).join('')
      : '<p class="muted small">Crea un look: una combinación de niveles de tus luces (día, noche, tormenta…).</p>';
    $('#lightKeys').innerHTML = [...L.keys].sort((a, b) => a.exposure - b.exposure).map((k) => `
      <li data-id="${k.id}">
        <label>Exp. <input type="number" data-f="exposure" min="1" value="${k.exposure}"></label>
        <select data-f="lookId" class="grow">${L.looks.map((o) => `<option value="${o.id}"${o.id === k.lookId ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select>
        <button class="btn small ghost" data-act="remove" title="Quitar la clave">×</button>
        <span class="break"></span>
        <label class="check" title="Pasar poco a poco desde la clave anterior"><input type="checkbox" data-f="fade"${k.fade ? ' checked' : ''}> Fundido desde la clave anterior</label>
      </li>`).join('') || '<li class="muted small">Sin claves: añade una para fijar el look desde una exposición.</li>';
    $('#btnAddLightKey').disabled = !L.looks.length;
    this.renderLightView();
    this.updateOutputUI();
  }

  updateOutputUI() {
    const out = this.L.output;
    $('#artnetFields').hidden = out !== 'artnet';
    $('#enttecRow').hidden = out !== 'enttec';
    if (out === 'none') this.status('#dmxStatus', 'Las luces no se controlan. Elige «Simulador» para probar sin aparatos.');
    else if (out === 'sim') this.status('#dmxStatus', 'Simulador: verás los niveles arriba; no se envía nada a ningún aparato.');
    else if (out === 'artnet') this.status('#dmxStatus', `Art-Net al ${this.L.artnetHost}, universo ${this.L.universe}, puerto 6454.`);
    else if (!this.enttec) this.status('#dmxStatus', 'Pulsa «Conectar» y elige el ENTTEC DMX USB Pro.');
    const mo = this.M.output;
    $('#mocoConnectRow').hidden = mo === 'none';
    if (mo === 'none') this.status('#mocoStatus', 'Los motores no se controlan. Elige «Simulador» para probar sin motores.');
    else if (!this.moco) this.status('#mocoStatus', mo === 'sim' ? 'Pulsa «Conectar» para usar el simulador.' : 'Conecta el Arduino con el firmware MESORA-Moco (carpeta firmware/) y pulsa «Conectar».');
  }

  addLight() {
    const L = this.L;
    const used = new Set(L.lights.map((l) => l.channel));
    let channel = 1;
    while (used.has(channel)) channel++;
    const colors = ['#ffd27a', '#9cc8ff', '#ff9a8a', '#b6f0a0', '#f0b6ff'];
    L.lights.push({ id: uid(), name: `Luz ${L.lights.length + 1}`, channel, color: colors[L.lights.length % colors.length] });
    this.changed();
    this.renderLights();
  }

  addLook(name) {
    const L = this.L;
    const base = L.looks.find((k) => k.id === this.editLook);
    const look = { id: uid(), name, levels: base ? { ...base.levels } : Object.fromEntries(L.lights.map((l) => [l.id, 100])) };
    L.looks.push(look);
    this.editLook = look.id;
    this.changed();
    this.renderLights();
  }

  addLightKey() {
    const L = this.L;
    const exposure = this.nextExposure();
    L.keys = L.keys.filter((k) => k.exposure !== exposure);
    L.keys.push({ id: uid(), exposure, lookId: this.editLook || L.looks[0]?.id, fade: false });
    this.changed();
    this.renderLights();
  }

  onLightsInput(e) {
    const L = this.L;
    const li = e.target.closest('li[data-id], .look-row[data-id]');
    if (!li) return;
    if (li.classList.contains('look-row')) {
      const look = L.looks.find((k) => k.id === this.editLook);
      if (!look) return;
      look.levels[li.dataset.id] = Number(e.target.value);
      li.querySelector('b').textContent = `${e.target.value} %`;
      this.changed();
      if ($('#lookLive').checked && L.output !== 'none') this.sendLevels({ ...look.levels }).catch((err) => this.status('#dmxStatus', err.message, true));
      return;
    }
    const list = e.currentTarget.id === 'lightKeys' ? L.keys : L.lights;
    const item = list.find((x) => x.id === li.dataset.id);
    const f = e.target.dataset.f;
    // Text and colour apply while typing; numbers, lists and boxes when they change.
    if (!item || !f || (e.type === 'input' && f !== 'name' && f !== 'color')) return;
    if (f === 'fade') item.fade = e.target.checked;
    else if (f === 'channel') item.channel = Math.max(1, Math.min(512, Math.round(Number(e.target.value) || 1)));
    else if (f === 'exposure') item.exposure = Math.max(1, Math.round(Number(e.target.value) || 1));
    else item[f] = e.target.value;
    this.changed();
    if (f !== 'name' && f !== 'color') this.renderLights();
    else this.renderLightView();
  }

  onListClick(e, list, render) {
    const btn = e.target.closest('[data-act="remove"]');
    const li = e.target.closest('li[data-id]');
    if (!btn || !li) return;
    const i = list().findIndex((x) => x.id === li.dataset.id);
    if (i >= 0) list().splice(i, 1);
    this.changed();
    render();
  }

  // ------------------------------------------------------------ editing: axes and keys

  renderAxes() {
    const M = this.M;
    $('#axisList').innerHTML = M.axes.map((a) => `
      <li data-id="${a.id}">
        <input data-f="name" value="${esc(a.name)}" class="grow" aria-label="Nombre del eje">
        <input data-f="unit" value="${esc(a.unit)}" class="unit" aria-label="Unidad" title="Unidad (mm, grados…)">
        <button class="btn small ghost" data-act="remove" title="Quitar el eje">×</button>
        <span class="break"></span>
        <label title="Pasos del motor por unidad (por ejemplo 80 pasos por mm)">Pasos/u <input type="number" data-f="stepsPerUnit" min="0.001" step="any" value="${a.stepsPerUnit}"></label>
        <label title="Mover este eje ahora a una posición">Ir a <input type="number" data-go step="any" value="0"></label>
        <button class="btn small" data-act="go">Ir</button>
      </li>`).join('');
    const keys = M.axes.flatMap((a) => a.keys.map((k) => ({ a, k }))).sort((x, y) => x.k.exposure - y.k.exposure);
    $('#axisKeys').innerHTML = keys.map(({ a, k }) => `
      <li data-id="${k.id}" data-axis="${a.id}">
        <span class="axis-name grow">${esc(a.name)}</span>
        <label>Exp. <input type="number" data-f="exposure" min="1" value="${k.exposure}"></label>
        <button class="btn small ghost" data-act="remove" title="Quitar la clave">×</button>
        <span class="break"></span>
        <label><input type="number" data-f="position" step="any" value="${k.position}"> ${esc(a.unit)}</label>
        <select data-f="ease" class="grow" title="Cómo llega hasta esta posición desde la clave anterior">${Object.entries(EASE_LABELS).map(([v, t]) => `<option value="${v}"${v === (k.ease || 'linear') ? ' selected' : ''}>${t}</option>`).join('')}</select>
      </li>`).join('') || '<li class="muted small">Sin claves: mueve un eje a su posición y añade una clave.</li>';
    $('#btnAddAxisKey').disabled = !M.axes.length;
    this.renderAxisView();
    this.drawMocoChart();
    this.updateOutputUI();
  }

  addAxis() {
    const M = this.M;
    const names = ['Carro', 'Panorámica', 'Inclinación', 'Foco'];
    M.axes.push({ id: uid(), name: names[M.axes.length] || `Eje ${M.axes.length + 1}`, unit: M.axes.length === 0 ? 'mm' : 'grados', stepsPerUnit: M.axes.length === 0 ? 80 : 10, keys: [] });
    this.disconnectMoco();
    this.changed();
    this.renderAxes();
  }

  /** A key for every axis at the next exposure, at the position where each axis is now. */
  addAxisKeys() {
    const exposure = this.nextExposure();
    this.M.axes.forEach((a, i) => {
      a.keys = a.keys.filter((k) => k.exposure !== exposure);
      a.keys.push({ id: uid(), exposure, position: Number(((this.positions[i] ?? 0) / (a.stepsPerUnit || 1)).toFixed(3)), ease: 'easeInOut' });
    });
    this.changed();
    this.renderAxes();
  }

  async jog(axisId, value) {
    const i = this.M.axes.findIndex((a) => a.id === axisId);
    if (i < 0) return;
    const steps = [...this.positions];
    steps[i] = toSteps(this.M.axes[i], value);
    this.invalidate();
    await this.moveSteps(steps);
  }

  onAxesInput(e) {
    const li = e.target.closest('li[data-id]');
    const f = e.target.dataset.f;
    if (!li || !f) return;
    const M = this.M;
    const item = e.currentTarget.id === 'axisKeys'
      ? M.axes.find((a) => a.id === li.dataset.axis)?.keys.find((k) => k.id === li.dataset.id)
      : M.axes.find((a) => a.id === li.dataset.id);
    if (!item) return;
    if (['stepsPerUnit', 'position'].includes(f)) item[f] = Number(e.target.value) || 0;
    else if (f === 'exposure') item.exposure = Math.max(1, Math.round(Number(e.target.value) || 1));
    else item[f] = e.target.value;
    this.changed();
    if (e.type === 'change' && e.currentTarget.id === 'axisKeys') this.renderAxes();
    else { this.renderAxisView(); this.drawMocoChart(); }
  }

  onAxesClick(e) {
    const btn = e.target.closest('[data-act]');
    const li = e.target.closest('li[data-id]');
    if (!btn || !li) return;
    const M = this.M;
    if (btn.dataset.act === 'go') {
      this.jog(li.dataset.id, Number(li.querySelector('[data-go]').value) || 0).catch((err) => this.status('#mocoStatus', err.message, true));
      return;
    }
    if (e.currentTarget.id === 'axisKeys') {
      const a = M.axes.find((x) => x.id === li.dataset.axis);
      if (a) a.keys = a.keys.filter((k) => k.id !== li.dataset.id);
    } else {
      M.axes = M.axes.filter((a) => a.id !== li.dataset.id);
      this.disconnectMoco();
    }
    this.changed();
    this.renderAxes();
  }

  /** Path of every axis over the exposures with keys, to see the easing before shooting. */
  drawMocoChart() {
    const c = $('#mocoChart');
    if (!c) return;
    const M = this.M;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const last = Math.max(2, ...M.axes.flatMap((a) => a.keys.map((k) => k.exposure)));
    const colors = ['#ffb020', '#4cc3ff', '#c08cff', '#5ee08a'];
    M.axes.forEach((a, i) => {
      if (!a.keys.length) return;
      const ps = a.keys.map((k) => k.position);
      const lo = Math.min(...ps), hi = Math.max(...ps);
      ctx.strokeStyle = colors[i % colors.length];
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let e = 1; e <= last; e++) {
        const v = positionsAt({ axes: [a] }, e)[a.id];
        const x = 4 + ((e - 1) / (last - 1)) * (c.width - 8);
        const y = c.height - 6 - ((v - lo) / (hi - lo || 1)) * (c.height - 12);
        if (e === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }

  render() {
    this.renderLights();
    this.renderAxes();
  }
}

