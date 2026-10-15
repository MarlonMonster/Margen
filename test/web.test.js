'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createData } = require('../lib/data');
const { createSentences } = require('../lib/sentences');
const engine = require('../web-src/engine');

const dir = path.join(__dirname, '..', 'data');
const have = fs.existsSync(path.join(dir, 'READY'));
const load = async (p, kind) => {
  try { const t = fs.readFileSync(path.join(dir, p), 'utf8'); return kind === 'json' ? JSON.parse(t) : t; } catch { return null; }
};

test('web engine gives the same lookups as the Node data module', { skip: !have && 'data not built' }, async () => {
  const node = createData(dir), web = engine.create(load);
  for (const w of ['casa', 'comemos', 'queso', 'Madrid', 'constructor', 'estaba', 'hablado', 'xyzzy', 'niños']) {
    assert.deepEqual(await web.lookup(w), await node.lookup(w), w);
  }
});

test('web engine builds the same practice sets as the Node module', { skip: !have && 'data not built' }, async () => {
  const node = createSentences(createData(dir)), web = engine.create(load);
  for (const args of [{ level: 1, seed: 7 }, { level: 2, word: 'casa', seed: 3, count: 10 }]) {
    assert.deepEqual(await web.makeSet(args), await node.makeSet(args));
  }
  assert.equal(await web.makeSet({ level: 1, word: 'qqqq' }), null);
});
