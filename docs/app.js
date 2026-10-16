(function () {
  'use strict';

  /* ---------- Small helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const WORD = /\p{L}[\p{L}\p{M}]*(?:['’\-]\p{L}[\p{L}\p{M}]*)*/gu;
  const ABBR = /\b(?:Sr|Sra|Srta|Dr|Dra|Ud|Uds|Lic|Ing|pág|núm|Av|Dña|Sta|Sto|D)\.\s*$/;
  const SIZES = ['1.1rem', '1.25rem', '1.5rem'];
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const load = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

  const vocab = window.MargenVocab.create({ get: load, set: store });

  function h(tag, cls, txt) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  }
  function btn(label, cls, fn) {
    const b = h('button', 'btn ' + (cls || ''), label);
    b.type = 'button';
    if (fn) b.addEventListener('click', fn);
    return b;
  }
  async function api(path, opts) {
    const o = Object.assign({}, opts);
    if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers = { 'content-type': 'application/json' }; }
    const res = await fetch(path, o);
    let j = null;
    try { j = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((j && j.error) || res.statusText);
    return j;
  }
  function splitSentences(p) {
    const raw = p.match(/[^.!?…]+(?:[.!?…]+["”»’')\]]*|$)\s*/g) || [p];
    if (raw.join('').length !== p.length) return [p.trim()];
    const out = [];
    raw.forEach((part) => { if (out.length && ABBR.test(out[out.length - 1])) out[out.length - 1] += part; else out.push(part); });
    return out.map((s) => s.trim()).filter(Boolean);
  }

  /* ---------- State ---------- */
  const el = {
    reader: $('reader'), cap: $('cap'), tools: $('tools'), pop: $('pop'), body: $('p-body'), label: $('p-label'),
    caret: $('caret'), top: $('top'), libBtn: $('lib-btn'), read: $('read'), lib: $('library'),
    pager: $('pager'), banner: $('banner'),
  };
  let status = { ready: false, setup: {} }, meta = null;
  let current = null, pages = [], page = 0, mode = 'word', sizeIdx = 1, view = 'read';
  let sel = null, popOpen = false, anchor = null, openScroll = 0, selText = '', hoverTimer;

  /* ---------- Dictionary (cached) ---------- */
  const dictCache = new Map();
  function lookup(word) {
    const k = word.toLowerCase();
    if (!dictCache.has(k)) dictCache.set(k, api('/api/dict?w=' + encodeURIComponent(word)).catch((e) => ({ error: e.message, senses: [] })));
    return dictCache.get(k);
  }

  /* ---------- Reading view ---------- */
  function paginate(paras, layout) {
    const limit = layout === 'list' ? 1800 : 3200;
    const out = [];
    let cur = [], weight = 0;
    paras.forEach((p) => {
      const w = typeof p === 'string' ? p.length : Array.isArray(p) ? p.reduce((n, x) => n + x[0].length, 0) : 700;
      if (cur.length && weight + w > limit) { out.push(cur); cur = []; weight = 0; }
      cur.push(p);
      weight += w;
    });
    if (cur.length) out.push(cur);
    return out.length ? out : [[]];
  }

  function sentenceEl(es, en) {
    const s = h('span', 's');
    s.dataset.t = es;
    if (en) s.dataset.en = en;
    let last = 0;
    const lf = vocab.learningForms();
    Array.from(es.matchAll(WORD)).forEach((m) => {
      if (m.index > last) s.append(es.slice(last, m.index));
      s.append(h('span', lf.has(m[0].toLowerCase()) ? 'w learn' : 'w', m[0]));
      last = m.index + m[0].length;
    });
    if (last < es.length) s.append(es.slice(last));
    return s;
  }

  function paintMarks() {
    const lf = vocab.learningForms();
    el.reader.querySelectorAll('.w').forEach((w) => w.classList.toggle('learn', lf.has(w.textContent.toLowerCase())));
  }

  function figure(img) {
    const f = h('figure', 'fig');
    const i = h('img');
    i.src = img.src;
    i.alt = img.alt || '';
    i.loading = 'lazy';
    f.append(i);
    if (img.caption) f.append(h('figcaption', '', img.caption));
    return f;
  }

  function renderPage() {
    closePop();
    el.reader.replaceChildren();
    el.reader.dataset.layout = current.layout || 'prose';
    (pages[page] || []).forEach((p) => {
      if (p && !Array.isArray(p) && typeof p === 'object') { if (p.image) el.reader.append(figure(p.image)); return; }
      const par = h('p', 'par');
      if (Array.isArray(p)) {
        p.forEach((x, i) => { par.append(sentenceEl(x[0], x[1])); if (i < p.length - 1) par.append(' '); });
      } else {
        splitSentences(p).forEach((s, i, a) => { par.append(sentenceEl(s)); if (i < a.length - 1) par.append(' '); });
      }
      el.reader.append(par);
    });
    paintMarks();
    el.pager.hidden = pages.length < 2;
    $('page-of').textContent = `Page ${page + 1} of ${pages.length}`;
    $('prev').disabled = page === 0;
    $('next').disabled = page >= pages.length - 1;
    if (!current.ephemeral) store('margen:pos:' + current.id, String(page));
  }

  function renderText() {
    const t = current;
    pages = paginate(t.paras, t.layout);
    const saved = t.ephemeral ? 0 : parseInt(load('margen:pos:' + t.id), 10);
    page = saved >= 0 && saved < pages.length ? saved : 0;
    const count = t.paras.reduce((n, p) => n + (typeof p === 'string' ? (p.match(WORD) || []).length : Array.isArray(p) ? p.reduce((m, x) => m + (x[0].match(WORD) || []).length, 0) : 0), 0);
    el.cap.textContent = [t.title, t.author, t.level, `${count.toLocaleString('en')} words`, t.pairs ? 'English for every sentence' : 'Spanish only'].filter(Boolean).join(' · ');

    const cover = $('cover');
    cover.hidden = !t.cover;
    if (t.cover) { $('cover-img').src = t.cover; $('cover-img').alt = `Cover of ${t.title}`; }

    const audio = $('audio');
    audio.hidden = !(t.audio && t.audio.length);
    if (!audio.hidden) {
      const sel = $('audio-sel');
      sel.replaceChildren(...t.audio.map((a, i) => { const o = h('option', '', `${a.title}${a.time ? ' (' + a.time + ')' : ''}`); o.value = i; return o; }));
      $('audio-el').src = t.audio[0].url;
    }
    const ref = $('ref');
    ref.hidden = !t.reference;
    if (t.reference) {
      $('ref-sum').textContent = `English Wikipedia: ${t.reference.title}`;
      const b = $('ref-body');
      b.replaceChildren(...t.reference.text.split(/\n+/).map((x) => h('p', '', x)));
      const a = h('a', '', 'Open the English article');
      a.href = t.reference.url; a.target = '_blank'; a.rel = 'noopener';
      b.append(a);
    }

    const credit = $('credit');
    credit.replaceChildren();
    if (t.source) {
      credit.append('Source: ');
      if (t.source.url) { const a = h('a', '', t.source.name); a.href = t.source.url; a.target = '_blank'; a.rel = 'noopener'; credit.append(a); } else credit.append(t.source.name);
      if (t.source.license) credit.append(` · ${t.source.license}`);
      if (!t.pairs) credit.append(' · Word meanings come from Wiktionary (CC BY-SA).');
    }

    const acts = $('read-actions');
    acts.replaceChildren();
    if (t.ephemeral) {
      acts.append(
        btn('New set', '', () => makeSet(t.params, true)),
        btn('Save to my texts', 'primary', async (e) => {
          e.target.disabled = true;
          try { const saved = await api('/api/text', { method: 'POST', body: Object.assign({}, t, { ephemeral: undefined, params: undefined }) }); current = saved; e.target.textContent = 'Saved'; } catch (err) { e.target.textContent = err.message; }
        }));
    }
    acts.hidden = !t.ephemeral;
    renderPage();
    window.scrollTo(0, 0);
  }

  async function openText(idOrObj) {
    try {
      current = typeof idOrObj === 'string' ? await api('/api/text/' + idOrObj) : idOrObj;
      if (!current.ephemeral) store('margen:src', current.id);
      renderText();
      setView('read');
    } catch (e) {
      current = null;
      setView('library');
    }
  }

  /* ---------- Popup ---------- */
  function clearMarks() { el.reader.querySelectorAll('.on').forEach((n) => n.classList.remove('on')); }
  function rectsOf(rects) {
    const list = Array.from(rects).filter((r) => r.width > 0 || r.height > 0);
    if (!list.length) return null;
    const f = list[0], l = list[list.length - 1];
    return { f: { top: f.top, left: f.left, right: f.right }, l: { bottom: l.bottom, left: l.left, right: l.right } };
  }
  function place() {
    if (!anchor) return;
    const pop = el.pop;
    pop.style.visibility = 'hidden';
    pop.hidden = false;
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    const barB = el.top.getBoundingClientRect().bottom, gap = 12;
    const below = vh - anchor.l.bottom - gap, above = anchor.f.top - barB - gap;
    const useBelow = below >= ph || below >= above;
    let y = useBelow ? anchor.l.bottom + gap : anchor.f.top - gap - ph;
    y = Math.max(barB + 6, Math.min(y, vh - ph - 8));
    const cx = useBelow ? (anchor.l.left + anchor.l.right) / 2 : (anchor.f.left + anchor.f.right) / 2;
    const x = Math.max(12, Math.min(cx - pw / 2, vw - pw - 12));
    pop.style.left = x + 'px';
    pop.style.top = y + 'px';
    pop.dataset.side = useBelow ? 'below' : 'above';
    el.caret.style.setProperty('--cx', Math.max(20, Math.min(cx - x, pw - 20)) + 'px');
    pop.style.visibility = '';
  }
  function openPop(a, label, hover) {
    el.pop.classList.toggle('hover', !!hover);
    anchor = a;
    el.label.textContent = label;
    popOpen = true;
    openScroll = window.pageYOffset;
  }
  function setBody(...nodes) {
    el.body.replaceChildren(...nodes.filter(Boolean));
    place();
  }
  function closePop() {
    el.pop.hidden = true;
    el.pop.classList.remove('hover');
    popOpen = false; sel = null; anchor = null; selText = '';
    clearMarks();
  }

  const speakOk = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  let autoSpeak = load('margen:sound') === '1';
  function speak(text) {
    if (!speakOk) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'es-ES'; u.rate = 0.9; speechSynthesis.speak(u); } catch (e) { /* no voice */ }
  }
  function speakBtn(text) {
    if (!speakOk) return null;
    const b = h('button', 'say');
    b.type = 'button';
    b.setAttribute('aria-label', 'Hear ' + text);
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>';
    b.addEventListener('click', () => speak(text));
    return b;
  }
  /** A short English rendering of a dictionary gloss: no leading qualifiers, at most three near-synonyms. */
  function short(g) {
    const s = String(g).replace(/^(\([^)]*\)\s*)+/, '').trim() || String(g);
    const parts = s.split(/\s*[,;]\s*/);
    let out = parts[0];
    for (let i = 1; i < parts.length && i < 3; i++) { if ((out + ', ' + parts[i]).length > 36) break; out += ', ' + parts[i]; }
    return out;
  }

  function senseBlock(s) {
    const d = h('div', 'g-sense');
    const head = h('div');
    head.append(h('b', '', s.lemma), ` · ${s.pos}${s.gender ? ', ' + s.gender : ''}`);
    d.append(head);
    const ul = h('ul');
    s.glosses.slice(0, 3).forEach((g) => ul.append(h('li', '', g)));
    d.append(ul);
    if (s.forms && s.forms.length) d.append(h('p', 'g-meta', 'This form: ' + s.forms.join('; ')));
    return d;
  }

  async function showWord(token) {
    const word = sel.text;
    const override = current.gloss && current.gloss[word.toLowerCase()];
    if (autoSpeak) speak(word);
    const row = h('div', 'g-wordrow');
    row.append(h('p', 'g-word', word));
    const sp = speakBtn(word);
    if (sp) row.append(sp);
    setBody(row, h('p', 'g-meta', 'Looking up…'));
    const info = await lookup(word);
    if (!sel || sel.token !== token) return;
    const nodes = [row];
    const senses = info.senses || [];
    if (override) {
      const [m, note] = override.split('|');
      nodes.push(h('p', 'g-en', m));
      if (note) nodes.push(h('p', 'g-meta', note));
    } else if (info.error) {
      nodes.push(h('p', 'g-meta', info.error));
    } else if (!senses.length) {
      nodes.push(h('p', 'g-en', 'No entry'));
      nodes.push(h('p', 'g-meta', /^\p{Lu}/u.test(word) ? 'This may be a name.' : 'This word is not in the dictionary.'));
    } else {
      const first = senses[0];
      nodes.push(h('p', 'g-en', short(first.glosses[0])));
      const also = first.glosses.slice(1, 3).map(short).filter((x) => x && x !== short(first.glosses[0]) && !/^in (various|certain|some)/i.test(x));
      if (also.length) nodes.push(h('p', 'g-also', 'also: ' + also.join(' · ')));
      nodes.push(h('p', 'g-meta', first.lemma + ' · ' + first.pos + (first.forms && first.forms[0] ? ' · ' + first.forms[0] : '')));
    }
    if (senses.length) {
      const more = h('details', 'g-more');
      more.append(h('summary', '', override ? 'Dictionary' : 'More meanings'));
      senses.slice(0, 3).forEach((x) => more.append(senseBlock(x)));
      nodes.push(more);
    }
    const first = senses[0];
    const gloss = override ? override.split('|')[0] : first ? short(first.glosses[0]) : '';
    const act = h('div', 'g-actions');
    if (gloss) {
      const lemma = (info.lemma || word).toLowerCase();
      const sn = sel.el && sel.el.closest ? sel.el.closest('.s') : null;
      const meta = { lemma, pos: first ? first.pos : '', gloss, form: word, ex: sn ? { es: sn.dataset.t, en: sn.dataset.en || '' } : null };
      const learnB = btn('', 'small'), knownB = btn('', 'small');
      const paint = () => {
        const c = vocab.get(lemma);
        const learning = !!c && c.status === 'learning', known = !!c && c.status === 'known';
        learnB.textContent = learning ? '✓ Learning' : '+ Learn';
        knownB.textContent = known ? '✓ Known' : 'I know it';
        learnB.classList.toggle('on', learning); knownB.classList.toggle('on', known);
        learnB.setAttribute('aria-pressed', String(learning)); knownB.setAttribute('aria-pressed', String(known));
      };
      learnB.addEventListener('click', () => { const c = vocab.get(lemma); if (c && c.status === 'learning') vocab.remove(lemma); else vocab.add(meta); paint(); paintMarks(); });
      knownB.addEventListener('click', () => { const c = vocab.get(lemma); if (c && c.status === 'known') vocab.remove(lemma); else vocab.setKnown(meta); paint(); paintMarks(); });
      paint();
      act.append(learnB, knownB);
    }
    act.append(btn('Translate the sentence', 'small', () => lineFromWord()));
    nodes.push(act);
    setBody(...nodes);
  }

  let translator = null;
  async function deviceTranslate(text) {
    if (!('Translator' in self)) return null;
    try {
      if (!translator) {
        const av = await self.Translator.availability({ sourceLanguage: 'es', targetLanguage: 'en' });
        if (av === 'unavailable') return null;
        translator = await self.Translator.create({ sourceLanguage: 'es', targetLanguage: 'en' });
      }
      return await translator.translate(text);
    } catch (e) { return null; }
  }

  async function showLine(src, en, tokenCheck) {
    if (en) { setBody(h('p', 'g-src', src), h('p', 'g-en line', en)); return; }
    setBody(h('p', 'g-src', src), h('p', 'g-meta', 'Translating on this device…'));
    const t = await deviceTranslate(src);
    if (!sel || sel.token !== tokenCheck) return;
    if (t) setBody(h('p', 'g-src', src), h('p', 'g-en line', t), h('p', 'g-meta', 'Translated on this device, so check it.'));
    else setBody(h('p', 'g-src', src), h('p', 'g-meta', 'This text has no English for its sentences. Chrome can translate on the device if it has the Spanish language pack installed.'));
  }

  let tokenSeq = 0;
  function pick(kind, node, sn, hover) {
    if (!hover) clearTimeout(hoverTimer);
    clearMarks();
    node.classList.add('on');
    sel = { kind, el: node, text: kind === 'word' ? node.textContent : sn.dataset.t, en: sn.dataset.en || '', token: ++tokenSeq };
    const a = rectsOf(node.getClientRects());
    if (!a) return;
    openPop(a, kind === 'word' ? 'Word' : 'Sentence', hover);
    if (kind === 'word') showWord(sel.token); else showLine(sel.text, sel.en, sel.token);
  }
  function lineFromWord() {
    if (!sel || !sel.el) return;
    const sn = sel.el.closest('.s');
    if (!sn) return;
    clearMarks();
    sn.classList.add('on');
    sel = { kind: 'line', el: sn, text: sn.dataset.t, en: sn.dataset.en || '', token: ++tokenSeq };
    const a = rectsOf(sn.getClientRects());
    if (a) anchor = a;
    el.label.textContent = 'Sentence';
    showLine(sel.text, sel.en, sel.token);
  }

  /* ---------- Reader events ---------- */
  el.reader.addEventListener('click', (e) => {
    const s = window.getSelection();
    if (s && !s.isCollapsed && s.toString().trim()) return;
    const sn = e.target.closest('.s');
    if (!sn) return;
    if (mode === 'word') { const w = e.target.closest('.w'); if (w) pick('word', w, sn); } else pick('line', sn, sn);
  });

  function hoverTarget(t) {
    if (!t || !t.closest) return null;
    const sn = t.closest('.s');
    if (!sn) return null;
    if (mode === 'word') { const w = t.closest('.w'); return w ? { kind: 'word', el: w, sn } : null; }
    return { kind: 'line', el: sn, sn };
  }
  el.reader.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    if (popOpen && !el.pop.classList.contains('hover')) return;
    const hit = hoverTarget(e.target);
    clearTimeout(hoverTimer);
    if (!hit) { if (popOpen) hoverTimer = setTimeout(closePop, 120); return; }
    if (popOpen && sel && sel.el === hit.el) return;
    hoverTimer = setTimeout(() => {
      if (popOpen && !el.pop.classList.contains('hover')) return;
      pick(hit.kind, hit.el, hit.sn, true);
    }, 90);
  });
  el.reader.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(hoverTimer);
    if (popOpen && el.pop.classList.contains('hover')) closePop();
  });
  document.addEventListener('pointerdown', (e) => { if (popOpen && !el.pop.contains(e.target)) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popOpen) closePop(); });
  window.addEventListener('scroll', () => { if (popOpen && Math.abs(window.pageYOffset - openScroll) > 14) closePop(); }, { passive: true });
  $('p-close').addEventListener('click', closePop);

  let selTimer;
  document.addEventListener('selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(onSelection, 250); });
  function onSelection() {
    if (view !== 'read') return;
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const range = s.getRangeAt(0);
    if (!el.reader.contains(range.commonAncestorContainer)) return;
    const t = s.toString().replace(/\s+/g, ' ').trim();
    if (!t || (t === selText && popOpen)) return;
    const a = rectsOf(range.getClientRects());
    if (!a) return;
    const sents = Array.from(el.reader.querySelectorAll('.s')).filter((n) => range.intersectsNode(n));
    if (!sents.length) return;
    clearMarks();
    selText = t;
    sel = { kind: 'pick', el: null, text: t, token: ++tokenSeq };
    openPop(a, 'Selection, whole sentences', false);
    const src = sents.map((n) => n.dataset.t).join(' ');
    const en = sents.every((n) => n.dataset.en) ? sents.map((n) => n.dataset.en).join(' ') : '';
    showLine(src, en, sel.token);
  }

  /* ---------- Toolbar ---------- */
  function setMode(m) {
    mode = m; store('margen:mode', m);
    el.reader.dataset.mode = m;
    $('m-word').setAttribute('aria-checked', String(m === 'word'));
    $('m-line').setAttribute('aria-checked', String(m === 'line'));
    closePop();
  }
  $('m-word').addEventListener('click', () => setMode('word'));
  $('m-line').addEventListener('click', () => setMode('line'));
  const soundBtn = $('sound-btn'), themeBtn = $('theme-btn');
  function paintSound() { soundBtn.setAttribute('aria-pressed', String(autoSpeak)); soundBtn.classList.toggle('on', autoSpeak); }
  if (!speakOk) soundBtn.hidden = true;
  soundBtn.addEventListener('click', () => { autoSpeak = !autoSpeak; store('margen:sound', autoSpeak ? '1' : '0'); paintSound(); if (autoSpeak) speak('hola'); });
  paintSound();
  const paintTheme = () => { const dark = document.documentElement.dataset.theme === 'dark'; themeBtn.textContent = dark ? '☀' : '☾'; themeBtn.setAttribute('aria-label', dark ? 'Switch to the light theme' : 'Switch to the dark theme'); };
  themeBtn.addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = t; store('margen:theme', t); paintTheme(); });
  paintTheme();
  function applySize() { el.reader.style.setProperty('--read', SIZES[sizeIdx]); }
  $('size-btn').addEventListener('click', () => { sizeIdx = (sizeIdx + 1) % SIZES.length; store('margen:size', String(sizeIdx)); applySize(); closePop(); });
  $('prev').addEventListener('click', () => { if (page > 0) { page--; renderPage(); window.scrollTo(0, 0); } });
  $('next').addEventListener('click', () => { if (page < pages.length - 1) { page++; renderPage(); window.scrollTo(0, 0); } });
  $('audio-sel').addEventListener('change', (e) => { const a = $('audio-el'); a.src = current.audio[Number(e.target.value)].url; a.play().catch(() => {}); });

  /* ---------- Views and library ---------- */
  function setView(v) {
    closePop();
    view = v;
    if (v === 'read' && !current) v = view = 'library';
    el.read.hidden = v !== 'read';
    el.tools.hidden = v !== 'read';
    el.lib.hidden = v !== 'library';
    el.libBtn.setAttribute('aria-pressed', String(v === 'library'));
    el.libBtn.textContent = v === 'library' && current ? 'Back to reading' : 'Library';
    if (v === 'library') showTab(tab);
    window.scrollTo(0, 0);
  }
  el.libBtn.addEventListener('click', () => setView(view === 'library' ? 'read' : 'library'));

  let tab = 'mine';
  const searchState = {};

  function tabsList() {
    const due = vocab.stats().due;
    const t = [{ id: 'mine', name: 'My texts' }, { id: 'review', name: due ? `Review (${due})` : 'Review' }, { id: 'train', name: 'Train' }, { id: 'practice', name: 'Practice' }];
    (meta ? meta.sources : []).forEach((s) => t.push({ id: s.id, name: s.name }));
    t.push({ id: 'add', name: 'Add text' }, { id: 'more', name: 'More sources' });
    return t;
  }
  function showTab(id) {
    tab = id;
    const tabs = $('tabs');
    tabs.replaceChildren(...tabsList().map((t) => {
      const b = h('button', '', t.name);
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(t.id === id));
      b.addEventListener('click', () => showTab(t.id));
      return b;
    }));
    const panel = $('panel');
    panel.replaceChildren();
    if (id === 'mine') return tabMine(panel);
    if (id === 'review') return tabReview(panel);
    if (id === 'train') return tabTrain(panel);
    if (id === 'practice') return tabPractice(panel);
    if (id === 'add') return tabAdd(panel);
    if (id === 'more') return tabMore(panel);
    const src = meta.sources.find((s) => s.id === id);
    if (src) tabSource(panel, src);
  }

  function thumb(src, title) {
    if (src) { const i = h('img', 'thumb'); i.src = src; i.alt = ''; i.loading = 'lazy'; i.referrerPolicy = 'no-referrer'; return i; }
    return h('div', 'thumb blank', (title || '?').trim()[0] || '?');
  }

  async function tabMine(panel) {
    const list = h('ul', 'list');
    panel.append(h('p', '', 'Everything you can read offline. Starter texts are translated sentence by sentence; books and articles are Spanish only, with word meanings.'), list);
    let items = [];
    try { items = await api('/api/library'); } catch (e) { panel.append(h('p', 'status err', e.message)); return; }
    items.forEach((t) => {
      const li = h('li', 'item');
      li.append(thumb(t.cover, t.title));
      const body = h('div', 'body');
      const title = h('p', 't', t.title);
      if (t.level) title.append(' ', h('span', 'chip', t.level));
      body.append(title, h('p', 'sub', [t.author, t.pairs ? 'English for every sentence' : 'Spanish only', t.audio ? 'with audio' : '', t.source].filter(Boolean).join(' · ')));
      const btns = h('div', 'btns');
      btns.append(btn('Read', 'primary small', () => openText(t.id)));
      if (!t.bundled) {
        const del = btn('Remove', 'small', () => {
          if (del.dataset.armed) { api('/api/text/' + t.id, { method: 'DELETE' }).then(() => { if (current && current.id === t.id) current = null; showTab('mine'); }); return; }
          del.dataset.armed = '1'; del.textContent = 'Tap again to remove'; del.classList.add('danger');
        });
        btns.append(del);
      }
      body.append(btns);
      li.append(body);
      list.append(li);
    });
  }

  /* ---------- Review: the words you chose to learn ---------- */
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Position of `form` as a whole word inside a sentence, or null. */
  function findWord(es, form) {
    if (!es || !form) return null;
    const m = new RegExp('(?<![\\p{L}\\p{M}])' + esc(form) + '(?![\\p{L}\\p{M}])', 'iu').exec(es);
    return m ? { i: m.index, len: m[0].length } : null;
  }
  function sentenceWith(es, form, blank) {
    const out = h('p', 'rv-s');
    out.lang = 'es';
    const f = findWord(es, form);
    if (!f) { out.textContent = es; return out; }
    out.append(es.slice(0, f.i), blank ? h('span', 'blank', '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0') : h('mark', '', es.slice(f.i, f.i + f.len)), es.slice(f.i + f.len));
    return out;
  }

  function runReview(panel) {
    panel.replaceChildren();
    const queue = vocab.due().slice(0, 20);
    const total = queue.length;
    let n = 0;
    const box = h('div', 'rv');
    panel.append(box);
    const next = () => {
      box.replaceChildren();
      if (!queue.length) {
        box.append(h('p', 'g-en', 'Done'), h('p', 'g-meta', `${total} word${total === 1 ? '' : 's'} reviewed. They will come back when they are due.`), btn('Back to my words', 'primary', () => showTab('review')));
        return;
      }
      const c = queue[0];
      const hasEx = !!(c.ex && c.ex.es && findWord(c.ex.es, c.ex.form));
      box.append(h('p', 'g-label', `Word ${Math.min(n + 1, total)} of ${total}`));
      if (hasEx) { box.append(sentenceWith(c.ex.es, c.ex.form, true), h('p', 'g-meta', 'What word fits the gap?')); }
      else box.append(h('p', 'rv-word', c.lemma), h('p', 'g-meta', 'What does it mean?'));
      box.append(btn('Show answer', 'primary rv-show', () => {
        box.replaceChildren();
        if (autoSpeak) speak(hasEx ? c.ex.form : c.lemma);
        const head = h('div', 'g-wordrow');
        head.append(h('p', 'g-word', hasEx ? c.ex.form : c.lemma));
        const sp = speakBtn(hasEx ? c.ex.es : c.lemma); if (sp) head.append(sp);
        box.append(head, h('p', 'g-en', c.gloss || '—'), h('p', 'g-meta', [c.lemma, c.pos].filter(Boolean).join(' · ')));
        if (hasEx) { box.append(sentenceWith(c.ex.es, c.ex.form, false)); if (c.ex.en) box.append(h('p', 'g-also', c.ex.en)); }
        const pv = vocab.preview(c);
        const row = h('div', 'rv-grade');
        [['again', 'Again'], ['good', 'Good'], ['easy', 'Easy']].forEach(([g, label]) => {
          const b = btn('', g === 'good' ? 'primary' : '', () => {
            vocab.grade(c.lemma, g);
            queue.shift();
            if (g === 'again') queue.push(c); else n++;
            next();
          });
          b.append(h('span', '', label), h('small', '', window.MargenVocab.wait(pv[g])));
          row.append(b);
        });
        box.append(row);
      }));
    };
    next();
  }

  function tabReview(panel) {
    const st = vocab.stats();
    const cards = vocab.all();
    if (!cards.length) {
      panel.append(h('p', '', 'Tap a word while you read and choose “+ Learn”. Your words are listed here and come back for a short review, spaced out so they stick. Words you save are underlined in every text.'));
    } else {
      panel.append(h('p', '', `${st.due} due now · ${st.learning} learning · ${st.known} known`));
      const acts = h('div', 'btns');
      if (st.due) acts.append(btn(`Review ${Math.min(st.due, 20)} word${st.due === 1 ? '' : 's'}`, 'primary', () => runReview(panel)));
      if (st.learning && (status.ready || status.web)) {
        const pr = btn('Read sentences with my words', '', async (e) => {
          e.target.disabled = true;
          try { await makeSet({ level: Number(load('margen:level')) || 2, words: vocab.practiceWords(12) }, false); } catch (err) { e.target.disabled = false; e.target.textContent = err.message; }
        });
        acts.append(pr);
      }
      panel.append(acts);
      if (!st.due && st.learning) {
        const nextDue = Math.min(...vocab.all().filter((c) => c.status === 'learning').map((c) => c.due));
        panel.append(h('p', 'g-meta', 'Nothing is due. Next review in ' + window.MargenVocab.wait(Math.max(0, nextDue - Date.now())) + '.'));
      }
      const learning = cards.filter((c) => c.status === 'learning').sort((a, b) => b.added - a.added);
      const list = h('ul', 'list');
      learning.forEach((c) => {
        const li = h('li', 'item');
        const body = h('div', 'body');
        const t = h('p', 't', c.lemma);
        body.append(t, h('p', 'sub', [c.gloss, c.pos].filter(Boolean).join(' · ')));
        if (c.ex && c.ex.es) body.append(h('p', 'sub it', c.ex.es));
        const rm = btn('Remove', 'small', () => { if (rm.dataset.armed) { vocab.remove(c.lemma); showTab('review'); return; } rm.dataset.armed = '1'; rm.textContent = 'Tap again'; rm.classList.add('danger'); });
        const b = h('div', 'btns'); b.append(rm); body.append(b);
        li.append(body); list.append(li);
      });
      panel.append(list);
      const known = cards.filter((c) => c.status === 'known');
      if (known.length) {
        const d = h('details', 'g-more');
        d.append(h('summary', '', `Known words (${known.length})`));
        known.forEach((c) => {
          const row = h('p', 'sub', `${c.lemma} — ${c.gloss || ''} `);
          row.append(btn('Not yet', 'small', () => { vocab.add({ lemma: c.lemma }); showTab('review'); }));
          d.append(row);
        });
        panel.append(d);
      }
    }
    // Backup: browser storage can be cleared, so the list can be saved to a file and restored.
    const tools = h('div', 'btns');
    tools.style.marginTop = '16px';
    const msg = h('p', 'status');
    if (cards.length) tools.append(btn('Download backup', 'small', () => {
      const a = h('a'); a.href = URL.createObjectURL(new Blob([vocab.exportJSON()], { type: 'application/json' })); a.download = 'margen-words.json';
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }));
    const file = h('input'); file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
    file.addEventListener('change', async () => {
      try { const n = vocab.importJSON(await file.files[0].text()); msg.className = 'status'; msg.textContent = `Restored ${n} word${n === 1 ? '' : 's'}.`; showTab('review'); } catch (e) { msg.className = 'status err'; msg.textContent = e.message; }
    });
    tools.append(btn('Restore backup', 'small', () => file.click()), file);
    panel.append(tools, msg);
  }

  /* ---------- Train: short mixed exercises ---------- */
  function tabTrain(panel) {
    const T = window.MargenTrain;
    const learning = vocab.all().filter((c) => c.status === 'learning');
    const canSentences = status.ready || status.web;
    panel.append(h('p', '', 'Twelve short exercises: meanings, filling gaps, building sentences and listening. They use the words you are learning and real sentences with English. A right answer moves a due word on; a wrong one brings it back sooner.'));
    if (!learning.length && !canSentences) { panel.append(h('p', 'status err', 'Tap “+ Learn” on some words first, or download the dictionary so sentences are available.')); return; }
    let level = Number(load('margen:level')) || 2;
    const chips = h('div', 'chips');
    const draw = () => chips.replaceChildren(...Object.entries(meta.practice.levels).map(([k, v]) => {
      const b = btn(v.label, Number(k) === level ? 'on' : '', () => { level = Number(k); store('margen:level', String(level)); draw(); });
      b.setAttribute('aria-pressed', String(Number(k) === level));
      return b;
    }));
    draw();
    const st = h('p', 'status');
    const go = btn(learning.length ? `Start (${learning.length} of your words)` : 'Start', 'primary', async () => {
      go.disabled = true; st.className = 'status'; st.textContent = 'Choosing exercises…';
      try {
        let pairs = [];
        if (canSentences) {
          const ask = (extra) => api('/api/practice', { method: 'POST', body: Object.assign({ level, count: 40, seed: Math.floor(Math.random() * 1e6) }, extra) }).then((t) => t.paras.map((p) => p[0])).catch(() => []);
          const mine = learning.length ? await ask({ words: vocab.practiceWords(12) }) : [];
          pairs = mine.concat(await ask({}));
        }
        const list = T.makeExercises({ cards: learning, pairs, speech: speakOk, n: 12 });
        if (!list.length) throw new Error('Not enough material yet. Learn a few words first.');
        runTrain(panel, list);
      } catch (e) { go.disabled = false; st.className = 'status err'; st.textContent = e.message; }
    });
    panel.append(chips, go, st);
  }

  function runTrain(panel, list) {
    const T = window.MargenTrain;
    const queue = list.slice();
    const total = list.length;
    let done = 0, firstTry = 0;
    const missed = new Set();
    const box = h('div', 'tr');
    panel.replaceChildren(box);

    const finish = () => {
      box.replaceChildren(h('p', 'g-en', `${firstTry} of ${total} right first time`));
      if (missed.size) box.append(h('p', 'g-meta', 'To revisit: ' + [...missed].join(', ')));
      const row = h('div', 'btns');
      row.append(btn('Another set', 'primary', () => showTab('train')), btn('Done', '', () => showTab('review')));
      box.append(row);
    };
    const grade = (ex, ok) => {
      if (!ex.lemma) return;
      const c = vocab.get(ex.lemma);
      if (!c || c.status !== 'learning') return;
      if (!ok) vocab.grade(ex.lemma, 'again'); else if (c.due <= Date.now()) vocab.grade(ex.lemma, 'good');
    };

    const next = () => {
      box.replaceChildren();
      if (!queue.length) return finish();
      const ex = queue[0];
      const bar = h('div', 'tr-bar'); const fill = h('span'); fill.style.width = Math.round((done / total) * 100) + '%'; bar.append(fill);
      box.append(bar);
      const body = h('div', 'tr-body');
      const foot = h('div', 'tr-foot');
      box.append(body, foot);
      let answered = false;

      const settle = (result, correctNode, note) => {
        if (answered) return;
        answered = true;
        const ok = result === 'right' || result === 'accent';
        if (!ex.retried) { grade(ex, ok); if (ok) firstTry++; else if (ex.lemma) missed.add(ex.lemma); }
        queue.shift();
        if (ok) done++; else if (!ex.retried) { ex.retried = true; queue.push(ex); }
        else done++;
        foot.className = 'tr-foot ' + (ok ? 'good' : 'bad');
        foot.replaceChildren(h('p', 'tr-verdict', ok ? (result === 'accent' ? 'Nearly: mind the accents' : 'Correct') : 'Not quite'));
        if (correctNode) foot.append(correctNode);
        if (note) foot.append(h('p', 'g-meta', note));
        const c = btn('Continue', 'primary', next); foot.append(c); c.focus();
        if (autoSpeak && ok && (ex.es || ex.lemma)) speak(ex.es || ex.lemma);
      };
      const ans = (text, es) => { const d = h('div', 'tr-ans'); d.append(h('p', 'tr-correct', text)); if (es) { const sp = speakBtn(es); if (sp) d.append(sp); } return d; };

      if (ex.type === 'meaning' || ex.type === 'read') {
        let chosen = null;
        if (ex.type === 'meaning') {
          const row = h('div', 'g-wordrow'); row.append(h('p', 'rv-word', ex.prompt)); const sp = speakBtn(ex.prompt); if (sp) row.append(sp);
          body.append(h('p', 'g-label', 'What does this word mean?'), row);
        } else {
          const row = h('div', 'g-wordrow'); row.append(h('p', 'rv-s', ex.es)); const sp = speakBtn(ex.es); if (sp) row.append(sp);
          body.append(h('p', 'g-label', 'Choose the English'), row);
        }
        const opts = h('div', 'tr-opts');
        const check = btn('Check', 'primary', () => {
          opts.querySelectorAll('button').forEach((b) => { b.disabled = true; if (b.textContent === ex.answer) b.classList.add('right'); else if (b.textContent === chosen) b.classList.add('wrong'); });
          check.remove();
          settle(chosen === ex.answer ? 'right' : 'wrong', chosen === ex.answer ? null : ans(ex.answer, ex.type === 'read' ? ex.es : ex.lemma));
        });
        check.disabled = true;
        ex.options.forEach((o) => {
          const b = btn(o, 'tr-opt', () => { chosen = o; opts.querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b)); check.disabled = false; });
          opts.append(b);
        });
        body.append(opts); foot.append(check);
      } else if (ex.type === 'gap') {
        body.append(h('p', 'g-label', 'Type the missing word'));
        const f = T.findWord(ex.es, ex.form);
        const s = h('p', 'rv-s'); s.lang = 'es';
        s.append(ex.es.slice(0, f.i), h('span', 'blank', '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0'), ex.es.slice(f.i + f.len));
        body.append(s);
        if (ex.hint) body.append(h('p', 'g-also', ex.hint));
        const inp = h('input'); inp.type = 'text'; inp.lang = 'es'; inp.autocomplete = 'off'; inp.autocapitalize = 'off'; inp.spellcheck = false; inp.setAttribute('aria-label', 'Missing word');
        inp.className = 'tr-input';
        const check = btn('Check', 'primary', () => {
          if (answered) return;
          inp.disabled = true; check.remove();
          const r = T.checkTyped(inp.value, ex.form);
          const full = h('p', 'rv-s'); full.append(ex.es.slice(0, f.i), h('mark', '', ex.es.slice(f.i, f.i + f.len)), ex.es.slice(f.i + f.len));
          const d = h('div', 'tr-ans'); d.append(full); const sp = speakBtn(ex.es); if (sp) d.append(sp);
          settle(r, d, ex.en || '');
        });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') check.click(); });
        body.append(inp); foot.append(check);
        setTimeout(() => inp.focus(), 50);
      } else {
        // build / listen: tap the words in order
        const listen = ex.type === 'listen';
        body.append(h('p', 'g-label', listen ? 'Tap what you hear' : 'Build the Spanish sentence'));
        if (listen) {
          const row = h('div', 'btns');
          row.append(btn('▶ Play', 'primary', () => speak(ex.es)), btn('Slower', '', () => { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(ex.es); u.lang = 'es-ES'; u.rate = 0.6; speechSynthesis.speak(u); } catch (e) { /* no voice */ } }));
          body.append(row);
          setTimeout(() => speak(ex.es), 150);
        } else body.append(h('p', 'rv-s en', ex.en));
        const line = h('div', 'tr-line'); const bank = h('div', 'tr-bank');
        const built = [];
        const chipFor = (t, idx) => { const b = btn(t, 'chip-w'); b.dataset.i = idx; return b; };
        const items = ex.bank.map((t, i) => ({ t, i, used: false }));
        const redraw = () => {
          line.replaceChildren(...built.map((it) => { const b = btn(it.t, 'chip-w placed', () => { it.used = false; built.splice(built.indexOf(it), 1); redraw(); }); return b; }));
          bank.replaceChildren(...items.map((it) => { const b = btn(it.t, 'chip-w', () => { it.used = true; built.push(it); redraw(); }); b.disabled = it.used; if (it.used) b.classList.add('gone'); return b; }));
          check.disabled = !built.length;
        };
        const check = btn('Check', 'primary', () => {
          check.remove(); bank.querySelectorAll('button').forEach((b) => { b.disabled = true; }); line.querySelectorAll('button').forEach((b) => { b.disabled = true; });
          const ok = T.checkBuilt(built.map((x) => x.t), ex.es);
          settle(ok ? 'right' : 'wrong', ans(ex.es, ex.es), ex.en);
        });
        body.append(line, bank); foot.append(check);
        redraw();
      }
    };
    next();
  }

  function tabPractice(panel) {
    const st = h('p', 'status');
    if (!(status.ready || status.web)) {
      panel.append(h('p', '', 'Practice sets need the sentence data. Use the Download button at the top of the page first.'));
      return;
    }
    let level = Number(load('margen:level')) || 1;
    panel.append(h('p', '', 'Real sentences from Tatoeba, each with its English, picked so every word is among the most common in Spanish. Start at the first level, move up when it feels easy.'));
    const chips = h('div', 'chips');
    const draw = () => chips.replaceChildren(...Object.entries(meta.practice.levels).map(([k, v]) => {
      const b = btn(v.label, Number(k) === level ? 'on' : '', () => { level = Number(k); store('margen:level', String(level)); draw(); });
      b.setAttribute('aria-pressed', String(Number(k) === level));
      return b;
    }));
    draw();
    const form = h('form', 'form');
    const word = h('input'); word.type = 'text'; word.placeholder = 'Only sentences with a word (optional), for example casa'; word.setAttribute('aria-label', 'Word to practise');
    const go = btn('Make a set', 'primary'); go.type = 'submit';
    form.append(word, go);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      st.className = 'status'; st.textContent = 'Choosing sentences…';
      try { await makeSet({ level, word: word.value.trim() }, false); } catch (err) { st.className = 'status err'; st.textContent = err.message; }
    });
    panel.append(chips, form, st);
  }

  async function makeSet(params, stay) {
    const t = await api('/api/practice', { method: 'POST', body: Object.assign({}, params, { seed: Math.floor(Math.random() * 1e6) }) });
    t.ephemeral = true; t.params = params;
    current = t;
    renderText();
    if (!stay) setView('read');
  }

  function tabSource(panel, src) {
    const st = searchState[src.id] || (searchState[src.id] = { q: '', items: [], next: null, searched: false });
    panel.append(h('p', '', src.description));
    const form = h('form', 'form');
    const q = h('input'); q.type = 'text'; q.placeholder = src.placeholder || 'Search'; q.value = st.q; q.setAttribute('aria-label', 'Search ' + src.name);
    const go = btn('Search', 'primary'); go.type = 'submit';
    form.append(q, go);
    const status$ = h('p', 'status');
    const list = h('ul', 'list');
    const more = btn('More results', '');
    more.hidden = true;
    panel.append(form, status$, list, more);

    const draw = () => {
      list.replaceChildren();
      st.items.forEach((it) => {
        const li = h('li', 'item');
        li.append(thumb(it.cover, it.title));
        const body = h('div', 'body');
        body.append(h('p', 't', it.title), h('p', 'sub', it.subtitle || ''), h('p', 'sub', it.meta || ''));
        const btns = h('div', 'btns');
        (it.actions || []).forEach((a, i) => {
          const b = btn(a.label, i === 0 ? 'primary small' : 'small');
          b.addEventListener('click', async () => {
            b.disabled = true; status$.className = 'status'; status$.textContent = `Adding “${it.title}”…`;
            try {
              const saved = await api(`/api/sources/${src.id}/import`, { method: 'POST', body: { id: it.id, action: a.id } });
              status$.className = 'status ok'; status$.textContent = `Added “${saved.title}”.`;
              b.replaceWith(btn('Read it now', 'primary small', () => openText(saved.id)));
            } catch (e) { status$.className = 'status err'; status$.textContent = e.message; b.disabled = false; }
          });
          btns.append(b);
        });
        if (it.link) { const a = h('a', '', 'Open the site'); a.href = it.link; a.target = '_blank'; a.rel = 'noopener'; a.className = 'btn small'; a.style.display = 'inline-grid'; a.style.placeItems = 'center'; a.style.textDecoration = 'none'; btns.append(a); }
        body.append(btns);
        li.append(body);
        list.append(li);
      });
      more.hidden = !st.next;
      if (st.searched && !st.items.length) status$.textContent = 'Nothing found. Try a different word.';
    };
    const run = async (page) => {
      status$.className = 'status'; status$.textContent = 'Searching…';
      try {
        const r = await api(`/api/sources/${src.id}/search?q=${encodeURIComponent(st.q)}&page=${page}`);
        st.items = page === 1 ? r.items : st.items.concat(r.items);
        st.next = r.next ? page + 1 : null; st.searched = true; st.page = page;
        status$.textContent = '';
        draw();
      } catch (e) { status$.className = 'status err'; status$.textContent = `Could not reach ${src.name}. ${e.message}`; }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); st.q = q.value.trim(); run(1); });
    more.addEventListener('click', () => run(st.next));
    if (st.searched) draw(); else { st.q = ''; run(1); }
  }

  function tabAdd(panel) {
    panel.append(h('p', '', 'Paste Spanish text to read it with word meanings. Lines of Spanish, a tab, then English are kept as sentence pairs.'));
    const title = h('input'); title.type = 'text'; title.placeholder = 'Title'; title.setAttribute('aria-label', 'Title'); title.style.minHeight = '40px';
    const ta = h('textarea'); ta.placeholder = 'Pega aquí el texto en español'; ta.lang = 'es'; ta.spellcheck = false; ta.setAttribute('aria-label', 'Spanish text');
    const st = h('p', 'status');
    const go = btn('Add to my texts', 'primary', async () => {
      if (!ta.value.trim()) { ta.focus(); return; }
      go.disabled = true; st.className = 'status'; st.textContent = 'Adding…';
      try { const t = await api('/api/text', { method: 'POST', body: { title: title.value.trim(), text: ta.value } }); await openText(t.id); } catch (e) { st.className = 'status err'; st.textContent = e.message; go.disabled = false; }
    });
    panel.append(title, ta, go, st);
  }

  function tabMore(panel) {
    panel.append(h('p', '', 'Sites worth knowing that have no feed Margen can read. Open one, copy a passage and use Add text.'));
    const list = h('ul', 'list');
    meta.links.forEach((l) => {
      const li = h('li', 'item');
      const body = h('div', 'body');
      const title = h('p', 't');
      if (l.url) { const a = h('a', '', l.name); a.href = l.url; a.target = '_blank'; a.rel = 'noopener'; title.append(a); } else title.textContent = l.name;
      body.append(title);
      body.append(h('p', 'sub', l.note));
      li.append(body);
      list.append(li);
    });
    panel.append(list);
  }

  /* ---------- Setup banner ---------- */
  function showBanner() {
    const b = el.banner;
    const running = status.setup && status.setup.running;
    const err = status.setup && status.setup.error;
    b.hidden = status.ready && !running;
    b.classList.toggle('err', !!err);
    const bn = status.banner || {};
    $('banner-title').textContent = running ? 'Downloading…' : err ? 'The download stopped' : (bn.title || 'Download the dictionary');
    $('banner-text').textContent = running ? (status.setup.step || 'Working') + '. This takes a minute or two.' : err ? err : (bn.text || 'Margen needs a Spanish–English dictionary, word forms and example sentences (about 150 MB, once). Nothing is sent anywhere.');
    $('banner-btn').hidden = !!running;
    $('banner-btn').textContent = err ? 'Try again' : (bn.button || 'Download');
  }
  $('banner-btn').addEventListener('click', async () => {
    await api('/api/setup', { method: 'POST', body: {} });
    poll();
  });
  async function poll() {
    status = await api('/api/status');
    showBanner();
    if (status.setup && status.setup.running) setTimeout(poll, 1500);
    else if (status.ready) dictCache.clear();
  }

  /* ---------- Start ---------- */
  async function init() {
    const sz = parseInt(load('margen:size'), 10);
    if (sz >= 0 && sz < SIZES.length) sizeIdx = sz;
    applySize();
    setMode(load('margen:mode') === 'line' ? 'line' : 'word');
    try { [status, meta] = await Promise.all([api('/api/status'), api('/api/sources')]); } catch (e) {
      el.cap.textContent = 'Margen could not reach its server. Start it with npm start.';
      return;
    }
    showBanner();
    if (status.setup && status.setup.running) poll();
    const last = load('margen:src');
    const library = await api('/api/library').catch(() => []);
    const first = library.find((t) => t.id === last) || library[0];
    if (first) await openText(first.id); else setView('library');
  }
  init();
})();
