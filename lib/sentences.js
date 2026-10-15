'use strict';
/** Graded practice sets built from Tatoeba sentence pairs. */
const path = require('node:path');
const { readJSON, mulberry32, slug } = require('./util');

const LEVELS = {
  1: { label: 'First 300 words', max: 300 },
  2: { label: 'First 1,000 words', max: 1000 },
  3: { label: 'First 2,500 words', max: 2500 },
  4: { label: 'First 5,000 words', max: 5000 },
};

function createSentences(data) {
  let all = null;
  const load = async () => (all ||= (await readJSON(path.join(data.dir, 'sentences.json'), [])));

  async function pool(level, word) {
    const max = (LEVELS[level] || LEVELS[2]).max;
    const base = await load();
    if (!word) return base.filter((s) => s[2] > 0 && s[2] <= max);
    const w = word.toLowerCase().trim();
    const forms = new Set([w, ...((await data.lemmaForms(w)) || [])]);
    const withWord = base.filter((s) => (s[0].toLowerCase().match(/[\p{L}\p{M}]+/gu) || []).some((t) => forms.has(t)));
    // Prefer sentences at the chosen level; otherwise show the easiest ones that use the word.
    const inLevel = withWord.filter((s) => s[2] <= max);
    return inLevel.length ? inLevel : withWord.sort((a, b) => a[2] - b[2]).slice(0, 60);
  }

  /** Returns a text object with `count` sentences, chosen with the given seed. */
  async function makeSet({ level = 1, word = '', count = 30, seed = Date.now() % 100000 } = {}) {
    level = LEVELS[level] ? Number(level) : 2;
    const list = await pool(level, word);
    if (!list.length) return null;
    const rnd = mulberry32(seed);
    const idx = list.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    const chosen = idx.slice(0, count).map((i) => list[i]);
    const label = word ? `Sentences with “${word}”` : LEVELS[level].label;
    return {
      id: `practice-${level}-${word ? slug(word, 20) + '-' : ''}${seed}`,
      title: `Practice · ${label}`,
      level: ['A1', 'A1–A2', 'A2–B1', 'B1'][level - 1],
      kind: 'practice',
      layout: 'list',
      pairs: true,
      source: { name: 'Tatoeba', url: 'https://tatoeba.org', license: 'CC BY 2.0 FR' },
      paras: chosen.map(([es, en]) => [[es, en]]),
    };
  }

  const available = async () => (await load()).length > 0;
  return { makeSet, available, LEVELS };
}

module.exports = { createSentences, LEVELS };
