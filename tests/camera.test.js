import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import raw from '../electron/core/rawpreview.cjs';
import fw from '../electron/core/folderwatch.cjs';
import lib from '../electron/core/library.cjs';
import ff from '../electron/core/ffmpeg.cjs';

const { findJpegs, largestJpeg, isRaw } = raw;
const { FolderWatcher } = fw;
const { Library } = lib;
const ffmpeg = ff.bundledFFmpeg();
const sha = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A real JPEG of the given size, made with the bundled FFmpeg. */
function jpeg(w, h, color = 'red') {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], { maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr?.toString());
  return r.stdout;
}

/** JPEG with a smaller JPEG nested in an APP1 (EXIF-like) segment, like camera previews. */
function jpegWithThumbnail(big, thumb) {
  const payload = Buffer.concat([Buffer.from('Exif\0\0'), thumb]);
  const app1 = Buffer.alloc(4);
  app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([big.subarray(0, 2), app1, payload, big.subarray(2)]);
}

/** A fake RAW file: sensor-like noise around a big preview (with thumbnail) and a medium one. */
function fakeRaw() {
  const big = jpegWithThumbnail(jpeg(640, 480, 'blue'), jpeg(160, 120, 'green'));
  return { bytes: Buffer.concat([Buffer.from('II*\0'), randomBytes(5000), big, randomBytes(3000), jpeg(320, 240, 'white'), randomBytes(2000)]), big };
}

test('RAW: encuentra las vistas previas sin confundir la miniatura anidada', () => {
  const { bytes, big } = fakeRaw();
  const found = findJpegs(bytes);
  assert.deepEqual(found.map((j) => `${j.width}x${j.height}`), ['640x480', '320x240']);
  const best = largestJpeg(bytes);
  assert.equal(best.width, 640);
  assert.equal(sha(best.bytes), sha(big), 'bytes idénticos a la vista previa incrustada');
  assert.equal(largestJpeg(randomBytes(10000)), null);
  assert.ok(isRaw('IMG_0001.CR3') && isRaw('a.nef') && isRaw('b.ARW') && !isRaw('c.jpg'));
});

test('RAW reales (si hay muestras en MESORA_RAW_SAMPLES)', { skip: !process.env.MESORA_RAW_SAMPLES }, async () => {
  const dir = process.env.MESORA_RAW_SAMPLES;
  for (const name of (await readdir(dir)).filter(isRaw)) {
    const best = largestJpeg(await readFile(join(dir, name)));
    assert.ok(best && best.width >= 1000, `${name}: vista previa ${best?.width}x${best?.height}`);
  }
});

test('carpeta vigilada: espera a que el archivo esté completo y agrupa RAW + JPEG', { timeout: 20_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mesora-tether-'));
  await writeFile(join(dir, 'ANTIGUA.JPG'), jpeg(32, 32)); // ya estaba: no es una captura nueva
  const got = [];
  const w = new FolderWatcher(dir, { onCapture: (files) => { got.push(files.map((f) => f.name).sort()); }, pollMs: 50, settleMs: 200, quietMs: 150, pairMs: 1500 });
  await w.start();

  // The tethering program writes the RAW in pieces, then the JPEG.
  const { bytes } = fakeRaw();
  await writeFile(join(dir, 'IMG_0001.CR3'), bytes.subarray(0, 4000));
  await sleep(120);
  await appendFile(join(dir, 'IMG_0001.CR3'), bytes.subarray(4000));
  await sleep(80);
  await writeFile(join(dir, 'IMG_0001.JPG'), jpeg(64, 48));
  await writeFile(join(dir, '~temporal.tmp'), 'x');
  // A second shot in a dated subfolder, JPEG only.
  await mkdir(join(dir, '2026_10_26'));
  await sleep(600);
  await writeFile(join(dir, '2026_10_26', 'IMG_0002.JPG'), jpeg(64, 48));
  await sleep(1500);
  w.stop();
  assert.deepEqual(got, [['IMG_0001.CR3', 'IMG_0001.JPG'], ['IMG_0002.JPG']]);
});

test('biblioteca: una foto RAW + JPEG es una sola captura; RAW solo muestra su JPEG incrustado', async () => {
  const src = await mkdtemp(join(tmpdir(), 'mesora-src-'));
  const { bytes, big } = fakeRaw();
  const jpg = jpeg(64, 48);
  await writeFile(join(src, 'IMG_1.CR3'), bytes);
  await writeFile(join(src, 'IMG_1.JPG'), jpg);
  await writeFile(join(src, 'IMG_2.NEF'), bytes);

  const library = new Library(await mkdtemp(join(tmpdir(), 'mesora-lib-')));
  const { project } = await library.createProduction({ name: 'Réflex' });
  const pair = await library.ingestFiles(project.id, [{ path: join(src, 'IMG_1.CR3'), name: 'IMG_1.CR3' }, { path: join(src, 'IMG_1.JPG'), name: 'IMG_1.JPG' }]);
  assert.deepEqual(pair.files, ['sc010_tk01_X1_c000001.cr3', 'sc010_tk01_X1_c000001.jpg']);
  assert.equal(pair.display, null, 'con JPEG no hace falta extraer');
  assert.equal(sha((await library.readCapture(project.id, pair.id, 'full')).bytes), sha(jpg));

  const rawOnly = await library.ingestFiles(project.id, [{ path: join(src, 'IMG_2.NEF'), name: 'IMG_2.NEF' }]);
  assert.equal(rawOnly.display.width, 640);
  const shown = await library.readCapture(project.id, rawOnly.id, 'full');
  assert.equal(shown.type, 'image/jpeg');
  assert.equal(sha(shown.bytes), sha(big));
  // The originals are byte-identical copies, and the source files are still there.
  const capDir = join(project.folder, 'capture', 'X1');
  assert.equal(sha(await readFile(join(capDir, 'sc010_tk01_X1_c000002.nef'))), sha(bytes));
  assert.equal((await readdir(src)).length, 3);

  // Proxies and video assist.
  await library.writeProxies(project.id, rawOnly.id, { preview: { bytes: jpg }, thumb: { bytes: jpg }, meta: { w: 640, h: 480, luma: 40 } });
  assert.equal((await library.readMeta(project.id, rawOnly.id)).luma, 40);
  assert.equal(sha((await library.readCapture(project.id, rawOnly.id, 'assist')).bytes), sha(jpg), 'sin assist, usa la vista previa');
  const assist = jpeg(48, 32, 'yellow');
  await library.writeAssist(project.id, rawOnly.id, { bytes: assist });
  assert.equal(sha((await library.readCapture(project.id, rawOnly.id, 'assist')).bytes), sha(assist));

  // Conform copies both files of the RAW + JPEG photo.
  project.frames.push({ key: 'a', id: pair.id, hold: 1 }, { key: 'b', id: rawOnly.id, hold: 1 });
  await library.saveProject(project);
  const { dir } = await library.conform(project.id);
  assert.deepEqual((await readdir(dir)).sort(), ['sc010_tk01_0001.cr3', 'sc010_tk01_0001.jpg', 'sc010_tk01_0002.nef']);
});

test('biblioteca: un RAW importado (bytes) también muestra su vista previa', async () => {
  const library = new Library(await mkdtemp(join(tmpdir(), 'mesora-lib-')));
  const { project } = await library.createProduction({ name: 'P' });
  const { bytes, big } = fakeRaw();
  const r = await library.ingestCapture(project.id, { full: { bytes, type: '', name: 'DSC_9.ARW' } });
  assert.match(r.file, /c000001\.arw$/);
  assert.equal(r.display.height, 480);
  assert.equal(sha((await library.readCapture(project.id, r.id, 'full')).bytes), sha(big));
});
