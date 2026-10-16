'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../public/train');

const rnd = (() => { let a = 7; return () => { a = (a * 1664525 + 1013904223) % 4294967296; return a / 4294967296; }; })();
const cards = ['casa', 'perro', 'gato', 'libro', 'mesa'].map((l, i) => ({ lemma: l, gloss: ['house', 'dog', 'cat', 'book', 'table'][i], forms: [l], ex: i < 3 ? { es: `Veo la ${l} grande.`, en: `I see the big ${l}.`, form: l } : null }));
const pairs = [['Me gusta mi casa nueva.', 'I like my new house.'], ['El perro come pan.', 'The dog eats bread.'], ['Vamos al mercado hoy.', 'We go to the market today.'], ['Ella lee un libro.', 'She reads a book.'], ['Hola.', 'Hello.']];

test('train: checks typed answers and built sentences', () => {
  assert.equal(T.checkTyped(' Hace ', 'hace'), 'right');
  assert.equal(T.checkTyped('esta', 'está'), 'accent');
  assert.equal(T.checkTyped('casa', 'perro'), 'wrong');
  assert.equal(T.checkTyped('', 'perro'), 'wrong');
  assert.ok(T.checkBuilt(['El', 'perro', 'come', 'pan'], 'El perro come pan.'));
  assert.ok(!T.checkBuilt(['perro', 'El', 'come', 'pan'], 'El perro come pan.'));
  assert.equal(T.findWord('Hola amigo y adiós', 'y').i, 11);
  assert.equal(T.findWord('Es un país', 'pa'), null);
});

test('train: builds a mixed session from words and sentences', () => {
  const ex = T.makeExercises({ cards, pairs, n: 8, rnd });
  assert.ok(ex.length >= 6 && ex.length <= 8);
  const types = new Set(ex.map((e) => e.type));
  assert.ok(types.has('gap') || types.has('meaning'));
  assert.ok(types.has('build') || types.has('read'));
  for (const e of ex) {
    if (e.type === 'meaning') { assert.equal(e.options.length, 4); assert.ok(e.options.includes(e.answer)); assert.equal(new Set(e.options).size, 4); }
    if (e.type === 'read') { assert.equal(e.options.length, 3); assert.ok(e.options.includes(e.answer)); }
    if (e.type === 'build' || e.type === 'listen') { assert.ok(e.bank.length >= e.tokens.length); e.tokens.forEach((t) => assert.ok(e.bank.includes(t))); assert.ok(T.checkBuilt(e.tokens, e.es)); }
    if (e.type === 'gap') assert.ok(T.findWord(e.es, e.form));
  }
  assert.ok(!T.makeExercises({ cards, pairs, speech: false, rnd }).some((e) => e.type === 'listen'));
});

test('train: works with no learned words, or no sentences', () => {
  assert.ok(T.makeExercises({ cards: [], pairs, rnd }).length >= 3);
  const only = T.makeExercises({ cards, pairs: [], rnd });
  assert.ok(only.length >= 3 && only.every((e) => e.type === 'gap' || e.type === 'meaning'));
  assert.equal(T.makeExercises({ cards: [], pairs: [], rnd }).length, 0);
});
