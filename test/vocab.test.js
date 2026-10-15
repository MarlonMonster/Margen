'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../public/vocab');

const mem = () => { let s = null; return { get: () => s, set: (k, v) => { s = v; } }; };
const T0 = 1_700_000_000_000;

test('vocab: adding, forms and counts', () => {
  const st = mem(), v = V.create(st);
  v.add({ lemma: 'Hacer', pos: 'verb', gloss: 'to do', form: 'hace', ex: { es: 'Hace calor.', en: 'It is hot.' } }, T0);
  v.add({ lemma: 'hacer', form: 'hacemos' }, T0);
  const c = v.get('HACER');
  assert.deepEqual(c.forms, ['hace', 'hacemos']);
  assert.equal(c.seen, 2);
  assert.equal(v.learningForms().get('hacemos'), 'hacer');
  assert.ok(V.create(st).get('hacer'), 'persists through storage');
});

test('vocab: review schedule grows and resets', () => {
  const v = V.create(mem());
  v.add({ lemma: 'casa', gloss: 'house' }, T0);
  assert.equal(v.due(T0).length, 1);
  v.grade('casa', 'good', T0);
  assert.equal(v.get('casa').interval, 1);
  v.grade('casa', 'good', T0 + V.DAY);
  assert.equal(v.get('casa').interval, 3);
  v.grade('casa', 'good', T0 + 4 * V.DAY);
  assert.equal(v.get('casa').interval, 8);          // 3 x 2.5, rounded
  assert.equal(v.due(T0 + 5 * V.DAY).length, 0);
  v.grade('casa', 'again', T0 + 12 * V.DAY);
  const c = v.get('casa');
  assert.equal(c.interval, 0); assert.equal(c.lapses, 1); assert.ok(c.ease < 2.5);
  assert.equal(c.due, T0 + 12 * V.DAY + 10 * V.MIN);
  v.grade('casa', 'easy', T0 + 13 * V.DAY);
  assert.equal(v.get('casa').interval, 4);
});

test('vocab: known words leave the learning list and can come back', () => {
  const v = V.create(mem());
  v.setKnown({ lemma: 'perro', gloss: 'dog', form: 'perros' }, T0);
  assert.equal(v.stats(T0).known, 1);
  assert.equal(v.stats(T0).learning, 0);
  assert.equal(v.learningForms().has('perros'), false);
  v.add({ lemma: 'perro', form: 'perro' }, T0 + 1);
  assert.equal(v.stats(T0 + 1).learning, 1);
});

test('vocab: practice words, backup and restore', () => {
  const a = V.create(mem());
  ['uno', 'dos', 'tres'].forEach((w, i) => a.add({ lemma: w, gloss: w }, T0 + i));
  a.grade('dos', 'again', T0 + 5);
  assert.equal(a.practiceWords(2, T0 + 20 * V.MIN)[0], 'dos', 'struggling words first');
  const b = V.create(mem());
  assert.equal(b.importJSON(a.exportJSON()), 3);
  assert.equal(b.importJSON(a.exportJSON()), 0, 'restoring twice changes nothing');
  assert.throws(() => b.importJSON('{"x":1}'), /not a Margen backup/);
  assert.equal(V.wait(10 * V.MIN), '10 min');
  assert.equal(V.wait(3 * V.DAY), '3 days');
});
