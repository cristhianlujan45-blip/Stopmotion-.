// The phone as a wireless camera (desktop app). The phone opens MESORA's camera
// page (electron/remote/camera.html) and sends its video by WebRTC, straight
// over the local network; each photo comes at full resolution over a data
// channel. The live view is light and quick; the photos keep all the quality.

const REQUEST_MS = 8000;
const STILL_MS = 20000;
const READY_MS = 15000;
const MAX_STILL = 64 * 1024 * 1024;
const SILENCE_MS = 5000; // the phone sends something every second

/** H.264 first (phones encode it in hardware), then VP8; the rest stay. */
function preferCodecs(transceiver) {
  try {
    const caps = RTCRtpReceiver.getCapabilities?.('video');
    if (!caps || !transceiver.setCodecPreferences) return;
    const rank = (c) => (/h264/i.test(c.mimeType) ? 0 : /vp8/i.test(c.mimeType) ? 1 : /rtx|red|fec/i.test(c.mimeType) ? 3 : 2);
    transceiver.setCodecPreferences([...caps.codecs].sort((a, b) => rank(a) - rank(b)));
  } catch { /* the browser chooses */ }
}

/** Shows each frame as soon as it arrives instead of keeping a safety margin. */
function lowLatency(receiver) {
  try { receiver.jitterBufferTarget = 0; } catch { /* not supported */ }
  try { if ('playoutDelayHint' in receiver) receiver.playoutDelayHint = 0; } catch { /* not supported */ }
}

/** All the addresses, or after `ms` the ones found so far, but never none (at most 4 × ms). */
function gathered(pc, ms) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const waited = Date.now() - start;
      const some = /a=candidate/.test(pc.localDescription?.sdp || '');
      if (pc.iceGatheringState === 'complete' || (waited >= ms && some) || waited >= ms * 4) { clearInterval(timer); resolve(); }
    };
    const timer = setInterval(check, 100);
    pc.addEventListener('icegatheringstatechange', check);
    check();
  });
}

export class PhoneLink {
  constructor() {
    this.pc = null;
    this.channel = null;
    this.stream = null;
    this.remoteTrack = null;
    this.info = {}; // what the phone says about its camera
    this.closed = false;
    this.onChange = () => {};
    this.onClose = () => {};
    this.pending = new Map();
    this.nextId = 1;
    this.incoming = null;
    this.endedListeners = [];
    this.last = null; // stats samples, to measure over the last second
    this.base = null;
    this.heard = 0;
    this.watch = null;
    this.ready = new Promise((resolve, reject) => { this.readyDone = { resolve, reject }; });
    this.ready.catch(() => {});
  }

  get connected() { return !this.closed && this.channel?.readyState === 'open'; }
  /** Size of the photos (the phone's camera), not of the live view, which can be smaller on a busy wifi. */
  get width() { return this.info.width || 0; }
  get height() { return this.info.height || 0; }

  /** Answers the phone's offer. Resolves with the answer to send back. */
  async accept(sdp) {
    const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
    this.pc = pc;
    const timer = setTimeout(() => this.fail('El móvil no llegó a conectarse (¿están en la misma wifi?)'), READY_MS);
    this.ready.finally(() => clearTimeout(timer)).catch(() => {});
    pc.addEventListener('track', (e) => {
      lowLatency(e.receiver);
      this.remoteTrack = e.track;
      this.stream = e.streams[0] || new MediaStream([e.track]);
      this.checkReady();
    });
    pc.addEventListener('datachannel', (e) => this.bind(e.channel));
    let lost = null;
    pc.addEventListener('connectionstatechange', () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') this.close();
      else if (s === 'disconnected') lost = setTimeout(() => this.close(), 4000);
      else if (s === 'connected') clearTimeout(lost);
    });
    await pc.setRemoteDescription({ type: 'offer', sdp });
    for (const t of pc.getTransceivers()) if (t.receiver.track?.kind === 'video') preferCodecs(t);
    await pc.setLocalDescription(await pc.createAnswer());
    await gathered(pc, 1500);
    return pc.localDescription.sdp;
  }

  bind(channel) {
    if (this.closed) return;
    this.channel = channel;
    channel.binaryType = 'arraybuffer';
    channel.addEventListener('message', (e) => { this.heard = Date.now(); this.receive(e.data); });
    channel.addEventListener('close', () => this.close());
    // A phone that is switched off or loses the wifi does not say goodbye.
    // If this window itself was busy (the check came late), its messages may
    // still be waiting to be read: that silence is not the phone's.
    this.heard = Date.now();
    let tick = Date.now();
    this.watch = setInterval(() => {
      const now = Date.now();
      if (now - tick > 2000) this.heard = now;
      tick = now;
      if (now - this.heard > SILENCE_MS) this.close();
    }, 1000);
  }

  checkReady() {
    if (this.stream && this.info.type === 'info') this.readyDone.resolve(this);
  }

  fail(message) {
    this.readyDone.reject(new Error(message));
    this.close();
  }

  receive(data) {
    if (typeof data !== 'string') {
      const s = this.incoming;
      if (!s) return;
      s.parts.push(data);
      s.received += data.byteLength;
      if (s.received >= s.size) {
        this.incoming = null;
        this.settle(s.id, null, new Blob(s.parts, { type: s.mime }));
      }
      return;
    }
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'info') {
      this.info = msg;
      this.checkReady();
      this.onChange();
    } else if (msg.type === 'reply') {
      this.settle(msg.id, msg.ok ? null : new Error(msg.error || 'El móvil no pudo hacerlo'), msg);
    } else if (msg.type === 'still') {
      const mime = msg.mime === 'image/png' ? 'image/png' : 'image/jpeg';
      if (!(msg.size > 0 && msg.size <= MAX_STILL)) { this.settle(msg.id, new Error('Foto del móvil no válida')); return; }
      this.incoming = { id: msg.id, size: msg.size, mime, received: 0, parts: [] };
    }
  }

  settle(id, err, value) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (err) p.reject(err);
    else p.resolve(value);
  }

  /** Asks the phone for something and waits for its answer. */
  request(msg, ms = REQUEST_MS) {
    if (!this.connected) return Promise.reject(new Error('El móvil no está conectado'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (this.incoming?.id === id) this.incoming = null;
        reject(new Error('El móvil no respondió a tiempo'));
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      this.channel.send(JSON.stringify({ ...msg, id }));
    });
  }

  /** A photo at the full resolution of the phone's camera, as an encoded image (JPEG or PNG). */
  photo({ average = 1, flipH = false, flipV = false, format = 'jpeg', quality = 0.95 } = {}) {
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    return this.request({ type: 'still', average, flipH, flipV, mime, quality }, STILL_MS);
  }

  /** Another camera of the phone (wide, telephoto, front…) or another size. */
  useCamera({ deviceId, width, height }) {
    return this.request({ type: 'camera', deviceId, width, height });
  }

  /** What Camera needs from a track, answered by the phone's camera. */
  trackProxy() {
    const link = this;
    return {
      kind: 'video',
      get label() { return link.info.label ? `Móvil · ${link.info.label}` : 'Móvil'; },
      get readyState() { return link.closed ? 'ended' : link.remoteTrack?.readyState || 'ended'; },
      getSettings: () => ({ ...(link.info.settings || {}), width: link.width, height: link.height }),
      getCapabilities: () => link.info.caps || {},
      applyConstraints: (constraints) => link.request({ type: 'apply', constraints }),
      addEventListener: (type, fn) => { if (type === 'ended') link.endedListeners.push(fn); },
      stop: () => link.close(),
    };
  }

  /** Delay and quality of the live view over the last second, measured here. */
  async stats() {
    if (!this.pc || this.closed) return null;
    const report = await this.pc.getStats();
    let video = null, pair = null;
    report.forEach((s) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') video = s;
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
    });
    if (!video) return null;
    // Compared with a sample at least a second old (several callers may ask at once); at first, since the start.
    if (!this.last || video.timestamp - this.last.timestamp >= 1000) {
      this.base = this.last;
      this.last = { ...video };
    }
    const prev = this.base;
    const d = (k) => (prev ? (video[k] || 0) - (prev[k] || 0) : video[k] || 0);
    const emitted = d('jitterBufferEmittedCount');
    const decoded = d('framesDecoded');
    const seconds = prev ? (video.timestamp - prev.timestamp) / 1000 : 0;
    return {
      width: video.frameWidth || 0,
      height: video.frameHeight || 0,
      fps: Math.round(video.framesPerSecond || 0),
      codec: (report.get(video.codecId)?.mimeType || '').replace(/^video\//, ''),
      networkMs: pair?.currentRoundTripTime != null ? (pair.currentRoundTripTime * 1000) / 2 : null,
      bufferMs: emitted ? (d('jitterBufferDelay') / emitted) * 1000 : null,
      decodeMs: decoded ? (d('totalDecodeTime') / decoded) * 1000 : null,
      kbps: seconds > 0 ? Math.round((d('bytesReceived') * 8) / seconds / 1000) : null,
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watch);
    this.readyDone.reject(new Error('Conexión cerrada'));
    for (const [id] of this.pending) this.settle(id, new Error('Se perdió la conexión con el móvil'));
    try { this.pc?.close(); } catch { /* already closed */ }
    for (const fn of this.endedListeners) fn();
    this.onClose();
  }
}
