#!/usr/bin/env node
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');

const { createData } = require('./lib/data');
const { createSentences } = require('./lib/sentences');
const { createStore } = require('./lib/store');
const { createRegistry } = require('./lib/sources');
const { setup } = require('./lib/setup');
const { slug, splitSentences } = require('./lib/util');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
};

function createApp(opts = {}) {
  const root = opts.root || __dirname;
  const dataDir = opts.dataDir || path.join(root, 'data');
  const libraryDir = opts.libraryDir || path.join(root, 'library');
  const publicDir = path.join(root, 'public');

  const data = createData(dataDir);
  const sentences = createSentences(data);
  const store = createStore({ libraryDir, bundledDir: path.join(root, 'texts') });
  const registry = createRegistry({ fetch: opts.fetch, imgDir: store.imgDir, sentences, bases: opts.bases });

  const job = { running: false, step: '', error: '' };

  async function runSetup() {
    if (job.running) return;
    Object.assign(job, { running: true, step: 'Starting', error: '' });
    try {
      await setup({ dir: dataDir, fetchImpl: opts.fetch, urls: opts.setupUrls, log: (m) => { job.step = m; } });
      job.step = 'Done';
    } catch (e) {
      job.error = e.message;
    } finally {
      job.running = false;
    }
  }

  const json = (res, code, body) => {
    const s = JSON.stringify(body);
    res.writeHead(code, { 'content-type': MIME['.json'], 'cache-control': 'no-store', 'content-length': Buffer.byteLength(s) });
    res.end(s);
  };
  const readBody = (req, max = 2_000_000) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error('Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });

  async function serveFile(res, base, rel) {
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base + path.sep) && file !== base) return json(res, 403, { error: 'Forbidden' });
    try {
      const st = await fsp.stat(file);
      if (!st.isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size });
      fs.createReadStream(file).pipe(res);
    } catch {
      json(res, 404, { error: 'Not found' });
    }
  }

  /** Turns pasted text into a text object. Lines with a tab are read as Spanish<TAB>English pairs. */
  function textFromPaste(title, body) {
    const lines = String(body).replace(/\r\n?/g, '\n').split('\n');
    const tabbed = lines.filter((l) => l.includes('\t')).length;
    let paras, pairs = false;
    if (tabbed >= Math.max(1, lines.filter((l) => l.trim()).length / 2)) {
      pairs = true;
      paras = lines.filter((l) => l.trim()).map((l) => { const [es, en] = l.split('\t'); return [[es.trim(), (en || '').trim()]]; });
    } else {
      paras = String(body).replace(/\r\n?/g, '\n').trim().split(/\n\s*\n|\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
    }
    if (!paras.length) throw new Error('There is no text to add');
    const base = slug(title || 'text', 40);
    return { id: `my-${base}-${Date.now().toString(36)}`.slice(0, 80), title: title || 'My text', level: '', kind: 'mine', layout: pairs ? 'list' : 'prose', pairs, source: { name: 'Added by you', license: '' }, paras };
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const m = req.method;
    try {
      // Refuse other hostnames (blocks DNS-rebinding) and cross-site form posts (JSON only).
      const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
      if (host.includes('.') && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.endsWith('.local')) return json(res, 403, { error: 'Unknown host name' });
      if (m === 'POST' && !/^application\/json/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'JSON only' });
      if (p.startsWith('/api/')) {
        if (p === '/api/status' && m === 'GET') {
          return json(res, 200, { ready: await data.ready(), setup: { ...job }, practice: await data.ready() });
        }
        if (p === '/api/setup' && m === 'POST') { runSetup(); return json(res, 202, { ...job, running: true }); }
        if (p === '/api/sources' && m === 'GET') return json(res, 200, registry.meta());

        if (p === '/api/dict' && m === 'GET') {
          if (!(await data.ready())) return json(res, 409, { error: 'The dictionary is not downloaded yet' });
          return json(res, 200, await data.lookup(url.searchParams.get('w') || ''));
        }
        if (p === '/api/library' && m === 'GET') return json(res, 200, await store.list());
        if (p === '/api/practice' && m === 'POST') {
          if (!(await data.ready())) return json(res, 409, { error: 'The dictionary and sentences are not downloaded yet' });
          const b = await readBody(req);
          const t = await sentences.makeSet({ level: Number(b.level) || 1, word: Array.isArray(b.words) && b.words.length ? b.words.slice(0, 12).map((x) => String(x).slice(0, 40)) : String(b.word || '').slice(0, 40), count: Math.min(Number(b.count) || 30, 60), seed: Number(b.seed) || undefined });
          if (!t) return json(res, 404, { error: 'No sentences found for that word. Try another word or a higher level.' });
          return json(res, 200, t);
        }
        if (p === '/api/text' && m === 'POST') {
          const b = await readBody(req, 4_000_000);
          if (b.text && !b.paras) return json(res, 200, await store.save(textFromPaste(String(b.title || '').slice(0, 80), b.text)));
          if (b.paras && b.id) return json(res, 200, await store.save({ ...b, id: String(b.id) }));  // saving a practice set
          return json(res, 400, { error: 'Nothing to save' });
        }
        let r;
        if ((r = p.match(/^\/api\/text\/([a-z0-9-]+)$/))) {
          if (m === 'GET') { const t = await store.get(r[1]); return t ? json(res, 200, t) : json(res, 404, { error: 'Text not found' }); }
          if (m === 'DELETE') return json(res, (await store.remove(r[1])) ? 200 : 404, { ok: true });
        }
        if ((r = p.match(/^\/api\/sources\/([a-z]+)\/search$/)) && m === 'GET') {
          const src = registry.get(r[1]);
          if (!src) return json(res, 404, { error: 'Unknown source' });
          return json(res, 200, await src.search(url.searchParams.get('q') || '', { page: Number(url.searchParams.get('page')) || 1 }));
        }
        if ((r = p.match(/^\/api\/sources\/([a-z]+)\/import$/)) && m === 'POST') {
          const src = registry.get(r[1]);
          if (!src) return json(res, 404, { error: 'Unknown source' });
          const b = await readBody(req);
          const fn = b.action === 'full' && src.importFull ? src.importFull : src.import;
          const text = await fn(String(b.id || ''));
          return json(res, 200, await store.save(text));
        }
        return json(res, 404, { error: 'Unknown request' });
      }
      if (p.startsWith('/library-img/')) return serveFile(res, store.imgDir, decodeURIComponent(p.slice('/library-img/'.length)));
      return serveFile(res, publicDir, p === '/' ? 'index.html' : decodeURIComponent(p.slice(1)));
    } catch (e) {
      return json(res, 500, { error: e.message || 'Something went wrong' });
    }
  }

  return { server: http.createServer(handle), data, store, runSetup, job };
}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return null;
}

if (require.main === module) {
  const lan = process.argv.includes('--lan');
  const port = Number(process.env.PORT) || 3210;
  const { server } = createApp();
  server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`Margen is running.\n  On this computer: http://localhost:${port}`);
    if (lan) {
      const ip = lanAddress();
      console.log(ip ? `  On your phone (same Wi-Fi): http://${ip}:${port}` : '  No Wi-Fi address found.');
      console.log('  Anyone on your network can open this. Stop it with Ctrl+C when you are done.');
    } else {
      console.log('  To use it on your phone, restart with: npm run lan');
    }
  });
}

module.exports = { createApp };
