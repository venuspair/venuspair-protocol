(() => {
  'use strict';

  const cfg = JSON.parse(document.getElementById('vp-config').textContent);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- live region + clipboard ---------- */
  const live = document.createElement('div');
  live.className = 'sr';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  document.body.appendChild(live);

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const t = document.createElement('textarea');
      t.value = text;
      t.setAttribute('readonly', '');
      t.className = 'sr';
      document.body.appendChild(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      t.remove();
      return ok;
    }
  }

  /* ---------- damped spring (semi-implicit Euler, fixed step) ---------- */
  function spring(onUpdate, onDone, delay = 0) {
    const k = Number(css('--spring-stiffness')) || 170;
    const c = Number(css('--spring-damping')) || 24;
    let x = 0, v = 0, last = 0, started = false;
    const step = 1 / 120;
    let acc = 0;
    const start = performance.now() + delay;
    function frame(now) {
      if (now < start) return requestAnimationFrame(frame);
      if (!started) { started = true; last = now; }
      acc += Math.min(0.05, (now - last) / 1000);
      last = now;
      while (acc >= step) {
        const a = -k * (x - 1) - c * v;
        v += a * step;
        x += v * step;
        acc -= step;
      }
      onUpdate(x);
      if (Math.abs(x - 1) < 0.0008 && Math.abs(v) < 0.001) { onUpdate(1); if (onDone) onDone(); return; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- scroll reveal ---------- */
  const stagger = parseFloat(css('--stagger')) || 70;
  const revealEls = $$('.reveal');
  function showNow(el) { el.classList.add('in'); el.style.opacity = ''; el.style.transform = ''; }
  if (reduced || !('IntersectionObserver' in window)) {
    revealEls.forEach(showNow);
  } else {
    const batch = new Map();
    const io = new IntersectionObserver((entries) => {
      const fresh = entries.filter((e) => e.isIntersecting);
      fresh.forEach((e, i) => {
        io.unobserve(e.target);
        const el = e.target;
        el.style.opacity = '0';
        el.style.transform = 'translate3d(0,28px,0)';
        el.classList.add('in');
        spring((p) => {
          el.style.opacity = String(clamp(p, 0, 1));
          el.style.transform = `translate3d(0,${(1 - p) * 28}px,0)`;
        }, () => { el.style.opacity = ''; el.style.transform = ''; }, i * stagger);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach((el) => io.observe(el));
  }

  /* ---------- scroll progress + scroll spy ---------- */
  const bar = $('#progress-bar');
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? clamp(scrollY / max, 0, 1) : 0})`;
      ticking = false;
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const spyLinks = $$('[data-spy]');
  if ('IntersectionObserver' in window) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) spyLinks.forEach((a) => a.classList.toggle('active', a.dataset.spy === e.target.id));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    ['market', 'orbit', 'notes'].forEach((id) => { const s = document.getElementById(id); if (s) spy.observe(s); });
  }

  /* ---------- spotlight ---------- */
  document.addEventListener('pointermove', (e) => {
    const t = e.target.closest && e.target.closest('.spot');
    if (!t) return;
    const r = t.getBoundingClientRect();
    t.style.setProperty('--mx', `${e.clientX - r.left}px`);
    t.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, { passive: true });

  /* ---------- hero parallax + stars ---------- */
  const layers = $$('.layer[data-depth]');
  const hero = $('.hero');
  const stars = $('#stars');
  let starList = [];
  function paintStars(t) {
    const ctx = stars.getContext('2d');
    ctx.clearRect(0, 0, stars.width, stars.height);
    for (const s of starList) {
      const tw = reduced ? 1 : 0.55 + 0.45 * Math.sin(t / 1000 * s.sp + s.ph);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(s.x * stars.width, s.y * stars.height, s.r * devicePixelRatio, 0, 6.2832);
      ctx.fill();
    }
  }
  function sizeStars() {
    const r = stars.getBoundingClientRect();
    stars.width = Math.max(1, Math.round(r.width * devicePixelRatio));
    stars.height = Math.max(1, Math.round(r.height * devicePixelRatio));
    const palette = [css('--ice'), css('--mist'), css('--sand'), css('--azure')];
    const n = Math.round(clamp(r.width / 8, 60, 200));
    starList = Array.from({ length: n }, () => ({
      x: Math.random(), y: Math.random(), r: Math.random() * 1.1 + 0.3, a: Math.random() * 0.6 + 0.25,
      sp: Math.random() * 1.6 + 0.4, ph: Math.random() * 6.28, c: palette[Math.floor(Math.random() * palette.length)]
    }));
    paintStars(0);
  }
  if (stars) { sizeStars(); addEventListener('resize', sizeStars); }

  if (!reduced && hero) {
    const tgt = { x: 0, y: 0, s: 0 }, cur = { x: 0, y: 0, s: 0 };
    let raf = 0;
    const loop = (now) => {
      cur.x += (tgt.x - cur.x) * 0.07;
      cur.y += (tgt.y - cur.y) * 0.07;
      cur.s += (tgt.s - cur.s) * 0.12;
      layers.forEach((l) => {
        const d = Number(l.dataset.depth);
        l.style.transform = `translate3d(${cur.x * d * 26}px,${cur.y * d * 20 - cur.s * d * 90}px,0)`;
      });
      if (stars) paintStars(now);
      raf = requestAnimationFrame(loop);
    };
    addEventListener('pointermove', (e) => {
      tgt.x = (e.clientX / innerWidth - 0.5) * 2;
      tgt.y = (e.clientY / innerHeight - 0.5) * 2;
    }, { passive: true });
    addEventListener('scroll', () => { tgt.s = clamp(scrollY / Math.max(1, hero.offsetHeight), 0, 1.4); }, { passive: true });
    raf = requestAnimationFrame(loop);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf); else raf = requestAnimationFrame(loop);
    });
  }

  /* ---------- contract slot ---------- */
  const caBtn = $('#ca-btn');
  if (caBtn && caBtn.dataset.copy) {
    const act = $('.ca-act', caBtn);
    let t = 0;
    caBtn.addEventListener('click', async () => {
      const ok = await copyText(caBtn.dataset.copy);
      act.textContent = ok ? 'Copied' : 'Press Ctrl+C';
      $('.ca').dataset.copied = String(ok);
      live.textContent = ok ? 'Contract address copied' : 'Copy failed';
      clearTimeout(t);
      t = setTimeout(() => { act.textContent = 'Copy'; $('.ca').dataset.copied = 'false'; }, 1800);
    });
  }

  /* ---------- formatting ---------- */
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2, style: 'currency', currency: 'USD' });
  const intFmt = new Intl.NumberFormat('en-US');
  const fmt = {
    usd: (v) => compact.format(v),
    int: (v) => intFmt.format(Math.round(v)),
    pct: (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}%`,
    pctplain: (v) => `${v.toFixed(1)}%`,
    price: (v) => {
      if (!(v > 0)) return '$0';
      if (v >= 1000) return `$${intFmt.format(Math.round(v))}`;
      if (v >= 1) return `$${v.toFixed(2)}`;
      const d = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(v))));
      return `$${v.toFixed(d)}`;
    }
  };

  function countTo(el, to, f, from) {
    const prev = Number(el.dataset.raw);
    const hasPrev = el.dataset.raw !== undefined && el.dataset.raw !== '' && !Number.isNaN(prev);
    el.dataset.raw = String(to);
    const start = from !== undefined ? from : (hasPrev ? prev : 0);
    if (reduced || start === to) { el.textContent = f(to); return; }
    if (hasPrev && start !== to) {
      const cls = to > start ? 'flash-up' : 'flash-down';
      el.classList.remove('flash-up', 'flash-down');
      void el.offsetWidth;
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), 950);
    }
    const t0 = performance.now(), dur = 700;
    const run = (now) => {
      const p = clamp((now - t0) / dur, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = f(start + (to - start) * e);
      if (p < 1) requestAnimationFrame(run); else el.textContent = f(to);
    };
    requestAnimationFrame(run);
  }

  /* ---------- market ---------- */
  const M = cfg.market;
  const rowsEl = $('#rows');
  const statusEl = $('#status');
  const statusText = $('#status-text');
  const errEl = $('#market-error');
  const trackEl = $('#ticker-track');
  const tileEls = {};
  $$('[data-tile]').forEach((el) => { tileEls[el.dataset.tile] = el; });
  const tileNote = $('[data-tile-note="mover"]');
  const shareBar = $('#share-bar');

  let rows = [];            // last good, sorted by volume desc
  let sortKey = 'volume';
  let failures = 0;
  let timer = 0;
  let inflight = false;
  let firstPaint = true;

  function setStatus(state, text) { statusEl.dataset.state = state; statusText.textContent = text; }

  const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
  const DONE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

  function letterTile(sym) {
    const s = document.createElement('span');
    s.className = 'logo fb';
    s.setAttribute('aria-hidden', 'true');
    const m = (sym || '?').match(/[A-Za-z0-9]/);
    s.textContent = (m ? m[0] : '?').toUpperCase();
    return s;
  }
  function logoNode(item) {
    if (!item.image) return letterTile(item.symbol);
    const img = document.createElement('img');
    img.className = 'logo';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.replaceWith(letterTile(item.symbol)), { once: true });
    img.src = item.image;
    return img;
  }

  function buildRow(item) {
    const li = document.createElement('li');
    li.className = 'row spot';
    li.dataset.addr = item.address;
    const rank = document.createElement('span'); rank.className = 'rank';
    const tok = document.createElement('div'); tok.className = 'tok';
    const names = document.createElement('div'); names.className = 'names';
    const sym = document.createElement('strong'); sym.textContent = item.symbol;
    const nm = document.createElement('span'); nm.textContent = item.name;
    names.append(sym, nm);
    tok.append(logoNode(item), names);
    const mk = (cls, label) => { const s = document.createElement('span'); s.className = `cell ${cls}`; s.dataset.l = label; return s; };
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'copy';
    btn.setAttribute('aria-label', `Copy address for ${item.symbol}`);
    btn.innerHTML = COPY_ICON;
    let t = 0;
    btn.addEventListener('click', async () => {
      const ok = await copyText(item.address);
      live.textContent = ok ? `Address for ${item.symbol} copied` : 'Copy failed';
      btn.dataset.done = String(ok);
      btn.innerHTML = ok ? DONE_ICON : COPY_ICON;
      clearTimeout(t);
      t = setTimeout(() => { btn.dataset.done = 'false'; btn.innerHTML = COPY_ICON; }, 1600);
    });
    li.append(rank, tok, mk('c-price', 'Quote'), mk('c-chg', '24h'), mk('c-vol', 'Volume'), mk('c-liq', 'Depth'), btn);
    return li;
  }

  function fillRow(li, item, rank, first) {
    $('.rank', li).textContent = String(rank);
    const setCell = (sel, v, f) => countTo($(sel, li), v, f, first ? 0 : undefined);
    setCell('.c-price', item.price, fmt.price);
    setCell('.c-vol', item.volume, fmt.usd);
    setCell('.c-liq', item.liquidity, fmt.usd);
    const chg = $('.c-chg', li);
    countTo(chg, item.change, fmt.pct, first ? 0 : undefined);
    chg.classList.toggle('up', item.change >= 0);
    chg.classList.toggle('down', item.change < 0);
  }

  function sorted() {
    const k = { volume: 'volume', change: 'change', liquidity: 'liquidity' }[sortKey];
    return rows.slice().sort((a, b) => b[k] - a[k]);
  }

  function render() {
    const list = sorted();
    const first = firstPaint;
    const existing = new Map($$('.row[data-addr]', rowsEl).map((r) => [r.dataset.addr, r]));
    $$('.row:not([data-addr])', rowsEl).forEach((r) => r.remove());
    const frag = [];
    list.forEach((item, i) => {
      let li = existing.get(item.address);
      const isNew = !li;
      if (isNew) {
        li = buildRow(item);
        li.style.setProperty('--i', String(i));
        if (!reduced) li.classList.add('is-in');
      }
      existing.delete(item.address);
      fillRow(li, item, i + 1, isNew && !reduced);
      frag.push(li);
    });
    existing.forEach((r) => r.remove());
    frag.forEach((li) => rowsEl.appendChild(li));
    firstPaint = false;
    renderTicker(list);
    renderTiles(rows);
  }

  function renderTicker(list) {
    const mk = (item, hidden) => {
      const s = document.createElement('span');
      s.className = 'tick';
      if (hidden) s.setAttribute('aria-hidden', 'true');
      const b = document.createElement('b'); b.textContent = item.symbol;
      const p = document.createElement('span'); p.textContent = fmt.price(item.price);
      const c = document.createElement('span'); c.textContent = fmt.pct(item.change);
      c.className = item.change >= 0 ? 'cell up' : 'cell down';
      s.append(b, p, c);
      return s;
    };
    const nodes = list.map((i) => mk(i, false));
    if (!reduced) list.forEach((i) => nodes.push(mk(i, true)));
    trackEl.replaceChildren(...nodes);
    trackEl.style.setProperty('--dur', `${Math.max(24, list.length * 6)}s`);
  }

  function median(a) {
    const s = a.slice().sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function setTile(key, v, f, signed) {
    const el = tileEls[key];
    if (!el) return;
    countTo(el, v, f, undefined);
    if (signed) { el.classList.toggle('up', v >= 0); el.classList.toggle('down', v < 0); }
  }

  function renderTiles(list) {
    if (!list.length) return;
    const vol = list.reduce((a, r) => a + r.volume, 0);
    const liq = list.reduce((a, r) => a + r.liquidity, 0);
    const top = list.slice().sort((a, b) => b.volume - a.volume)[0];
    const mover = list.slice().sort((a, b) => b.change - a.change)[0];
    const up = list.filter((r) => r.change >= 0).length;
    setTile('count', list.length, fmt.int);
    setTile('volume', vol, fmt.usd);
    setTile('liquidity', liq, fmt.usd);
    setTile('mover', mover.change, fmt.pct, true);
    if (tileNote) tileNote.textContent = `${mover.symbol} leads the 24h move.`;
    const lead = tileEls.leader; lead.textContent = top.symbol; lead.dataset.raw = '';
    setTile('median', median(list.map((r) => r.change)), fmt.pct, true);
    setTile('share', vol > 0 ? (top.volume / vol) * 100 : 0, fmt.pctplain);
    const ratio = up / list.length;
    const g = tileEls.rising; g.textContent = `${up} of ${list.length}`; g.dataset.raw = '';
    shareBar.style.setProperty('--w', String(ratio));
    shareBar.style.transform = `scaleX(${ratio})`;
  }

  function renderDash() {
    firstPaint = false;
    rowsEl.replaceChildren(...Array.from({ length: 10 }, (_, i) => {
      const li = document.createElement('li');
      li.className = 'row';
      const cells = ['—', '—', '—', '—', '—'];
      li.innerHTML = '<span class="rank"></span><div class="tok"><span class="logo fb" aria-hidden="true">—</span><div class="names"><strong>—</strong><span>—</span></div></div>';
      ['Quote', '24h', 'Volume', 'Depth'].forEach((l, j) => {
        const s = document.createElement('span'); s.className = 'cell'; s.dataset.l = l; s.textContent = cells[j]; li.appendChild(s);
      });
      li.firstChild.textContent = String(i + 1);
      const b = document.createElement('button'); b.className = 'copy'; b.type = 'button'; b.disabled = true; b.setAttribute('aria-label', 'No address available'); b.innerHTML = COPY_ICON;
      li.appendChild(b);
      return li;
    }));
    Object.values(tileEls).forEach((el) => { el.textContent = '—'; el.dataset.raw = ''; });
    trackEl.replaceChildren();
  }

  async function getJson(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`http ${r.status}`);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  async function pull() {
    const boosts = await getJson(M.boosts);
    const addrs = [];
    for (const b of Array.isArray(boosts) ? boosts : []) {
      if (b && b.chainId === 'solana' && b.tokenAddress && !addrs.includes(b.tokenAddress)) addrs.push(b.tokenAddress);
    }
    if (!addrs.length) throw new Error('no solana entries');
    const pairs = await getJson(M.pairs + addrs.slice(0, 30).join(','));
    const want = new Set(addrs);
    const best = new Map();
    for (const p of Array.isArray(pairs) ? pairs : []) {
      const a = p && p.baseToken && p.baseToken.address;
      if (!a || !want.has(a)) continue;
      const vol = Number(p.volume && p.volume.h24) || 0;
      const prev = best.get(a);
      if (!prev || vol > prev.volume) {
        best.set(a, {
          address: a,
          symbol: String(p.baseToken.symbol || '?'),
          name: String(p.baseToken.name || ''),
          price: Number(p.priceUsd) || 0,
          change: Number(p.priceChange && p.priceChange.h24) || 0,
          volume: vol,
          liquidity: Number(p.liquidity && p.liquidity.usd) || 0,
          image: (p.info && p.info.imageUrl) || ''
        });
      }
    }
    const list = Array.from(best.values()).sort((a, b) => b.volume - a.volume).slice(0, 10);
    if (!list.length) throw new Error('no pairs');
    return list;
  }

  function schedule(ms) {
    clearTimeout(timer);
    if (document.hidden) return;
    timer = setTimeout(load, ms);
  }

  async function load() {
    if (inflight) return;
    inflight = true;
    clearTimeout(timer);
    setStatus('syncing', 'Syncing');
    try {
      rows = await pull();
      failures = 0;
      errEl.hidden = true;
      render();
      setStatus('live', 'Streaming');
      schedule(60000);
    } catch (e) {
      failures += 1;
      console.warn('market refresh failed', e);
      if (!rows.length) { renderDash(); }
      errEl.hidden = false;
      setStatus('error', rows.length ? 'Stale' : 'Offline');
      const wait = Math.min(60000, 1500 * Math.pow(2, failures - 1)) + Math.random() * 500;
      schedule(wait);
    } finally {
      inflight = false;
    }
  }

  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((o) => o.setAttribute('aria-selected', String(o === t)));
    sortKey = t.dataset.sort;
    if (rows.length) render();
  }));

  if (M && M.state === 'stated') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { clearTimeout(timer); setStatus('paused', 'Paused'); }
      else load();
    });
    if (!document.hidden) load(); else setStatus('paused', 'Paused');
  } else {
    renderDash();
    setStatus('paused', 'Pending');
  }
})();
