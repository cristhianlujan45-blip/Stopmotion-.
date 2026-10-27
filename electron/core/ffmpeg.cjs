// Offline export with FFmpeg: the editor composes every exposure (grade,
// deflicker, scaling) and sends raw RGBA pixels; FFmpeg encodes them exactly
// one picture per exposure, so nothing depends on playback timing.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/** Export formats. `kind` 'video' writes one file; 'images' writes a numbered sequence into a folder. */
const FORMATS = {
  mp4: { kind: 'video', ext: 'mp4', label: 'MP4 (H.264)', video: ['-c:v', 'libx264', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'], audio: ['-c:a', 'aac', '-b:a', '192k'], even: true },
  prores: { kind: 'video', ext: 'mov', label: 'MOV ProRes 422 HQ', video: ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s16le'], even: true },
  mjpeg: { kind: 'video', ext: 'avi', label: 'AVI Motion JPEG', video: ['-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj420p'], audio: ['-c:a', 'pcm_s16le'], even: true },
  png: { kind: 'images', ext: 'png', label: 'Secuencia PNG', video: ['-c:v', 'png'] },
  jpg: { kind: 'images', ext: 'jpg', label: 'Secuencia JPEG', video: ['-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj444p'] },
  tiff: { kind: 'images', ext: 'tif', label: 'Secuencia TIFF', video: ['-c:v', 'tiff', '-compression_algo', 'lzw'] },
};

/** MP4 constant quality (CRF) per quality setting: lower is better. */
const CRF = { alta: 16, media: 20, ligera: 26 };

/**
 * Arguments for an export.
 * @param {object} spec { format, width, height, fps, out, quality, audio: { file, startSeconds, durationSeconds } | null }
 * `out` is the output file, or for image sequences the pattern inside the target folder (e.g. .../name_%05d.png).
 */
function buildArgs(spec) {
  const f = FORMATS[spec.format];
  if (!f) throw new Error(`Formato desconocido: ${spec.format}`);
  const { width, height, fps } = spec;
  if (!(width > 0 && height > 0 && fps > 0)) throw new Error('Tamaño o velocidad no válidos');
  if (f.even && (width % 2 || height % 2)) throw new Error('El vídeo necesita ancho y alto pares');
  const args = ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-framerate', String(fps), '-i', 'pipe:0'];
  const withAudio = f.kind === 'video' && spec.audio?.file;
  if (withAudio) {
    const start = spec.audio.startSeconds || 0;
    // A positive start skips into the audio; a negative one means the sound begins later than the first frame.
    if (start > 0) args.push('-ss', start.toFixed(4));
    args.push('-i', spec.audio.file);
  }
  args.push('-map', '0:v');
  if (withAudio) {
    args.push('-map', '1:a');
    const start = spec.audio.startSeconds || 0;
    if (start < 0) args.push('-af', `adelay=${Math.round(-start * 1000)}:all=1`);
    args.push(...f.audio, '-shortest');
  }
  args.push(...f.video);
  if (spec.format === 'mp4') args.push('-crf', String(CRF[spec.quality] ?? CRF.alta));
  args.push('-r', String(fps));
  if (f.kind === 'images') args.push('-start_number', '1');
  args.push(spec.out);
  return args;
}

/** One running export: write frames, then finish. */
class ExportJob {
  constructor(ffmpegPath, args, { cleanup } = {}) {
    this.cleanup = cleanup;
    this.stderr = '';
    this.proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    this.proc.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000); });
    this.done = new Promise((resolve, reject) => {
      this.proc.on('error', reject);
      this.proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(this.stderr.trim() || `FFmpeg terminó con el código ${code}`))));
    });
    this.done.catch(() => {});
    this.proc.stdin.on('error', () => {}); // reported through `done`
  }

  /** Resolves when FFmpeg has accepted the frame (back-pressure keeps memory flat). */
  write(bytes, times = 1) {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = Promise.resolve();
    for (let i = 0; i < times; i++) {
      p = p.then(() => new Promise((resolve, reject) => {
        if (this.proc.exitCode != null) { reject(new Error(this.stderr.trim() || 'FFmpeg se detuvo')); return; }
        if (this.proc.stdin.write(buf)) resolve();
        else this.proc.stdin.once('drain', resolve);
      }));
    }
    return p;
  }

  async finish() {
    this.proc.stdin.end();
    await this.done;
  }

  async cancel() {
    this.proc.stdin.destroy();
    this.proc.kill('SIGKILL');
    await this.done.catch(() => {});
    await this.cleanup?.();
  }
}

function runOnce(ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `FFmpeg terminó con el código ${code}`))));
  });
}

/** Path of the bundled FFmpeg (outside the asar archive when packaged), or null. */
function bundledFFmpeg() {
  try {
    const p = require('ffmpeg-static');
    if (!p) return null;
    const real = p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return fs.existsSync(real) ? real : null;
  } catch {
    return null;
  }
}

module.exports = { FORMATS, CRF, buildArgs, ExportJob, runOnce, bundledFFmpeg };
