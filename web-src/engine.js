/* Margen browser engine: dictionary lookup and practice sets, reading the same data files the Node app builds.
   Mirrors lib/data.js and lib/sentences.js (a test compares the two). Works in a browser and in Node. */
(function (root) {
  'use strict';
  const POS_NAMES = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', prep: 'preposition', art: 'article', pron: 'pronoun', conj: 'conjunction', intj: 'interjection', prop: 'proper noun', num: 'number', contraction: 'contraction', det: 'determiner', phrase: 'phrase', prefix: 'prefix', suffix: 'suffix' };
  const GENDER = { m: 'masculine', f: 'feminine', mf: 'masculine or feminine', 'm-p': 'masculine plural', 'f-p': 'feminine plural' };
  const LEVELS = { 1: { label: 'First 300 words', max: 300 }, 2: { label: 'First 1,000 words', max: 1000 }, 3: { label: 'First 2,500 words', max: 2500 }, 4: { label: 'First 5,000 words', max: 5000 } };
  const WEAK = /^(obsolete|dated|archaic|alternative (form|spelling)|pronunciation spelling|eye dialect|misspelling|nonstandard|superseded)/i;

  const stripAccents = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const slug = (s, max = 48) => stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'text';
  const bucketOf = (w) => { const c = stripAccents(w).toLowerCase()[0]; return c && /[a-z]/.test(c) ? c : '_'; };
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

  function cleanGlosses(gl, max = 3) {
    const RUDE = /vulgar|offensive|obscene|derogatory|slur|euphemis/i;
    const SOFT = /slang|colloquial|dated|archaic|obsolete|rare|dialect|nonstandard/i;
    const ok = gl.filter(([t, q]) => t && !WEAK.test(t) && !RUDE.test(q) && !RUDE.test(t.slice(0, 40)));
    const plain = ok.filter(([, q]) => !SOFT.test(q));
    const strong = plain.concat(ok.filter((x) => !plain.includes(x)));
    const pick = (strong.length ? strong : gl).slice(0, max);
    return pick.map(([t, q]) => {
      let s = t.replace(/\[\+[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (s.length > 90) {
        s = s.slice(0, 87).replace(/\s+\S*$/, '');
        if (s.lastIndexOf('(') > s.lastIndexOf(')')) s = s.slice(0, s.lastIndexOf('(')).trim();
        s += '…';
      }
      return (q && q.length <= 28 ? `(${q}) ${s}` : s).replace(/\s+/g, ' ');
    });
  }

  /** `load(path, kind)` returns a Promise of the file's text ('text') or parsed JSON ('json'), or null if missing. */
  function create(load) {
    const dictCache = new Map(), formCache = new Map();
    let freq = null, verbs = null, sentencesAll = null;

    async function dictBucket(b) {
      if (!dictCache.has(b)) dictCache.set(b, new Map(Object.entries((await load(`dict/${b}.json`, 'json')) || {})));
      return dictCache.get(b);
    }
    async function formBucket(b) {
      if (!formCache.has(b)) {
        const m = new Map();
        const txt = (await load(`forms/${b}.tsv`, 'text')) || '';
        for (const line of txt.split('\n')) {
          if (!line) continue;
          const [form, pos, lemmas] = line.split('\t');
          const arr = m.get(form) || [];
          arr.push({ pos, lemmas: lemmas.split(',') });
          m.set(form, arr);
        }
        formCache.set(b, m);
      }
      return formCache.get(b);
    }
    const loadFreq = async () => (freq ||= (await load('freq.json', 'json')) || { rank: {}, forms: {} });
    const loadVerbs = async () => (verbs ||= (await load('verbs.json', 'json')) || {});
    const rankOf = async (lemma) => own((await loadFreq()).rank, lemma) || 1e6;
    const lemmaForms = async (lemma) => own((await loadFreq()).forms, lemma) || null;

    async function glossesFor(lemma, pos) {
      const key = lemma.toLowerCase();
      const entries = (await dictBucket(bucketOf(key))).get(key);
      if (!entries) return null;
      const match = entries.filter((e) => e.p === pos);
      return (match.length ? match : entries).map((e) => ({ pos: e.p, gender: e.g, glosses: cleanGlosses(e.gl) })).filter((e) => e.glosses.length);
    }

    async function lookup(word) {
      const w = String(word).toLowerCase().trim();
      if (!w) return { word, senses: [] };
      let cands = (await formBucket(bucketOf(w))).get(w);
      if (!cands) {
        for (const alt of [w.replace(/es$/, ''), w.replace(/s$/, '')]) {
          if (alt && alt !== w) { const c = (await formBucket(bucketOf(alt))).get(alt); if (c) { cands = c; break; } }
        }
      }
      if (!cands) cands = [{ pos: null, lemmas: [w] }];
      const seen = new Set(), picks = [];
      for (const c of cands) for (const lemma of c.lemmas) {
        const k = `${lemma}|${c.pos}`;
        if (!seen.has(k)) { seen.add(k); picks.push({ lemma, pos: c.pos, rank: await rankOf(lemma) }); }
      }
      picks.sort((a, b) => a.rank - b.rank);
      const vb = own(await loadVerbs(), w) || [];
      const senses = [];
      for (const p of picks.slice(0, 5)) {
        const groups = await glossesFor(p.lemma, p.pos);
        if (!groups) continue;
        for (const g of groups.slice(0, 2)) {
          const sense = { lemma: p.lemma, pos: POS_NAMES[g.pos] || g.pos, gender: GENDER[g.gender] || '', glosses: g.glosses };
          if (g.pos === 'v') {
            const forms = vb.filter((x) => x.infinitive === p.lemma && !/archaic/i.test(x.tense));
            const seenF = new Set();
            const simple = (x) => (/perfect/i.test(x.tense) ? 1 : 0);
            sense.forms = forms.slice().sort((a, b) => simple(a) - simple(b))
              .map((x) => `${x.tense.toLowerCase()} ${x.mood.toLowerCase()} · ${x.performer_en}`)
              .filter((s) => (seenF.has(s) ? false : seenF.add(s))).slice(0, 2);
          }
          senses.push(sense);
        }
        if (senses.length >= 4) break;
      }
      return { word, lemma: picks[0] ? picks[0].lemma : w, senses: senses.slice(0, 4) };
    }

    async function pool(level, word) {
      const max = (LEVELS[level] || LEVELS[2]).max;
      const base = (sentencesAll ||= (await load('sentences.json', 'json')) || []);
      const list = [].concat(word || []).map((x) => String(x).toLowerCase().trim()).filter(Boolean);
      if (!list.length) return base.filter((s) => s[2] > 0 && s[2] <= max);
      const forms = new Set();
      for (const w of list) { forms.add(w); for (const f of (await lemmaForms(w)) || []) forms.add(f); }
      const withWord = base.filter((s) => (s[0].toLowerCase().match(/[\p{L}\p{M}]+/gu) || []).some((t) => forms.has(t)));
      const inLevel = withWord.filter((s) => s[2] <= max);
      return inLevel.length ? inLevel : withWord.sort((a, b) => a[2] - b[2]).slice(0, 60);
    }
    async function makeSet({ level = 1, word = '', count = 30, seed = Date.now() % 100000 } = {}) {
      level = LEVELS[level] ? Number(level) : 2;
      const list = await pool(level, word);
      if (!list.length) return null;
      const rnd = mulberry32(seed);
      const idx = list.map((_, i) => i);
      for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
      const many = Array.isArray(word) && word.length > 1;
      const label = many ? 'Sentences with your words' : word && word.length ? `Sentences with “${[].concat(word)[0]}”` : LEVELS[level].label;
      return {
        id: `practice-${level}-${[].concat(word || []).length ? slug([].concat(word)[0], 20) + '-' : ''}${seed}`,
        title: `Practice · ${label}`,
        level: ['A1', 'A1–A2', 'A2–B1', 'B1'][level - 1],
        kind: 'practice', layout: 'list', pairs: true,
        source: { name: 'Tatoeba', url: 'https://tatoeba.org', license: 'CC BY 2.0 FR' },
        paras: idx.slice(0, count).map((i) => [[list[i][0], list[i][1]]]),
      };
    }
    return { lookup, makeSet, lemmaForms };
  }

  const api = { create, LEVELS, slug, cleanGlosses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MargenEngine = api;
})(typeof self !== 'undefined' ? self : globalThis);
