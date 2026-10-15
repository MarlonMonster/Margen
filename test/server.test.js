'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../server');
const { setup } = require('../lib/setup');
const { tmp, mockFetch, rawRoutes } = require('./helpers');

const BOOK = {
  id: 2000, title: 'Don Quijote', authors: [{ name: 'Cervantes, Miguel' }], download_count: 5, languages: ['es'],
  formats: { 'text/plain': 'https://www.gutenberg.org/cache/epub/2000/pg2000.txt', 'image/jpeg': 'https://www.gutenberg.org/cache/epub/2000/cover.jpg' },
};
const TEXT = '*** START OF THE PROJECT GUTENBERG EBOOK X ***\n\nEn un lugar de la Mancha.\n\nOtro párrafo.\n\nY otro más.\n\n*** END OF THE PROJECT GUTENBERG EBOOK X ***';

async function boot({ withData = true } = {}) {
  const dataDir = tmp(), libraryDir = tmp();
  const fetchImpl = mockFetch({
    ...rawRoutes(),
    'https://gutendex.test/books?languages=es': { count: 1, next: null, results: [BOOK] },
    'https://gutendex.test/books/2000': BOOK,
    'https://www.gutenberg.org/cache/epub/2000/pg2000.txt': TEXT,
    'https://www.gutenberg.org/cache/epub/2000/cover.jpg': { __image: 'image/jpeg', bytes: Buffer.from('ffd8ffe0', 'hex') },
  });
  if (withData) await setup({ dir: dataDir, fetchImpl, urls: { doozan: 'https://raw.test/', jehle: 'https://raw.test/jehle_verb_lookup.json' } });
  const app = createApp({ dataDir, libraryDir, fetch: fetchImpl, bases: { gutendex: 'https://gutendex.test' }, setupUrls: { doozan: 'https://raw.test/', jehle: 'https://raw.test/jehle_verb_lookup.json' } });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const port = app.server.address().port;
  const call = (method, path, body, headers = {}) => new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(data ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks).toString(); let json; try { json = JSON.parse(raw); } catch { /* not json */ } resolve({ status: res.statusCode, json, raw, type: res.headers['content-type'] }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
  return { call, close: () => new Promise((r) => app.server.close(r)), app };
}

test('library, texts, dictionary and practice sets', async (t) => {
  const s = await boot(); t.after(s.close);
  assert.deepEqual((await s.call('GET', '/api/status')).json.ready, true);
  const lib = (await s.call('GET', '/api/library')).json;
  assert.ok(['en-el-mercado', 'la-casa-de-pablo', 'mi-dia', 'me-llamo-ana'].every((id) => lib.some((x) => x.id === id)));
  assert.ok(lib.every((x) => x.bundled && x.pairs));
  const text = (await s.call('GET', '/api/text/mi-dia')).json;
  assert.equal(text.paras.flat().length, 7);
  assert.equal(text.gloss.vivo, 'I live|vivir · yo form');
  assert.equal((await s.call('GET', '/api/text/nope')).status, 404);
  assert.equal((await s.call('GET', '/api/text/..%2f..%2fpackage')).status, 404);
  assert.equal((await s.call('GET', '/api/dict?w=tomamos')).json.senses[0].lemma, 'tomar');
  const set = (await s.call('POST', '/api/practice', { level: 1, seed: 4 })).json;
  assert.equal(set.pairs, true);
  assert.ok(set.paras.length >= 2);
  assert.equal((await s.call('POST', '/api/practice', { level: 1, word: 'zzzz' })).status, 404);
});

test('adding pasted text, pairs, importing a book, and removing', async (t) => {
  const s = await boot(); t.after(s.close);
  const pasted = (await s.call('POST', '/api/text', { title: 'Mi nota', text: 'Hola mundo.\n\nSegundo párrafo.' })).json;
  assert.match(pasted.id, /^my-mi-nota-/);
  assert.deepEqual(pasted.paras, ['Hola mundo.', 'Segundo párrafo.']);
  const pairs = (await s.call('POST', '/api/text', { title: 'Pares', text: 'Hola.\tHello.\nAdiós.\tGoodbye.' })).json;
  assert.equal(pairs.pairs, true);
  assert.deepEqual(pairs.paras[1], [['Adiós.', 'Goodbye.']]);
  assert.equal((await s.call('POST', '/api/text', { title: 'x', text: '   ' })).status, 500);

  const found = (await s.call('GET', '/api/sources/gutenberg/search?q=')).json;
  assert.equal(found.items[0].title, 'Don Quijote');
  const added = (await s.call('POST', '/api/sources/gutenberg/import', { id: '2000' })).json;
  assert.equal(added.paras.length, 3);
  assert.equal((await s.call('GET', added.cover)).status, 200);
  const list = (await s.call('GET', '/api/library')).json.filter((x) => !x.bundled);
  assert.equal(list.length, 3);
  assert.equal((await s.call('DELETE', '/api/text/' + added.id)).status, 200);
  assert.equal((await s.call('GET', added.cover)).status, 404, 'its cover is removed with it');
  assert.equal((await s.call('DELETE', '/api/text/mi-dia')).status, 404, 'bundled texts cannot be removed');
  assert.equal((await s.call('GET', '/api/sources/unknown/search')).status, 404);
});

test('security: host names, content type, and file paths', async (t) => {
  const s = await boot(); t.after(s.close);
  assert.equal((await s.call('GET', '/api/status', undefined, { host: 'evil.example' })).status, 403);
  assert.equal((await s.call('GET', '/api/status', undefined, { host: 'localhost:3210' })).status, 200);
  assert.equal((await s.call('GET', '/api/status', undefined, { host: '192.168.1.20:3210' })).status, 200);
  assert.equal((await s.call('GET', '/api/status', undefined, { host: 'my-mac.local:3210' })).status, 200);
  const r = await s.call('POST', '/api/text', undefined, { 'content-type': 'text/plain' });
  assert.equal(r.status, 415);
  for (const p of ['/..%2fpackage.json', '/%2e%2e/package.json', '/library-img/..%2f..%2fpackage.json']) {
    const x = await s.call('GET', p);
    assert.ok([403, 404].includes(x.status), `${p} -> ${x.status}`);
  }
  const home = await s.call('GET', '/');
  assert.equal(home.status, 200);
  assert.match(home.raw, /<title>Margen<\/title>/);
});

test('without data: the dictionary asks for setup, and setup can be started from the API', async (t) => {
  const s = await boot({ withData: false }); t.after(s.close);
  assert.equal((await s.call('GET', '/api/status')).json.ready, false);
  assert.equal((await s.call('GET', '/api/dict?w=casa')).status, 409);
  assert.equal((await s.call('POST', '/api/practice', { level: 1 })).status, 409);
  assert.equal((await s.call('GET', '/api/library')).json.length >= 3, true, 'starter texts work before any download');
  assert.equal((await s.call('POST', '/api/setup', {})).status, 202);
  for (let i = 0; i < 50; i++) { const st = (await s.call('GET', '/api/status')).json; if (st.ready) break; await new Promise((r) => setTimeout(r, 100)); }
  const st = (await s.call('GET', '/api/status')).json;
  assert.equal(st.ready, true, JSON.stringify(st.setup));
  assert.equal((await s.call('GET', '/api/dict?w=casa')).json.senses[0].glosses[0], 'house');
});
