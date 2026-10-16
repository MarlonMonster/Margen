'use strict';
/**
 * Builds web/: a static copy of Margen that runs entirely in the browser (no server).
 * Needs the data built first (node scripts/setup.js). Host the web/ folder anywhere that serves static files over HTTPS.
 */
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { LINKS } = require('../lib/sources');

const root = path.join(__dirname, '..');
const out = path.join(root, process.argv[2] || 'web');
const dataDir = path.join(root, 'data');

async function copyDir(from, to, filter = () => true) {
  await fsp.mkdir(to, { recursive: true });
  const names = [];
  for (const n of await fsp.readdir(from)) {
    if (!filter(n)) continue;
    await fsp.copyFile(path.join(from, n), path.join(to, n));
    names.push(n);
  }
  return names;
}

async function main() {
  if (!fs.existsSync(path.join(dataDir, 'READY'))) throw new Error('Run "node scripts/setup.js" first: the dictionary data is not built.');
  await fsp.rm(out, { recursive: true, force: true });
  await fsp.mkdir(out, { recursive: true });

  /* App files */
  for (const f of ['app.css', 'app.js', 'vocab.js', 'train.js', 'icon.svg']) await fsp.copyFile(path.join(root, 'public', f), path.join(out, f));
  await fsp.copyFile(path.join(root, 'web-src', 'engine.js'), path.join(out, 'engine.js'));
  await fsp.copyFile(path.join(root, 'web-src', 'shim.js'), path.join(out, 'shim.js'));
  for (const n of await fsp.readdir(path.join(root, 'web-src', 'icons'))) await fsp.copyFile(path.join(root, 'web-src', 'icons', n), path.join(out, n));

  let html = await fsp.readFile(path.join(root, 'public', 'index.html'), 'utf8');
  html = html.replace('<script src="vocab.js"></script>\n<script src="train.js"></script>\n<script src="app.js"></script>', '<script src="engine.js"></script>\n<script src="shim.js"></script>\n<script src="vocab.js"></script>\n<script src="train.js"></script>\n<script src="app.js"></script>')
    .replace('<link rel="apple-touch-icon" href="icon.svg">', '<link rel="apple-touch-icon" href="icon-180.png">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="Margen">');
  await fsp.writeFile(path.join(out, 'index.html'), html);

  const manifest = JSON.parse(await fsp.readFile(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  manifest.start_url = './'; manifest.scope = './';
  manifest.icons = [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ];
  await fsp.writeFile(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

  /* Starter texts */
  const tdir = path.join(out, 'texts');
  const names = (await copyDir(path.join(root, 'texts'), tdir, (n) => n.endsWith('.json'))).sort();
  const index = [];
  for (const n of names) {
    const t = JSON.parse(await fsp.readFile(path.join(tdir, n), 'utf8'));
    index.push({ id: t.id, title: t.title, author: t.author || '', level: t.level || '', kind: t.kind || 'text', pairs: !!t.pairs, cover: t.cover || null, audio: false, source: t.source ? t.source.name : '', bundled: true });
  }
  await fsp.writeFile(path.join(tdir, 'index.json'), JSON.stringify(index));

  const links = [
    { name: 'Project Gutenberg: Spanish books', url: 'https://www.gutenberg.org/browse/languages/es', note: 'Public-domain books. Open one, choose “Plain Text UTF-8”, copy it, and paste it under Add text. (A web page cannot fetch these for you.)' },
    ...LINKS,
  ];
  await fsp.writeFile(path.join(out, 'links.json'), JSON.stringify(links));

  /* Data */
  const ddir = path.join(out, 'data');
  const files = [];
  for (const sub of ['dict', 'forms']) {
    for (const n of await copyDir(path.join(dataDir, sub), path.join(ddir, sub))) files.push(`${sub}/${n}`);
  }
  for (const n of ['freq.json', 'verbs.json', 'sentences.json']) { await fsp.copyFile(path.join(dataDir, n), path.join(ddir, n)); files.push(n); }
  await fsp.writeFile(path.join(ddir, 'manifest.json'), JSON.stringify({ files }));

  /* Service worker, versioned by the content of the app files */
  const shell = ['./', 'index.html', 'app.css', 'app.js', 'vocab.js', 'train.js', 'engine.js', 'shim.js', 'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest', 'links.json', 'texts/index.json', ...names.map((n) => `texts/${n}`)];
  const h = crypto.createHash('sha1');
  for (const f of shell.filter((f) => f !== './')) h.update(await fsp.readFile(path.join(out, f)));
  const sw = (await fsp.readFile(path.join(root, 'web-src', 'sw.js'), 'utf8')).replace('__VERSION__', h.digest('hex').slice(0, 10)).replace('__SHELL_FILES__', JSON.stringify(shell));
  await fsp.writeFile(path.join(out, 'sw.js'), sw);
  await fsp.writeFile(path.join(out, '.nojekyll'), '');
  await fsp.copyFile(path.join(root, 'web-src', 'HOSTING.txt'), path.join(out, 'HOSTING.txt'));

  const mb = (await Promise.all(files.map(async (f) => (await fsp.stat(path.join(ddir, f))).size))).reduce((a, b) => a + b, 0) / 1e6;
  console.log(`Built ${path.relative(root, out)}/ with ${names.length} texts and ${files.length} data files (${mb.toFixed(0)} MB).`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
