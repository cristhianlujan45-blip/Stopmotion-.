// Watches the folder where the camera's own tethering software (EOS Utility,
// NX Tether, Imaging Edge, X Acquire, Capture One…) saves each photo, and
// reports every new photo once it is completely written. Files that share a
// name (IMG_0001.CR3 + IMG_0001.JPG) arrive together as one capture.
// Polling is used instead of fs.watch because it behaves the same on every
// system, external drive and network share.
const fsp = require('node:fs/promises');
const path = require('node:path');
const { isRaw, isDisplayable } = require('./rawpreview.cjs');

const IGNORED = /^[.~]|\.(tmp|part|partial|crdownload|download)$/i;
const MAX_DEPTH = 2; // some programs create one subfolder per day

class FolderWatcher {
  /**
   * @param {string} dir
   * @param {{ onCapture: (files: {path: string, name: string}[]) => void, onError?: (err: Error) => void,
   *           pollMs?: number, settleMs?: number, pairMs?: number }} opts
   */
  constructor(dir, { onCapture, onError = () => {}, pollMs = 400, settleMs = 900, quietMs = 700, pairMs = 2500 }) {
    Object.assign(this, { dir, onCapture, onError, pollMs, settleMs, quietMs, pairMs });
    this.seen = new Map();     // path → { size, since, done }
    this.pending = new Map();  // folder/stem → { files: Map(path → name), firstAt }
    this.timer = null;
    this.busy = false;
  }

  async start() {
    await fsp.access(this.dir);
    // Photos already in the folder are not new captures.
    for (const f of await this.list()) this.seen.set(f.path, { size: f.size, since: 0, done: true });
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  async list(dir = this.dir, depth = 0) {
    const out = [];
    let entries = [];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      if (IGNORED.test(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < MAX_DEPTH) out.push(...await this.list(p, depth + 1));
      } else if (e.isFile() && (isRaw(e.name) || isDisplayable(e.name))) {
        try { out.push({ path: p, name: e.name, size: (await fsp.stat(p)).size }); } catch { /* vanished */ }
      }
    }
    return out;
  }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      for (const f of await this.list()) {
        const s = this.seen.get(f.path);
        if (!s) { this.seen.set(f.path, { size: f.size, since: now, done: false }); continue; }
        if (s.done) continue;
        if (f.size !== s.size || f.size === 0) { s.size = f.size; s.since = now; continue; }
        if (now - s.since < this.settleMs) continue;
        // Size has not changed for settleMs: the file is complete.
        s.done = true;
        const key = path.join(path.dirname(f.path), f.name.replace(/\.[^.]+$/, '').toLowerCase());
        const group = this.pending.get(key) || { files: new Map(), firstAt: now };
        group.files.set(f.path, f.name);
        this.pending.set(key, group);
      }
      for (const [key, group] of this.pending) {
        const waitingSibling = [...this.seen.entries()].some(([p, s]) => !s.done
          && path.join(path.dirname(p), path.basename(p).replace(/\.[^.]+$/, '').toLowerCase()) === key);
        // Give the RAW/JPEG twin a moment to appear, and longer while it is still being written.
        const age = now - group.firstAt;
        if (age < this.quietMs || (waitingSibling && age < this.pairMs)) continue;
        this.pending.delete(key);
        const files = [...group.files].map(([p, name]) => ({ path: p, name }));
        try { await this.onCapture(files); } catch (err) { this.onError(err); }
      }
    } catch (err) {
      this.onError(err);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { FolderWatcher };
