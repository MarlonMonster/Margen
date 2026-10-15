'use strict';
/**
 * Downloads the open data files and builds the compact files the app reads.
 *
 *   Wiktionary Spanish-English entries, word forms, frequency list, Tatoeba sentence pairs
 *     github.com/doozan/spanish_data (CC BY-SA for Wiktionary data, CC BY 2.0 FR for Tatoeba)
 *   Spanish verb tenses
 *     github.com/ghidinelli/fred-jehle-spanish-verbs (CC BY-NC-SA 3.0, personal use)
 */
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const readline = require('node:readline');
const { download, bucketOf, writeJSON, WORD_RE } = require('./util');
const { parseDictText } = require('./data');

const DOOZAN = 'https://raw.githubusercontent.com/doozan/spanish_data/master/';
const JEHLE = 'https://raw.githubusercontent.com/ghidinelli/fred-jehle-spanish-verbs/master/jehle_verb_lookup.json';
const FILES = ['es-en.data', 'frequency.csv', 'es_allforms.csv', 'sentences.tsv'];

async function setup({ dir, fetchImpl, log = () => {}, keepRaw = false, urls = {} }) {
  const raw = path.join(dir, 'raw');
  await fsp.mkdir(raw, { recursive: true });
  await fsp.rm(path.join(dir, 'READY'), { force: true });

  for (const f of FILES) {
    log(`Downloading ${f}`);
    await download((urls.doozan || DOOZAN) + f, path.join(raw, f), fetchImpl);
  }
  log('Downloading verb tenses');
  await download(urls.jehle || JEHLE, path.join(raw, 'jehle_verb_lookup.json'), fetchImpl);

  /* Dictionary, split by first letter */
  log('Building the dictionary');
  const dict = parseDictText(await fsp.readFile(path.join(raw, 'es-en.data'), 'utf8'));
  const dbuckets = Object.create(null);
  for (const [head, entries] of dict) {
    if (/\s/.test(head)) continue;
    (dbuckets[bucketOf(head)] ||= Object.create(null))[head] = entries;
  }
  await fsp.rm(path.join(dir, 'dict'), { recursive: true, force: true });
  for (const [b, obj] of Object.entries(dbuckets)) await writeJSON(path.join(dir, 'dict', `${b}.json`), obj);

  /* Frequency ranks, and which forms belong to each lemma */
  log('Building the frequency list');
  const rank = Object.create(null), lemmaForms = Object.create(null), formRank = new Map();
  const freqLines = (await fsp.readFile(path.join(raw, 'frequency.csv'), 'utf8')).split('\n');
  let n = 0;
  for (let i = 1; i < freqLines.length; i++) {
    const cols = freqLines[i].split(',');
    if (cols.length < 5) continue;
    const lemma = cols[1];
    if (!(lemma in rank)) rank[lemma] = ++n;
    const r = rank[lemma];
    const set = (lemmaForms[lemma] ||= []);
    for (const piece of cols.slice(4).join(',').split('|')) {
      const form = piece.slice(piece.indexOf(':') + 1).toLowerCase();
      if (!form || /[\s:]/.test(form)) continue;
      if (!set.includes(form) && set.length < 80) set.push(form);
      if (!formRank.has(form) || formRank.get(form) > r) formRank.set(form, r);
    }
  }
  await writeJSON(path.join(dir, 'freq.json'), { rank, forms: lemmaForms });

  /* Word forms (2.8 million rows), streamed into one file per letter */
  log('Building the word-form index');
  await fsp.rm(path.join(dir, 'forms'), { recursive: true, force: true });
  await fsp.mkdir(path.join(dir, 'forms'), { recursive: true });
  const outs = {};
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(raw, 'es_allforms.csv'), 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const form = parts[0].toLowerCase();
    if (!form || /[\s\t]/.test(form)) continue;
    const b = bucketOf(form);
    (outs[b] ||= fs.createWriteStream(path.join(dir, 'forms', `${b}.tsv`))).write(`${form}\t${parts[1]}\t${parts.slice(2).join(',')}\n`);
  }
  await Promise.all(Object.values(outs).map((s) => new Promise((res) => s.end(res))));

  /* Verb tenses, trimmed to what the popup shows */
  log('Building the verb tenses');
  const jehle = JSON.parse(await fsp.readFile(path.join(raw, 'jehle_verb_lookup.json'), 'utf8'));
  const verbs = Object.create(null);
  for (const [form, arr] of Object.entries(jehle)) {
    verbs[form.toLowerCase()] = arr.map((x) => ({
      infinitive: x.infinitive, mood: x.mood, tense: x.tense, performer_en: x.performer_en,
    }));
  }
  await writeJSON(path.join(dir, 'verbs.json'), verbs);

  /* Sentence pairs with a difficulty: the rank of the rarest word in the sentence */
  log('Building the sentence sets');
  const seen = new Set();
  const sentences = [];
  for (const line of (await fsp.readFile(path.join(raw, 'sentences.tsv'), 'utf8')).split('\n')) {
    const c = line.split('\t');
    if (c.length < 3) continue;
    const en = c[0].trim(), es = c[1].trim();
    if (!en || !es || !/tatoeba/i.test(c[2])) continue;
    const toks = es.match(WORD_RE) || [];
    if (toks.length < 3 || toks.length > 16) continue;
    const key = es.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let max = 0;
    toks.forEach((t, i) => {
      if (/^\d/.test(t) || (i > 0 && t[0] !== t[0].toLowerCase())) return; // numbers and names
      const r = formRank.get(t.toLowerCase()) || 40000;
      if (r > max) max = r;
    });
    sentences.push([es, en, max]);
  }
  await writeJSON(path.join(dir, 'sentences.json'), sentences);

  if (!keepRaw) await fsp.rm(raw, { recursive: true, force: true });
  await fsp.writeFile(path.join(dir, 'READY'), new Date().toISOString());
  log('Done');
  return { dictionaryHeadwords: dict.size, sentences: sentences.length, lemmas: n };
}

module.exports = { setup };
