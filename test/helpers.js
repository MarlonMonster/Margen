'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = (p = 'margen-') => fs.mkdtempSync(path.join(os.tmpdir(), p));

/** Tiny stand-ins for the five downloaded files. */
const RAW = {
  'es-en.data': `_____
casa
pos: n
  meta: {{es-noun|f}}
  g: f
  gloss: house
_____
tomar
pos: v
  meta: {{es-verb}}
  gloss: to take
  gloss: to drink [+de (from)]
    q: Latin America
_____
vivir
pos: v
  meta: {{es-verb}}
  gloss: to live
_____
vivo
pos: adj
  meta: {{es-adj}}
  gloss: obsolete word for alive
  gloss: alive, living
_____
Madrid
pos: prop
  g: m
  gloss: Madrid (a capital city of Spain)
`,
  'frequency.csv': `count,spanish,pos,flags,usage
1000,el,art,,600:la|400:el
950,en,prep,,950:en
900,casa,n,,500:casa|400:casas
800,tomar,v,,300:tomo|300:tomamos|200:tomar
700,vivir,v,,400:vivo|200:vivimos|100:vivir
`,
  'es_allforms.csv': `casa,n,casa
casas,n,casa
tomamos,v,tomar
tomo,v,tomar
vivo,adj,vivo
vivo,v,vivar,vivir
madrid,prop,Madrid
`,
  'sentences.tsv': `I take the house.\tTomo la casa.\tCC-BY 2.0 (France) Attribution: tatoeba.org #1 (a) & #2 (b)\t5\t5\t:v,tomo
We live in Madrid.\tVivimos en Madrid.\tCC-BY 2.0 (France) Attribution: tatoeba.org #3 (a) & #4 (b)\t5\t5\t:v,vivimos
Rare words only.\tZarzaparrilla extravagante inexplicable.\tCC-BY 2.0 (France) Attribution: tatoeba.org #5 (a) & #6 (b)\t5\t5\t:n,x
`,
  'jehle_verb_lookup.json': JSON.stringify({
    tomamos: [{ infinitive: 'tomar', mood: 'Indicative', tense: 'Present', performer_en: 'we' }],
    vivo: [{ infinitive: 'vivir', mood: 'Indicative', tense: 'Present', performer_en: 'I' }],
  }),
};

/** A fetch that serves `routes` (url prefix -> string | object | function) and 404s otherwise. */
function mockFetch(routes) {
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    for (const [prefix, v] of Object.entries(routes)) {
      if (String(url).startsWith(prefix)) {
        const val = typeof v === 'function' ? v(String(url)) : v;
        if (val && val.__image) return new Response(val.bytes, { status: 200, headers: { 'content-type': val.__image } });
        const body = typeof val === 'string' ? val : JSON.stringify(val);
        return new Response(body, { status: 200, headers: { 'content-type': typeof val === 'string' ? 'text/plain' : 'application/json' } });
      }
    }
    return new Response('not found', { status: 404, statusText: 'Not Found' });
  };
  f.calls = calls;
  return f;
}

function rawRoutes() {
  const r = {};
  for (const [k, v] of Object.entries(RAW)) r[`https://raw.test/${k}`] = v;
  return r;
}

module.exports = { tmp, RAW, mockFetch, rawRoutes };
