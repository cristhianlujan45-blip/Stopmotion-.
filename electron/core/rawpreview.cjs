// Embedded JPEG previews inside camera RAW files (CR2, CR3, NEF, ARW, RAF,
// ORF, RW2, DNG…). Cameras store a full- or large-size JPEG next to the raw
// data; like Dragonframe, MESORA shows that JPEG and keeps the RAW untouched.
// The JPEG streams are found by walking their markers, so EXIF thumbnails
// nested inside a bigger JPEG are not mistaken for separate images.

const RAW_EXT = new Set(['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'dng', 'srw', 'x3f', '3fr', 'iiq', 'erf', 'mef', 'mos', 'kdc', 'dcr']);
const DISPLAY_EXT = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp', 'heic', 'heif', 'bmp', 'gif']);

const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
const isRaw = (name) => RAW_EXT.has(extOf(name));
const isDisplayable = (name) => DISPLAY_EXT.has(extOf(name));

/** Marker codes that stand alone (no length field). */
const standalone = (m) => m === 0x01 || (m >= 0xd0 && m <= 0xd9);

/**
 * Parses one JPEG starting at `start` (an FF D8). Returns { start, end, width, height }
 * with `end` just past the FF D9, or null when the data is not a well-formed JPEG.
 */
function parseJpeg(buf, start) {
  let p = start + 2;
  let width = 0;
  let height = 0;
  while (p + 4 <= buf.length) {
    if (buf[p] !== 0xff) return null;
    const m = buf[p + 1];
    if (m === 0xff) { p++; continue; } // fill byte
    if (m === 0xd9) return { start, end: p + 2, width, height };
    if (standalone(m)) { p += 2; continue; }
    const len = buf.readUInt16BE(p + 2);
    if (len < 2 || p + 2 + len > buf.length) return null;
    // SOF0–SOF15 (except DHT C4, JPG C8, DAC CC) carry the image size.
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      height = buf.readUInt16BE(p + 5);
      width = buf.readUInt16BE(p + 7);
    }
    p += 2 + len;
    if (m === 0xda) {
      // Entropy-coded data: runs until a marker that is not a stuffed 00 or a restart marker.
      while (p + 1 < buf.length) {
        if (buf[p] === 0xff && buf[p + 1] !== 0x00 && !(buf[p + 1] >= 0xd0 && buf[p + 1] <= 0xd7)) break;
        p++;
      }
    }
  }
  return null;
}

/** Every well-formed, non-overlapping JPEG in the buffer. */
function findJpegs(buf) {
  const out = [];
  let i = 0;
  while (i + 3 < buf.length) {
    i = buf.indexOf(0xff, i);
    if (i < 0 || i + 3 >= buf.length) break;
    if (buf[i + 1] === 0xd8 && buf[i + 2] === 0xff) {
      const j = parseJpeg(buf, i);
      if (j && j.width > 0 && j.height > 0) {
        out.push(j);
        i = j.end; // skip what it contains (e.g. its EXIF thumbnail)
        continue;
      }
    }
    i++;
  }
  return out;
}

/** The largest embedded JPEG (by pixel count), as a Buffer slice, or null. */
function largestJpeg(buf) {
  let best = null;
  for (const j of findJpegs(buf)) if (!best || j.width * j.height > best.width * best.height) best = j;
  return best ? { bytes: buf.subarray(best.start, best.end), width: best.width, height: best.height } : null;
}

module.exports = { RAW_EXT, DISPLAY_EXT, extOf, isRaw, isDisplayable, findJpegs, largestJpeg, parseJpeg };
