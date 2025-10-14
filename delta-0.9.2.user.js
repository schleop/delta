// ==UserScript==
// @name         delta
// @namespace    delta.local
// @version      0.9.2
// @description  Draggable panel (F8). Tabs with horizontal scroll; Visual layout fixed. Emoji debug, Snapshots, and custom code tabs.
// @match        *://*/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      cdn.jsdelivr.net
// @connect      unpkg.com
// ==/UserScript==

(() => {
  'use strict';

  // IDs / LS keys
  const BOX_ID = 'delta__box';
  const DROPDOWN_ID = 'delta__dropdown';
  const LIGHTBOX_ID = 'delta__lightbox';
  const LS_ENABLED = 'delta__emojiDebug';
  const LS_MAP = 'delta__emojiMap_v5';
  const LS_ENTRIES = 'delta__emojiEntries_v5';
  const LS_TAB = 'delta__activeTab';
  const LS_CODE_TABS = 'delta__codeTabs_v1';

  // Snapshot scaling
  const SNAP_MAX_DIM = 1024; // max side length of stored PNG

  // Emoji dataset (full Unicode via CLDR/Emojibase)
  const EMOJI_DATA_URLS = [
    'https://cdn.jsdelivr.net/npm/emojibase-data@15.3.0/en/data.json',
    'https://unpkg.com/emojibase-data@15.3.0/en/data.json'
  ];
  const DISCORD_SC_URLS = [
    'https://cdn.jsdelivr.net/npm/emojibase-data@15.3.0/en/shortcodes/discord.json',
    'https://unpkg.com/emojibase-data@15.3.0/en/shortcodes/discord.json'
  ];

  // Fallback emoji
  const FALLBACK_MAP = {
    'smile':'😄','grinning':'😀','smiley':'😃','slight_smile':'🙂','wink':'😉','blush':'😊',
    'stuck_out_tongue':'😛','stuck_out_tongue_winking_eye':'😜','sunglasses':'😎','thinking':'🤔',
    'joy':'😂','sob':'😭','cry':'😢','eyes':'👀','poop':'💩',
    'heart':'❤️','orange_heart':'🧡','yellow_heart':'💛','green_heart':'💚',
    'blue_heart':'💙','purple_heart':'💜','black_heart':'🖤','broken_heart':'💔',
    'tada':'🎉','fire':'🔥','rocket':'🚀','sparkles':'✨','star':'⭐',
    'white_check_mark':'✅','heavy_check_mark':'✔️','x':'❌','question':'❓','exclamation':'❗',
    'ok_hand':'👌','clap':'👏','wave':'👋','thumbsup':'👍','+1':'👍','thumbs_up':'👍','thumbsdown':'👎','-1':'👎'
  };

  // Guard re-init
  if (window.__delta_init) return;
  window.__delta_init = true;

  // State
  let emojiEnabled = (localStorage.getItem(LS_ENABLED) !== '0'); // default ON
  let emojiMap = null, emojiEntries = null, emojiLoaded = false, emojiLoading = false;
  let composing = false;
  let statusEl = null;

  // Dropdown (emoji)
  let dd = null, ddList = null, ddOpen = false, ddItems = [], ddIndex = 0, ddAnchor = null;

  // Snapshots + lightbox
  const snapshots = [];
  let lightbox, lightboxImg;

  // Tabs UI refs
  let tabsLeft, tabsLeftBase, tabsLeftCodes, tabsRight, contentEl;
  let tabVisualBtn, tabShotsBtn, plusBtn;
  let pageVisual, pageShots;
  const codeTabButtons = new Map(); // id -> button
  const codeTabPages = new Map();   // id -> page el
  let activeTabKey = localStorage.getItem(LS_TAB) || 'visual';

  // Code tabs model
  let codeTabs = loadCodeTabs();
  const uid = () => 't' + Math.random().toString(36).slice(2, 10);

  // Styles
  GM_addStyle(`
    /* Panel */
    #${BOX_ID} {
      position: fixed; top: 60px; left: 60px; width: 360px;
      background: #0f0f10; color: #e8e8ea; border: 1px solid #1f1f22; border-radius: 12px;
      z-index: 2147483647; display: block; font: 12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      box-sizing: border-box; user-select: none; box-shadow: 0 10px 28px rgba(0,0,0,0.5);
    }
    #${BOX_ID} .hdr {
      padding: 8px 10px; background: linear-gradient(180deg, #121215, #0f0f10);
      color: #f5f5f7; cursor: move; border-top-left-radius: 12px; border-top-right-radius: 12px;
      font-weight: 600; letter-spacing: 0.2px;
    }

    /* Tabs bar with horizontal scroll on the left side */
    #${BOX_ID} .tabs {
      display: flex; align-items: flex-end; justify-content: flex-start; gap: 6px;
      padding: 8px 10px 0; border-bottom: 1px solid #1f1f22; box-sizing: border-box;
    }
    #${BOX_ID} .tabs-left {
      flex: 1 1 auto; min-width: 0;
      display: flex; flex-wrap: nowrap; gap: 6px;
      overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch;
    }
    #${BOX_ID} .tabs-left::-webkit-scrollbar { height: 8px; }
    #${BOX_ID} .tabs-left::-webkit-scrollbar-track { background: #0f0f10; }
    #${BOX_ID} .tabs-left::-webkit-scrollbar-thumb { background: #2c2c31; border-radius: 8px; border: 2px solid #0f0f10; }
    #${BOX_ID} .tabs-left-base, #${BOX_ID} .tabs-left-codes {
      display: flex; flex-wrap: nowrap; gap: 6px;
    }
    #${BOX_ID} .tabs-right { flex: 0 0 auto; }

    #${BOX_ID} .tab {
      flex: 0 0 auto;
      padding: 6px 10px; border-radius: 8px 8px 0 0; background: #131316; color: #cfcfd4;
      cursor: pointer; border: 1px solid #1f1f22; border-bottom: none; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #${BOX_ID} .tab[aria-selected="true"] { background: #1a1a1f; color: #fff; }
    #${BOX_ID} .tab.plus { width: 34px; text-align: center; font-weight: 700; }

    /* Content and pages (fix Visual alignment) */
    #${BOX_ID} .content { padding: 10px; user-select: auto; cursor: default; text-align: left; }
    #${BOX_ID} .page { display: none; margin: 0; }
    #${BOX_ID} .page.active { display: block; }

    #${BOX_ID} label { display: flex; gap: 8px; align-items: center; }
    #${BOX_ID} input[type="checkbox"] { accent-color: #7a5cff; }
    #${BOX_ID} .status { margin-top: 6px; color: #a7a7ad; }
    #${BOX_ID} .btn {
      margin-top: 8px; padding: 6px 10px; font-size: 12px; color: #e8e8ea;
      background: #1a1a1f; border: 1px solid #26262d; border-radius: 6px; cursor: pointer;
    }
    #${BOX_ID} .btn:hover { background: #202028; }
    #${BOX_ID} .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    #${BOX_ID} .row-actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
    #${BOX_ID} .inp, #${BOX_ID} .sel, #${BOX_ID} textarea {
      background: #131316; color: #e8e8ea; border: 1px solid #26262d; border-radius: 6px; padding: 6px 8px; font: 12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, monospace;
    }
    #${BOX_ID} .inp:focus, #${BOX_ID} .sel:focus, #${BOX_ID} textarea:focus { outline: 1px solid #7a5cff; }
    #${BOX_ID} .muted { color: #8b8b95; font-size: 11px; margin-top: 6px; }

    /* Code editor area */
    #${BOX_ID} .code-wrap { margin-top: 8px; }
    #${BOX_ID} .code-ta { width: 100%; min-height: 160px; max-height: 420px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

    /* Snapshots: thumbs */
    #${BOX_ID} .shots {
      display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-top: 8px; max-height: 260px; overflow: auto;
      padding-right: 4px; scrollbar-width: thin; scrollbar-color: #2c2c31 #0f0f10;
    }
    #${BOX_ID} .shots::-webkit-scrollbar { width: 10px; }
    #${BOX_ID} .shots::-webkit-scrollbar-track { background: #0f0f10; }
    #${BOX_ID} .shots::-webkit-scrollbar-thumb { background: #2c2c31; border-radius: 8px; border: 2px solid #0f0f10; }
    #${BOX_ID} .shot-item { border: 1px solid #1f1f22; border-radius: 8px; padding: 6px; background: #131316; }
    #${BOX_ID} .shot-head { color: #c8c8ce; margin-bottom: 6px; font-size: 11px; line-height: 1.2; max-height: 2.4em; overflow: hidden; }
    #${BOX_ID} .shot-img { display: block; width: 100%; height: auto; border-radius: 6px; background: #0f0f10; cursor: zoom-in; }

    /* Emoji dropdown */
    #${DROPDOWN_ID} {
      position: fixed; background: #0f0f10; color: #e8e8ea; border: 1px solid #1f1f22; border-radius: 10px;
      z-index: 2147483646; display: none; min-width: 240px; box-shadow: 0 10px 24px rgba(0,0,0,0.45);
      overflow: hidden; user-select: none;
    }
    #${DROPDOWN_ID} .list {
      max-height: 300px; overflow-y: auto; background: #0f0f10;
      scrollbar-width: thin; scrollbar-color: #2c2c31 #0f0f10;
    }
    #${DROPDOWN_ID} .list::-webkit-scrollbar { width: 10px; }
    #${DROPDOWN_ID} .list::-webkit-scrollbar-track { background: #0f0f10; }
    #${DROPDOWN_ID} .list::-webkit-scrollbar-thumb { background: #2c2c31; border-radius: 8px; border: 2px solid #0f0f10; }
    #${DROPDOWN_ID} .row { padding: 6px 10px; display: flex; gap: 10px; align-items: center; white-space: nowrap; cursor: pointer; background: transparent; }
    #${DROPDOWN_ID} .row + .row { border-top: 1px solid #1f1f22; }
    #${DROPDOWN_ID} .row.active { background: #18181d; }
    #${DROPDOWN_ID} .row .emo { font-size: 18px; line-height: 18px; }
    #${DROPDOWN_ID} .row .name { color: #c8c8ce; }
    #${DROPDOWN_ID} .row .hint { margin-left: auto; color: #7f7f88; font-size: 11px; }

    /* Lightbox */
    #${LIGHTBOX_ID} {
      position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 2147483647; display: none;
      align-items: center; justify-content: center; cursor: zoom-out;
    }
    #${LIGHTBOX_ID} img { max-width: 92vw; max-height: 92vh; border-radius: 10px; box-shadow: 0 10px 28px rgba(0,0,0,0.6); }
  `);

  // IME guard
  document.addEventListener('compositionstart', () => composing = true, true);
  document.addEventListener('compositionend', () => composing = false, true);

  // Editable detection
  const isTextarea = (el) => el && el.tagName === 'TEXTAREA' && !el.readOnly && !el.disabled;
  function isTextInput(el) {
    if (!el || el.tagName !== 'INPUT' || el.readOnly || el.disabled) return false;
    const t = (el.type || 'text').toLowerCase();
    const bad = ['button','submit','reset','checkbox','radio','file','image','color','range','hidden','date','datetime-local','month','time','week','number','password'];
    return !bad.includes(t);
  }
  const isEditableCE = (el) => el && el.nodeType === 1 && el.isContentEditable === true;

  function getEditableFromEvent(e) {
    const path = e && e.composedPath ? e.composedPath() : [e.target];
    for (const node of path) {
      if (node && node.nodeType === 1) {
        if (isTextInput(node) || isTextarea(node)) return { type: 'input', el: node };
        if (isEditableCE(node)) return { type: 'ce', el: findRootCE(node) };
      }
    }
    return null;
  }
  function findRootCE(el) {
    let cur = el;
    while (cur && cur.parentElement && cur.parentElement.isContentEditable) cur = cur.parentElement;
    return cur;
  }

  // Fetch helpers
  function gmGetJSON(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({ method: 'GET', url, headers: { 'Accept': 'application/json' },
          onload: (res) => { try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(e); } },
          onerror: (err) => reject(err)
        });
      } else { fetch(url).then(r => r.json()).then(resolve).catch(reject); }
    });
  }
  async function firstJSON(urls) {
    let lastErr;
    for (const u of urls) { try { return await gmGetJSON(u); } catch (e) { lastErr = e; } }
    throw lastErr || new Error('all sources failed');
  }

  // Emoji dataset
  const slug = (s) => String(s || '').toLowerCase().replace(/['’]+/g, '').replace(/[^a-z0-9+\-_ ]+/g, ' ').trim().replace(/\s+/g, '_');
  const splitTerms = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9+\-_ ]+/g, ' ').split(/\s+/).filter(Boolean);

  async function loadEmojiData() {
    if (emojiLoaded || emojiLoading) return;
    emojiLoading = true;

    const cachedMap = localStorage.getItem(LS_MAP);
    const cachedEntries = localStorage.getItem(LS_ENTRIES);
    if (cachedMap && cachedEntries) {
      try { emojiMap = JSON.parse(cachedMap); emojiEntries = JSON.parse(cachedEntries); emojiLoaded = true; }
      catch {}
      emojiLoading = false;
      return;
    }

    try {
      const [data, sc] = await Promise.all([ firstJSON(EMOJI_DATA_URLS), firstJSON(DISCORD_SC_URLS) ]);
      const map = Object.create(null);
      const entries = [];
      let order = 0;

      function pushEntry(emoji, hex, annotation, tagsArr) {
        const discordNames = sc[hex] ? (Array.isArray(sc[hex]) ? sc[hex] : [sc[hex]]).map(x => String(x).toLowerCase()) : [];
        const cldrName = slug(annotation);
        const nameSet = new Set();
        for (const n of discordNames) if (n) nameSet.add(n);
        if (cldrName) nameSet.add(cldrName);

        const aliases = Array.from(nameSet);
        const terms = new Set(aliases);
        if (annotation) { terms.add(cldrName); for (const t of splitTerms(annotation)) terms.add(t); }
        if (Array.isArray(tagsArr)) for (const tag of tagsArr) { const sg = slug(tag); terms.add(sg); for (const w of splitTerms(tag)) terms.add(w); }

        const primary = (discordNames[0] || cldrName || '').toLowerCase();
        for (const n of aliases) map[n] = emoji;

        entries.push({ emoji, primary, names: aliases, terms: Array.from(terms), order: order++ });
      }

      for (const e of data) {
        if (e.emoji && e.hexcode) pushEntry(e.emoji, e.hexcode, e.annotation || e.label || '', e.tags || e.keywords || []);
        if (Array.isArray(e.skins)) for (const s of e.skins) if (s.emoji && s.hexcode)
          pushEntry(s.emoji, s.hexcode, s.annotation || s.label || e.annotation || '', s.tags || s.keywords || e.tags || []);
      }

      for (const k in FALLBACK_MAP) if (!map[k]) { map[k] = FALLBACK_MAP[k]; entries.push({ emoji: FALLBACK_MAP[k], primary: k, names: [k], terms: [k], order: order++ }); }

      const seen = new Set(); const dedup = [];
      for (const x of entries) { const key = x.emoji + '|' + x.primary; if (!seen.has(key)) { seen.add(key); dedup.push(x); } }

      emojiMap = map; emojiEntries = dedup;
      localStorage.setItem(LS_MAP, JSON.stringify(map));
      localStorage.setItem(LS_ENTRIES, JSON.stringify(dedup));
      emojiLoaded = true;
    } catch (e) {
      console.error('delta: emoji dataset failed, using fallback', e);
      emojiMap = { ...FALLBACK_MAP };
      emojiEntries = Object.keys(FALLBACK_MAP).map((k, i) => ({ emoji: FALLBACK_MAP[k], primary: k, names: [k], terms: [k], order: i }));
      emojiLoaded = true;
    } finally { emojiLoading = false; }
  }
  function getEmoji(code) {
    if (!code) return null;
    code = code.toLowerCase();
    if (emojiMap && emojiMap[code]) return emojiMap[code];
    return FALLBACK_MAP[code] || null;
  }

  // Emoji dropdown
  function ensureDropdown() {
    if (dd) return dd;
    dd = document.createElement('div'); dd.id = DROPDOWN_ID;
    ddList = document.createElement('div'); ddList.className = 'list';
    dd.appendChild(ddList); document.body.appendChild(dd);
    return dd;
  }
  function renderDropdown(items, anchor) {
    ensureDropdown();
    ddItems = items; ddList.innerHTML = '';
    if (!items.length) { closeDropdown(); return; }

    const frag = document.createDocumentFragment();
    items.forEach((it, idx) => {
      const row = document.createElement('div');
      row.className = 'row'; row.dataset.idx = String(idx);
      const emo = document.createElement('span'); emo.className = 'emo'; emo.textContent = it.emoji;
      const name = document.createElement('span'); name.className = 'name'; name.textContent = `:${it.primary}:`;
      const hint = document.createElement('span'); hint.className = 'hint';
      if (it.names.length > 1) hint.textContent = `+${it.names.length - 1} alias`;
      row.appendChild(emo); row.appendChild(name); row.appendChild(hint);
      row.addEventListener('mouseenter', () => setActiveIndex(idx));
      row.addEventListener('mousedown', (ev) => { ev.preventDefault(); pickActive(); });
      frag.appendChild(row);
    });
    ddList.appendChild(frag);

    // Position: flip up if needed, clamp to viewport
    dd.style.visibility = 'hidden';
    dd.style.display = 'block';
    dd.style.left = '0px';
    dd.style.top = '0px';
    const gap = 8, vw = window.innerWidth, vh = window.innerHeight;
    const rect = dd.getBoundingClientRect();
    const width = rect.width, height = rect.height;
    let left = Math.round(anchor.left);
    if (left + width + gap > vw) left = Math.max(gap, vw - width - gap);
    if (left < gap) left = gap;
    let top = Math.round(anchor.topBelow);
    if (top + height + gap > vh && anchor.topAbove != null) {
      top = Math.round(anchor.topAbove - height);
      if (top < gap) top = gap;
    }
    if (top + height + gap > vh) top = Math.max(gap, vh - height - gap);
    dd.style.left = left + 'px'; dd.style.top = top + 'px'; dd.style.visibility = 'visible';
    ddOpen = true; setActiveIndex(0);
  }
  function setActiveIndex(i) {
    ddIndex = Math.max(0, Math.min(i, ddItems.length - 1));
    const rows = ddList.querySelectorAll('.row');
    rows.forEach((r, idx) => r.classList.toggle('active', idx === ddIndex));
  }
  function closeDropdown() {
    ddOpen = false;
    if (dd) { dd.style.display = 'none'; ddList && (ddList.innerHTML = ''); }
    ddItems = []; ddIndex = 0; ddAnchor = null;
  }

  function findQueryInInput(el) {
    if (!(el && el.selectionStart != null && el.selectionEnd != null)) return null;
    if (el.selectionStart !== el.selectionEnd) return null;
    const pos = el.selectionStart; const left = (el.value || '').slice(0, pos);
    const m = left.match(/:([a-z0-9_+\-]{1,48})$/i);
    if (!m) return null;
    return { type: 'input', el, start: pos - (m[1].length + 1), end: pos, query: m[1] };
  }
  function findQueryInCE(el) {
    const sel = el.ownerDocument.getSelection(); if (!sel || !sel.rangeCount === 0) return null;
    const rng = sel.getRangeAt(0); if (!el.contains(rng.startContainer) || !rng.collapsed) return null;

    let node = rng.startContainer, offset = rng.startOffset;
    if (node.nodeType !== Node.TEXT_NODE) {
      const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let last = null;
      while (walker.nextNode()) {
        const n = walker.currentNode;
        const r = document.createRange(); r.selectNodeContents(n);
        if (r.comparePoint(rng.startContainer, rng.startOffset) <= 0) last = n; else break;
      }
      if (!last) return null; node = last; offset = node.nodeValue.length;
    }
    const text = node.nodeValue || ''; const left = text.slice(0, offset);
    const m = left.match(/:([a-z0-9_+\-]{1,48})$/i); if (!m) return null;
    const startOffset = offset - (m[1].length + 1);
    return { type: 'ce', el, node, startOffset, endOffset: offset, query: m[1] };
  }
  function caretAnchorRectForInput(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left + 8, topBelow: r.bottom + 6, topAbove: r.top - 6 };
  }
  function caretAnchorRectForCE(node, offset) {
    try {
      const r = document.createRange();
      r.setStart(node, offset); r.collapse(true);
      const rects = r.getClientRects(); const b = rects.length ? rects[0] : r.getBoundingClientRect();
      return { left: b.left, topBelow: b.bottom + 4, topAbove: b.top - 4 };
    } catch {
      const p = node.parentElement ? node.parentElement.getBoundingClientRect() : { left: 0, top: 0, bottom: 0 };
      return { left: p.left, topBelow: p.bottom + 4, topAbove: p.top - 4 };
    }
  }
  function scoreEntry(q, e) {
    const p = e.primary;
    if (p === q) return 1e9;
    if (p.startsWith(q)) return 1e8 - (p.length - q.length);
    let best = 0;
    for (const n of e.names) {
      if (n === q) best = Math.max(best, 1e7);
      else if (n.startsWith(q)) best = Math.max(best, 9e6 - (n.length - q.length));
      else if (n.includes(q)) best = Math.max(best, 3e6 - (n.length - q.length));
    }
    for (const t of e.terms) {
      if (t === q) best = Math.max(best, 2e6);
      else if (t.startsWith(q)) best = Math.max(best, 1e6 - (t.length - q.length));
      else if (t.includes(q)) best = Math.max(best, 2e5 - (t.length - q.length));
    }
    return best - e.order / 10000;
  }
  function updateDropdown(e) {
    if (!emojiEnabled || composing || !emojiLoaded) { closeDropdown(); return; }
    const info = getEditableFromEvent(e); if (!info) { closeDropdown(); return; }

    let qInfo = null, anchor = null;
    if (info.type === 'input') {
      qInfo = findQueryInInput(info.el); if (!qInfo) { closeDropdown(); return; }
      anchor = caretAnchorRectForInput(info.el); ddAnchor = qInfo;
    } else {
      qInfo = findQueryInCE(info.el); if (!qInfo) { closeDropdown(); return; }
      anchor = caretAnchorRectForCE(qInfo.node, qInfo.endOffset); ddAnchor = qInfo;
    }

    const q = qInfo.query.toLowerCase();
    const results = [];
    for (const en of emojiEntries) {
      if (en.primary.includes(q) || en.names.some(n => n.includes(q)) || en.terms?.some(t => t.includes(q))) results.push(en);
    }
    results.sort((a, b) => scoreEntry(q, b) - scoreEntry(q, a));
    renderDropdown(results.slice(0, 12), anchor);
  }
  function insertEmojiFromDropdown(item) {
    if (!item || !ddAnchor) return;
    if (ddAnchor.type === 'input') {
      const el = ddAnchor.el;
      const before = el.value.slice(0, ddAnchor.start);
      const after = el.value.slice(ddAnchor.end);
      el.value = before + item.emoji + after;
      const pos = before.length + item.emoji.length;
      try { el.setSelectionRange(pos, pos); } catch {}
      el.dispatchEvent(new Event('input', { bubbles: true })); el.focus();
    } else {
      const el = ddAnchor.el; const node = ddAnchor.node;
      const sel = el.ownerDocument.getSelection(); const r = document.createRange();
      r.setStart(node, ddAnchor.startOffset); r.setEnd(node, ddAnchor.endOffset); r.deleteContents();
      const textNode = document.createTextNode(item.emoji); r.insertNode(textNode);
      const nr = document.createRange(); nr.setStart(textNode, textNode.nodeValue.length); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr); el.focus();
    }
  }
  function pickActive() { if (!ddOpen || !ddItems.length) return; insertEmojiFromDropdown(ddItems[ddIndex]); closeDropdown(); }

  // Auto-convert :name:
  function onAutoConvert(e) {
    if (!emojiEnabled || composing) return;
    const info = getEditableFromEvent(e); if (!info) return;

    if (info.type === 'input') {
      const el = info.el;
      if (!(el && el.selectionStart != null && el.selectionEnd != null)) return;
      if (el.selectionStart !== el.selectionEnd) return;
      const pos = el.selectionStart; const left = (el.value || '').slice(0, pos);
      const m = left.match(/:([a-z0-9_+\-]+):$/i); if (!m) return;
      const emoji = getEmoji(m[1]); if (!emoji) return;
      const newLeft = left.slice(0, left.length - m[0].length) + emoji;
      el.value = newLeft + (el.value || '').slice(pos);
      const caret = newLeft.length; try { el.setSelectionRange(caret, caret); } catch {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const el = info.el; const sel = el.ownerDocument.getSelection(); if (!sel || sel.rangeCount === 0) return;
      const rng = sel.getRangeAt(0); if (!el.contains(rng.startContainer) || !rng.collapsed) return;
      if (rng.startContainer.nodeType !== Node.TEXT_NODE) return;
      const node = rng.startContainer; const pos = rng.startOffset;
      const left = (node.nodeValue || '').slice(0, pos); const m = left.match(/:([a-z0-9_+\-]+):$/i);
      if (!m) return; const emoji = getEmoji(m[1]); if (!emoji) return;
      const startIdx = left.length - m[0].length;
      const newText = left.slice(0, startIdx) + emoji + (node.nodeValue || '').slice(pos);
      node.nodeValue = newText;
      const caret = startIdx + emoji.length; const nr = document.createRange();
      nr.setStart(node, caret); nr.collapse(true);
      sel.removeAllRanges(); sel.addRange(nr);
    }
  }

  // Global handlers
  function onGlobalInput(e) { onAutoConvert(e); updateDropdown(e); }
  function onGlobalKeydown(e) {
    // Toggle panel
    if (e.key === 'F8' || e.keyCode === 119) {
      const t = e.target; const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (t && (t.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select')) return;
      e.preventDefault();
      const el = document.getElementById(BOX_ID) || createBox();
      el.style.display = (el.style.display === 'none') ? 'block' : 'none';
      return;
    }
    // Close lightbox
    if (e.key === 'Escape' && lightbox && lightbox.style.display === 'flex') { e.preventDefault(); closeLightbox(); return; }

    if (!emojiEnabled || !ddOpen) return;
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setActiveIndex(ddIndex + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setActiveIndex(ddIndex - 1); }
    else if (k === 'Enter' || k === 'Tab') { e.preventDefault(); e.stopPropagation(); pickActive(); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDropdown(); }
  }
  function onGlobalClick(e) { if (ddOpen && dd && !dd.contains(e.target)) closeDropdown(); }
  function attachListeners(doc) {
    doc.addEventListener('input', onGlobalInput, true);
    doc.addEventListener('keydown', onGlobalKeydown, true);
    doc.addEventListener('click', onGlobalClick, true);
  }

  // Lightbox
  function ensureLightbox() {
    if (lightbox) return;
    lightbox = document.createElement('div'); lightbox.id = LIGHTBOX_ID;
    lightbox.style.display = 'none'; lightbox.style.alignItems = 'center'; lightbox.style.justifyContent = 'center';
    lightboxImg = document.createElement('img'); lightbox.appendChild(lightboxImg);
    lightbox.addEventListener('click', () => closeLightbox());
    document.body.appendChild(lightbox);
  }
  function showLightbox(src) { ensureLightbox(); lightboxImg.src = src; lightbox.style.display = 'flex'; }
  function closeLightbox() { if (!lightbox) return; lightbox.style.display = 'none'; lightboxImg.src = ''; }

  // Snapshots
  function formatTS(ts = Date.now()) {
    const d = new Date(ts); const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }
  async function takeSnapshot(snapStatus, snapList) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { snapStatus.textContent = 'Screen capture not supported.'; return; }
    try {
      snapStatus.textContent = 'Requesting screen...';
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      const track = stream.getVideoTracks()[0];
      const video = document.createElement('video');
      video.srcObject = stream; video.muted = true; video.playsInline = true; await video.play();
      await new Promise((res) => { if (video.readyState >= 2) res(); else video.onloadeddata = () => res(); });

      const srcW = video.videoWidth || 1920; const srcH = video.videoHeight || 1080;
      const scale = Math.min(1, SNAP_MAX_DIM / Math.max(srcW, srcH));
      const dw = Math.max(1, Math.round(srcW * scale));
      const dh = Math.max(1, Math.round(srcH * scale));
      const canvas = document.createElement('canvas'); canvas.width = dw; canvas.height = dh;
      const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0, dw, dh);
      const dataURL = canvas.toDataURL('image/png');
      track.stop(); video.srcObject = null;

      const ts = Date.now(); const name = `snapshot-${formatTS(ts)}_${dw}x${dh}.png`;
      snapshots.unshift({ ts, name, dataURL, w: dw, h: dh });
      snapStatus.textContent = 'Captured.'; renderSnapshots(snapList);
    } catch (err) {
      snapStatus.textContent = 'Capture cancelled or failed.'; console.error('delta snapshot error:', err);
    }
  }
  function renderSnapshots(snapList) {
    if (!snapList) return; snapList.innerHTML = '';
    if (!snapshots.length) {
      const p = document.createElement('div'); p.className = 'muted'; p.textContent = 'No snapshots yet.'; snapList.appendChild(p); return;
    }
    for (const s of snapshots) {
      const item = document.createElement('div'); item.className = 'shot-item';
      const head = document.createElement('div'); head.className = 'shot-head'; head.textContent = s.name;
      const img = document.createElement('img'); img.className = 'shot-img'; img.src = s.dataURL; img.alt = s.name; img.title = 'Click to preview';
      img.addEventListener('click', () => showLightbox(s.dataURL));
      const actions = document.createElement('div'); actions.className = 'row-actions';
      const a = document.createElement('a'); a.className = 'btn'; a.textContent = 'Download PNG'; a.href = s.dataURL; a.download = s.name;
      const del = document.createElement('button'); del.className = 'btn'; del.textContent = 'Remove';
      del.addEventListener('click', () => { const idx = snapshots.indexOf(s); if (idx >= 0) snapshots.splice(idx, 1); renderSnapshots(snapList); });
      actions.appendChild(a); actions.appendChild(del);
      item.appendChild(head); item.appendChild(img); item.appendChild(actions); snapList.appendChild(item);
    }
  }

  // Code tabs: storage
  function loadCodeTabs() {
    try { const raw = localStorage.getItem(LS_CODE_TABS); if (!raw) return []; const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : []; }
    catch { return []; }
  }
  function saveCodeTabs() { localStorage.setItem(LS_CODE_TABS, JSON.stringify(codeTabs)); }

  // Code injection helpers
  function cssNodeId(tabId) { return `delta__css_${tabId}`; }
  function injectForTab(tab) {
    if (!tab) return;
    if (tab.mode === 'css') {
      let style = document.getElementById(cssNodeId(tab.id));
      if (!style) { style = document.createElement('style'); style.id = cssNodeId(tab.id); document.head.appendChild(style); }
      style.textContent = tab.code || '';
    } else {
      const scr = document.createElement('script');
      scr.type = 'text/javascript';
      scr.textContent = tab.code || '';
      scr.dataset.deltaFrom = tab.id;
      document.documentElement.appendChild(scr);
    }
  }
  function clearInjectedForTab(tab) {
    if (!tab) return;
    if (tab.mode === 'css') {
      const style = document.getElementById(cssNodeId(tab.id));
      if (style && style.parentNode) style.parentNode.removeChild(style);
    }
    document.querySelectorAll(`script[data-delta-from="${tab.id}"]`).forEach(n => n.parentNode && n.parentNode.removeChild(n));
  }

  // Build a code tab page
  function makeCodePage(tab) {
    const page = document.createElement('div');
    page.className = 'page';
    page.id = `delta-code-${tab.id}`;

    const metaRow = document.createElement('div');
    metaRow.className = 'row';

    const titleInp = document.createElement('input');
    titleInp.className = 'inp';
    titleInp.placeholder = 'tab name';
    titleInp.value = tab.title || 'untitled';

    const modeSel = document.createElement('select');
    modeSel.className = 'sel';
    const optJS = document.createElement('option'); optJS.value = 'js'; optJS.textContent = 'JavaScript';
    const optCSS = document.createElement('option'); optCSS.value = 'css'; optCSS.textContent = 'CSS';
    modeSel.appendChild(optJS); modeSel.appendChild(optCSS);
    modeSel.value = tab.mode || 'js';

    const autoLabel = document.createElement('label');
    const autoCb = document.createElement('input'); autoCb.type = 'checkbox'; autoCb.checked = !!tab.autoRun;
    const autoSpan = document.createElement('span'); autoSpan.textContent = 'auto-run on load';
    autoLabel.appendChild(autoCb); autoLabel.appendChild(autoSpan);

    metaRow.appendChild(titleInp);
    metaRow.appendChild(modeSel);
    metaRow.appendChild(autoLabel);

    const codeWrap = document.createElement('div');
    codeWrap.className = 'code-wrap';
    const ta = document.createElement('textarea');
    ta.className = 'code-ta';
    ta.placeholder = tab.mode === 'css' ? '/* CSS here */' : '// JavaScript here';
    ta.value = tab.code || '';
    codeWrap.appendChild(ta);

    const actions = document.createElement('div'); actions.className = 'row-actions';
    const runBtn = document.createElement('button'); runBtn.className = 'btn'; runBtn.textContent = 'Run now';
    const clearBtn = document.createElement('button'); clearBtn.className = 'btn'; clearBtn.textContent = 'Clear injected';
    const delBtn = document.createElement('button'); delBtn.className = 'btn'; delBtn.textContent = 'Delete tab';
    actions.appendChild(runBtn); actions.appendChild(clearBtn); actions.appendChild(delBtn);

    const hint = document.createElement('div');
    hint.className = 'muted';
    hint.textContent = 'JS runs in the page context. CSS stays removable. Clear removes injected nodes (JS side-effects may persist).';

    const save = () => { saveCodeTabs(); updateCodeTabButton(tab.id); };
    titleInp.addEventListener('input', () => { tab.title = titleInp.value || 'untitled'; save(); });
    modeSel.addEventListener('change', () => { tab.mode = modeSel.value === 'css' ? 'css' : 'js'; ta.placeholder = tab.mode === 'css' ? '/* CSS here */' : '// JavaScript here'; save(); });
    autoCb.addEventListener('change', () => { tab.autoRun = !!autoCb.checked; save(); });
    ta.addEventListener('input', debounce(() => { tab.code = ta.value; save(); }, 200));

    runBtn.addEventListener('click', () => injectForTab(tab));
    clearBtn.addEventListener('click', () => clearInjectedForTab(tab));
    delBtn.addEventListener('click', () => { if (!confirm(`Delete tab "${tab.title || 'untitled'}"?`)) return; deleteCodeTab(tab.id); });

    page.appendChild(metaRow);
    page.appendChild(codeWrap);
    page.appendChild(actions);
    page.appendChild(hint);
    return page;
  }
  function debounce(fn, ms = 200) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

  // Tabs render/update
  function renderCodeTabButtons() {
    tabsLeftCodes.innerHTML = '';
    codeTabButtons.clear();
    for (const tab of codeTabs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.textContent = tab.title || 'untitled';
      btn.setAttribute('role', 'tab');
      btn.dataset.id = tab.id;
      btn.addEventListener('click', () => switchTab(`code:${tab.id}`));
      btn.addEventListener('dblclick', () => {
        const name = prompt('Rename tab:', tab.title || 'untitled');
        if (name != null) {
          tab.title = name.trim() || 'untitled';
          saveCodeTabs();
          updateCodeTabButton(tab.id);
        }
      });
      tabsLeftCodes.appendChild(btn);
      codeTabButtons.set(tab.id, btn);
    }
    syncTabSelectedState();
  }
  function updateCodeTabButton(id) {
    const tab = codeTabs.find(t => t.id === id);
    const btn = codeTabButtons.get(id);
    if (btn && tab) btn.textContent = tab.title || 'untitled';
  }
  function renderCodePages() {
    for (const [id, el] of codeTabPages.entries()) {
      if (!codeTabs.some(t => t.id === id)) { el.remove(); codeTabPages.delete(id); }
    }
    for (const tab of codeTabs) {
      if (!codeTabPages.has(tab.id)) {
        const page = makeCodePage(tab);
        contentEl.appendChild(page);
        codeTabPages.set(tab.id, page);
      }
    }
  }
  function createNewCodeTab() {
    const id = uid();
    const idx = codeTabs.length + 1;
    const tab = { id, title: `tab ${idx}`, mode: 'js', autoRun: false, code: '' };
    codeTabs.push(tab);
    saveCodeTabs();
    renderCodeTabButtons();
    renderCodePages();
    switchTab(`code:${id}`);
    setTimeout(() => {
      const page = codeTabPages.get(id);
      if (page) {
        const inp = page.querySelector('.inp');
        if (inp) inp.focus();
      }
    }, 50);
  }
  function deleteCodeTab(id) {
    const i = codeTabs.findIndex(t => t.id === id);
    if (i >= 0) codeTabs.splice(i, 1);
    saveCodeTabs();
    clearInjectedForTab({ id, mode: 'js' });
    clearInjectedForTab({ id, mode: 'css' });
    const btn = codeTabButtons.get(id); if (btn) btn.remove(); codeTabButtons.delete(id);
    const page = codeTabPages.get(id); if (page) page.remove(); codeTabPages.delete(id);
    switchTab('visual');
  }
  function syncTabSelectedState() {
    const target = activeTabKey;
    const isVisual = target === 'visual';
    const isShots = target === 'snapshots';
    tabVisualBtn.setAttribute('aria-selected', String(isVisual));
    tabVisualBtn.tabIndex = isVisual ? 0 : -1;
    tabShotsBtn.setAttribute('aria-selected', String(isShots));
    tabShotsBtn.tabIndex = isShots ? 0 : -1;
    for (const [id, btn] of codeTabButtons.entries()) {
      const on = (target === `code:${id}`);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
  }
  function switchTab(key) {
    activeTabKey = key.startsWith('code:') || key === 'snapshots' ? key : 'visual';
    localStorage.setItem(LS_TAB, activeTabKey);
    pageVisual.classList.toggle('active', activeTabKey === 'visual');
    pageShots.classList.toggle('active', activeTabKey === 'snapshots');
    for (const [id, el] of codeTabPages.entries()) el.classList.toggle('active', activeTabKey === `code:${id}`);
    syncTabSelectedState();
  }

  // UI builder
  function createBox() {
    let box = document.getElementById(BOX_ID);
    if (box) return box;

    box = document.createElement('div'); box.id = BOX_ID;

    // Header (drag)
    const header = document.createElement('div');
    header.className = 'hdr'; header.textContent = 'delta';

    // Tabs bar
    const tabsBar = document.createElement('div'); tabsBar.className = 'tabs'; tabsBar.setAttribute('role', 'tablist');

    tabsLeft = document.createElement('div'); tabsLeft.className = 'tabs-left';
    tabsLeftBase = document.createElement('div'); tabsLeftBase.className = 'tabs-left-base';
    tabsLeftCodes = document.createElement('div'); tabsLeftCodes.className = 'tabs-left-codes';

    tabVisualBtn = document.createElement('button'); tabVisualBtn.type = 'button'; tabVisualBtn.className = 'tab'; tabVisualBtn.textContent = 'visual';
    tabVisualBtn.setAttribute('role', 'tab'); tabVisualBtn.addEventListener('click', () => switchTab('visual'));
    tabShotsBtn = document.createElement('button'); tabShotsBtn.type = 'button'; tabShotsBtn.className = 'tab'; tabShotsBtn.textContent = 'snapshots';
    tabShotsBtn.setAttribute('role', 'tab'); tabShotsBtn.addEventListener('click', () => switchTab('snapshots'));
    tabsLeftBase.appendChild(tabVisualBtn); tabsLeftBase.appendChild(tabShotsBtn);
    tabsLeft.appendChild(tabsLeftBase); tabsLeft.appendChild(tabsLeftCodes);

    const tabsRightWrap = document.createElement('div'); tabsRightWrap.className = 'tabs-right';
    plusBtn = document.createElement('button'); plusBtn.type = 'button'; plusBtn.className = 'tab plus'; plusBtn.textContent = '+';
    plusBtn.title = 'New code tab'; plusBtn.addEventListener('click', createNewCodeTab);
    tabsRightWrap.appendChild(plusBtn);

    tabsBar.appendChild(tabsLeft);
    tabsBar.appendChild(tabsRightWrap);

    // Content
    contentEl = document.createElement('div'); contentEl.className = 'content';

    // Visual page (emoji)
    pageVisual = document.createElement('div'); pageVisual.className = 'page'; pageVisual.id = 'delta-page-visual';
    const label = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = emojiEnabled;
    const span = document.createElement('span'); span.textContent = 'emoji debug';
    label.appendChild(cb); label.appendChild(span);
    statusEl = document.createElement('div'); statusEl.className = 'status'; statusEl.textContent = emojiEnabled ? 'loading emoji map...' : 'off';
    const btnRetry = document.createElement('button'); btnRetry.className = 'btn'; btnRetry.textContent = 'Retry emoji data';
    btnRetry.addEventListener('click', async () => {
      statusEl.textContent = 'loading emoji map...';
      await loadEmojiData();
      statusEl.textContent = emojiLoaded ? `emoji map loaded (${emojiEntries.length})` : 'failed to load; using basic set';
    });
    pageVisual.appendChild(label); pageVisual.appendChild(statusEl); pageVisual.appendChild(btnRetry);

    // Snapshots page
    pageShots = document.createElement('div'); pageShots.className = 'page'; pageShots.id = 'delta-page-snapshots';
    const snapBtn = document.createElement('button'); snapBtn.className = 'btn'; snapBtn.textContent = 'Snapshot';
    const clearBtn = document.createElement('button'); clearBtn.className = 'btn'; clearBtn.textContent = 'Clear all'; clearBtn.style.marginLeft = '6px';
    const snapStatus = document.createElement('div'); snapStatus.className = 'status';
    snapStatus.textContent = 'Click Snapshot, pick a screen/window/tab; we save a smaller PNG here. Click a thumb to preview.';
    const snapList = document.createElement('div'); snapList.className = 'shots';
    snapBtn.addEventListener('click', () => takeSnapshot(snapStatus, snapList));
    clearBtn.addEventListener('click', () => { snapshots.splice(0, snapshots.length); renderSnapshots(snapList); });
    pageShots.appendChild(snapBtn); pageShots.appendChild(clearBtn); pageShots.appendChild(snapStatus); pageShots.appendChild(snapList);

    // Assemble
    contentEl.appendChild(pageVisual);
    contentEl.appendChild(pageShots);
    box.appendChild(header);
    box.appendChild(tabsBar);
    box.appendChild(contentEl);
    document.body.appendChild(box);

    // Dragging
    let dragging = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      dragging = true; const r = box.getBoundingClientRect();
      ox = e.clientX - r.left; oy = e.clientY - r.top;
      const mm = (ev) => { if (dragging) { box.style.left = (ev.clientX - ox) + 'px'; box.style.top = (ev.clientY - oy) + 'px'; } };
      const mu = () => { dragging = false; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
      document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
      e.preventDefault();
    });

    // Emoji checkbox
    cb.addEventListener('change', async () => {
      emojiEnabled = cb.checked; localStorage.setItem(LS_ENABLED, emojiEnabled ? '1' : '0');
      if (emojiEnabled) {
        statusEl.textContent = 'loading emoji map...'; await loadEmojiData();
        statusEl.textContent = emojiLoaded ? `emoji map loaded (${emojiEntries.length})` : 'failed to load; using basic set';
      } else { statusEl.textContent = 'off'; closeDropdown(); }
    });

    // Initial tab selection
    renderCodeTabButtons();
    renderCodePages();
    switchTab(activeTabKey);

    // Warm load emoji
    if (emojiEnabled) { (async () => { statusEl.textContent = 'loading emoji map...'; await loadEmojiData(); statusEl.textContent = emojiLoaded ? `emoji map loaded (${emojiEntries.length})` : 'failed to load; using basic set'; })(); }

    // Initial snapshots list
    renderSnapshots(snapList);

    // Auto-run code tabs if marked
    for (const t of codeTabs) if (t.autoRun) injectForTab(t);

    return box;
  }

  function setupToggle() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F8' || e.keyCode === 119) {
        const t = e.target; const tag = t && t.tagName ? t.tagName.toLowerCase() : '';
        if (t && (t.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select')) return;
        e.preventDefault();
        const el = document.getElementById(BOX_ID) || createBox();
        el.style.display = (el.style.display === 'none') ? 'block' : 'none';
      }
    });
  }

  // Init
  attachListeners(document);
  createBox();
  setupToggle();
  if (emojiEnabled) loadEmojiData();
})();