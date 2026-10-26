import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import mod from '../electron/core/ffmpeg.cjs';

const { buildArgs, buildAudioArgs, ExportJob, runOnce, bundledFFmpeg } = mod;
const ffmpeg = bundledFFmpeg();

/** Frame count, codec names and duration of a media file, read with FFmpeg itself. */
function probe(file) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file, '-map', '0', '-c', 'copy', '-f', 'null', '-'], { encoding: 'utf8' });
  const out = r.stderr;
  const frames = [...out.matchAll(/frame=\s*(\d+)/g)].map((m) => Number(m[1])).pop();
  const video = /Video: ([\w]+)/.exec(out)?.[1];
  const audio = /Audio: ([\w]+)/.exec(out)?.[1];
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(out);
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;
  return { frames, video, audio, duration, raw: out };
}

/** 10 distinct 64×48 frames; the 3rd is held for 3 exposures → 12 pictures. */
async function encode(format, out, extra = {}) {
  const W = 64, H = 48;
  const job = new ExportJob(ffmpeg, buildArgs({ format, width: W, height: H, fps: 12, out, quality: 'alta', ...extra }));
  for (let i = 0; i < 10; i++) {
    const px = new Uint8Array(W * H * 4).fill(i * 25);
    for (let k = 3; k < px.length; k += 4) px[k] = 255;
    await job.write(px, i === 2 ? 3 : 1);
  }
  await job.finish();
}

test('argumentos: tamaño, velocidad, códec y calidad', () => {
  const a = buildArgs({ format: 'mp4', width: 1920, height: 1080, fps: 24, out: 'x.mp4', quality: 'media' });
  assert.deepEqual(a.slice(a.indexOf('-s'), a.indexOf('-s') + 2), ['-s', '1920x1080']);
  assert.ok(a.includes('libx264') && a.includes('yuv420p'));
  assert.equal(a[a.indexOf('-crf') + 1], '20');
  assert.throws(() => buildArgs({ format: 'mp4', width: 1921, height: 1080, fps: 24, out: 'x.mp4' }), /pares/);
  assert.throws(() => buildArgs({ format: 'gif', width: 2, height: 2, fps: 1, out: 'x' }), /desconocido/);
  const withLateAudio = buildArgs({ format: 'mp4', width: 2, height: 2, fps: 12, out: 'x.mp4', audio: { file: 'a.wav', startSeconds: -0.5 } });
  assert.ok(withLateAudio.includes('adelay=500:all=1'));
  const withSkip = buildArgs({ format: 'prores', width: 2, height: 2, fps: 12, out: 'x.mov', audio: { file: 'a.wav', startSeconds: 2 } });
  assert.equal(withSkip[withSkip.indexOf('-ss') + 1], '2.0000');
});

test('hay un FFmpeg incluido y se ejecuta', () => {
  assert.ok(ffmpeg, 'ffmpeg-static instalado');
  const r = spawnSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
});

for (const [format, ext, codec] of [['mp4', 'mp4', 'h264'], ['prores', 'mov', 'prores'], ['mjpeg', 'avi', 'mjpeg']]) {
  test(`vídeo ${format}: un fotograma por exposición (holds incluidos)`, { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mesora-ff-'));
    const out = join(dir, `prueba.${ext}`);
    await encode(format, out);
    const p = probe(out);
    assert.equal(p.video, codec, p.raw);
    assert.equal(p.frames, 12, p.raw);
  });
}

for (const [format, ext] of [['png', 'png'], ['jpg', 'jpg'], ['tiff', 'tif']]) {
  test(`secuencia ${format}: 12 imágenes numeradas desde 00001`, { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mesora-ff-'));
    await encode(format, join(dir, `toma_%05d.${ext}`));
    const files = (await readdir(dir)).sort();
    assert.equal(files.length, 12);
    assert.equal(files[0], `toma_00001.${ext}`);
    assert.equal(files[11], `toma_00012.${ext}`);
  });
}

test('vídeo con audio desplazado y WAV del mismo tramo', { timeout: 60_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mesora-ff-'));
  const wav = join(dir, 'voz.wav');
  await runOnce(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-c:a', 'pcm_s16le', wav]);
  const out = join(dir, 'con-audio.mp4');
  await encode('mp4', out, { audio: { file: wav, startSeconds: 0.5 } });
  const p = probe(out);
  assert.equal(p.audio, 'aac', p.raw);
  assert.equal(p.frames, 12);
  assert.ok(Math.abs(p.duration - 1) < 0.15, `dura ${p.duration} s (12 fotogramas a 12 fps = 1 s)`);

  const tramo = join(dir, 'tramo.wav');
  await runOnce(ffmpeg, buildAudioArgs({ file: wav, startSeconds: 1, durationSeconds: 1.5, out: tramo }));
  const a = probe(tramo);
  assert.equal(a.audio, 'pcm_s16le');
  assert.ok(Math.abs(a.duration - 1.5) < 0.05, `dura ${a.duration} s`);
});

test('cancelar detiene FFmpeg y limpia', { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mesora-ff-'));
  let cleaned = false;
  const job = new ExportJob(ffmpeg, buildArgs({ format: 'mp4', width: 64, height: 48, fps: 12, out: join(dir, 'x.mp4') }), { cleanup: async () => { cleaned = true; } });
  await job.write(new Uint8Array(64 * 48 * 4));
  await job.cancel();
  assert.equal(cleaned, true);
  assert.notEqual(job.proc.exitCode ?? job.proc.signalCode, null);
});
