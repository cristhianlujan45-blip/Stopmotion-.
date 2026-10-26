// Crash-safe file primitives. Every write goes to a temporary ".partial" file
// in the same folder, is flushed to disk and only then renamed into place, so
// a crash leaves either the old file or the new one, never a torn one.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PARTIAL = '.partial';

function tempName(file) {
  return `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}${PARTIAL}`;
}

/** Flushes a directory entry (needed for renames to survive power loss on Linux/macOS). */
async function syncDir(dir) {
  let fh;
  try {
    fh = await fsp.open(dir, 'r');
    await fh.sync();
  } catch {
    // Windows cannot open or fsync directories; NTFS journals the rename itself.
  } finally {
    await fh?.close().catch(() => {});
  }
}

async function writeTemp(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = tempName(file);
  const fh = await fsp.open(tmp, 'wx');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } catch (err) {
    await fh.close().catch(() => {});
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  await fh.close();
  return tmp;
}

/** Atomically replaces (or creates) a file. */
async function writeAtomic(file, data) {
  const tmp = await writeTemp(file, data);
  await fsp.rename(tmp, file);
  await syncDir(path.dirname(file));
}

/**
 * Atomically creates a file that must not exist yet. Used for original
 * captures: an existing file is never overwritten.
 */
async function writeNew(file, data) {
  const tmp = await writeTemp(file, data);
  try {
    // link() fails with EEXIST instead of replacing, which makes the check atomic.
    await fsp.link(tmp, file);
    await fsp.rm(tmp, { force: true });
  } catch (err) {
    if (err.code === 'EEXIST') {
      await fsp.rm(tmp, { force: true });
      throw new Error(`Ya existe un archivo con ese nombre, no se sobrescribe: ${file}`);
    }
    // File systems without hard links (FAT32/exFAT drives): check, then rename.
    if (fs.existsSync(file)) {
      await fsp.rm(tmp, { force: true });
      throw new Error(`Ya existe un archivo con ese nombre, no se sobrescribe: ${file}`);
    }
    await fsp.rename(tmp, file);
  }
  await syncDir(path.dirname(file));
}

async function writeJSON(file, value) {
  await writeAtomic(file, `${JSON.stringify(value, null, 1)}\n`);
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Copies a file without overwriting; uses copy-on-write clones where the file system supports them. */
async function copyNew(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE);
}

async function sha256(file) {
  return crypto.createHash('sha256').update(await fsp.readFile(file)).digest('hex');
}

/** File-name-safe version of a user-provided name. */
function safeName(name, fallback = 'sin-nombre') {
  const s = String(name || '')
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  return (s && !reserved.test(s) ? s : fallback).slice(0, 80);
}

module.exports = {
  PARTIAL, syncDir, writeAtomic, writeNew, writeJSON, readJSON, exists, copyNew, sha256, safeName,
};
