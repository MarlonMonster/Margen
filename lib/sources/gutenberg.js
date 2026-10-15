'use strict';
/** Project Gutenberg, through the Gutendex catalogue API. Spanish-language books with cover images. */
const { getJSON, fetchOk, hostAllowed, saveImage, slug } = require('../util');

const GUTENDEX = 'https://gutendex.com';
const HOSTS = ['gutenberg.org'];

function cleanGutenberg(raw) {
  let t = String(raw).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const s = t.search(/\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\n/i);
  if (s >= 0) t = t.slice(s).replace(/^[^\n]*\n/, '');
  const e = t.search(/\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i);
  if (e >= 0) t = t.slice(0, e);
  return t.trim();
}
const toParagraphs = (t) => t.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);

// Gutendex's languages=es also returns English books that merely contain some Spanish.
const spanishOnly = (b) => Array.isArray(b.languages) && b.languages.length > 0 && b.languages.every((l) => l === 'es');

// Rough check on the text itself: share of common Spanish vs English function words.
function looksSpanish(text) {
  const w = String(text).slice(0, 60000).toLowerCase().match(/[a-záéíóúñü]+/g) || [];
  if (w.length < 50) return true;
  const es = new Set(['el','la','los','las','de','que','y','en','un','una','es','se','por','con','para','del','al','su','lo','como','pero','más','sus']);
  const en = new Set(['the','of','and','to','in','is','that','it','was','for','with','as','his','he','on','be','at','by','this','had','not','are','but','from']);
  let a = 0, b = 0;
  for (const x of w) { if (es.has(x)) a++; if (en.has(x)) b++; }
  return a > b * 1.5;
}

function pickFormat(formats, prefix) {
  const keys = Object.keys(formats || {});
  const k = keys.find((x) => x === prefix) || keys.find((x) => x.startsWith(prefix));
  return k ? formats[k] : null;
}
const authorNames = (b) => (b.authors || []).map((a) => (a.name || '').split(',').reverse().join(' ').trim()).filter(Boolean).join(', ');

function create({ fetch = globalThis.fetch, imgDir, base = GUTENDEX } = {}) {
  async function search(q, { page = 1 } = {}) {
    const url = `${base}/books?languages=es${q ? `&search=${encodeURIComponent(q)}` : ''}&page=${page}`;
    const j = await getJSON(url, fetch);
    return {
      items: (j.results || []).filter(spanishOnly).map((b) => ({
        id: String(b.id),
        title: b.title,
        subtitle: authorNames(b) || 'Unknown author',
        meta: `${(b.download_count || 0).toLocaleString('en')} downloads`,
        cover: pickFormat(b.formats, 'image/jpeg'),
        link: `https://www.gutenberg.org/ebooks/${b.id}`,
        actions: [{ id: 'import', label: 'Add to my texts' }],
      })),
      next: j.next ? page + 1 : null,
      total: j.count,
    };
  }

  async function importBook(id) {
    if (!/^\d+$/.test(String(id))) throw new Error('Invalid book id');
    const b = await getJSON(`${base}/books/${id}`, fetch);
    if (!spanishOnly(b)) throw new Error('This book is not written only in Spanish, so it was not added');
    const txt = pickFormat(b.formats, 'text/plain');
    if (!txt || !hostAllowed(txt, HOSTS)) throw new Error('This book has no plain-text edition on Project Gutenberg');
    const res = await fetchOk(txt, {}, fetch);
    const paras = toParagraphs(cleanGutenberg(await res.text()));
    if (paras.length < 3) throw new Error('The downloaded text looks empty');
    if (!looksSpanish(paras.join(' '))) throw new Error('This text looks like English, so it was not added');
    const cover = await saveImage(pickFormat(b.formats, 'image/jpeg'), imgDir, `pg-${b.id}`, fetch);
    return {
      id: `pg-${b.id}-${slug(b.title, 30)}`,
      title: b.title,
      author: authorNames(b),
      level: '',
      kind: 'book',
      layout: 'prose',
      pairs: false,
      cover,
      source: { name: 'Project Gutenberg', url: `https://www.gutenberg.org/ebooks/${b.id}`, license: 'Public domain in the USA' },
      paras,
    };
  }

  return { id: 'gutenberg', name: 'Project Gutenberg', kind: 'books', homepage: 'https://www.gutenberg.org',
    description: 'Spanish-language books in the public domain, with cover images. Spanish only: word meanings work, sentences have no English.',
    placeholder: 'Title or author, for example Cervantes', search, import: importBook };
}

module.exports = { looksSpanish, spanishOnly, create, cleanGutenberg, toParagraphs };
