// Copies the web app into www/, the folder packaged by the desktop (Electron)
// and Android (Capacitor) builds.
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');
const entries = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const entry of entries) await cp(join(root, entry), join(out, entry), { recursive: true });

// Which commit this build comes from, so the desktop app can tell when a newer download exists.
let commit = process.env.GITHUB_SHA || null;
if (!commit) {
  try { commit = execSync('git rev-parse HEAD', { cwd: root }).toString().trim(); } catch { commit = null; }
}
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
await writeFile(join(out, 'build.json'), `${JSON.stringify({ version, commit, date: new Date().toISOString() })}\n`);
console.log(`Web app copiada en ${out}`);
