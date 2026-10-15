'use strict';
/** Saved texts: one JSON file each in <library>/texts, plus a small index, with images in <library>/img. */
const fsp = require('node:fs/promises');
const path = require('node:path');
const { isSafeId, readJSON, writeJSON } = require('./util');

function createStore({ libraryDir, bundledDir }) {
  const textsDir = path.join(libraryDir, 'texts');
  const indexFile = path.join(libraryDir, 'index.json');
  const imgDir = path.join(libraryDir, 'img');

  const summary = (t, bundled) => ({
    id: t.id, title: t.title, author: t.author || '', level: t.level || '', kind: t.kind || 'text',
    pairs: !!t.pairs, cover: t.cover || null, audio: !!(t.audio && t.audio.length),
    source: t.source ? t.source.name : '', bundled: !!bundled,
  });

  async function bundled() {
    let files = [];
    try { files = (await fsp.readdir(bundledDir)).filter((f) => f.endsWith('.json')).sort(); } catch { /* none */ }
    const out = [];
    for (const f of files) { const t = await readJSON(path.join(bundledDir, f), null); if (t && t.id) out.push(t); }
    return out;
  }

  async function list() {
    const saved = await readJSON(indexFile, []);
    return [...(await bundled()).map((t) => summary(t, true)), ...saved];
  }

  async function get(id) {
    if (!isSafeId(id)) return null;
    const mine = await readJSON(path.join(textsDir, `${id}.json`), null);
    if (mine) return mine;
    return (await bundled()).find((t) => t.id === id) || null;
  }

  async function save(text) {
    if (!isSafeId(text.id)) throw new Error('Invalid text id');
    await writeJSON(path.join(textsDir, `${text.id}.json`), text);
    const idx = (await readJSON(indexFile, [])).filter((x) => x.id !== text.id);
    idx.unshift(summary(text, false));
    await writeJSON(indexFile, idx);
    return text;
  }

  async function remove(id) {
    if (!isSafeId(id)) return false;
    const idx = await readJSON(indexFile, []);
    const hit = idx.find((x) => x.id === id);
    if (!hit) return false;
    await writeJSON(indexFile, idx.filter((x) => x.id !== id));
    await fsp.rm(path.join(textsDir, `${id}.json`), { force: true });
    if (hit.cover && hit.cover.startsWith('/library-img/')) {
      const stillUsed = idx.some((x) => x.id !== id && x.cover === hit.cover);
      if (!stillUsed) await fsp.rm(path.join(imgDir, path.basename(hit.cover)), { force: true });
    }
    return true;
  }

  return { list, get, save, remove, imgDir };
}

module.exports = { createStore };
