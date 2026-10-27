// Pixel tests of the stage compositor: the GPU (WebGL2) viewer and the Canvas
// 2D fallback must produce the same images. Runs inside the desktop app
// (Electron) with SwiftShader (except on macOS), so it also works on machines without a GPU.
// Run with: npm run build:web && npm run test:viewer   (xvfb-run -a on Linux without a display)
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const repo = path.join(__dirname, '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mesora-viewer-'));

// SwiftShader on Linux and Windows; macOS runners have a virtual Metal GPU instead.
const GPU_ARGS = process.platform === 'darwin' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

(async () => {
  const app = await electron.launch({
    executablePath: require('electron'),
    args: [repo, '--no-sandbox', `--user-data-dir=${work}/perfil`, ...GPU_ARGS],
    env: { ...process.env, MESORA_LIBRARY: path.join(work, 'lib'), MESORA_TEST: '1' },
  });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.mesora?.state?.project, null, { timeout: 30000 });

  const results = await win.evaluate(async () => {
    const { GLViewer } = await import('./js/viewer-gl.js');
    const { Viewer } = await import('./js/viewer.js');
    const W = 320, H = 180;

    const solid = (rgb, w = W, h = H) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = `rgb(${rgb})`; x.fillRect(0, 0, w, h);
      return createImageBitmap(c);
    };
    const split = (left, right) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = `rgb(${left})`; x.fillRect(0, 0, W / 2, H);
      x.fillStyle = `rgb(${right})`; x.fillRect(W / 2, 0, W / 2, H);
      return createImageBitmap(c);
    };
    const greenWithRed = async () => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d');
      x.fillStyle = 'rgb(0,255,0)'; x.fillRect(0, 0, W, H);
      x.fillStyle = 'rgb(255,0,0)'; x.fillRect(W / 2 - 20, H / 2 - 20, 40, 40);
      return createImageBitmap(c);
    };
    const img = {
      red: await solid('255,0,0'), blue: await solid('0,0,255'), white: await solid('255,255,255'),
      g100: await solid('100,100,100'), g128: await solid('128,128,128'), g200: await solid('200,200,200'),
      wide: await solid('255,0,0', W, W / 4), redBlue: await split('255,0,0', '0,0,255'),
      blackWhite: await split('0,0,0', '255,255,255'), key: await greenWithRed(),
    };

    const make = (Kind) => {
      const area = document.createElement('div');
      const el = (t) => document.createElement(t);
      const v = new Kind({ area, stage: el('div'), main: el('canvas'), overlay: el('canvas'), guides: el('canvas'), loupe: el('canvas') });
      v.setSize(W, H);
      return v;
    };
    const read = (v) => {
      v.flush();
      const c = document.createElement('canvas'); c.width = v.W; c.height = v.H;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(v.main, 0, 0);
      return (px, py) => [...x.getImageData(px, py, 1, 1).data.slice(0, 3)];
    };

    const cases = {
      'dibujo normal': (v) => { v.clear(); v.draw(img.red, W, H); return [[160, 90, [255, 0, 0]]]; },
      'bandas negras (encaje)': (v) => { v.clear(); v.draw(img.wide, W, W / 4); return [[160, 5, [0, 0, 0]], [160, 90, [255, 0, 0]]]; },
      'transparencia 50 %': (v) => { v.clear(); v.draw(img.blue, W, H); v.draw(img.red, W, H, { alpha: 0.5 }); return [[160, 90, [128, 0, 128]]]; },
      'diferencia de iguales = negro': (v) => { v.clear(); v.draw(img.g128, W, H); v.draw(img.g128, W, H, { op: 'difference' }); return [[160, 90, [0, 0, 0]]]; },
      'diferencia de distintos': (v) => { v.clear(); v.draw(img.g100, W, H); v.draw(img.g200, W, H, { op: 'difference' }); return [[160, 90, [100, 100, 100]]]; },
      'destacar lo claro': (v) => { v.clear(); v.draw(img.g200, W, H); v.draw(img.g100, W, H, { op: 'lighten' }); return [[160, 90, [200, 200, 200]]]; },
      'destacar lo oscuro': (v) => { v.clear(); v.draw(img.g200, W, H); v.draw(img.g100, W, H, { op: 'darken' }); return [[160, 90, [100, 100, 100]]]; },
      'brillo ×1.5': (v) => { v.clear(); v.draw(img.g100, W, H, { grade: { brightness: 1.5, contrast: 1, saturation: 1 } }); return [[160, 90, [150, 150, 150]]]; },
      'contraste ×2': (v) => { v.clear(); v.draw(img.g100, W, H, { grade: { brightness: 1, contrast: 2, saturation: 1 } }); return [[160, 90, [73, 73, 73]]]; },
      'saturación 0': (v) => { v.clear(); v.draw(img.red, W, H, { grade: { brightness: 1, contrast: 1, saturation: 0 } }); return [[160, 90, [54, 54, 54]]]; },
      'espejo horizontal': (v) => { v.clear(); v.draw(img.redBlue, W, H, { flipH: true }); return [[40, 90, [0, 0, 255]], [280, 90, [255, 0, 0]]]; },
      'croma sin fondo (cuadros)': (v) => { v.clear(); v.draw(img.key, W, H); v.chroma({ color: '#00ff00', threshold: 0.1, softness: 0.05 }, null); return [[160, 90, [255, 0, 0]], [8, 8, [42, 44, 49]], [24, 8, [58, 61, 68]]]; },
      'croma con fondo': (v) => { v.clear(); v.draw(img.key, W, H); v.chroma({ color: '#00ff00', threshold: 0.1, softness: 0.05 }, img.blue); return [[160, 90, [255, 0, 0]], [20, 20, [0, 0, 255]]]; },
      'comparación A/B (mitad derecha)': (v) => { v.clear(); v.draw(img.red, W, H); v.draw(img.blue, W, H, { clip: [0.5, 1] }); return [[80, 90, [255, 0, 0]], [240, 90, [0, 0, 255]]]; },
      'peaking marca el borde': (v) => { v.clear(); v.draw(img.blackWhite, W, H); v.peaking(60); return [[160, 90, [255, 40, 40]], [40, 90, [0, 0, 0]], [280, 90, [255, 255, 255]]]; },
    };
    const gpuOnly = {
      'tinte de papel cebolla': (v) => { v.clear(); v.draw(img.white, W, H, { tint: [1, 0.5, 0.5] }); return [[160, 90, [255, 128, 128]]]; },
    };

    const out = [];
    let gl;
    try { gl = make(GLViewer); } catch (err) { return { error: `WebGL2 no disponible: ${err.message}` }; }
    const cpu = make(Viewer);
    const check = (viewerName, v, name, fn) => {
      const expects = fn(v);
      const at = read(v);
      for (const [x, y, want] of expects) {
        const got = at(x, y);
        const ok = got.every((c, i) => Math.abs(c - want[i]) <= 4);
        out.push({ ok, msg: `${viewerName} · ${name} @${x},${y}: ${got} (esperado ${want})` });
      }
    };
    for (const [name, fn] of Object.entries(cases)) { check('GPU', gl, name, fn); check('2D ', cpu, name, fn); }
    for (const [name, fn] of Object.entries(gpuOnly)) check('GPU', gl, name, fn);
    return { kind: [gl.kind, cpu.kind], out };
  });

  await app.close();
  fs.rmSync(work, { recursive: true, force: true });
  if (results.error) { console.error(results.error); process.exit(1); }
  let failed = 0;
  for (const r of results.out) {
    console.log(`${r.ok ? '· OK' : '✗ FALLO'} ${r.msg}`);
    if (!r.ok) failed++;
  }
  console.log(failed ? `\n${failed} comprobaciones fallaron` : `\nTODO OK (${results.out.length} comprobaciones, visores: ${results.kind.join(' y ')})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
