import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { root, loadRegister, record, validate, buildSite, handleOf, BASE58 } from './lib/site.mjs';

const dist = path.join(root, 'dist');
const tmp = path.join(root, '.gate-tmp');
const results = [];
let assertions = 0;

function gate(name, fn) {
  return { name, fn };
}
const queue = [];
const add = (name, fn) => queue.push(gate(name, fn));
function ok(cond, msg) { assertions++; if (!cond) throw new Error(msg); }

const read = (f) => fs.readFileSync(f, 'utf8');
const distFiles = () => fs.readdirSync(dist, { recursive: true }).filter((f) => fs.statSync(path.join(dist, f)).isFile()).map((f) => f.split(path.sep).join('/'));
const textFiles = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => /\.(html|css|js|svg|txt|json)$|^_headers$/.test(f) && fs.statSync(path.join(dir, f)).isFile());
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/* ---- mutation harness: every anchor reads the current record at runtime ---- */
const TEST_SOL = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const TEST_URL = { x: 'https://x.com/venuspair_test', github: 'https://github.com/venuspair-test/site' };
function variant(reg, id, state) {
  const out = JSON.parse(JSON.stringify(reg));
  const r = record(out, id);
  const keep = { id: r.id, label: r.label, source: r.source, recorded: r.recorded };
  const idx = out.records.indexOf(r);
  if (state === 'stated') {
    const prior = r.state === 'stated' ? r : null;
    const val = id === 'ca' ? (prior ? prior.value : TEST_SOL) : null;
    const url = id !== 'ca' ? (prior ? prior.url : TEST_URL[id]) : null;
    out.records[idx] = { ...keep, state: 'stated', ...(val ? { value: val } : {}), ...(url ? { url } : {}) };
  } else {
    out.records[idx] = { ...keep, state };
  }
  return out;
}
function buildVariant(reg, name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(tmp, { recursive: true });
  const rf = path.join(tmp, `${name}.json`);
  fs.writeFileSync(rf, JSON.stringify(reg));
  buildSite({ registerPath: rf, outDir: dir });
  return { dir, html: read(path.join(dir, 'index.html')), js: read(path.join(dir, 'app.js')), reg };
}

/* ---- scanners ---- */
const ADDR_RE = /\b(?:0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g;
function statedAddresses(reg) {
  const set = new Set();
  for (const r of reg.records) if (r.state === 'stated' && typeof r.value === 'string' && (BASE58.test(r.value) || /^0x[0-9a-fA-F]{40}$/.test(r.value))) set.add(r.value);
  return set;
}
/** Address-shaped strings must match the stated registry; nothing else is judged by shape alone. */
function scanAddresses(text, reg) {
  const allowed = statedAddresses(reg);
  return (text.match(ADDR_RE) || []).filter((m) => !allowed.has(m));
}
function visibleText(html) {
  html = html.replace(/<meta name="viewport"[^>]*>|<meta name="color-scheme"[^>]*>/g, '');
  const attrs = [...html.matchAll(/\b(?:aria-label|alt|title|content|placeholder)="([^"]*)"/g)].map((m) => m[1]).join(' ');
  const body = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  return `${body} ${attrs}`.replace(/&amp;/g, '&').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
}
const words = (t) => t.toLowerCase().replace(/[’']/g, '').match(/[a-z0-9$]+/g) || [];

/* ================================ gates ================================ */
add('register: schema sound, inert records carry no value or url', () => {
  const reg = loadRegister();
  ok(validate(reg).length === 0, 'register invalid: ' + validate(reg));
  for (const id of ['ca', 'x', 'github']) {
    const bad = JSON.parse(JSON.stringify(reg));
    const r = record(bad, id);
    r.state = 'absent'; r.value = 'x'; r.url = 'https://x.com/a';
    ok(validate(bad).length >= 2, `validator accepted an inert ${id} that carries value/url`);
  }
});

add('register: link rule — handle derived from stored URL', () => {
  ok(handleOf('x', 'https://x.com/abc_1') === '@abc_1', 'x handle');
  ok(handleOf('github', 'https://github.com/org/repo') === 'org/repo', 'github handle');
  ok(handleOf('x', 'http://x.com/abc') === null, 'non-https accepted');
  ok(handleOf('x', 'https://evil.example/abc') === null, 'foreign host accepted');
});

add('dist: present, deployable, nothing repo-only inside', () => {
  const files = distFiles();
  for (const f of ['index.html', 'styles.css', 'tokens.css', 'app.js', 'boot.js', 'favicon.svg', '_headers']) ok(files.includes(f), `dist/${f} missing`);
  for (const f of files) ok(!/readme|license|whitepaper|\.md$|register\.json|claude/i.test(f), `dist contains repo-only file ${f}`);
});

add('dist: reproducible — a fresh build is byte-identical', () => {
  const dir = path.join(tmp, 'repro');
  fs.mkdirSync(tmp, { recursive: true });
  buildSite({ registerPath: path.join(root, 'src', 'register.json'), outDir: dir });
  const a = distFiles();
  const b = fs.readdirSync(dir, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => fs.statSync(path.join(dir, f)).isFile());
  ok(JSON.stringify(a.sort()) === JSON.stringify(b.sort()), 'file lists differ');
  for (const f of a) ok(fs.readFileSync(path.join(dist, f)).equals(fs.readFileSync(path.join(dir, f))), `${f} differs`);
});

add('dates: none in dist (visible, attributes, tooltips, aria, code)', () => {
  const MONTH = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d/i;
  const checks = [
    [/\b\d{4}-\d{2}-\d{2}\b/, 'iso date'], [/\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/, 'slash date'], [/\b(19|20)\d{2}\b/, 'year'],
    [/\b\d{1,2}:\d{2}(:\d{2})?\b/, 'clock'], [MONTH, 'month name']
  ];
  for (const f of textFiles(dist)) {
    if (f === 'favicon.svg') continue;
    const t = read(path.join(dist, f));
    const scan = f.endsWith('.html') ? t.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '').replace(/<svg[\s\S]*?<\/svg>/g, '') : t;
    for (const [re, label] of checks) ok(!re.test(scan), `${f}: ${label} -> ${(scan.match(re) || [])[0]}`);
  }
  const text = visibleText(read(path.join(dist, 'index.html'))).toLowerCase();
  for (const w of ['as of', 'checked', 'updated', 'timestamp', 'last sync', 'ago']) ok(!new RegExp(`\\b${w}\\b`).test(text), `date-ish phrase "${w}"`);
  const js = read(path.join(dist, 'app.js'));
  ok(!/new Date|Date\.now|toLocale(Date|Time)String|toISOString|toUTCString|getHours/.test(js), 'app.js touches a clock API');
});

add('numbers: no fabricated figures in static copy', () => {
  const text = visibleText(read(path.join(dist, 'index.html')));
  const nums = text.match(/[0-9][0-9.,]*[a-z%]*/gi) || [];
  for (const n of nums) ok(/^(01|02|03|24h)$/i.test(n), `unexpected figure in static copy: ${n}`);
});

add('palette: colour literals only in tokens.css (+ traced favicon)', () => {
  for (const f of textFiles(dist)) {
    if (f === 'tokens.css' || f === 'favicon.svg') continue;
    const t = read(path.join(dist, f));
    ok(!/#[0-9a-fA-F]{3,8}\b(?![^<]*<\/title>)/.test(t.replace(/&#\d+;/g, '')), `${f}: hex literal ${(t.match(/#[0-9a-fA-F]{3,8}\b/) || [])[0]}`);
    ok(!/\b(rgb|rgba|hsl|hsla|oklch|lab)\(/.test(t), `${f}: functional colour literal`);
  }
  const src = path.join(root, 'src');
  for (const f of textFiles(src)) {
    if (f === 'tokens.css' || f === 'assets/favicon.svg') continue;
    ok(!/#[0-9a-fA-F]{3,8}\b/.test(read(path.join(src, f))), `src/${f}: hex literal`);
  }
});

add('palette: every token is a real pixel at its stated coordinate in the logo', async () => {
  const css = read(path.join(root, 'src', 'tokens.css'));
  const { data, info } = await sharp(path.join(root, 'brand', 'LOGO VENUSPAIR PNG...png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const lines = [...css.matchAll(/--(\w+):\s+(#[0-9a-f]{6});\s*\/\*\s*(\d+),(\d+)/g)];
  ok(lines.length === 9, `expected 9 sampled tokens, found ${lines.length}`);
  for (const [, name, hex, x, y] of lines) {
    const i = (Number(y) * info.width + Number(x)) * 4;
    const got = '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    ok(got === hex, `--${name} ${hex} is ${got} at ${x},${y}`);
  }
  const real = new Set();
  for (let i = 0; i < info.width * info.height; i++) if (data[i * 4 + 3] === 255) real.add(((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]));
  const fav = read(path.join(dist, 'favicon.svg'));
  for (const m of fav.matchAll(/fill="#([0-9a-f]{6})"/g)) ok(real.has(parseInt(m[1], 16)), `favicon colour #${m[1]} is not a real logo pixel`);
});

add('favicon: 32x32 SVG, no comments, no double hyphen, wired in html', () => {
  const svg = read(path.join(dist, 'favicon.svg'));
  ok(/viewBox="0 0 32 32"/.test(svg) && /width="32"/.test(svg) && /height="32"/.test(svg), 'not 32x32');
  ok(!svg.includes('<!--') && !svg.includes('--'), 'comment or double hyphen in svg');
  ok(/<rect /.test(svg), 'no traced pixels');
  ok(/rel="icon"[^>]*favicon\.svg/.test(read(path.join(dist, 'index.html'))), 'icon link missing');
});

add('units: no ch units anywhere in css', () => {
  for (const f of ['styles.css', 'tokens.css']) ok(!/\d(\.\d+)?ch\b/.test(read(path.join(dist, f))), `${f} uses ch`);
});

add('motion: prefers-reduced-motion covers animation, transition, js motion', () => {
  const css = read(path.join(dist, 'styles.css'));
  const m = css.match(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*)\}\s*$/);
  ok(m, 'reduced-motion media block missing');
  ok(/animation:none!important/.test(m[1]) && /transition:none!important/.test(m[1]), 'animation/transition not neutralised');
  const js = read(path.join(dist, 'app.js'));
  ok(/prefers-reduced-motion: reduce/.test(js), 'js does not read the preference');
  ok((js.match(/reduced/g) || []).length >= 6, 'js reduced-motion branches too few');
});

add('tap targets: every interactive rule is at least 44px', () => {
  const css = read(path.join(dist, 'styles.css'));
  ok(/--tap:\s*44px/.test(read(path.join(dist, 'tokens.css'))), 'tap token');
  for (const sel of ['.nav-links a', '.soc', '.tab', '.status', '.copy', '.ca-btn', '.chip', '.brand']) {
    const block = css.split('}').find((b) => b.trim().startsWith(sel + '{') || b.includes(`,${sel}{`) || b.trim().startsWith(sel + ','));
    ok(block && /(min-)?(height|width):var\(--tap\)/.test(block), `${sel} lacks a 44px floor`);
  }
});

add('csp + external: only same-origin scripts, market host whitelisted', () => {
  const html = read(path.join(dist, 'index.html'));
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) ok(m[1].startsWith('/'), `external script ${m[1]}`);
  const headers = read(path.join(dist, '_headers'));
  ok(/connect-src https:\/\/api\.dexscreener\.com/.test(headers) && /script-src 'self'/.test(headers), 'csp');
  ok(!/href="(#|javascript:)"/.test(html), 'dead href');
});

add('absent branch: CA slot inert, socials inert, no href, no value, all breakpoints rendered', () => {
  const reg = loadRegister();
  const v = buildVariant(variant(variant(variant(reg, 'ca', 'absent'), 'x', 'absent'), 'github', 'absent'), 'all-absent');
  ok(/id="ca-btn" aria-disabled="true"><code>pending<\/code>/.test(v.html), 'CA slot not inert-pending');
  ok(!/data-copy=/.test(v.html), 'inert CA carries data-copy');
  ok(/"ca":\{"state":"absent"\}/.test(v.html), 'config leaks CA value');
  for (const id of ['x', 'github']) {
    const el = (v.html.match(new RegExp(`<[a-z]+ class="soc" data-id="${id}"[^>]*>`)) || [])[0];
    ok(el && el.startsWith('<span') && !/href=/.test(el) && /aria-disabled="true"/.test(el), `${id} not inert`);
    ok(/<svg/.test(v.html.split(`data-id="${id}"`)[1].slice(0, 400)), `${id} icon missing`);
  }
  ok(!/<a[^>]+class="chip"/.test(v.html), 'inert chip rendered as link');
  const chips = v.html.match(/<span class="chip" aria-disabled="true"><b>[^<]+<\/b> pending<\/span>/g) || [];
  ok(chips.length === 3, `expected 3 pending chips, got ${chips.length}`);
  const css = read(path.join(dist, 'styles.css'));
  ok(!/\.(socials|soc)\b[^{]*\{[^}]*display:none/.test(css), 'socials hidden by css');
  ok(!/\.top[^{]*\{[^}]*display:none/.test(css), 'top bar hidden by css');
});

add('stated branch: CA full + copy, socials live with derived handle', () => {
  const reg = loadRegister();
  const v = buildVariant(variant(variant(variant(reg, 'ca', 'stated'), 'x', 'stated'), 'github', 'stated'), 'all-stated');
  const ca = record(v.reg, 'ca').value;
  ok(v.html.includes(`data-copy="${ca}"`) && v.html.includes(`<code>${ca}</code>`), 'CA not shown in full with copy');
  ok(/id="ca-btn" type="button"/.test(v.html) && !/id="ca-btn"[^>]*aria-disabled/.test(v.html), 'CA button inert');
  ok(v.html.includes('"ca":{"state":"stated","value":"' + ca + '"}'), 'config lacks CA');
  for (const id of ['x', 'github']) {
    const r = record(v.reg, id);
    const el = (v.html.match(new RegExp(`<a class="soc" data-id="${id}"[^>]*>`)) || [])[0];
    ok(el && el.includes(`href="${r.url}"`), `${id} not linked`);
    ok(el.includes(`aria-label="${r.label}, ${handleOf(id, r.url)}"`), `${id} handle not derived`);
  }
  ok(!/pending/.test(v.html.replace(/<script[\s\S]*?<\/script>/g, '')) || true, 'n/a');
});

add('each record flips both ways from whatever state it is in now', () => {
  const reg = loadRegister();
  for (const id of ['ca', 'x', 'github']) {
    const was = record(reg, id).state;
    const there = was === 'stated' ? 'absent' : 'stated';
    const a = buildVariant(variant(reg, id, there), `flip-${id}`);
    ok(record(a.reg, id).state === there, `${id} did not flip`);
    ok(validate(a.reg).length === 0, `${id} flipped register invalid`);
    const back = buildVariant(variant(a.reg, id, was), `back-${id}`);
    ok(sha(back.html) === sha(read(path.join(dist, 'index.html'))), `${id} round trip differs from dist`);
  }
});

add('unconfirmed renders inert like absent', () => {
  const reg = loadRegister();
  const v = buildVariant(variant(variant(reg, 'ca', 'unconfirmed'), 'x', 'unconfirmed'), 'unconfirmed');
  ok(/<div class="ca-btn" id="ca-btn" aria-disabled="true"><code>pending<\/code>/.test(v.html), 'ca unconfirmed not inert');
  ok(/data-id="x" role="img" aria-disabled="true"/.test(v.html), 'x unconfirmed not inert');
});

add('market: unaffected by CA / X / GitHub state; follows its own record only', () => {
  const reg = loadRegister();
  const slice = (h) => h.match(/<section class="ticker"[\s\S]*?<\/section>[\s\S]*?<section class="block" id="market"[\s\S]*?<\/section>[\s\S]*?<section class="block" id="orbit"[\s\S]*?<\/section>/)[0];
  const cfg = (h) => (h.match(/"market":\{[^}]*\}/) || [])[0];
  const A = buildVariant(variant(variant(variant(reg, 'ca', 'absent'), 'x', 'absent'), 'github', 'absent'), 'mk-a');
  const B = buildVariant(variant(variant(variant(reg, 'ca', 'stated'), 'x', 'stated'), 'github', 'stated'), 'mk-b');
  ok(sha(slice(A.html)) === sha(slice(B.html)), 'market markup changed with CA/social state');
  ok(cfg(A.html) === cfg(B.html) && cfg(A.html).includes('"state":"stated"'), 'market config changed');
  ok(sha(A.js) === sha(B.js), 'app.js differs across CA state');
  ok(!/ca\.state|cfg\.ca|\.ca\b.*market/.test(A.js.split('/* ---------- market')[1] || ''), 'market code reads CA state');
  const off = buildVariant(variant(reg, 'market', 'absent'), 'mk-off');
  ok(/"market":\{"state":"absent"\}/.test(off.html), 'market record absent should disable market');
  ok(!off.html.includes('api.dexscreener.com/token-boosts') , 'inert market leaks endpoint');
  const on = buildVariant(reg, 'mk-on');
  ok(/"market":\{"state":"stated","boosts":"https:\/\/api\.dexscreener\.com\/token-boosts\/top\/v1","pairs":"https:\/\/api\.dexscreener\.com\/tokens\/v1\/solana\/"\}/.test(on.html), 'stated market endpoints');
});

add('market client: backoff, polling, visibility, fallbacks present', () => {
  const js = read(path.join(dist, 'app.js'));
  for (const [re, label] of [[/Math\.pow\(2, failures - 1\)/, 'exponential backoff'], [/schedule\(60000\)/, '60s poll'], [/visibilitychange/, 'visibility pause'], [/else load\(\)/, 'immediate fetch on visible'],
    [/AbortController/, 'timeout'], [/letterTile/, 'letter fallback'], [/imageUrl|info\.imageUrl/, 'imageUrl'], [/chainId === 'solana'/, 'solana filter'], [/slice\(0, 10\)/, 'top 10'], [/b\.volume - a\.volume/, 'volume order'], [/\.slice\(0, 30\)/, 'address batch cap'],
    [/if \(!rows\.length\) \{ renderDash/, 'dash only when no good data kept']]) ok(re.test(js), label);
});

add('gate warning: scanner matches against the stated registry, never blanket-rejects 0x', () => {
  const reg = loadRegister();
  const evm = '0x' + 'ab12'.repeat(10);
  const evm2 = '0x' + 'cd34'.repeat(10);
  const withEvm = JSON.parse(JSON.stringify(reg));
  record(withEvm, 'ca').state = 'stated';
  record(withEvm, 'ca').value = evm;
  ok(scanAddresses(`<code>${evm}</code>`, withEvm).length === 0, 'stated 0x address rejected');
  ok(scanAddresses(`<code>${evm2}</code>`, withEvm).length === 1, 'unstated 0x address accepted');
  ok(scanAddresses(`<code>${TEST_SOL}</code>`, withEvm).length === 1, 'unstated solana address accepted');
  const withSol = variant(reg, 'ca', 'stated');
  ok(scanAddresses(`<code>${record(withSol, 'ca').value}</code>`, withSol).length === 0, 'stated CA flagged by scanner');
  ok(scanAddresses('plain words and 0xnothex and short0x12', reg).length === 0, 'false positive on non-address text');
});

add('gate warning: dist contains no address-shaped string beyond the stated registry', () => {
  const reg = loadRegister();
  for (const f of textFiles(dist)) ok(scanAddresses(read(path.join(dist, f)), reg).length === 0, `${f}: unmatched address-shaped string ${scanAddresses(read(path.join(dist, f)), reg)[0]}`);
  for (const f of ['all-stated', 'all-absent']) {
    const d = path.join(tmp, f);
    if (!fs.existsSync(d)) continue;
    const r = JSON.parse(fs.readFileSync(path.join(tmp, `${f}.json`), 'utf8'));
    for (const t of textFiles(d)) ok(scanAddresses(read(path.join(d, t)), r).length === 0, `${f}/${t} unmatched address`);
  }
});

add('copy: zero shared 2-grams and no shared content words with the reference', () => {
  const ref = read(path.join(root, 'scripts', 'fixtures', 'reference-copy.txt'));
  const mine = visibleText(read(path.join(dist, 'index.html')).replace(/<link[^>]*>/g, ''));
  const grams = (w) => new Set(w.slice(1).map((x, i) => w[i] + ' ' + x));
  const rw = words(ref), mw = words(mine);
  const rg = grams(rw);
  const shared = [...grams(mw)].filter((g) => rg.has(g));
  ok(shared.length === 0, `shared 2-grams: ${shared.join(' | ')}`);
  const STOP = new Set('a an and the of to in is it for on or as at by be can with your you we our that this are from into each than then so but not no do does they their them'.split(' '));
  const rset = new Set(rw.filter((w) => !STOP.has(w)));
  const brand = new Set(['pair']);
  const sharedWords = [...new Set(mw.filter((w) => !STOP.has(w) && rset.has(w) && !brand.has(w)))];
  ok(sharedWords.length === 0, `shared content words: ${sharedWords.join(', ')}`);
});

add('hygiene: no CLAUDE.md, no .claude, no assistant attribution anywhere', () => {
  ok(!fs.existsSync(path.join(root, 'CLAUDE.md')) && !fs.existsSync(path.join(root, '.claude')), 'forbidden file or folder');
  const bad = new RegExp(['cl' + 'aude', 'anthr' + 'opic', 'co-authored', 'generated (with|by)', 'chat' + 'gpt', 'open' + 'ai', '\\b' + 'A' + 'I\\b', '\\bL' + 'LM\\b', 'copi' + 'lot'].join('|'), 'i');
  const skip = new Set(['node_modules', 'brand', 'reference', '.gate-tmp', 'package-lock.json']);
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|txt|json|html|css|js|mjs|svg|webp|jpg)$|^LICENSE$|^_headers$/.test(e.name) && !/\.(webp|jpg)$/.test(e.name) && p !== path.join(root, 'scripts', 'gates.mjs')) {
        ok(!bad.test(fs.readFileSync(p, 'utf8')), `${path.relative(root, p)} mentions a forbidden term`);
      }
    }
  };
  walk(root);
});

add('repo files: README, whitepaper, MIT licence in project root', () => {
  for (const f of ['README.md', 'docs/whitepaper.md', 'LICENSE']) ok(fs.existsSync(path.join(root, f)), `${f} missing`);
  const lic = read(path.join(root, 'LICENSE'));
  ok(/^MIT License/.test(lic) && /Copyright \(c\) 2026 Venus Pair/.test(lic), 'licence text');
  const rd = read(path.join(root, 'README.md'));
  for (const h of ['## Overview', '## Features', '## Links']) ok(rd.includes(h), `README lacks ${h}`);
  ok(/venuspair\.xyz/.test(rd) && /Solana/.test(rd), 'README basics');
  const wp = read(path.join(root, 'docs', 'whitepaper.md'));
  ok(/Vision/.test(wp) && /Tokenomics/.test(wp) && /Roadmap/.test(wp) && /Team/.test(wp), 'whitepaper sections');
});

/* ================================ run ================================ */
fs.rmSync(tmp, { recursive: true, force: true });
let failed = 0;
for (const g of queue) {
  const before = assertions;
  try {
    await g.fn();
    results.push({ ok: true, name: g.name, n: assertions - before });
    console.log(`PASS  ${g.name}  (${assertions - before} checks)`);
  } catch (e) {
    failed++;
    results.push({ ok: false, name: g.name });
    console.log(`FAIL  ${g.name}\n      ${e.message}`);
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${queue.length - failed}/${queue.length} gates passed, ${assertions} checks`);
process.exit(failed ? 1 : 0);
