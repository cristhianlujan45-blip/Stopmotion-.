// Renders the app icons (desktop, Android, PWA) from the SVG sources.
// Usage: node scripts/make-icons.cjs   (needs Playwright + Chromium)
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'icons/icon.svg'), 'utf8');
const fg = fs.readFileSync(path.join(root, 'icons/icon-foreground.svg'), 'utf8');
const BG = '#15171c';

// [file, size, html]
const full = (size) => `<div style="width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div>`;
const round = (size) => `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${BG};overflow:hidden;display:flex;align-items:center;justify-content:center">${fg.replace('<svg ', `<svg width="${size * 0.82}" height="${size * 0.82}" `)}</div>`;
// Adaptive icon foreground: artwork inside the central 66% safe zone of a 108dp canvas.
const adaptive = (size) => `<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${fg.replace('<svg ', `<svg width="${size * 0.62}" height="${size * 0.62}" `)}</div>`;

const res = 'android/app/src/main/res';
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const jobs = [
  ['build/icon.png', 1024, full(1024)],
  ['icons/icon-192.png', 192, full(192)],
  ['icons/icon-512.png', 512, full(512)],
];
for (const [d, k] of Object.entries(densities)) {
  jobs.push([`${res}/mipmap-${d}/ic_launcher.png`, 48 * k, full(48 * k)]);
  jobs.push([`${res}/mipmap-${d}/ic_launcher_round.png`, 48 * k, round(48 * k)]);
  jobs.push([`${res}/mipmap-${d}/ic_launcher_foreground.png`, 108 * k, adaptive(108 * k)]);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [file, size, html] of jobs) {
    const out = path.join(root, file);
    if (file.startsWith('android/') && !fs.existsSync(path.join(root, res))) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
    await page.locator('body > div').screenshot({ path: out, omitBackground: true });
    console.log(file);
  }
  await browser.close();
})();
