'use strict';
/**
 * LibriVox: free public-domain audiobooks. A Spanish recording is only useful here when it
 * names a Project Gutenberg text, so the book can be read while it plays.
 */
const { getJSON, hostAllowed } = require('../util');

const API = 'https://librivox.org/api/feed/audiobooks';
const PAGE = 24;
const GUT_ID = /gutenberg\.org\/(?:ebooks|etext|files|cache\/epub)\/(\d+)/i;
const AUDIO_HOSTS = ['archive.org', 'librivox.org'];

const authors = (b) => (b.authors || []).map((a) => [a.first_name, a.last_name].filter(Boolean).join(' ')).filter(Boolean).join(', ');

function create({ fetch = globalThis.fetch, gutenberg, base = API } = {}) {
  async function fetchBooks(params) {
    const j = await getJSON(`${base}?format=json&extended=1&${params}`, fetch);
    return Array.isArray(j.books) ? j.books : [];
  }

  async function search(q, { page = 1 } = {}) {
    const title = q ? `&title=${encodeURIComponent('^' + q)}` : '';
    const books = await fetchBooks(`language=Spanish&limit=${PAGE}&offset=${(page - 1) * PAGE}${title}`);
    return {
      items: books.map((b) => {
        const m = String(b.url_text_source || '').match(GUT_ID);
        return {
          id: String(b.id),
          title: b.title,
          subtitle: authors(b) || 'Unknown reader',
          meta: [b.totaltime, m ? 'text on Project Gutenberg' : 'no matching text'].filter(Boolean).join(' · '),
          cover: null,
          link: b.url_librivox,
          actions: m ? [{ id: 'import', label: 'Add text and audio' }] : [],
        };
      }),
      next: books.length === PAGE ? page + 1 : null,
    };
  }

  async function importBook(id) {
    if (!/^\d+$/.test(String(id))) throw new Error('Invalid audiobook id');
    const [b] = await fetchBooks(`id=${id}`);
    if (!b) throw new Error('Audiobook not found');
    const m = String(b.url_text_source || '').match(GUT_ID);
    if (!m) throw new Error('This recording does not name a text on Project Gutenberg');
    const text = await gutenberg.import(m[1]);
    const audio = (b.sections || [])
      .filter((s) => s.listen_url && hostAllowed(s.listen_url, AUDIO_HOSTS))
      .map((s) => ({ title: s.title || `Section ${s.section_number}`, url: s.listen_url, time: s.playtime || '' }));
    if (!audio.length) throw new Error('No playable audio sections were listed');
    return { ...text, id: `lv-${b.id}-${text.id}`.slice(0, 80), kind: 'audiobook', audio,
      source: { name: 'Project Gutenberg text with LibriVox audio', url: b.url_librivox, license: 'Public domain' } };
  }

  return { id: 'librivox', name: 'LibriVox', kind: 'audio', homepage: 'https://librivox.org',
    description: 'Free Spanish audiobooks. Only recordings that name a Project Gutenberg text can be added, so you can read along.',
    placeholder: 'Title starts with, for example Don Quijote', search, import: importBook };
}

module.exports = { create, GUT_ID };
