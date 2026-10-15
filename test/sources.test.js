'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const gutenberg = require('../lib/sources/gutenberg');
const wikipedia = require('../lib/sources/wikipedia');
const librivox = require('../lib/sources/librivox');
const { tmp, mockFetch } = require('./helpers');

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const BOOK = {
  id: 2000, title: 'Don Quijote de la Mancha', authors: [{ name: 'Cervantes Saavedra, Miguel de' }], download_count: 12345, languages: ['es'],
  formats: { 'text/plain; charset=utf-8': 'https://www.gutenberg.org/cache/epub/2000/pg2000.txt', 'image/jpeg': 'https://www.gutenberg.org/cache/epub/2000/pg2000.cover.medium.jpg' },
};
const TEXT = 'Front matter\n*** START OF THE PROJECT GUTENBERG EBOOK DON QUIJOTE ***\n\nEn un lugar de la Mancha,\nde cuyo nombre no quiero acordarme.\n\nNo ha mucho tiempo que vivía un hidalgo.\n\nSegundo párrafo más.\n\n*** END OF THE PROJECT GUTENBERG EBOOK DON QUIJOTE ***\nLicence text';

test('gutenberg: cleaning removes header, footer and joins wrapped lines', () => {
  const paras = gutenberg.toParagraphs(gutenberg.cleanGutenberg(TEXT));
  assert.deepEqual(paras, ['En un lugar de la Mancha, de cuyo nombre no quiero acordarme.', 'No ha mucho tiempo que vivía un hidalgo.', 'Segundo párrafo más.']);
});

test('gutenberg: search lists Spanish books and import saves text and cover', async () => {
  const imgDir = tmp();
  const f = mockFetch({
    'https://gutendex.test/books?languages=es&search=quijote': { count: 1, next: null, results: [BOOK] },
    'https://gutendex.test/books/2000': BOOK,
    'https://www.gutenberg.org/cache/epub/2000/pg2000.txt': TEXT,
    'https://www.gutenberg.org/cache/epub/2000/pg2000.cover': { __image: 'image/jpeg', bytes: PNG },
  });
  const g = gutenberg.create({ fetch: f, imgDir, base: 'https://gutendex.test' });
  const r = await g.search('quijote');
  assert.equal(r.items[0].subtitle, 'Miguel de Cervantes Saavedra');
  assert.equal(r.items[0].cover, BOOK.formats['image/jpeg']);
  const t = await g.import('2000');
  assert.equal(t.paras.length, 3);
  assert.equal(t.pairs, false);
  assert.match(t.cover, /^\/library-img\/pg-2000\.jpg$/);
  assert.ok(fs.existsSync(path.join(imgDir, 'pg-2000.jpg')));
  await assert.rejects(g.import('../etc'), /Invalid/);
});

test('gutenberg: hides books that are not Spanish-only and rejects English text', async () => {
  const EN = { ...BOOK, id: 3, title: 'Spanish Grammar', languages: ['en', 'es'] };
  const f = mockFetch({
    'https://gutendex.test/books?languages=es': { count: 2, next: null, results: [BOOK, EN] },
    'https://gutendex.test/books/3': EN,
    'https://gutendex.test/books/4': { ...BOOK, id: 4, formats: { 'text/plain': 'https://www.gutenberg.org/cache/epub/4/pg4.txt' } },
    'https://www.gutenberg.org/cache/epub/4/pg4.txt': 'x\n*** START OF THE PROJECT GUTENBERG EBOOK X ***\n\n' + 'the cat and the dog is in the house of the man that was with his friend. '.repeat(40) + '\n\nthe second paragraph of the book is here.\n\nthe third paragraph is for the test.\n',
  });
  const g = gutenberg.create({ fetch: f, imgDir: tmp(), base: 'https://gutendex.test' });
  const r = await g.search('');
  assert.equal(r.items.length, 1);
  await assert.rejects(g.import('3'), /not written only in Spanish/);
  await assert.rejects(g.import('4'), /looks like English/);
});

test('gutenberg: refuses a text link on another host', async () => {
  const bad = { ...BOOK, formats: { 'text/plain': 'https://evil.example/book.txt' } };
  const g = gutenberg.create({ fetch: mockFetch({ 'https://gutendex.test/books/2000': bad }), imgDir: tmp(), base: 'https://gutendex.test' });
  await assert.rejects(g.import('2000'), /no plain-text edition/);
});

test('wikipedia: search, random, and import with image and English reference', async () => {
  const imgDir = tmp();
  const f = mockFetch({
    'https://es.test/w?action=query&format=json&formatversion=2&redirects=1&generator=search': { query: { pages: [{ title: 'Gato', index: 1, extract: 'El gato es un felino.\nSegunda línea.', thumbnail: { source: 'https://upload.wikimedia.org/a/gato.jpg' } }] } },
    'https://es.test/w?action=query&format=json&formatversion=2&redirects=1&generator=random': { query: { pages: [{ title: 'Azar', index: 1, extract: 'Algo.' }] } },
    'https://es.test/w?action=query&format=json&formatversion=2&redirects=1&titles=Gato': { query: { pages: [{ title: 'Gato', extract: 'El gato doméstico es un felino.\n\n== Historia ==\nSe domesticó hace mucho.', thumbnail: { source: 'https://upload.wikimedia.org/a/gato.jpg' }, langlinks: [{ lang: 'en', title: 'Cat' }] }] } },
    'https://en.test/w': { query: { pages: [{ title: 'Cat', extract: 'The cat is a small carnivorous mammal.' }] } },
    'https://upload.wikimedia.org/a/gato.jpg': { __image: 'image/jpeg', bytes: PNG },
  });
  const w = wikipedia.create({ fetch: f, imgDir, base: 'https://es.test/w', baseEn: 'https://en.test/w' });
  const s = await w.search('gato');
  assert.equal(s.items[0].title, 'Gato');
  assert.equal(s.items[0].actions.length, 2);
  assert.equal((await w.search('')).items[0].title, 'Azar');
  const t = await w.import('Gato');
  assert.equal(t.paras.length, 2);
  assert.equal(t.paras[0], 'El gato doméstico es un felino.');
  assert.ok(!t.paras.some((p) => p.startsWith('==')), 'section headings removed');
  assert.match(t.cover, /^\/library-img\/wiki-gato\.jpg$/);
  assert.equal(t.reference.title, 'Cat');
  assert.match(t.source.license, /CC BY-SA/);
  await assert.rejects(wikipedia.create({ fetch: mockFetch({ 'https://es.test/w': { query: { pages: [{ title: 'X', missing: true }] } } }), imgDir, base: 'https://es.test/w' }).import('X'), /not found/);
});

test('librivox: only recordings that name a Gutenberg text can be added; audio hosts are checked', async () => {
  const books = [
    { id: '10', title: 'Don Quijote', url_librivox: 'https://librivox.org/dq', totaltime: '10:00:00', url_text_source: 'https://www.gutenberg.org/ebooks/2000',
      authors: [{ first_name: 'Miguel', last_name: 'de Cervantes' }],
      sections: [{ section_number: '1', title: 'Capítulo 1', listen_url: 'https://archive.org/download/dq/dq_01.mp3', playtime: '600' }, { section_number: '2', title: 'x', listen_url: 'https://evil.example/x.mp3' }] },
    { id: '11', title: 'Sin texto', url_librivox: 'https://librivox.org/s', url_text_source: 'http://example.org/mine.pdf', authors: [], sections: [] },
  ];
  const f = mockFetch({
    'https://lv.test/feed?format=json&extended=1&id=10': { books: [books[0]] },
    'https://lv.test/feed?format=json&extended=1&language=Spanish': { books },
    'https://gutendex.test/books/2000': BOOK,
    'https://www.gutenberg.org/cache/epub/2000/pg2000.txt': TEXT,
  });
  const g = gutenberg.create({ fetch: f, imgDir: tmp(), base: 'https://gutendex.test' });
  const lv = librivox.create({ fetch: f, gutenberg: g, base: 'https://lv.test/feed' });
  const r = await lv.search('Don');
  assert.equal(r.items[0].actions.length, 1);
  assert.equal(r.items[1].actions.length, 0, 'no matching text, so no Add button');
  const t = await lv.import('10');
  assert.equal(t.audio.length, 1);
  assert.equal(t.audio[0].url, 'https://archive.org/download/dq/dq_01.mp3');
  assert.equal(t.kind, 'audiobook');
  assert.ok(t.id.length <= 80);
  assert.deepEqual((await librivox.create({ fetch: mockFetch({ 'https://lv.test/feed': { error: 'none' } }), gutenberg: g, base: 'https://lv.test/feed' }).search('x')).items, [], 'an error reply is an empty list');
});
