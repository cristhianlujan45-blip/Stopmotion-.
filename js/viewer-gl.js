// GPU (WebGL2) version of the stage compositor. Same drawing API as the
// Canvas 2D Viewer, but every layer, blend mode, colour grade, chroma key and
// focus-peaking pass runs in shaders, so the live view keeps its frame rate
// at high resolutions. createViewer() falls back to the 2D viewer when the
// computer has no WebGL2.
import { Viewer } from './viewer.js';
import { fitContain, fitCover } from './util.js';

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Shared helpers. Pixel coordinates are in "image space": origin top-left, y down.
const COMMON = `#version 300 es
precision highp float;
uniform vec2 uSize;
out vec4 outColor;
vec2 imagePx() { return vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y); }
vec4 accAt(sampler2D acc) { return texture(acc, gl_FragCoord.xy / uSize); }
// Maps an image-space pixel into a texture drawn at rect (x, y, w, h).
vec2 rectUv(vec4 rect, vec2 p) { return (p - rect.xy) / rect.zw; }
bool inside(vec2 uv) { return all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0))); }
`;

const LAYER = `${COMMON}
uniform sampler2D uAcc;
uniform sampler2D uSrc;
uniform vec4 uRect;
uniform vec2 uFlip;
uniform float uAlpha;
uniform int uMode;      // 0 normal, 1 difference, 2 lighten, 3 darken
uniform vec3 uGrade;    // brightness, contrast, saturation (CSS filter semantics)
uniform vec3 uTint;
void main() {
  vec4 dst = accAt(uAcc);
  vec2 uv = rectUv(uRect, imagePx());
  if (!inside(uv)) { outColor = dst; return; }
  uv = mix(uv, 1.0 - uv, uFlip);
  vec3 c = texture(uSrc, uv).rgb;
  c = clamp(c * uGrade.x, 0.0, 1.0);
  c = clamp((c - 0.5) * uGrade.y + 0.5, 0.0, 1.0);
  float l = dot(c, vec3(0.213, 0.715, 0.072));
  c = clamp(mix(vec3(l), c, uGrade.z), 0.0, 1.0);
  c *= uTint;
  vec3 r = c;
  if (uMode == 1) r = abs(dst.rgb - c);
  else if (uMode == 2) r = max(dst.rgb, c);
  else if (uMode == 3) r = min(dst.rgb, c);
  outColor = vec4(mix(dst.rgb, r, uAlpha), 1.0);
}`;

const CHROMA = `${COMMON}
uniform sampler2D uAcc;
uniform sampler2D uBg;
uniform bool uHasBg;
uniform vec4 uBgRect;
uniform vec3 uKey;
uniform float uThreshold;
uniform float uSoft;
vec2 cbcr(vec3 c) {
  return vec2(-0.168736 * c.r - 0.331264 * c.g + 0.5 * c.b, 0.5 * c.r - 0.418688 * c.g - 0.081312 * c.b);
}
void main() {
  vec2 p = imagePx();
  vec3 c = accAt(uAcc).rgb;
  float a = clamp((distance(cbcr(c), cbcr(uKey)) - uThreshold) / max(0.001, uSoft), 0.0, 1.0);
  if (a < 1.0) {
    // Spill suppression, as in the 2D viewer.
    if (uKey.g >= uKey.r && uKey.g >= uKey.b) c.g = min(c.g, max(c.r, c.b));
    else if (uKey.b > uKey.r && uKey.b > uKey.g) c.b = min(c.b, max(c.r, c.g));
  }
  vec3 bg;
  if (uHasBg) {
    bg = texture(uBg, clamp(rectUv(uBgRect, p), 0.0, 1.0)).rgb;
  } else {
    bool odd = mod(floor(p.x / 16.0) + floor(p.y / 16.0), 2.0) < 1.0;
    bg = odd ? vec3(0.165, 0.173, 0.192) : vec3(0.227, 0.239, 0.267);
  }
  outColor = vec4(mix(bg, c, a), 1.0);
}`;

const PEAK = `${COMMON}
uniform sampler2D uAcc;
uniform vec2 uStep;
uniform float uThreshold;
uniform vec3 uColor;
float lum(vec2 o) { return dot(texture(uAcc, gl_FragCoord.xy / uSize + o).rgb, vec3(77.0, 150.0, 29.0) / 256.0) * 255.0; }
void main() {
  vec2 s = uStep;
  float tl = lum(vec2(-s.x, s.y)), tc = lum(vec2(0.0, s.y)), tr = lum(vec2(s.x, s.y));
  float ml = lum(vec2(-s.x, 0.0)), mr = lum(vec2(s.x, 0.0));
  float bl = lum(vec2(-s.x, -s.y)), bc = lum(vec2(0.0, -s.y)), br = lum(vec2(s.x, -s.y));
  float gx = tr + 2.0 * mr + br - tl - 2.0 * ml - bl;
  float gy = bl + 2.0 * bc + br - tl - 2.0 * tc - tr;
  vec3 c = accAt(uAcc).rgb;
  outColor = vec4(abs(gx) + abs(gy) > uThreshold ? uColor : c, 1.0);
}`;

const PRESENT = `${COMMON}
uniform sampler2D uAcc;
void main() { outColor = accAt(uAcc); }`;

const MODES = { 'source-over': 0, difference: 1, lighten: 2, darken: 3 };
const MAX_TEXTURES = 24;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function program(gl, frag) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const { name } = gl.getActiveUniform(p, i);
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { p, u: uniforms };
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export class GLViewer extends Viewer {
  initContext() {
    this.gl = this.main.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!this.gl) throw new Error('WebGL2 no disponible');
    this.kind = 'gpu';
    this.setupGL();
    this.main.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    this.main.addEventListener('webglcontextrestored', () => { this.lost = false; this.setupGL(); });
  }

  setupGL() {
    const { gl } = this;
    this.progs = {
      layer: program(gl, LAYER), chroma: program(gl, CHROMA), peak: program(gl, PEAK), present: program(gl, PRESENT),
    };
    this.quad = gl.createVertexArray();
    gl.bindVertexArray(this.quad);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.textures = new Map(); // source → texture, for still images (ImageBitmap)
    this.streamTex = this.makeTexture();
    this.targets = null;
    this.targetSize = '';
  }

  makeTexture() {
    const { gl } = this;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Two render targets used in turn: each pass reads one and writes the other. */
  ensureTargets() {
    const { gl, W, H } = this;
    const key = `${W}x${H}`;
    if (this.targetSize === key) return;
    for (const t of this.targets || []) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    this.targets = [0, 1].map(() => {
      const tex = this.makeTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb };
    });
    this.cur = 0;
    this.targetSize = key;
  }

  /** Uploads a source as a texture. Still images are cached; video is re-uploaded each frame. */
  textureFor(src) {
    const { gl } = this;
    const still = typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap;
    if (still && this.textures.has(src)) {
      const t = this.textures.get(src);
      this.textures.delete(src); // keep LRU order
      this.textures.set(src, t);
      return t;
    }
    const tex = still ? this.makeTexture() : this.streamTex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    if (still) {
      this.textures.set(src, tex);
      // Drop textures of closed bitmaps and keep the cache bounded.
      for (const [bmp, t] of this.textures) {
        if (this.textures.size <= MAX_TEXTURES && bmp.width) continue;
        if (bmp === src) continue;
        gl.deleteTexture(t);
        this.textures.delete(bmp);
      }
    }
    return tex;
  }

  pass(prog, setup) {
    const { gl, W, H } = this;
    this.ensureTargets();
    const read = this.targets[this.cur];
    const write = this.targets[1 - this.cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fb);
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u.uSize, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.tex);
    gl.uniform1i(prog.u.uAcc, 0);
    setup(prog.u);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.cur = 1 - this.cur;
  }

  /** Shows the finished composite; called once per frame. */
  flush() {
    if (this.pending && !this.lost) this.present();
    this.pending = false;
  }

  clear(color = '#000') {
    if (this.lost) return;
    const { gl } = this;
    this.ensureTargets();
    const [r, g, b] = hexToRgb(color);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[this.cur].fb);
    gl.viewport(0, 0, this.W, this.H);
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.pending = true;
  }

  draw(src, sw, sh, { flipH = false, flipV = false, alpha = 1, op = 'source-over', grade = null, tint = null } = {}) {
    if (this.lost || !sw || !sh) return;
    const { gl } = this;
    const f = fitContain(sw, sh, this.W, this.H);
    const tex = this.textureFor(src);
    this.pass(this.progs.layer, (u) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.uSrc, 1);
      gl.uniform4f(u.uRect, f.x, f.y, f.w, f.h);
      gl.uniform2f(u.uFlip, flipH ? 1 : 0, flipV ? 1 : 0);
      gl.uniform1f(u.uAlpha, alpha);
      gl.uniform1i(u.uMode, MODES[op] ?? 0);
      gl.uniform3f(u.uGrade, grade?.brightness ?? 1, grade?.contrast ?? 1, grade?.saturation ?? 1);
      gl.uniform3fv(u.uTint, tint || [1, 1, 1]);
    });
    this.pending = true;
  }

  chroma({ color, threshold, softness }, background) {
    if (this.lost) return;
    const { gl } = this;
    const bgTex = background ? this.textureFor(background) : null;
    const r = background ? fitCover(background.width, background.height, this.W, this.H) : null;
    this.pass(this.progs.chroma, (u) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bgTex || this.streamTex);
      gl.uniform1i(u.uBg, 1);
      gl.uniform1i(u.uHasBg, background ? 1 : 0);
      if (r) gl.uniform4f(u.uBgRect, r.x, r.y, r.w, r.h);
      gl.uniform3fv(u.uKey, hexToRgb(color));
      gl.uniform1f(u.uThreshold, threshold);
      gl.uniform1f(u.uSoft, softness);
    });
    this.pending = true;
  }

  /** Same detector as the 2D viewer (Sobel on a 480 px wide image), now at full resolution. */
  peaking(threshold = 60, color = [255, 40, 40]) {
    if (this.lost) return;
    const { gl, W, H } = this;
    const pw = Math.min(480, W);
    const ph = Math.round((pw * H) / W);
    this.pass(this.progs.peak, (u) => {
      gl.uniform2f(u.uStep, 1 / pw, 1 / ph);
      gl.uniform1f(u.uThreshold, threshold * 4);
      gl.uniform3f(u.uColor, color[0] / 255, color[1] / 255, color[2] / 255);
    });
    this.pending = true;
  }

  /** Copies the composite to the visible canvas. */
  present() {
    const { gl, W, H } = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const prog = this.progs.present;
    gl.useProgram(prog.p);
    gl.uniform2f(prog.u.uSize, W, H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.targets[this.cur].tex);
    gl.uniform1i(prog.u.uAcc, 0);
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/** GPU viewer when the computer supports WebGL2, otherwise the Canvas 2D one. */
export function createViewer(opts) {
  try {
    return new GLViewer(opts);
  } catch (err) {
    console.warn('Visor en GPU no disponible; se usa el visor 2D.', err.message);
    return new Viewer(opts);
  }
}
