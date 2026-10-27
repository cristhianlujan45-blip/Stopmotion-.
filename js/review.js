// Review package: a single HTML file with the take (pictures, timing, notes and
// optionally the sound) that anyone can open in a browser, without installing
// anything. The reviewer writes notes per frame and downloads them as a small
// file that MESORA reads back into the timeline.

export const NOTES_FORMAT = 'mesora-review-notes';

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/**
 * @param {{ project: object, frames: object[], decode: (id: string) => Promise<ImageBitmap|null>,
 *           audioWav?: Uint8Array|null, maxWidth?: number, onProgress?: (v: number) => void }} opts
 * @returns {Promise<Blob>} the HTML file
 */
export async function buildReviewPackage({ project, frames, decode, audioWav = null, maxWidth = 960, onProgress }) {
  const ids = [...new Set(frames.map((f) => f.id))];
  const images = {};
  for (let i = 0; i < ids.length; i++) {
    const bmp = await decode(ids[i]);
    if (bmp) {
      const scale = Math.min(1, maxWidth / bmp.width);
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale);
      c.height = Math.round(bmp.height * scale);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close?.();
      images[ids[i]] = await toDataUrl(await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82)));
    }
    onProgress?.((i + 1) / ids.length);
  }
  const data = {
    format: 'mesora-review', version: 1,
    id: `${project.id}:${Date.now()}`,
    takeId: project.id,
    title: project.name,
    take: project.scene ? `${project.scene.name} · ${project.take.name}` : '',
    fps: project.fps,
    createdAt: new Date().toISOString(),
    frames: frames.filter((f) => images[f.id]).map((f) => ({ key: f.key, id: f.id, hold: f.hold || 1, note: f.note || '' })),
    images,
    audio: audioWav ? await toDataUrl(new Blob([audioWav], { type: 'audio/wav' })) : null,
  };
  // Nothing in the data may close the <script> element that holds it.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return new Blob([TEMPLATE.replace('__TITLE__', escapeHtml(`${project.name} · revisión`)).replace('__DATA__', () => json)], { type: 'text/html' });
}

/** Notes downloaded from a review package, or null if the text is not one. */
export function parseReviewNotes(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (data?.format !== NOTES_FORMAT || !Array.isArray(data.notes)) return null;
  return {
    takeId: data.takeId || '', title: data.title || '', reviewer: String(data.reviewer || '').slice(0, 80),
    general: String(data.general || ''),
    notes: data.notes.filter((n) => n && (n.key || n.id) && String(n.text || '').trim())
      .map((n) => ({ key: n.key, id: n.id, frame: Number(n.frame) || 0, text: String(n.text).trim() })),
  };
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const TEMPLATE = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; base-uri 'none'; form-action 'none'">
<title>__TITLE__</title>
<style>
  :root { --bg:#0e0f12; --panel:#1c1f26; --line:#2a2f3a; --text:#e8eaef; --muted:#8d94a3; --accent:#ff4d3d; --note:#3b82f6; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  header { display:flex; justify-content:space-between; align-items:baseline; gap:12px; padding:12px 16px; border-bottom:1px solid var(--line); flex-wrap:wrap; }
  h1 { font-size:17px; margin:0; } .muted { color:var(--muted); font-size:12.5px; }
  main { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:16px; padding:16px; }
  @media (max-width: 860px) { main { grid-template-columns: 1fr; } }
  .stage { background:#000; border-radius:8px; aspect-ratio:16/9; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .stage img { max-width:100%; max-height:100%; display:block; }
  .bar { display:flex; gap:8px; align-items:center; margin:10px 0; flex-wrap:wrap; }
  button { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px 12px; font:inherit; cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:700; }
  #pos { font-variant-numeric: tabular-nums; min-width:150px; }
  .strip { display:flex; gap:3px; overflow-x:auto; padding-bottom:6px; }
  .strip img { height:46px; border-radius:3px; border:2px solid transparent; cursor:pointer; flex:none; }
  .strip img.cur { border-color:var(--accent); } .strip img.has { outline:2px solid var(--note); outline-offset:-2px; }
  aside { display:flex; flex-direction:column; gap:10px; }
  textarea, input { width:100%; background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px; font:inherit; }
  textarea { min-height:110px; resize:vertical; }
  label { font-size:12.5px; color:var(--muted); display:flex; flex-direction:column; gap:4px; }
  .anim { background:var(--panel); border-radius:8px; padding:8px 10px; font-size:13px; }
  ol { margin:0; padding-left:20px; max-height:220px; overflow:auto; } li { cursor:pointer; margin:2px 0; }
</style>
</head>
<body>
<header><div><h1 id="title"></h1><div class="muted" id="sub"></div></div><div class="muted">Paquete de revisión de MESORA Studio</div></header>
<main>
  <section>
    <div class="stage"><img id="pic" alt="Fotograma"></div>
    <div class="bar">
      <button id="prev" title="Anterior (←)">‹</button>
      <button id="play" class="primary" title="Reproducir / parar (espacio)">Reproducir</button>
      <button id="next" title="Siguiente (→)">›</button>
      <label style="flex-direction:row;align-items:center"><input type="checkbox" id="loop" style="width:auto" checked> Bucle</label>
      <span id="pos" class="muted"></span>
    </div>
    <div class="strip" id="strip"></div>
  </section>
  <aside>
    <div class="anim" id="animNote" hidden></div>
    <label>Tu nota para este fotograma<textarea id="note" placeholder="Por ejemplo: la mano se adelanta, el brazo salta…"></textarea></label>
    <label>Comentario general<textarea id="general" style="min-height:70px"></textarea></label>
    <label>Tu nombre<input id="reviewer" maxlength="80"></label>
    <button class="primary" id="save">Descargar mis notas</button>
    <div class="muted">Envía el archivo de notas a quien te mandó este paquete: MESORA las pone en cada fotograma. Tus notas también se guardan en este navegador.</div>
    <div class="muted" id="count"></div>
    <ol id="list"></ol>
  </aside>
</main>
<audio id="snd" preload="auto"></audio>
<script type="application/json" id="data">__DATA__</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById('data').textContent);
  const $ = (id) => document.getElementById(id);
  const F = D.frames;
  const key = 'mesora-review:' + D.id;
  let store = {};
  try { store = JSON.parse(localStorage.getItem(key) || '{}'); } catch {}
  const notes = store.notes || {};
  const persist = () => { try { localStorage.setItem(key, JSON.stringify({ notes, general: $('general').value, reviewer: $('reviewer').value })); } catch {} };
  $('general').value = store.general || '';
  $('reviewer').value = store.reviewer || '';
  $('title').textContent = D.title;
  $('sub').textContent = [D.take, F.length + ' fotogramas', D.fps + ' fps', 'enviado ' + new Date(D.createdAt).toLocaleString()].filter(Boolean).join(' · ');
  const starts = []; let total = 0;
  for (const f of F) { starts.push(total); total += f.hold; }
  let i = 0, timer = null;
  if (D.audio) $('snd').src = D.audio;

  const strip = $('strip');
  F.forEach((f, k) => { const im = document.createElement('img'); im.src = D.images[f.id]; im.alt = 'Fotograma ' + (k + 1); im.onclick = () => { stop(); show(k); }; strip.append(im); });

  function show(k) {
    i = Math.max(0, Math.min(F.length - 1, k));
    const f = F[i];
    $('pic').src = D.images[f.id];
    $('pos').textContent = 'Fotograma ' + (i + 1) + ' / ' + F.length + (f.hold > 1 ? ' (dura ' + f.hold + ' cuadros)' : '');
    $('note').value = notes[f.key] || '';
    $('animNote').hidden = !f.note;
    $('animNote').textContent = f.note ? 'Nota del animador: ' + f.note : '';
    [...strip.children].forEach((im, k2) => { im.classList.toggle('cur', k2 === i); im.classList.toggle('has', !!notes[F[k2].key]); });
    strip.children[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function renderList() {
    const list = $('list'); list.innerHTML = '';
    const ks = F.map((f, k) => [f, k]).filter(([f]) => notes[f.key]);
    $('count').textContent = !ks.length ? 'Aún no hay notas.' : ks.length === 1 ? '1 fotograma con nota:' : ks.length + ' fotogramas con nota:';
    for (const [f, k] of ks) { const li = document.createElement('li'); li.textContent = 'Fot. ' + (k + 1) + ': ' + notes[f.key]; li.onclick = () => { stop(); show(k); }; list.append(li); }
  }
  function play() {
    if (timer) return stop();
    if (i >= F.length - 1) i = 0;
    $('play').textContent = 'Parar';
    const t0 = performance.now() - starts[i] * 1000 / D.fps;
    if (D.audio) { const a = $('snd'); a.currentTime = starts[i] / D.fps; a.play().catch(() => {}); }
    timer = setInterval(() => {
      const e = Math.floor((performance.now() - t0) * D.fps / 1000);
      if (e >= total) { if ($('loop').checked) { stop(); i = 0; play(); } else { stop(); } return; }
      let k = i; while (k < F.length - 1 && starts[k + 1] <= e) k++;
      if (k !== i) show(k);
    }, 1000 / Math.max(D.fps, 1) / 2);
  }
  function stop() { clearInterval(timer); timer = null; $('play').textContent = 'Reproducir'; $('snd').pause(); }
  $('play').onclick = play;
  $('prev').onclick = () => { stop(); show(i - 1); };
  $('next').onclick = () => { stop(); show(i + 1); };
  $('note').oninput = () => { const t = $('note').value.trim(); if (t) notes[F[i].key] = t; else delete notes[F[i].key]; persist(); renderList(); strip.children[i].classList.toggle('has', !!t); };
  $('general').oninput = persist; $('reviewer').oninput = persist;
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('textarea, input')) return;
    if (e.key === 'ArrowLeft') { stop(); show(i - 1); } else if (e.key === 'ArrowRight') { stop(); show(i + 1); } else if (e.key === ' ') { e.preventDefault(); play(); }
  });
  $('save').onclick = () => {
    const out = { format: '${NOTES_FORMAT}', version: 1, takeId: D.takeId, title: D.title, take: D.take, reviewer: $('reviewer').value.trim(), general: $('general').value.trim(),
      createdAt: new Date().toISOString(), notes: F.map((f, k) => ({ key: f.key, id: f.id, frame: k + 1, text: notes[f.key] || '' })).filter((n) => n.text) };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }));
    a.download = 'notas-revision-' + D.title.replace(/[^\\w\\u00C0-\\u024F -]+/g, '').trim().replace(/\\s+/g, '_') + '.json';
    document.body.append(a); a.click(); a.remove();
  };
  show(0); renderList();
})();
</script>
</body>
</html>`;
