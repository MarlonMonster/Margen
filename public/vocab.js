/* Margen vocabulary: the words you chose to learn, and a spaced-review schedule for them.
   Pure logic with an injected storage, so it runs in the browser and in tests. */
(function (root) {
  'use strict';
  const DAY = 86400000, MIN = 60000;
  const KEY = 'margen:vocab:v1';

  function create(storage) {
    let deck = null, formIdx = null;
    const read = () => {
      if (deck) return deck;
      try { const j = JSON.parse(storage.get(KEY) || 'null'); deck = j && j.cards ? j : { cards: {} }; } catch (e) { deck = { cards: {} }; }
      return deck;
    };
    const save = () => { formIdx = null; try { storage.set(KEY, JSON.stringify(read())); } catch (e) { /* storage full or blocked */ } };
    const cards = () => read().cards;
    const key = (lemma) => String(lemma).toLowerCase();

    function get(lemma) { return cards()[key(lemma)] || null; }
    function all() { return Object.values(cards()); }

    /** Adds a word to learn (or puts a known word back into learning). */
    function add({ lemma, pos = '', gloss = '', form = '', ex = null }, now = Date.now()) {
      const k = key(lemma);
      let c = cards()[k];
      if (!c) {
        c = cards()[k] = { lemma: k, pos, gloss, forms: [], ex: null, status: 'learning', ease: 2.5, interval: 0, reps: 0, lapses: 0, seen: 0, added: now, due: now, last: now };
      }
      if (gloss) c.gloss = gloss;
      if (pos) c.pos = pos;
      const f = String(form || k).toLowerCase();
      if (!c.forms.includes(f)) c.forms.push(f);
      if (ex && ex.es) c.ex = { es: ex.es, en: ex.en || '', form: String(form || k) };
      if (c.status === 'known') { c.status = 'learning'; c.due = now; c.interval = 0; c.reps = 0; }
      c.seen++; c.last = now;
      save();
      return c;
    }
    function setKnown(info, now = Date.now()) {
      const c = add(info, now);
      c.status = 'known'; c.seen--; c.last = now;
      save();
      return c;
    }
    function remove(lemma) { delete cards()[key(lemma)]; save(); }

    /** form (as it appears in a text) -> lemma, for words being learned. */
    function learningForms() {
      if (!formIdx) {
        formIdx = new Map();
        for (const c of all()) if (c.status === 'learning') for (const f of c.forms) formIdx.set(f, c.lemma);
      }
      return formIdx;
    }

    const due = (now = Date.now()) => all().filter((c) => c.status === 'learning' && c.due <= now).sort((a, b) => a.due - b.due);

    /** The interval each answer would give, in ms, without changing the card. */
    function preview(c) {
      return { again: 10 * MIN, good: nextInterval(c, 'good') * DAY, easy: nextInterval(c, 'easy') * DAY };
    }
    function nextInterval(c, grade) {
      const reps = c.reps + 1;
      if (grade === 'easy') return reps === 1 ? 4 : Math.max(1, Math.round(Math.max(c.interval, 1) * c.ease * 1.3));
      return reps === 1 ? 1 : reps === 2 ? 3 : Math.max(1, Math.round(c.interval * c.ease));
    }
    function grade(lemma, g, now = Date.now()) {
      const c = get(lemma);
      if (!c) return null;
      if (g === 'again') { c.lapses++; c.ease = Math.max(1.3, c.ease - 0.2); c.reps = 0; c.interval = 0; c.due = now + 10 * MIN; }
      else {
        const days = nextInterval(c, g);
        c.reps++; c.interval = days; if (g === 'easy') c.ease = Math.min(3.2, c.ease + 0.15);
        c.due = now + days * DAY;
      }
      c.last = now;
      save();
      return c;
    }

    function stats(now = Date.now()) {
      const a = all();
      return { learning: a.filter((c) => c.status === 'learning').length, known: a.filter((c) => c.status === 'known').length, due: due(now).length };
    }
    /** Up to n learning lemmas to practise, the ones you struggle with or are due first. */
    function practiceWords(n = 12, now = Date.now()) {
      return all().filter((c) => c.status === 'learning')
        .sort((a, b) => (a.due <= now ? 0 : 1) - (b.due <= now ? 0 : 1) || b.lapses - a.lapses || a.due - b.due)
        .slice(0, n).map((c) => c.lemma);
    }

    const exportJSON = () => JSON.stringify({ margen: 'vocab', version: 1, cards: cards() }, null, 1);
    function importJSON(text) {
      const j = JSON.parse(text);
      if (!j || typeof j.cards !== 'object') throw new Error('This is not a Margen backup');
      let n = 0;
      for (const [k, c] of Object.entries(j.cards)) {
        if (!c || typeof c.lemma !== 'string' || !Array.isArray(c.forms)) continue;
        const mine = cards()[k];
        if (!mine || (c.last || 0) > (mine.last || 0)) { cards()[k] = c; n++; }
      }
      save();
      return n;
    }
    return { get, all, add, setKnown, remove, learningForms, due, preview, grade, stats, practiceWords, exportJSON, importJSON, DAY, MIN };
  }

  /** Human text for a wait: "10 min", "3 days". */
  function wait(ms) { return ms < 60 * MIN ? Math.max(1, Math.round(ms / MIN)) + ' min' : ms < DAY - 30 * MIN ? Math.round(ms / (60 * MIN)) + ' h' : Math.round(ms / DAY) + (Math.round(ms / DAY) === 1 ? ' day' : ' days'); }

  const api = { create, wait, KEY, DAY, MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MargenVocab = api;
})(typeof self !== 'undefined' ? self : globalThis);
