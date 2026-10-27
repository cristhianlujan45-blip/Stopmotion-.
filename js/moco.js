// Motion control: axes (slider, pan, tilt, focus…) with key positions at
// exposures and an easing between keys. Before each photo MESORA moves every
// axis to its position for the exposure being shot and waits until it stops
// (move · shoot · move).
//
// MESORA-Moco protocol (text lines ending in \n, 115200 baud). Host → device:
//   hi                      → MESORA-MOCO <version> axes=<n>
//   go <s1> <s2> … <sn>     → ok go, then done <s1> … <sn> when every axis has stopped
//   pos                     → pos <s1> … <sn>
//   zero                    → ok zero            (current position becomes 0 on every axis)
//   spd <steps/s> <steps/s²>→ ok spd
//   stop                    → ok stop, then done <s1> … <sn>
// Anything else → err <message>. Positions are absolute, in motor steps.
import { EASINGS } from './timing.js';

/** Position (in the axis' units) of every axis at an exposure (1-based). */
export function positionsAt(moco, exposure) {
  const out = {};
  for (const axis of moco.axes || []) {
    const keys = [...(axis.keys || [])].sort((a, b) => a.exposure - b.exposure);
    if (!keys.length) { out[axis.id] = 0; continue; }
    let i = keys.findIndex((k) => k.exposure > exposure);
    if (i === -1) i = keys.length;
    const prev = keys[i - 1], next = keys[i];
    if (!prev) out[axis.id] = next.position;
    else if (!next) out[axis.id] = prev.position;
    else {
      const t = (exposure - prev.exposure) / (next.exposure - prev.exposure);
      out[axis.id] = prev.position + (next.position - prev.position) * (EASINGS[next.ease] || EASINGS.linear)(t);
    }
  }
  return out;
}

export const toSteps = (axis, position) => Math.round(position * (axis.stepsPerUnit || 1));

/** Talks MESORA-Moco over a line transport: { write(line), onLine(cb), close() }. */
export class MocoHost {
  constructor(transport) {
    this.transport = transport;
    this.waiters = [];
    transport.onLine((line) => this.onLine(line.trim()));
  }

  onLine(line) {
    if (!line) return;
    const i = this.waiters.findIndex((w) => w.match(line));
    if (i >= 0) {
      const [w] = this.waiters.splice(i, 1);
      clearTimeout(w.timer);
      if (line.startsWith('err')) w.reject(new Error(`El controlador respondió: ${line.slice(4)}`));
      else w.resolve(line);
    }
  }

  expect(match, timeoutMs, what) {
    const w = { match: (l) => match(l) || l.startsWith('err') };
    w.promise = new Promise((resolve, reject) => {
      Object.assign(w, { resolve, reject });
      w.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        reject(new Error(`El controlador no respondió a tiempo (${what})`));
      }, timeoutMs);
    });
    this.waiters.push(w);
    return w.promise;
  }

  async hello() {
    const reply = this.expect((l) => l.startsWith('MESORA-MOCO'), 3000, 'hi');
    this.transport.write('hi');
    const line = await reply;
    this.axes = Number(/axes=(\d+)/.exec(line)?.[1]) || 0;
    return { version: line.split(' ')[1], axes: this.axes };
  }

  async setSpeed(stepsPerSecond, accel) {
    const reply = this.expect((l) => l === 'ok spd', 2000, 'spd');
    this.transport.write(`spd ${Math.round(stepsPerSecond)} ${Math.round(accel)}`);
    await reply;
  }

  /** Moves every axis to absolute step positions and resolves when they have stopped. */
  async moveTo(steps, timeoutMs = 60000) {
    // Both answers are awaited from the start: they can arrive in the same piece of serial data.
    const ok = this.expect((l) => l === 'ok go', 2000, 'go');
    const done = this.expect((l) => l.startsWith('done'), timeoutMs, 'movimiento');
    done.catch(() => {});
    this.transport.write(`go ${steps.map((s) => Math.round(s)).join(' ')}`);
    try {
      await ok;
    } catch (err) {
      this.cancel(done);
      throw err;
    }
    const line = await done;
    return line.split(' ').slice(1).map(Number);
  }

  cancel(promise) {
    const w = this.waiters.find((x) => x.promise === promise);
    if (!w) return;
    clearTimeout(w.timer);
    this.waiters.splice(this.waiters.indexOf(w), 1);
  }

  async position() {
    const reply = this.expect((l) => l.startsWith('pos'), 2000, 'pos');
    this.transport.write('pos');
    return (await reply).split(' ').slice(1).map(Number);
  }

  async zero() {
    const reply = this.expect((l) => l === 'ok zero', 2000, 'zero');
    this.transport.write('zero');
    await reply;
  }

  stop() { this.transport.write('stop'); }
  close() { for (const w of this.waiters) { clearTimeout(w.timer); w.reject(new Error('Desconectado')); } this.waiters = []; this.transport.close?.(); }
}

/**
 * A MESORA-Moco controller in software, with the same answers as the
 * firmware. Moves take the time they would take at the set speed (or
 * `timeScale` times that, to keep tests fast).
 */
export class MocoSimulator {
  constructor({ axes = 3, timeScale = 1 } = {}) {
    this.positions = new Array(axes).fill(0);
    this.speed = 2000;
    this.timeScale = timeScale;
    this.listener = () => {};
    this.moving = null;
    this.onMove = () => {};
  }

  /** Line transport for MocoHost, as if a cable were plugged in. */
  transport() {
    return {
      write: (line) => setTimeout(() => this.receive(line), 1),
      onLine: (cb) => { this.listener = cb; },
      close: () => { clearTimeout(this.moving); },
    };
  }

  send(line) { setTimeout(() => this.listener(line), 1); }

  receive(raw) {
    const [cmd, ...args] = raw.trim().split(/\s+/);
    const n = this.positions.length;
    if (cmd === 'hi') this.send(`MESORA-MOCO 1 axes=${n}`);
    else if (cmd === 'pos') this.send(`pos ${this.positions.join(' ')}`);
    else if (cmd === 'zero') { this.positions.fill(0); this.send('ok zero'); }
    else if (cmd === 'spd' && args.length === 2) { this.speed = Math.max(1, Number(args[0])); this.send('ok spd'); }
    else if (cmd === 'stop') { clearTimeout(this.moving); this.moving = null; this.send('ok stop'); this.send(`done ${this.positions.join(' ')}`); }
    else if (cmd === 'go' && args.length === n && args.every((a) => /^-?\d+$/.test(a))) {
      const target = args.map(Number);
      const far = Math.max(...target.map((t, i) => Math.abs(t - this.positions[i])));
      this.send('ok go');
      clearTimeout(this.moving);
      this.onMove(target);
      this.moving = setTimeout(() => {
        this.positions = target;
        this.moving = null;
        this.send(`done ${this.positions.join(' ')}`);
      }, (far / this.speed) * 1000 * this.timeScale);
    } else this.send(`err orden no válida: ${raw.trim()}`);
  }
}

/** Splits a stream of text into lines (for serial ports). */
export function lineSplitter(onLine) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, i).replace(/\r$/, ''));
      buffer = buffer.slice(i + 1);
    }
  };
}
