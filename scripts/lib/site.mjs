import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATES = ['stated', 'absent', 'unconfirmed'];
const REQUIRED = ['chain', 'market', 'ca', 'x', 'github'];
export const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function loadRegister(file = path.join(root, 'src', 'register.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function record(reg, id) {
  return reg.records.find((r) => r.id === id);
}

/** Returns a list of problems; empty when the register is sound. */
export function validate(reg) {
  const errs = [];
  if (!reg || !Array.isArray(reg.records)) return ['records[] missing'];
  const seen = new Set();
  for (const r of reg.records) {
    if (seen.has(r.id)) errs.push(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (!STATES.includes(r.state)) errs.push(`${r.id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      for (const k of ['value', 'url', 'href', 'address']) if (k in r) errs.push(`${r.id}: inert record carries ${k}`);
    }
  }
  for (const id of REQUIRED) if (!seen.has(id)) errs.push(`missing record ${id}`);
  const ca = record(reg, 'ca');
  if (ca && ca.state === 'stated' && !BASE58.test(String(ca.value || ''))) errs.push('ca: stated value is not a Solana address');
  for (const id of ['x', 'github']) {
    const r = record(reg, id);
    if (r && r.state === 'stated' && !handleOf(id, r.url)) errs.push(`${id}: stated url unusable`);
  }
  const m = record(reg, 'market');
  if (m && m.state === 'stated' && !(m.boosts && m.pairs)) errs.push('market: stated without endpoints');
  return errs;
}

/** Link rule: the URL is stored, the handle is derived from it. */
export function handleOf(id, url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean);
    if (id === 'x' && (host === 'x.com' || host === 'twitter.com') && seg[0]) return `@${seg[0]}`;
    if (id === 'github' && host === 'github.com' && seg[0]) return seg.slice(0, 2).join('/');
  } catch (e) { /* unusable url */ }
  return null;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const ICON_GH = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';
const ICONS = { x: ICON_X, github: ICON_GH };

function social(reg, id) {
  const r = record(reg, id);
  if (r.state === 'stated') {
    const h = handleOf(id, r.url);
    return `<a class="soc" data-id="${id}" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${esc(r.label)}, ${esc(h)}">${ICONS[id]}</a>`;
  }
  return `<span class="soc" data-id="${id}" role="img" aria-disabled="true" aria-label="${esc(r.label)}, pending">${ICONS[id]}</span>`;
}

function caSlot(reg) {
  const r = record(reg, 'ca');
  const head = '<div class="ca-head"><span class="eyebrow">Contract · Solana</span></div>';
  if (r.state === 'stated') {
    return `  <section class="ca" id="ca" data-state="stated" aria-label="Contract address">\n    ${head}\n    <button class="ca-btn" id="ca-btn" type="button" data-copy="${esc(r.value)}" aria-label="Copy contract address"><code>${esc(r.value)}</code><span class="ca-act">Copy</span></button>\n  </section>`;
  }
  return `  <section class="ca" id="ca" data-state="${r.state}" aria-label="Contract address">\n    ${head}\n    <div class="ca-btn" id="ca-btn" aria-disabled="true"><code>pending</code></div>\n  </section>`;
}

function chips(reg) {
  const out = [];
  const chain = record(reg, 'chain');
  out.push(`<li><span class="chip"><b>Chain</b> ${esc(chain.state === 'stated' ? chain.value : 'pending')}</span></li>`);
  for (const id of ['ca', 'x', 'github']) {
    const r = record(reg, id);
    if (r.state === 'stated' && (id === 'x' || id === 'github')) {
      out.push(`<li><a class="chip" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(r.label)}</b> ${esc(handleOf(id, r.url))}</a></li>`);
    } else if (r.state === 'stated') {
      out.push(`<li><span class="chip"><b>${esc(r.label)}</b> stated</span></li>`);
    } else {
      out.push(`<li><span class="chip" aria-disabled="true"><b>${esc(r.label)}</b> pending</span></li>`);
    }
  }
  return out.join('');
}

function skeletonRows() {
  const row = '<li class="row" aria-hidden="true"><span class="rank"><i class="sk"></i></span><div class="tok"><i class="sk logo-sk"></i><div class="names"><i class="sk"></i></div></div><span class="cell c-price"><i class="sk w60"></i></span><span class="cell c-chg"><i class="sk w60"></i></span><span class="cell c-vol"><i class="sk w60"></i></span><span class="cell c-liq"><i class="sk w60"></i></span><i class="sk logo-sk"></i></li>';
  return Array.from({ length: 10 }, () => row).join('');
}

export function buildSite({ registerPath, outDir }) {
  const reg = loadRegister(registerPath);
  const errs = validate(reg);
  if (errs.length) throw new Error('register invalid: ' + errs.join('; '));
  const src = path.join(root, 'src');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'assets'), { recursive: true });

  const ca = record(reg, 'ca');
  const market = record(reg, 'market');
  const config = {
    ca: ca.state === 'stated' ? { state: 'stated', value: ca.value } : { state: ca.state },
    market: market.state === 'stated' ? { state: 'stated', boosts: market.boosts, pairs: market.pairs } : { state: market.state }
  };
  let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  const map = {
    '{{SOCIAL}}': social(reg, 'x') + social(reg, 'github'),
    '{{CA_SLOT}}': caSlot(reg),
    '{{FOOT_CHIPS}}': chips(reg),
    '{{MARKET_STATE}}': market.state,
    '{{SKELETON_ROWS}}': skeletonRows(),
    '{{CONFIG}}': JSON.stringify(config).replace(/</g, '\\u003c')
  };
  for (const [k, v] of Object.entries(map)) html = html.split(k).join(v);
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('unreplaced template slot');
  fs.writeFileSync(path.join(outDir, 'index.html'), html);

  for (const f of ['tokens.css', 'styles.css', 'app.js', 'boot.js']) fs.copyFileSync(path.join(src, f), path.join(outDir, f));
  fs.copyFileSync(path.join(src, 'assets', 'favicon.svg'), path.join(outDir, 'favicon.svg'));
  for (const f of ['planet-1024.webp', 'planet-512.webp', 'planet-128.webp', 'og.jpg']) fs.copyFileSync(path.join(src, 'assets', f), path.join(outDir, 'assets', f));
  fs.writeFileSync(path.join(outDir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
  fs.writeFileSync(path.join(outDir, '_headers'), [
    '/*',
    "  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src https://api.dexscreener.com; base-uri 'self'; form-action 'none'; frame-ancestors 'none'",
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    ''
  ].join('\n'));
  return { reg, outDir };
}
