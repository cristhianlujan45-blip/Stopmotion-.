import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { mirror } = require('../electron/core/backup.cjs');

test('copia de seguridad: añade y actualiza, nunca borra, salta exports y temporales', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mesora-bk-'));
  const lib = join(root, 'MESORA');
  const dest = join(root, 'Disco externo', 'MESORA (copia)');
  const take = join(lib, 'Corto', 'scenes', 'sc010', 'takes', 'tk01');
  await mkdir(join(take, 'capture', 'X1'), { recursive: true });
  await mkdir(join(lib, 'Corto', 'exports'), { recursive: true });
  await writeFile(join(take, 'capture', 'X1', 'sc010_tk01_X1_c000001.jpg'), 'foto1');
  await writeFile(join(take, 'edl.json'), '{"frames":[1]}');
  await writeFile(join(take, 'edl.json.123-ab.partial'), 'a medias');
  await writeFile(join(lib, 'Corto', 'exports', 'pelicula.mp4'), 'grande');

  let r = await mirror(lib, dest);
  assert.equal(r.copied, 2);
  assert.equal(await readFile(join(dest, 'Corto', 'scenes', 'sc010', 'takes', 'tk01', 'capture', 'X1', 'sc010_tk01_X1_c000001.jpg'), 'utf8'), 'foto1');
  assert.ok(!existsSync(join(dest, 'Corto', 'exports')), 'las películas exportadas no se copian');
  assert.ok(!(await readdir(join(dest, 'Corto', 'scenes', 'sc010', 'takes', 'tk01'))).some((n) => n.endsWith('.partial')));
  assert.ok(existsSync(join(dest, 'LEEME.txt')));

  r = await mirror(lib, dest);
  assert.equal(r.copied, 0, 'sin cambios no copia nada');

  await writeFile(join(take, 'edl.json'), '{"frames":[1,2]}');
  const later = new Date(Date.now() + 10_000);
  await utimes(join(take, 'edl.json'), later, later);
  await writeFile(join(take, 'capture', 'X1', 'sc010_tk01_X1_c000002.jpg'), 'foto2');
  await rm(join(take, 'capture', 'X1', 'sc010_tk01_X1_c000001.jpg'));
  r = await mirror(lib, dest);
  assert.equal(r.copied, 2, 'el timeline cambiado y la foto nueva');
  assert.equal(await readFile(join(dest, 'Corto', 'scenes', 'sc010', 'takes', 'tk01', 'edl.json'), 'utf8'), '{"frames":[1,2]}');
  assert.ok(existsSync(join(dest, 'Corto', 'scenes', 'sc010', 'takes', 'tk01', 'capture', 'X1', 'sc010_tk01_X1_c000001.jpg')), 'lo borrado en la biblioteca sigue en la copia');

  await assert.rejects(mirror(lib, join(lib, 'copia')), /no puede estar dentro/);
  await assert.rejects(mirror(lib, root), /no puede estar dentro/);
});
