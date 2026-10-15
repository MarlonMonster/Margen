/* Margen web edition: answers the app's /api/* requests inside the browser.
   Data files are static (data/…), your texts live in IndexedDB, nothing leaves the phone except Wikipedia searches. */
(function () {
  'use strict';
  const realFetch = window.fetch.bind(window);
  const E = window.MargenEngine;
  const DATA_CACHE = 'margen-data-v1';
  const WIKI = 'https://es.wikipedia.org/w/api.php', WIKI_EN = 'https://en.wikipedia.org/w/api.php';
  const rel = (p) => new URL(p, document.baseURI).href;
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fail = (status, error) => reply({ error }, status);

  /* ---- data files ---- */
  async function load(path, kind) {
    let res;
    try { res = await realFetch(rel('data/' + path)); } catch (e) { throw new Error('You are offline, and this part of the dictionary is not saved on this phone yet.'); }
    if (!res.ok) return null;
    return kind === 'json' ? res.json() : res.text();
  }
  const engine = E.create(load);

  /* ---- your texts (IndexedDB, with a memory fallback) ---- */
  const mem = new Map();
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((resolve, reject) => {
      try {
        const r = indexedDB.open('margen', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('texts', { keyPath: 'id' });
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      } catch (e) { reject(e); }
    }).catch(() => null);
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await db();
    if (!d) return fn(null);
    return new Promise((resolve, reject) => {
      const t = d.transaction('texts', mode);
      const out = fn(t.objectStore('texts'));
      t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
      t.onerror = () => reject(t.error);
    });
  }
  const dbAll = () => tx('readonly', (s) => { if (!s) return [...mem.values()]; const r = s.getAll(); return r; });
  const dbGet = (id) => tx('readonly', (s) => (s ? s.get(id) : mem.get(id)));
  const dbPut = (t) => tx('readwrite', (s) => { if (!s) mem.set(t.id, t); else s.put(t); });
  const dbDel = (id) => tx('readwrite', (s) => { if (!s) mem.delete(id); else s.delete(id); });

  const summary = (t, bundled) => ({ id: t.id, title: t.title, author: t.author || '', level: t.level || '', kind: t.kind || 'text', pairs: !!t.pairs, cover: t.cover || null, audio: !!(t.audio && t.audio.length), source: t.source ? t.source.name : '', bundled: !!bundled });
  let bundledIndex = null;
  async function bundled() {
    if (!bundledIndex) { const r = await realFetch(rel('texts/index.json')); bundledIndex = r.ok ? await r.json() : []; }
    return bundledIndex;
  }
  async function listLibrary() {
    const saved = (await dbAll()).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)).map((t) => summary(t, false));
    return [...(await bundled()), ...saved];
  }
  async function getText(id) {
    const mine = await dbGet(id);
    if (mine) return mine;
    if ((await bundled()).some((t) => t.id === id)) { const r = await realFetch(rel(`texts/${id}.json`)); if (r.ok) return r.json(); }
    return null;
  }
  async function saveText(t) { t.savedAt = Date.now(); await dbPut(t); return t; }

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
    return { id: `my-${E.slug(title || 'text', 40)}-${Date.now().toString(36)}`.slice(0, 80), title: title || 'My text', level: '', kind: 'mine', layout: pairs ? 'list' : 'prose', pairs, source: { name: 'Added by you', license: '' }, paras };
  }

  /* ---- Spanish Wikipedia (it allows requests from web pages) ---- */
  const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const COMMON = { action: 'query', format: 'json', formatversion: 2, redirects: 1, origin: '*' };
  async function wjson(url) {
    let r;
    try { r = await realFetch(url); } catch (e) { throw new Error('Could not reach Wikipedia. Are you online?'); }
    if (!r.ok) throw new Error('Wikipedia answered with an error (' + r.status + ')');
    return r.json();
  }
  const wikiLink = (t) => 'https://es.wikipedia.org/wiki/' + encodeURIComponent(t.replace(/ /g, '_'));
  async function wikiSearch(q) {
    const props = { prop: 'extracts|pageimages', exintro: 1, explaintext: 1, exsentences: 2, exlimit: 'max', piprop: 'thumbnail', pithumbsize: 240 };
    const params = q ? { ...COMMON, generator: 'search', gsrsearch: q, gsrlimit: 12, ...props } : { ...COMMON, generator: 'random', grnnamespace: 0, grnlimit: 10, ...props };
    const j = await wjson(`${WIKI}?${qs(params)}`);
    const pages = ((j.query && j.query.pages) || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
    return { items: pages.map((p) => ({ id: p.title, title: p.title, subtitle: (p.extract || '').split('\n')[0].slice(0, 220), cover: p.thumbnail ? p.thumbnail.source : null, link: wikiLink(p.title), actions: [{ id: 'import', label: 'Add introduction' }, { id: 'full', label: 'Add full article' }] })), next: null };
  }
  async function wikiImport(title, full) {
    const params = { ...COMMON, titles: title, prop: 'extracts|pageimages|langlinks', explaintext: 1, piprop: 'thumbnail', pithumbsize: 900, lllang: 'en', ...(full ? {} : { exintro: 1 }) };
    const j = await wjson(`${WIKI}?${qs(params)}`);
    const page = ((j.query && j.query.pages) || [])[0];
    if (!page || page.missing || !page.extract) throw new Error('Article not found');
    let paras = page.extract.split(/\n+/).map((s) => s.trim()).filter((s) => s && !/^=+\s.*\s=+$/.test(s));
    if (full) paras = paras.slice(0, 80);
    if (!paras.length) throw new Error('The article has no text');
    let reference = null;
    const en = (page.langlinks || []).find((l) => l.lang === 'en');
    if (en) {
      try {
        const e = await wjson(`${WIKI_EN}?${qs({ ...COMMON, titles: en.title, prop: 'extracts', exintro: 1, explaintext: 1 })}`);
        const ep = ((e.query && e.query.pages) || [])[0];
        if (ep && ep.extract) reference = { title: en.title, url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(en.title.replace(/ /g, '_')), text: ep.extract.trim() };
      } catch (e) { /* optional */ }
    }
    return { id: `wiki-${E.slug(page.title, 40)}${full ? '-full' : ''}`, title: page.title, level: '', kind: 'article', layout: 'prose', pairs: false, cover: page.thumbnail ? page.thumbnail.source : null, reference, source: { name: 'Wikipedia (Spanish)', url: wikiLink(page.title), license: 'CC BY-SA 4.0' }, paras };
  }

  /* ---- saving everything for offline use ---- */
  const job = { running: false, step: '', error: '' };
  async function saveOffline() {
    if (job.running) return;
    Object.assign(job, { running: true, step: 'Starting', error: '' });
    try {
      const m = await (await realFetch(rel('data/manifest.json'), { cache: 'no-store' })).json();
      const cache = await caches.open(DATA_CACHE);
      let done = 0;
      const queue = m.files.slice();
      const worker = async () => {
        for (let f; (f = queue.shift());) {
          const url = rel('data/' + f);
          if (!(await cache.match(url))) { const r = await realFetch(url); if (!r.ok) throw new Error('Could not download ' + f); await cache.put(url, r); }
          done++; job.step = `Saved ${done} of ${m.files.length} files`;
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      lsSet('margen:offline', '1');
    } catch (e) {
      job.error = (e && e.message) || 'The download stopped. Check your connection and try again.';
    } finally { job.running = false; job.step = 'Done'; }
  }

  /* ---- routes ---- */
  let linksP = null;
  const links = () => (linksP ||= realFetch(rel('links.json')).then((r) => r.json()).catch(() => []));

  async function route(path, qsp, method, body) {
    let r;
    if (path === '/api/status') {
      const saved = lsGet('margen:offline') === '1';
      return reply({ ready: saved && !job.running && !job.error, setup: { ...job }, practice: true, web: true,
        banner: { title: 'Save the dictionary on this phone', text: 'Lets Margen work with no signal. About 100 MB, once. Without it, words load as you read and need a connection.', button: 'Save for offline' } });
    }
    if (path === '/api/setup' && method === 'POST') { saveOffline(); return reply({ ...job, running: true }, 202); }
    if (path === '/api/sources') {
      return reply({ practice: { levels: E.LEVELS },
        sources: [{ id: 'wikipedia', name: 'Wikipedia', kind: 'articles', homepage: 'https://es.wikipedia.org', description: 'Articles from Spanish Wikipedia with their lead image, and the English introduction alongside for reference. Leave the search empty for random articles.', placeholder: 'A topic, for example gatos or Madrid' }],
        links: await links() });
    }
    if (path === '/api/dict') return reply(await engine.lookup(qsp.get('w') || ''));
    if (path === '/api/library') return reply(await listLibrary());
    if (path === '/api/practice' && method === 'POST') {
      const t = await engine.makeSet({ level: Number(body.level) || 1, word: Array.isArray(body.words) && body.words.length ? body.words.slice(0, 12).map((x) => String(x).slice(0, 40)) : String(body.word || '').slice(0, 40), count: Math.min(Number(body.count) || 30, 60), seed: Number(body.seed) || undefined });
      return t ? reply(t) : fail(404, 'No sentences found for that word. Try another word or a higher level.');
    }
    if (path === '/api/text' && method === 'POST') {
      if (body.text && !body.paras) return reply(await saveText(textFromPaste(String(body.title || '').slice(0, 80), body.text)));
      if (body.paras && body.id) return reply(await saveText({ ...body, id: String(body.id) }));
      return fail(400, 'Nothing to save');
    }
    if ((r = path.match(/^\/api\/text\/([a-z0-9-]+)$/))) {
      if (method === 'GET') { const t = await getText(r[1]); return t ? reply(t) : fail(404, 'Text not found'); }
      if (method === 'DELETE') { if ((await bundled()).some((t) => t.id === r[1])) return fail(404, 'Starter texts cannot be removed'); await dbDel(r[1]); return reply({ ok: true }); }
    }
    if ((r = path.match(/^\/api\/sources\/([a-z]+)\/search$/)) && r[1] === 'wikipedia') return reply(await wikiSearch(qsp.get('q') || ''));
    if ((r = path.match(/^\/api\/sources\/([a-z]+)\/import$/)) && r[1] === 'wikipedia' && method === 'POST') return reply(await saveText(await wikiImport(String(body.id || ''), body.action === 'full')));
    return fail(404, 'Unknown request');
  }

  window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : input && input.url;
    if (typeof u === 'string' && u.startsWith('/api/')) {
      const url = new URL(u, 'http://x');
      const method = ((init && init.method) || 'GET').toUpperCase();
      let body = {};
      try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { /* none */ }
      return route(url.pathname, url.searchParams, method, body).catch((e) => fail(500, (e && e.message) || 'Something went wrong'));
    }
    return realFetch(input, init);
  };
  window.MARGEN_WEB = true;

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
