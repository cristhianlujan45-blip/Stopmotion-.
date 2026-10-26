// Copies the web app into www/, the folder packaged by the desktop (Electron)
// and Android (Capacitor) builds.
import { cp, rm, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const entries = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const entry of entries) await cp(join(root, entry), join(out, entry), { recursive: true });
console.log(`Web app copiada en ${out}`);
