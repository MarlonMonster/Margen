'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('../lib/setup');
const { createData, parseDictText, cleanGlosses } = require('../lib/data');
const { createSentences } = require('../lib/sentences');
const { tmp, RAW, mockFetch, rawRoutes } = require('./helpers');

test('parseDictText reads headwords, parts of speech and glosses', () => {
  const m = parseDictText(RAW['es-en.data']);
  assert.equal(m.size, 5);
  assert.deepEqual(m.get('casa')[0], { p: 'n', g: 'f', gl: [['house', '']] });
  assert.equal(m.get('tomar')[0].gl[1][1], 'Latin America');
  assert.ok(m.has('madrid'), 'headwords are lower-cased');
});

test('cleanGlosses drops weak senses, grammar patterns and broken brackets', () => {
  assert.deepEqual(cleanGlosses([['obsolete word for alive', ''], ['alive, living', '']]), ['alive, living']);
  assert.deepEqual(cleanGlosses([['to drink [+de (from)]', 'Latin America']]), ['(Latin America) to drink']);
  const long = cleanGlosses([['x '.repeat(30) + '(an unfinished note about something long and winding', '']])[0];
  assert.ok(long.endsWith('…') && !/\($/.test(long.slice(0, -1)) && long.length <= 95, long);
});

test('cleanGlosses keeps rude and slang senses out of the way', () => {
  assert.deepEqual(cleanGlosses([['foot', 'Spain, colloquial'], ['cheese', ''], ['sexual desire', 'Venezuela, vulgar']]), ['cheese', '(Spain, colloquial) foot']);
  assert.deepEqual(cleanGlosses([['sexual desire', 'vulgar']]), ['(vulgar) sexual desire'], 'kept when nothing else exists');
});

test('setup builds data that look up inflected forms, verb tenses, names and sentences', async () => {
  const dir = tmp();
  const steps = [];
  const r = await setup({ dir, fetchImpl: mockFetch(rawRoutes()), urls: { doozan: 'https://raw.test/', jehle: 'https://raw.test/jehle_verb_lookup.json' }, log: (m) => steps.push(m) });
  assert.equal(r.sentences, 3);
  assert.ok(steps.includes('Done'));

  const d = createData(dir);
  assert.equal(await d.ready(), true);
  const tomamos = await d.lookup('tomamos');
  assert.equal(tomamos.senses[0].lemma, 'tomar');
  assert.deepEqual(tomamos.senses[0].forms, ['present indicative · we']);
  const vivo = await d.lookup('vivo');
  assert.deepEqual(vivo.senses.map((s) => s.lemma), ['vivir', 'vivo'], 'ranked by how common the lemma is');
  assert.deepEqual(vivo.senses[1].glosses, ['alive, living'], 'obsolete sense dropped');
  assert.equal((await d.lookup('casas')).senses[0].glosses[0], 'house', 'plural');
  assert.equal((await d.lookup('Madrid')).senses[0].glosses[0], 'Madrid (a capital city of Spain)', 'capitalised lemma');
  assert.deepEqual((await d.lookup('constructor')).senses, [], 'no prototype leaks');
  assert.deepEqual((await d.lookup('')).senses, []);

  const s = createSentences(d);
  const set = await s.makeSet({ level: 1, seed: 1, count: 5 });   // the sentence of unknown words is above every level
  assert.equal(set.pairs, true);
  assert.deepEqual(set.paras.map((p) => p[0][0]).sort(), ['Tomo la casa.', 'Vivimos en Madrid.'].sort());
  const withWord = await s.makeSet({ level: 1, word: 'casa', seed: 1 });
  assert.deepEqual(withWord.paras.map((p) => p[0][0]), ['Tomo la casa.']);
  assert.equal(await s.makeSet({ level: 1, word: 'nonexistentword' }), null);
});

test('setup fails clearly when a download fails and leaves no READY marker', async () => {
  const dir = tmp();
  await assert.rejects(setup({ dir, fetchImpl: mockFetch({}), urls: { doozan: 'https://raw.test/' } }), /404/);
  assert.equal(await createData(dir).ready(), false);
});
