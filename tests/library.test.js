import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import core from '../electron/core/library.cjs';

const { Library, RECOVERED_NOTE } = core;
const here = dirname(fileURLToPath(import.meta.url));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const tempRoot = () => mkdtemp(join(tmpdir(), 'mesora-lib-'));
const jpeg = (n = 1000) => ({ bytes: randomBytes(n), type: 'image/jpeg' });

async function shoot(lib, project, count) {
  for (let i = 0; i < count; i++) {
    const { id } = await lib.ingestCapture(project.id, { full: jpeg(), preview: jpeg(200), thumb: jpeg(50), meta: { w: 4, h: 3, luma: 0.5 } });
    project.frames.push({ key: `k${id}`, id, hold: 1 });
  }
  await lib.saveProject(project);
}

test('crea producción › escena › toma con la estructura documentada', async () => {
  const root = await tempRoot();
  const lib = new Library(root);
  const { project } = await lib.createProduction({ name: 'Mi corto', fps: 24 });
  assert.match(project.id, /^[\w-]+\/sc010\/tk01$/);
  assert.equal(project.fps, 24);
  assert.equal(project.scene.name, 'Escena 010');
  const prodDir = join(root, 'Mi corto');
  for (const p of ['production.json', 'scenes/sc010/scene.json', 'scenes/sc010/takes/tk01/edl.json', 'scenes/sc010/takes/tk01/capture/X1', 'media', 'exports']) {
    await stat(join(prodDir, p));
  }
  const second = await lib.createProduction({ name: 'Mi corto' });
  assert.equal(second.project.folder.includes('Mi corto (2)'), true);
  assert.equal((await lib.listTakes()).length, 2);
});

test('las capturas se guardan con sus bytes exactos y nunca se sobrescriben', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  const original = jpeg(5000);
  const { id, file } = await lib.ingestCapture(project.id, { full: original });
  assert.equal(id, 'c000001');
  assert.match(file, /sc010_tk01_X1_c000001\.jpg$/);
  assert.equal(sha(await readFile(file)), sha(original.bytes));
  const back = await lib.readCapture(project.id, id, 'full');
  assert.equal(sha(back.bytes), sha(original.bytes));
  assert.equal(back.type, 'image/jpeg');
  // Without a proxy, previews fall back to the original.
  assert.equal(sha((await lib.readCapture(project.id, id, 'preview')).bytes), sha(original.bytes));

  // A fresh library on the same folder continues numbering after the last file.
  const lib2 = new Library(lib.root);
  const { id: id2 } = await lib2.ingestCapture(project.id, { full: jpeg() });
  assert.equal(id2, 'c000002');
  assert.equal(sha(await readFile(file)), sha(original.bytes));
});

test('borrar es virtual: la papelera conserva el original y se puede restaurar', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  await shoot(lib, project, 3);
  const removed = project.frames.splice(1, 1)[0];
  await lib.saveProject(project);
  assert.deepEqual(await lib.listTrash(project.id), [removed.id]);

  // Close and reopen: the frame is still gone from the timeline, but its file is intact.
  const reopened = (await new Library(lib.root).getProject(project.id)).project;
  assert.deepEqual(reopened.frames.map((f) => f.id), ['c000001', 'c000003']);
  reopened.frames.splice(1, 0, { key: 'r', id: removed.id, hold: 1 });
  await lib.saveProject(reopened);
  assert.deepEqual(await lib.listTrash(project.id), []);
  assert.deepEqual((await lib.getProject(project.id)).project.frames.map((f) => f.id), ['c000001', 'c000002', 'c000003']);
});

test('guarda holds, notas, ajustes y fps en el nivel correcto', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P', fps: 12 });
  await shoot(lib, project, 2);
  project.frames[0].hold = 3;
  project.frames[1].note = 'A — boca abierta';
  project.fps = 15;
  project.settings = { onion: 2 };
  project.guides = [{ points: [[0, 0], [1, 1]] }];
  project.name = 'Producción renombrada';
  await lib.saveProject(project);
  const { project: p } = await new Library(lib.root).getProject(project.id);
  assert.equal(p.frames[0].hold, 3);
  assert.equal(p.frames[1].note, 'A — boca abierta');
  assert.equal(p.fps, 15);
  assert.deepEqual(p.settings, { onion: 2 });
  assert.equal(p.guides.length, 1);
  assert.equal(p.name, 'Producción renombrada');
});

test('rechaza guardar fotogramas que no existen en la toma', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  project.frames.push({ key: 'x', id: 'c999999', hold: 1 });
  await assert.rejects(lib.saveProject(project), /no existe en esta toma/);
});

test('recupera capturas escritas antes de un cierre inesperado', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  await shoot(lib, project, 2);
  // Two more captures reach the disk, but the app "dies" before saving the timeline.
  await lib.ingestCapture(project.id, { full: jpeg() });
  await lib.ingestCapture(project.id, { full: jpeg() });
  await writeFile(join(project.folder, 'capture', 'X1', 'sc010_tk01_X1_c000005.jpg.123-abcd.partial'), 'half');

  const { project: p, report } = await new Library(lib.root).getProject(project.id);
  assert.deepEqual(report.recovered, ['c000003', 'c000004']);
  assert.deepEqual(p.frames.map((f) => f.id), ['c000001', 'c000002', 'c000003', 'c000004']);
  assert.equal(p.frames[2].note, RECOVERED_NOTE);
  assert.equal(report.partials.length, 1, 'los archivos parciales se informan');
  await stat(join(project.folder, 'capture', 'X1', 'sc010_tk01_X1_c000005.jpg.123-abcd.partial')); // y no se borran
  // Recovery is persisted: opening again does not duplicate frames.
  const again = await new Library(lib.root).getProject(project.id);
  assert.deepEqual(again.report.recovered, []);
  assert.equal(again.project.frames.length, 4);
});

test('reabrir una toma en la misma sesión no confunde capturas sin guardar con huérfanas', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  await lib.ingestCapture(project.id, { full: jpeg() });
  const { report } = await lib.getProject(project.id);
  assert.deepEqual(report.recovered, []);
});

test('nueva toma, toma duplicada y escena duplicada', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  project.settings = { grid: 'thirds' };
  await shoot(lib, project, 3);

  const empty = (await lib.createTake(project.id)).project;
  assert.equal(empty.take.id, 'tk02');
  assert.equal(empty.frames.length, 0);
  assert.deepEqual(empty.settings, { grid: 'thirds' }, 'la toma nueva comparte los ajustes de la escena');

  const copy = (await lib.createTake(project.id, { copyFrames: true })).project;
  assert.equal(copy.take.id, 'tk03');
  assert.equal(copy.frames.length, 3);
  const a = await lib.readCapture(project.id, 'c000002');
  const b = await lib.readCapture(copy.id, 'c000002');
  assert.equal(sha(a.bytes), sha(b.bytes));
  assert.match((await readdir(join(copy.folder, 'capture', 'X1')))[0], /^sc010_tk03_X1_/);

  const dup = (await lib.duplicateScene(project.id, { name: 'Escena 2' })).project;
  assert.equal(dup.scene.id, 'sc020');
  assert.equal(dup.scene.name, 'Escena 2');
  assert.equal(dup.frames.length, 3);
  // Editing the copy does not affect the source.
  dup.frames.pop();
  await lib.saveProject(dup);
  assert.equal((await lib.getProject(project.id)).project.frames.length, 3);

  const scene = (await lib.createScene(project.production.id, { copySettingsFrom: 'sc010' })).project;
  assert.equal(scene.scene.id, 'sc030');
  assert.deepEqual(scene.settings, { grid: 'thirds' });
});

test('conform copia en orden de timeline sin tocar los originales', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  await shoot(lib, project, 3);
  project.frames.reverse();
  project.frames[0].hold = 2;
  await lib.saveProject(project);
  const before = await Promise.all(['c000001', 'c000002', 'c000003'].map(async (id) => sha((await lib.readCapture(project.id, id)).bytes)));

  const { dir, count } = await lib.conform(project.id, { expandHolds: true });
  assert.equal(count, 4);
  const files = (await readdir(dir)).sort();
  assert.deepEqual(files, ['sc010_tk01_0001.jpg', 'sc010_tk01_0002.jpg', 'sc010_tk01_0003.jpg', 'sc010_tk01_0004.jpg']);
  assert.equal(sha(await readFile(join(dir, files[0]))), before[2]);
  assert.equal(sha(await readFile(join(dir, files[1]))), before[2]);
  assert.equal(sha(await readFile(join(dir, files[3]))), before[0]);
  const after = await Promise.all(['c000001', 'c000002', 'c000003'].map(async (id) => sha((await lib.readCapture(project.id, id)).bytes)));
  assert.deepEqual(after, before);
});

test('historial: guarda versiones anteriores del timeline y las restaura', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  await shoot(lib, project, 3);
  project.frames.length = 1;
  await lib.saveProject(project);
  const versions = await lib.listHistory(project.id);
  assert.ok(versions.length >= 1);
  const withThree = versions.find((v) => v.frameCount === 3);
  assert.ok(withThree, 'hay una versión con los 3 fotogramas');
  const { project: restored } = await lib.restoreHistory(project.id, withThree.version);
  assert.equal(restored.frames.length, 3);
});

test('los archivos de medios se guardan con sus bytes exactos', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  const bytes = randomBytes(3000);
  await lib.putBlob(project.id, { id: 'audio1', name: 'diálogo: toma/1.wav', bytes });
  const blob = await lib.getBlob(project.id, 'audio1');
  assert.equal(blob.name, 'diálogo  toma 1.wav'.replace(/\s+/g, ' '));
  assert.equal(sha(blob.bytes), sha(bytes));
  assert.equal(await lib.getBlob(project.id, 'otro1'), null);
});

test('no abre producciones de una versión futura', async () => {
  const lib = new Library(await tempRoot());
  const { project } = await lib.createProduction({ name: 'P' });
  const file = join(project.folder, 'edl.json');
  const edl = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...edl, version: 99 }));
  await assert.rejects(new Library(lib.root).getProject(project.id), /versión más nueva/);
});

test('no pierde ninguna captura confirmada aunque el proceso muera en cualquier momento', { timeout: 120_000 }, async () => {
  const root = await tempRoot();
  const { project } = await new Library(root).createProduction({ name: 'Choque' });
  const confirmed = new Map();
  const rounds = 20;
  for (let round = 0; round < rounds; round++) {
    const child = spawn(process.execPath, [join(here, 'helpers', 'crash-writer.cjs'), root, project.id], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const [tag, id, hash] = buf.slice(0, nl).split(' ');
        if (tag === 'OK') confirmed.set(id, hash);
        buf = buf.slice(nl + 1);
      }
    });
    await new Promise((r) => setTimeout(r, 150 + Math.random() * 350));
    child.kill('SIGKILL');
    await new Promise((r) => child.on('exit', r));
  }
  assert.ok(confirmed.size > rounds, `se confirmaron ${confirmed.size} capturas`);

  const lib = new Library(root);
  const { project: p } = await lib.getProject(project.id);
  const inTimeline = new Map();
  for (const f of p.frames) inTimeline.set(f.id, (inTimeline.get(f.id) || 0) + 1);
  for (const [id, hash] of confirmed) {
    assert.equal(inTimeline.get(id), 1, `la captura ${id} está exactamente una vez en el timeline`);
    assert.equal(sha((await lib.readCapture(p.id, id)).bytes), hash, `la captura ${id} está intacta`);
  }
  await rm(root, { recursive: true, force: true });
});
