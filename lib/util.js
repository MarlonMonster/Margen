'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const UA = 'Margen/1.0 (personal Spanish reader; local use)';

async function fetchOk(url, opts = {}, f = globalThis.fetch) {
  const res = await f(url, { redirect: 'follow', ...opts, headers: { 'user-agent': UA, ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res;
}
const getJSON = async (url, f) => (await fetchOk(url, {}, f)).json();
const getText = async (url, f) => (await fetchOk(url, {}, f)).text();

async function download(url, file, f) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const res = await fetchOk(url, {}, f);
  const tmp = file + '.part';
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
  await fsp.rename(tmp, file);
}

const stripAccents = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

function slug(s, max = 48) {
  return stripAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max) || 'text';
}
const isSafeId = (id) => typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,80}$/.test(id);

/** File bucket for a word: its first letter without accents, or "_" for anything else. */
function bucketOf(w) {
  const c = stripAccents(w).toLowerCase()[0];
  return c && /[a-z]/.test(c) ? c : '_';
}

function hostAllowed(url, suffixes) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  return suffixes.some((s) => u.hostname === s || u.hostname.endsWith('.' + s));
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORD_RE = /\p{L}[\p{L}\p{M}]*(?:['’\-]\p{L}[\p{L}\p{M}]*)*/gu;
const words = (s) => s.match(WORD_RE) || [];

/** Splits a paragraph into sentences without breaking on common abbreviations. */
const ABBR = /\b(?:Sr|Sra|Srta|Dr|Dra|Ud|Uds|Lic|Ing|pág|núm|Av|Dña|Sta|Sto|D)\.\s*$/;
function splitSentences(p) {
  const raw = p.match(/[^.!?…]+(?:[.!?…]+["”»’')\]]*|$)\s*/g) || [p];
  if (raw.join('').length !== p.length) return [p.trim()];
  const out = [];
  raw.forEach((part) => {
    if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += part;
    else out.push(part);
  });
  return out.map((s) => s.trim()).filter(Boolean);
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}
async function writeJSON(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

const IMG_HOSTS = ['gutenberg.org', 'wikimedia.org', 'archive.org', 'librivox.org'];
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };

/** Downloads an image from an allowed host into dir and returns its public path, or null. */
async function saveImage(url, dir, name, f = globalThis.fetch) {
  if (!url || !hostAllowed(url, IMG_HOSTS)) return null;
  try {
    const res = await fetchOk(url, {}, f);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    const ext = EXT[type];
    if (!ext) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8 * 1024 * 1024) return null;
    await fsp.mkdir(dir, { recursive: true });
    const file = `${name}.${ext}`;
    await fsp.writeFile(path.join(dir, file), buf);
    return `/library-img/${file}`;
  } catch {
    return null;
  }
}

module.exports = {
  fetchOk, getJSON, getText, download, slug, isSafeId, bucketOf, hostAllowed, mulberry32,
  WORD_RE, words, splitSentences, readJSON, writeJSON, saveImage, stripAccents,
};
