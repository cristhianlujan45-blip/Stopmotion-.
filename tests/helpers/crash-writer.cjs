// Child process for the no-loss test: shoots captures as fast as it can and
// saves the timeline now and then, until the parent kills it with SIGKILL.
// After each capture is confirmed it prints "OK <id> <sha256>".
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Library } = require('../../electron/core/library.cjs');

const [root, key] = process.argv.slice(2);

(async () => {
  const lib = new Library(root);
  const { project } = await lib.getProject(key);
  for (;;) {
    const bytes = crypto.randomBytes(20_000 + Math.floor(Math.random() * 180_000));
    const { id } = await lib.ingestCapture(key, { full: { bytes, type: 'image/jpeg' }, meta: { w: 10, h: 10 } });
    fs.writeSync(1, `OK ${id} ${crypto.createHash('sha256').update(bytes).digest('hex')}\n`);
    project.frames.push({ key: id, id, hold: 1 });
    if (Math.random() < 0.3) await lib.saveProject(project);
  }
})();
