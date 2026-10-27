// Interface language. The app is written in Spanish; for another language the
// page is translated as it is drawn (texts, tooltips, placeholders) and again
// whenever the app adds or changes something (notices, lists, the HUD), by
// exact text or by patterns with numbers and names. Projects and files keep
// their own names.
import { EN } from './i18n-en.js';

const LS_LANG = 'mesora.lang';
export const LANGS = { es: 'Español', en: 'English' };
const DICTS = { en: EN };
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);

let dict = null;

export function currentLang() {
  try {
    const saved = localStorage.getItem(LS_LANG);
    if (saved && LANGS[saved]) return saved;
  } catch { /* private mode */ }
  return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function saveLang(lang) {
  try { localStorage.setItem(LS_LANG, lang); } catch { /* private mode */ }
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Translation of a whole text (unchanged when there is none). */
export function t(text, depth = 0) {
  if (!dict || text == null) return text;
  const s = String(text);
  const key = norm(s);
  if (!key || !/[A-Za-zÀ-ÿ]/.test(key) || depth > 3) return s;
  const lead = s.match(/^\s*/)[0];
  const trail = s.slice(lead.length).match(/\s*$/)[0];
  const exact = dict.exact.get(key);
  if (exact != null) return lead + exact + trail;
  for (const [re, out] of dict.patterns) {
    const m = re.exec(key);
    if (!m) continue;
    const tr = (x) => t(x ?? '', depth + 1);
    return lead + (typeof out === 'function' ? out(m, tr) : out.replace(/\$(\d)/g, (_, n) => tr(m[n]))) + trail;
  }
  // Several sentences put together (e.g. two warnings): translate each one.
  const parts = key.split(/(?<=[.?!:])\s+(?=[¿¡A-ZÁÉÍÓÚÑ«])/);
  if (parts.length > 1) {
    const out = parts.map((p) => t(p, depth + 1));
    if (out.some((p, i) => p !== parts[i])) return lead + out.join(' ') + trail;
  }
  return s;
}

function translateText(node) {
  const v = node.nodeValue;
  if (!v || !/[A-Za-zÀ-ÿ]/.test(v)) return;
  const parent = node.parentElement;
  if (parent && (SKIP.has(parent.tagName) || parent.closest('[data-no-i18n]'))) return;
  const out = t(v);
  if (out !== v) node.nodeValue = out;
}

function translateAttr(el, name) {
  const v = el.getAttribute(name);
  if (!v) return;
  const out = t(v);
  if (out !== v) el.setAttribute(name, out);
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) { translateText(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE || SKIP.has(root.tagName)) return;
  for (const a of ATTRS) if (root.hasAttribute(a)) translateAttr(root, a);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) translateText(n);
    else for (const a of ATTRS) if (n.hasAttribute(a)) translateAttr(n, a);
  }
}

/** Starts translating the page; does nothing for Spanish. */
export function setupI18n(lang = currentLang()) {
  document.documentElement.lang = lang;
  if (lang === 'es' || !DICTS[lang]) return;
  const d = DICTS[lang];
  dict = { exact: new Map(d.exact.map(([es, other]) => [norm(es), other])), patterns: d.patterns };
  translateTree(document.documentElement);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') translateText(r.target);
      else if (r.type === 'attributes') translateAttr(r.target, r.attributeName);
      else for (const n of r.addedNodes) translateTree(n);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  // Native dialogs too.
  const { confirm, alert, prompt } = window;
  window.confirm = (msg) => confirm.call(window, t(msg));
  window.alert = (msg) => alert.call(window, t(msg));
  window.prompt = (msg, value) => prompt.call(window, t(msg), value);
}
