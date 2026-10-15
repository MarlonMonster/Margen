'use strict';
/**
 * Dictionary, word forms, frequency ranks and verb tenses.
 * Built once by lib/setup.js into <dataDir>, then read lazily (one letter at a time).
 */
const fsp = require('node:fs/promises');
const path = require('node:path');
const { bucketOf, readJSON } = require('./util');

const POS_NAMES = {
  n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', prep: 'preposition', art: 'article',
  pron: 'pronoun', conj: 'conjunction', intj: 'interjection', prop: 'proper noun', num: 'number',
  contraction: 'contraction', det: 'determiner', phrase: 'phrase', prefix: 'prefix', suffix: 'suffix',
};
const GENDER = { m: 'masculine', f: 'feminine', mf: 'masculine or feminine', 'm-p': 'masculine plural', 'f-p': 'feminine plural' };

/** Parses the Wiktionary-derived es-en.data file into Map(headword -> [{p, g, gl:[[text, qualifier]]}]). */
function parseDictText(text) {
  const out = new Map();
  const body = text.replace(/^_____\n/, '');
  for (const block of body.split('\n_____\n')) {
    const lines = block.split('\n');
    const head = (lines[0] || '').trim();
    if (!head) continue;
    const entries = [];
    let cur = null, last = null;
    for (let i = 1; i < lines.length; i++) {
      const L = lines[i];
      if (L.startsWith('pos: ')) { cur = { p: L.slice(5).trim(), g: '', gl: [] }; entries.push(cur); last = null; }
      else if (!cur) continue;
      else if (L.startsWith('  g: ')) cur.g = L.slice(5).trim();
      else if (L.startsWith('  gloss: ')) { last = [L.slice(9).trim(), '']; if (cur.gl.length < 8) cur.gl.push(last); }
      else if (L.startsWith('    q: ') && last) last[1] = L.slice(7).trim();
    }
    if (!entries.length) continue;
    const key = head.toLowerCase();
    const prev = out.get(key);
    out.set(key, prev ? prev.concat(entries) : entries);
  }
  return out;
}

const WEAK = /^(obsolete|dated|archaic|alternative (form|spelling)|pronunciation spelling|eye dialect|misspelling|nonstandard|superseded)/i;
/** Picks up to three readable glosses, putting the plain, current senses first. */
function cleanGlosses(gl, max = 3) {
  const RUDE = /vulgar|offensive|obscene|derogatory|slur|euphemis/i;
  const SOFT = /slang|colloquial|dated|archaic|obsolete|rare|dialect|nonstandard/i;
  const ok = gl.filter(([t, q]) => t && !WEAK.test(t) && !RUDE.test(q) && !RUDE.test(t.slice(0, 40)));
  const plain = ok.filter(([, q]) => !SOFT.test(q));
  // Plain, current senses first; informal ones only to fill the list; rude ones only if nothing else exists.
  const strong = plain.concat(ok.filter((x) => !plain.includes(x)));
  const pick = (strong.length ? strong : gl).slice(0, max);
  return pick.map(([t, q]) => {
    let s = t.replace(/\[\+[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();   // drop grammar patterns like [+con (with)]
    if (s.length > 90) {
      s = s.slice(0, 87).replace(/\s+\S*$/, '');
      if (s.lastIndexOf('(') > s.lastIndexOf(')')) s = s.slice(0, s.lastIndexOf('(')).trim();
      s += '…';
    }
    return (q && q.length <= 28 ? `(${q}) ${s}` : s).replace(/\s+/g, ' ');
  });
}

function createData(dir) {
  const dictCache = new Map();   // bucket -> Map
  const formCache = new Map();   // bucket -> Map(form -> [{pos, lemmas}])
  let freq = null, verbs = null;

  async function dictBucket(b) {
    if (!dictCache.has(b)) {
      const obj = await readJSON(path.join(dir, 'dict', `${b}.json`), {});
      dictCache.set(b, new Map(Object.entries(obj)));
    }
    return dictCache.get(b);
  }
  async function formBucket(b) {
    if (!formCache.has(b)) {
      const m = new Map();
      let txt = '';
      try { txt = await fsp.readFile(path.join(dir, 'forms', `${b}.tsv`), 'utf8'); } catch { /* not built */ }
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
  async function loadFreq() {
    if (!freq) freq = (await readJSON(path.join(dir, 'freq.json'), null)) || { rank: {}, forms: {} };
    return freq;
  }
  async function loadVerbs() {
    if (!verbs) verbs = (await readJSON(path.join(dir, 'verbs.json'), null)) || {};
    return verbs;
  }

  const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  const rankOf = async (lemma) => own((await loadFreq()).rank, lemma) || 1e6;

  async function ready() {
    try { await fsp.access(path.join(dir, 'READY')); return true; } catch { return false; }
  }

  async function glossesFor(lemma, pos) {
    const key = lemma.toLowerCase();
    const entries = (await dictBucket(bucketOf(key))).get(key);
    if (!entries) return null;
    const match = entries.filter((e) => e.p === pos);
    return (match.length ? match : entries).map((e) => ({ pos: e.p, gender: e.g, glosses: cleanGlosses(e.gl) })).filter((e) => e.glosses.length);
  }

  /** Looks a word up as it appears in a text (any inflected form). */
  async function lookup(word) {
    const w = String(word).toLowerCase().trim();
    if (!w) return { word, senses: [] };
    let cands = (await formBucket(bucketOf(w))).get(w);
    if (!cands) {
      // Fall back to a plural or a headword that is not listed as a form.
      for (const alt of [w.replace(/es$/, ''), w.replace(/s$/, '')]) {
        if (alt && alt !== w) {
          const c = (await formBucket(bucketOf(alt))).get(alt);
          if (c) { cands = c; break; }
        }
      }
    }
    if (!cands) cands = [{ pos: null, lemmas: [w] }];

    const seen = new Set();
    const picks = [];
    for (const c of cands) {
      for (const lemma of c.lemmas) {
        const k = `${lemma}|${c.pos}`;
        if (!seen.has(k)) { seen.add(k); picks.push({ lemma, pos: c.pos, rank: await rankOf(lemma) }); }
      }
    }
    picks.sort((a, b) => a.rank - b.rank);

    const vb = own(await loadVerbs(), w) || [];
    const senses = [];
    for (const p of picks.slice(0, 5)) {
      const groups = await glossesFor(p.lemma, p.pos);
      if (!groups) continue;
      for (const g of groups.slice(0, 2)) {
        const sense = {
          lemma: p.lemma,
          pos: POS_NAMES[g.pos] || g.pos,
          gender: GENDER[g.gender] || '',
          glosses: g.glosses,
        };
        if (g.pos === 'v') {
          const forms = vb.filter((x) => x.infinitive === p.lemma && !/archaic/i.test(x.tense));
          const seenF = new Set();
          const simple = (x) => (/perfect/i.test(x.tense) ? 1 : 0);   // simple tenses first
          sense.forms = forms
            .slice()
            .sort((a, b) => simple(a) - simple(b))
            .map((x) => `${x.tense.toLowerCase()} ${x.mood.toLowerCase()} · ${x.performer_en}`)
            .filter((s) => (seenF.has(s) ? false : seenF.add(s)))
            .slice(0, 2);
        }
        senses.push(sense);
      }
      if (senses.length >= 4) break;
    }
    return { word, lemma: picks[0] ? picks[0].lemma : w, senses: senses.slice(0, 4) };
  }

  async function lemmaForms(lemma) { return own((await loadFreq()).forms, lemma) || null; }

  return { dir, ready, lookup, rankOf, lemmaForms, loadFreq };
}

module.exports = { createData, parseDictText, cleanGlosses, POS_NAMES };
