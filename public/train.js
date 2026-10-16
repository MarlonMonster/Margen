/* Margen Train: builds short exercises from the words you are learning and from sentence pairs.
   Pure logic (no page code), so it runs in the browser and in tests. */
(function (root) {
  'use strict';
  const WORD = /\p{L}[\p{L}\p{M}]*(?:['’\-]\p{L}[\p{L}\p{M}]*)*/gu;
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const strip = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '');
  const plain = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{M}\p{N}' -]/gu, '').replace(/\s+/g, ' ').trim();

  /** Position of `form` as a whole word inside a sentence, or null. */
  function findWord(es, form) {
    if (!es || !form) return null;
    const m = new RegExp('(?<![\\p{L}\\p{M}])' + esc(form) + '(?![\\p{L}\\p{M}])', 'iu').exec(es);
    return m ? { i: m.index, len: m[0].length } : null;
  }
  const tokens = (es) => (String(es).match(WORD) || []);

  /** Typed answer: 'right', 'accent' (right letters, wrong accents) or 'wrong'. */
  function checkTyped(typed, answer) {
    const a = plain(typed), b = plain(answer);
    if (!a) return 'wrong';
    if (a === b) return 'right';
    return strip(a) === strip(b) ? 'accent' : 'wrong';
  }
  /** Built sentence: the tapped words in order against the target. */
  function checkBuilt(built, es) {
    const a = built.map((t) => plain(t)), b = tokens(es).map((t) => plain(t));
    return a.length === b.length && a.every((t, i) => t === b[i]);
  }

  function shuffle(list, rnd) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const pickN = (list, n, rnd) => shuffle(list, rnd).slice(0, n);

  /**
   * cards: learning cards ({lemma, pos, gloss, forms, ex:{es,en,form}}), pairs: [[es, en], ...].
   * Returns a mixed list of exercises. `speech` says whether listening exercises are possible.
   */
  function makeExercises({ cards = [], pairs = [], n = 12, speech = true, rnd = Math.random } = {}) {
    const out = [];
    const withGloss = cards.filter((c) => c.gloss);
    const chosen = pickN(cards, Math.min(cards.length, Math.ceil(n / 2)), rnd);
    chosen.forEach((c, i) => {
      const canGap = c.ex && c.ex.form && findWord(c.ex.es, c.ex.form);
      const canMeaning = c.gloss && withGloss.length >= 4;
      const kind = canGap && (!canMeaning || i % 2 === 0) ? 'gap' : canMeaning ? 'meaning' : null;
      if (kind === 'gap') out.push({ type: 'gap', lemma: c.lemma, es: c.ex.es, en: c.ex.en || '', form: c.ex.form, hint: c.ex.en || c.gloss || '' });
      else if (kind === 'meaning') {
        const wrong = pickN(withGloss.filter((x) => x.lemma !== c.lemma && x.gloss !== c.gloss), 3, rnd).map((x) => x.gloss);
        if (wrong.length === 3) out.push({ type: 'meaning', lemma: c.lemma, prompt: c.lemma, answer: c.gloss, options: shuffle([c.gloss, ...wrong], rnd) });
      }
    });

    const usable = pairs.filter((p) => p && p[0] && p[1] && tokens(p[0]).length >= 3 && tokens(p[0]).length <= 10);
    const kinds = speech ? ['build', 'read', 'listen'] : ['build', 'read'];
    const pool = shuffle(usable, rnd);
    for (let i = 0; out.length < n && i < pool.length; i++) {
      const [es, en] = pool[i];
      const kind = kinds[i % kinds.length];
      if (kind === 'read') {
        const wrong = pickN(usable.filter((p) => p[1] !== en), 2, rnd).map((p) => p[1]);
        if (wrong.length < 2) continue;
        out.push({ type: 'read', es, en, answer: en, options: shuffle([en, ...wrong], rnd) });
      } else {
        const own = tokens(es);
        const ownSet = new Set(own.map((t) => plain(t)));
        const extra = pickN([...new Set(usable.flatMap((p) => tokens(p[0])))].filter((t) => !ownSet.has(plain(t))), 2, rnd);
        out.push({ type: kind, es, en, tokens: own, bank: shuffle([...own, ...extra], rnd) });
      }
    }
    return shuffle(out, rnd).slice(0, n);
  }

  const api = { makeExercises, checkTyped, checkBuilt, findWord, tokens, shuffle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MargenTrain = api;
})(typeof self !== 'undefined' ? self : globalThis);
