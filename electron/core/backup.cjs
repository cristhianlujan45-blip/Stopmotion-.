// Automatic backup: mirrors the production library into another folder (an
// external drive, or a folder synced by Dropbox, Google Drive, OneDrive or
// iCloud). It only adds and updates files: nothing is ever deleted from the
// backup, so a mistake in the library cannot erase the copy.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { PARTIAL } = require('./fsutil.cjs');

/** Folders that are not copied: exported films can be made again from the takes. */
const SKIP_DIRS = new Set(['exports']);
const README = 'LEEME.txt';

const inside = (child, parent) => {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Copies `src` over `dest` through a temporary file, keeping the modification time. */
async function copyFileAtomic(src, dest, stat) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${crypto.randomBytes(4).toString('hex')}${PARTIAL}`;
  try {
    await fsp.copyFile(src, tmp);
    await fsp.utimes(tmp, stat.atime, stat.mtime);
    await fsp.rename(tmp, dest);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
}

/**
 * Copies every file of `src` that is missing or different in `dest`.
 * @returns {Promise<{ copied: number, bytes: number, files: number }>}
 */
async function mirror(src, dest) {
  if (inside(dest, src) || inside(src, dest)) throw new Error('La carpeta de la copia no puede estar dentro de la biblioteca (ni al revés)');
  const result = { copied: 0, bytes: 0, files: 0 };
  const walk = async (rel) => {
    const entries = await fsp.readdir(path.join(src, rel), { withFileTypes: true }).catch((err) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    });
    for (const ent of entries) {
      const r = path.join(rel, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) await walk(r);
        continue;
      }
      if (!ent.isFile() || ent.name.endsWith(PARTIAL) || ent.name.startsWith('.')) continue;
      result.files++;
      const from = path.join(src, r);
      const to = path.join(dest, r);
      const s = await fsp.stat(from);
      const d = await fsp.stat(to).catch(() => null);
      if (d && d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 2000) continue;
      await copyFileAtomic(from, to, s);
      result.copied++;
      result.bytes += s.size;
    }
  };
  await fsp.mkdir(dest, { recursive: true });
  await walk('');
  const readme = path.join(dest, README);
  if (!fs.existsSync(readme)) {
    await fsp.writeFile(readme, [
      'Copia de seguridad de MESORA Studio.',
      '',
      'MESORA copia aquí tus producciones automáticamente. Solo añade y actualiza',
      'archivos: nunca borra nada de esta carpeta. Las películas exportadas',
      '(carpetas «exports») no se copian.',
      '',
      'Para recuperar una producción, copia su carpeta a Documentos/MESORA',
      '(o a la biblioteca que uses) con MESORA cerrado.',
      '',
    ].join('\n'));
  }
  return result;
}

module.exports = { mirror, SKIP_DIRS };
