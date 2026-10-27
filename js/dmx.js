// Lighting with DMX: lights (a DMX channel each), looks (a level for each
// light) and keys that say which look the set has at an exposure, optionally
// fading from the previous key. Before each photo MESORA sends the levels of
// the exposure being shot, so light changes are repeatable frame by frame.
// Packet formats: Art-Net ArtDmx (UDP 6454) and ENTTEC DMX USB Pro (label 6).

/** Levels (0…100 %) of every light at an exposure (1-based). */
export function levelsAt(lighting, exposure) {
  const keys = [...(lighting.keys || [])].filter((k) => k.exposure > 0).sort((a, b) => a.exposure - b.exposure);
  const look = (id) => lighting.looks?.find((l) => l.id === id)?.levels || {};
  const out = {};
  for (const light of lighting.lights || []) out[light.id] = 0;
  if (!keys.length) return out;
  let i = keys.findIndex((k) => k.exposure > exposure);
  if (i === -1) i = keys.length;
  const prev = keys[i - 1], next = keys[i];
  for (const light of lighting.lights || []) {
    const a = prev ? look(prev.lookId)[light.id] ?? 0 : look(next.lookId)[light.id] ?? 0;
    if (prev && next?.fade) {
      const b = look(next.lookId)[light.id] ?? 0;
      const t = (exposure - prev.exposure) / (next.exposure - prev.exposure);
      out[light.id] = a + (b - a) * t;
    } else {
      out[light.id] = a;
    }
  }
  return out;
}

/** 512 DMX channel values (0…255) for the lights' levels. */
export function dmxFrame(lighting, levels) {
  const data = new Uint8Array(512);
  for (const light of lighting.lights || []) {
    const ch = Math.round(light.channel);
    if (ch >= 1 && ch <= 512) data[ch - 1] = Math.round(Math.max(0, Math.min(100, levels[light.id] ?? 0)) * 2.55);
  }
  return data;
}

/** Art-Net ArtDmx packet for a 15-bit port address (net · sub-net · universe). */
export function artnetPacket(data, { universe = 0, sequence = 0 } = {}) {
  let length = Math.max(2, Math.min(512, data.length));
  if (length % 2) length++;
  const p = new Uint8Array(18 + length);
  p.set([0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00]); // "Art-Net\0"
  p[8] = 0x00; p[9] = 0x50; // OpDmx 0x5000, little-endian
  p[10] = 0; p[11] = 14; // protocol version 14
  p[12] = sequence & 0xff;
  p[13] = 0; // physical port
  p[14] = universe & 0xff; // SubUni
  p[15] = (universe >> 8) & 0x7f; // Net
  p[16] = length >> 8; p[17] = length & 0xff;
  p.set(data.subarray(0, length), 18);
  return p;
}

/** ENTTEC DMX USB Pro «Output Only Send DMX Packet» (label 6): start code 0 + 512 channels. */
export function enttecPacket(data) {
  const n = 513;
  const p = new Uint8Array(n + 5);
  p[0] = 0x7e; p[1] = 6; p[2] = n & 0xff; p[3] = n >> 8;
  p[4] = 0; // DMX start code
  p.set(data.subarray(0, 512), 5);
  p[n + 4] = 0xe7;
  return p;
}

/** Reads an ArtDmx packet back (used by the tests and the network simulator). */
export function parseArtnet(bytes) {
  const p = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (p.length < 18 || String.fromCharCode(...p.subarray(0, 7)) !== 'Art-Net' || p[8] !== 0x00 || p[9] !== 0x50) return null;
  const length = (p[16] << 8) | p[17];
  return { universe: p[14] | (p[15] << 8), sequence: p[12], data: p.slice(18, 18 + length) };
}
