'use strict';
/** Spanish Wikipedia articles, with the lead image and a link to the English article. */
const { getJSON, saveImage, slug } = require('../util');

const API = 'https://es.wikipedia.org/w/api.php';
const API_EN = 'https://en.wikipedia.org/w/api.php';

const qs = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const COMMON = { action: 'query', format: 'json', formatversion: 2, redirects: 1 };

function create({ fetch = globalThis.fetch, imgDir, base = API, baseEn = API_EN } = {}) {
  async function search(q) {
    const props = { prop: 'extracts|pageimages', exintro: 1, explaintext: 1, exsentences: 2, exlimit: 'max', piprop: 'thumbnail', pithumbsize: 240 };
    const params = q
      ? { ...COMMON, generator: 'search', gsrsearch: q, gsrlimit: 12, ...props }
      : { ...COMMON, generator: 'random', grnnamespace: 0, grnlimit: 10, ...props };
    const j = await getJSON(`${base}?${qs(params)}`, fetch);
    const pages = ((j.query && j.query.pages) || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
    return {
      items: pages.map((p) => ({
        id: p.title,
        title: p.title,
        subtitle: (p.extract || '').split('\n')[0].slice(0, 220),
        cover: p.thumbnail ? p.thumbnail.source : null,
        link: `https://es.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
        actions: [{ id: 'import', label: 'Add introduction' }, { id: 'full', label: 'Add full article' }],
      })),
      next: null,
    };
  }

  async function importArticle(title, { full = false } = {}) {
    const params = { ...COMMON, titles: title, prop: 'extracts|pageimages|langlinks', explaintext: 1, piprop: 'thumbnail', pithumbsize: 900, lllang: 'en', ...(full ? {} : { exintro: 1 }) };
    const j = await getJSON(`${base}?${qs(params)}`, fetch);
    const page = ((j.query && j.query.pages) || [])[0];
    if (!page || page.missing || !page.extract) throw new Error('Article not found');
    let paras = page.extract.split(/\n+/).map((s) => s.trim()).filter((s) => s && !/^=+\s.*\s=+$/.test(s));
    if (full) paras = paras.slice(0, 80);
    if (!paras.length) throw new Error('The article has no text');

    const cover = await saveImage(page.thumbnail && page.thumbnail.source, imgDir, `wiki-${slug(page.title, 30)}`, fetch);

    // The English article's introduction, shown as a reference, not sentence by sentence.
    let reference = null;
    const en = (page.langlinks || []).find((l) => l.lang === 'en');
    if (en) {
      try {
        const e = await getJSON(`${baseEn}?${qs({ ...COMMON, titles: en.title, prop: 'extracts', exintro: 1, explaintext: 1 })}`, fetch);
        const ep = ((e.query && e.query.pages) || [])[0];
        if (ep && ep.extract) reference = { title: en.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(en.title.replace(/ /g, '_'))}`, text: ep.extract.trim() };
      } catch { /* the reference is optional */ }
    }
    return {
      id: `wiki-${slug(page.title, 40)}${full ? '-full' : ''}`,
      title: page.title,
      level: '',
      kind: 'article',
      layout: 'prose',
      pairs: false,
      cover,
      reference,
      source: { name: 'Wikipedia (Spanish)', url: `https://es.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`, license: 'CC BY-SA 4.0' },
      paras,
    };
  }

  return { id: 'wikipedia', name: 'Wikipedia', kind: 'articles', homepage: 'https://es.wikipedia.org',
    description: 'Articles from Spanish Wikipedia with their lead image, and the English introduction alongside for reference. Leave the search empty for random articles.',
    placeholder: 'A topic, for example gatos or Madrid',
    search, import: (id) => importArticle(id), importFull: (id) => importArticle(id, { full: true }) };
}

module.exports = { create };
