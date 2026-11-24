// Fail-closed self-audit of the built site in dist/.
//
//   node scripts/check.mjs                      audit dist/
//   node scripts/check.mjs --max-age-min=60     also fail if the data is older
//   node scripts/check.mjs --dir=some/folder    audit another build folder
//
// Exits 1 on any failure. Used in CI between build and deploy, so a build that
// breaks one of the bounty's rules is never published.
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR_ARG = process.argv.slice(2).find((x) => x.startsWith('--dir='));
const DIST = DIR_ARG ? join(process.cwd(), DIR_ARG.slice(6)) : join(ROOT, 'dist');
const ROUTES = [
  { key: 'overview', file: 'index.html' },
  { key: 'flows', file: 'flows/index.html' },
  { key: 'concentration', file: 'concentration/index.html' },
  { key: 'chains', file: 'chains/index.html' },
  { key: 'activity', file: 'activity/index.html' },
];
const DISCLAIMER = 'Made for a paid Taskmarket bounty (TSK-BRK611AN). Not an official Taskmarket product.';
const API_HOST = 'api.taskmarket.dev';
// Banned everywhere in generated HTML, JS and JSON.
const BANNED = ['revolutionary', 'game-changing', 'future of work', 'insane', '10x', 'passive income', 'earn while you sleep', 'get rich', 'guaranteed', 'price prediction', 'airdrop', 'token launch', 'AI will replace', 'to the moon'];
// The rest of the brand kit's list, checked against the words a reader sees.
const BANNED_VISIBLE = ['profit', 'returns', 'investment', 'moon'];
const TRACKERS = ['window.ethereum', 'gtag', 'google-analytics', 'googletagmanager', 'plausible', 'mixpanel', 'segment', 'requesterDisplayName', 'workerDisplayName', 'walletconnect', 'eth_requestAccounts', 'document.cookie', 'localStorage', 'sendBeacon'];
const BRAND_COLORS = new Set(['#12100E', '#3A1420', '#221E1A', '#453E37', '#EFE9E2', '#FFF6E8', '#B0A79D', '#E74079', '#D9A097']);
const BRAND_RGB = new Set(['18,16,14', '58,20,32', '34,30,26', '69,62,55', '239,233,226', '255,246,232', '176,167,157', '231,64,121', '217,160,151']);
const MAX_ROUTE_GZIP_KB = 450; // everything a phone downloads for one route

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const results = [];
const pass = (name, detail = '') => results.push({ ok: true, name, detail });
const fail = (name, detail = '') => results.push({ ok: false, name, detail });
const check = (ok, name, detail = '') => (ok ? pass(name, detail) : fail(name, detail));

async function walk(dir, base = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...await walk(join(dir, e.name), base ? `${base}/${e.name}` : e.name));
    else out.push(base ? `${base}/${e.name}` : e.name);
  }
  return out;
}
const wordRe = (w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i');
const stripScripts = (html) => html.replace(/<script\b[\s\S]*?<\/script>/gi, ' ');
const visibleText = (html) => stripScripts(html).replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
const pngSize = (buf) => (buf.length > 24 && buf.toString('latin1', 1, 4) === 'PNG' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null);
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;
const sum = (list, fn = (x) => x) => list.reduce((acc, x) => acc + fn(x), 0);

let files;
try { files = await walk(DIST); } catch { console.error('check: dist/ not found. Run "npm run build" first.'); process.exit(1); }
const text = new Map();
for (const f of files) if (['.html', '.mjs', '.css', '.json', '.txt', '.xml'].includes(extname(f))) text.set(f, await readFile(join(DIST, f), 'utf8'));
const htmlFiles = [...text.keys()].filter((f) => f.endsWith('.html'));
const jsFiles = [...text.keys()].filter((f) => f.endsWith('.mjs'));
const jsonFiles = [...text.keys()].filter((f) => f.endsWith('.json'));
const copyFiles = [...htmlFiles, ...jsFiles, ...jsonFiles];

// ---------- 1. the browser never calls the API ----------
{
  const hits = [];
  for (const f of jsFiles) if (text.get(f).includes(API_HOST)) hits.push(f);
  for (const f of htmlFiles) {
    const html = text.get(f);
    for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (m[1].includes(API_HOST)) hits.push(`${f} (inline script)`);
    for (const m of html.matchAll(/\b(?:src|href|action)\s*=\s*"([^"]*)"/gi)) if (m[1].includes(API_HOST)) hits.push(`${f} (${m[1]})`);
  }
  // The per-view data files the browser loads carry no API address either.
  for (const r of ROUTES) if ((text.get(`data/${r.key}.json`) || '').includes(API_HOST)) hits.push(`data/${r.key}.json`);
  check(!hits.length, '1. No api.taskmarket.dev in browser JS, inline scripts, links or view data', hits.join(', '));

  const external = [];
  for (const f of jsFiles) for (const m of text.get(f).matchAll(/https?:\/\/[^\s'"`)]+/g)) if (!m[0].startsWith('https://taskmarket.dev/tasks/') && !m[0].startsWith('http://www.w3.org/')) external.push(`${f}: ${m[0]}`);
  check(!external.length, '1b. Browser JS references no other origin (only links to taskmarket.dev task pages)', external.join(', '));

  const remote = [];
  for (const f of htmlFiles) for (const m of text.get(f).matchAll(/<(script|link|img|iframe|source|video|audio)\b[^>]*?\b(?:src|href)\s*=\s*"(https?:)?\/\/[^"]*"[^>]*>/gi)) {
    if (/rel="canonical"/.test(m[0])) continue;
    if (m[1].toLowerCase() === 'link' && /assets\/styles\.css"/.test(m[0]) && f === '404.html') continue; // absolute so it works at any depth
    if (m[1].toLowerCase() === 'img' && /assets\/brand\/taskmarket-lockup\.png"/.test(m[0]) && f === '404.html') continue;
    remote.push(`${f}: ${m[0].slice(0, 90)}`);
  }
  check(!remote.length, '1c. No remote scripts, stylesheets, fonts, images or frames', remote.join(' | '));
  const csp = ROUTES.every((r) => /Content-Security-Policy[^>]+connect-src 'self'/.test(text.get(r.file) || ''));
  check(csp, "1d. Every route ships a Content-Security-Policy with connect-src 'self'");
}

// ---------- 2. banned words ----------
{
  const hits = [];
  for (const f of copyFiles) for (const w of BANNED) if (wordRe(w).test(text.get(f))) hits.push(`${f}: "${w}"`);
  check(!hits.length, `2. None of the ${BANNED.length} banned phrases in generated HTML, JS or JSON`, hits.join(', '));
  const vis = [];
  for (const f of htmlFiles) { const t = visibleText(text.get(f)); for (const w of BANNED_VISIBLE) if (wordRe(w).test(t)) vis.push(`${f}: "${w}"`); }
  check(!vis.length, '2b. None of the remaining brand-kit banned words in visible page text', vis.join(', '));
  const shout = [];
  for (const f of htmlFiles) { const t = visibleText(text.get(f)); if (/!\s*!/.test(t)) shout.push(`${f}: exclamation chain`); }
  check(!shout.length, '2c. No exclamation-mark chains', shout.join(', '));
}

// ---------- 3. no wallet connection, analytics or tracking ----------
{
  const hits = [];
  for (const f of copyFiles) { const lower = text.get(f).toLowerCase(); for (const w of TRACKERS) if (lower.includes(w.toLowerCase())) hits.push(`${f}: "${w}"`); }
  check(!hits.length, '3. No wallet-connect, analytics, tracking, cookie or display-name strings', hits.join(', '));
  const names = [];
  for (const f of jsonFiles) if (/"(description|title|taskTitle|tags|displayName|agentId)"\s*:/i.test(text.get(f))) names.push(f);
  check(!names.length, '3b. Data files carry no free text, names or agent ids', names.join(', '));
  const fullHex = [];
  for (const r of ROUTES) { const m = visibleText(text.get(r.file) || '').match(/0x[0-9a-fA-F]{40}\b/); if (m) fullHex.push(`${r.file}: ${m[0]}`); }
  check(!fullHex.length, '3c. Pages show wallets as truncated hex only', fullHex.join(', '));
}

// ---------- 4. routes, disclaimer, data-as-of, share cards ----------
let asOfLabel = null;
{
  const market = JSON.parse(text.get('data/market.json') || '{}');
  asOfLabel = market.meta?.dataAsOfLabel;
  const seenOg = new Set();
  for (const r of ROUTES) {
    const html = text.get(r.file);
    if (!html) { fail(`4. Route ${r.file} exists`); continue; }
    const problems = [];
    const body = visibleText(html.slice(html.indexOf('<body')));
    if (!body.replace(/\s+/g, ' ').includes(DISCLAIMER)) problems.push('footer disclaimer missing or altered');
    if (!/<footer\b[\s\S]*Made for a paid Taskmarket bounty[\s\S]*<\/footer>/.test(html)) problems.push('disclaimer is not in the footer');
    if (!asOfLabel || !body.replace(/\s+/g, ' ').includes(`Data as of ${asOfLabel}`)) problems.push('visible "Data as of" missing or not the snapshot time');
    if (!/taskmarket-lockup\.png/.test(html)) problems.push('lockup missing');
    if (!/href="https:\/\/taskmarket\.dev"/.test(html)) problems.push('taskmarket.dev link missing');
    if (!/#methods"/.test(html) && !/id="methods"/.test(html)) problems.push('methods link missing');
    if (!/LICENSE\.txt"/.test(html)) problems.push('licence link missing');
    if ((html.match(/<h1\b/g) || []).length !== 1) problems.push('expected exactly one headline');
    if ((html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/)?.[0].match(/<em>/g) || []).length !== 1) problems.push('headline needs exactly one accent word');
    const meta = (prop) => html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`))?.[1];
    const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
    if (!canonical || !/^https:\/\//.test(canonical)) problems.push('canonical URL missing or not https');
    for (const p of ['og:title', 'og:description', 'og:url', 'og:image', 'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) if (!meta(p)) problems.push(`${p} missing`);
    if (meta('twitter:card') !== 'summary_large_image') problems.push('twitter:card is not summary_large_image');
    if (meta('og:url') !== canonical) problems.push('og:url differs from canonical');
    for (const p of ['og:image', 'twitter:image']) {
      const url = meta(p) || '';
      const m = url.match(/^https:\/\/[^?#]+\/og\/([a-z]+)\.png(?:\?.*)?$/);
      if (!m) { problems.push(`${p} is not an absolute https URL into og/`); continue; }
      if (m[1] !== r.key) problems.push(`${p} points at ${m[1]}.png, expected ${r.key}.png`);
      let size = null;
      try { size = pngSize(await readFile(join(DIST, 'og', `${m[1]}.png`))); } catch { /* reported below */ }
      if (!size) problems.push(`og/${m[1]}.png missing or not a PNG`);
      else if (size.w !== 1200 || size.h !== 630) problems.push(`og/${m[1]}.png is ${size.w}x${size.h}, expected 1200x630`);
      seenOg.add(m[1]);
    }
    check(!problems.length, `4. /${r.file.replace('index.html', '')} has disclaimer, data-as-of, canonical and its own 1200x630 share card`, problems.join('; '));
  }
  check(seenOg.size === ROUTES.length, '4b. Five distinct share cards, one per route', [...seenOg].join(', '));
  for (const f of ['.nojekyll', 'LICENSE.txt', '404.html', 'data/verify.json', 'data/meta.json', 'assets/brand/taskmarket-lockup.png']) {
    try { await stat(join(DIST, f)); } catch { fail(`4c. dist/${f} exists`); }
  }
  check(/MIT License/.test(text.get('LICENSE.txt') || ''), '4c. MIT licence is shipped with the site');
  const activity = text.get('activity/index.html') || '';
  const endpoints = ['/api/market/stats', '/api/stats/breakdowns', '/api/stats/platform-time-series', '/api/stats/activity-heatmap', '/api/stats/activity-feed', '/api/tasks'];
  const missing = endpoints.filter((e) => !activity.includes(e));
  check(!missing.length, '4d. Methods note names all six endpoints', missing.join(', '));
}

// ---------- 5. reconciliation ----------
{
  const market = JSON.parse(text.get('data/market.json'));
  const verify = JSON.parse(text.get('data/verify.json'));
  const rec = verify.reconciliation;
  const failed = verify.checks.filter((c) => c.level === 'required' && !c.pass).map((c) => c.name);
  check(verify.allRequiredPass && !failed.length, `5. All required build-time checks pass (${verify.checks.filter((c) => c.pass).length} of ${verify.checks.length} checks green)`, failed.join('; '));

  // Recount straight from the published task tuples: nothing is taken on trust.
  const tasks = market.swarm.tasks;
  const F = Object.fromEntries(market.swarm.fields.map((k, i) => [k, i]));
  const status = {}, mode = {};
  for (const t of tasks) { status[t[F.status]] = (status[t[F.status]] || 0) + 1; mode[t[F.mode]] = (mode[t[F.mode]] || 0) + 1; }
  const bd = Object.fromEntries(market.breakdowns.platform.status.map((r) => [r.key, r.count]));
  const bm = Object.fromEntries(market.breakdowns.platform.mode.map((r) => [r.key, r.count]));
  const over = [...Object.keys(status).filter((k) => status[k] > (bd[k] || 0)), ...Object.keys(mode).filter((k) => mode[k] > (bm[k] || 0))];
  check(!over.length, '5b. Public task list never exceeds the breakdown, for any status or mode', over.join(', '));
  const bdTotal = sum(Object.values(bd));
  const deltaStatus = sum(Object.keys(bd), (k) => bd[k] - (status[k] || 0));
  const deltaMode = sum(Object.keys(bm), (k) => bm[k] - (mode[k] || 0));
  check(tasks.length === rec.publicTasks && bdTotal === rec.breakdownTasks && deltaStatus === rec.unlistedTasks && deltaMode === rec.unlistedTasks && rec.unlistedTasks === bdTotal - tasks.length && rec.unlistedTasks >= 0,
    `5c. ${tasks.length} public tasks + ${rec.unlistedTasks} not listed = ${bdTotal} in the breakdown, by status and by mode`,
    `tasks=${tasks.length} breakdown=${bdTotal} deltaStatus=${deltaStatus} deltaMode=${deltaMode} reported=${rec.unlistedTasks}`);
  for (const s of ['completed', 'expired', 'cancelled', 'pending_approval', 'open']) {
    const d = (bd[s] || 0) - (status[s] || 0);
    check(d >= 0 && d === (rec.unlistedByStatus[s] || 0), `5d. Status ${s}: breakdown ${bd[s] || 0}, public list ${status[s] || 0}, not listed ${d}`);
  }
  const methodsText = visibleText(text.get('activity/index.html') || '').replace(/\s+/g, ' ');
  const n = (v) => Number(v).toLocaleString('en-US');
  check(methodsText.includes(`That gave ${n(rec.publicTasks)} public tasks`) && methodsText.includes(`reports ${n(rec.breakdownTasks)} tasks in total`),
    '5e. Methods note states the public-list count and the breakdown count');

  const usdTotal = sum(tasks, (t) => Math.round(t[F.rewardUsd] * 1e6)) / 1e6;
  const scopes = { all: () => true, tempo: (t) => t[F.chainId] === 4217, base: (t) => t[F.chainId] === 8453 };
  for (const [key, keep] of Object.entries(scopes)) {
    const sk = market.sankey[key];
    const expected = sum(tasks.filter(keep), (t) => Math.round(t[F.rewardUsd] * 1e6)) / 1e6;
    const paid = sk.gates.find((g) => g.key === 'paid').usd;
    const ok = near(sk.totalUsd, expected) && near(sum(sk.posters, (p) => p.usd), expected) && near(sum(sk.gates, (g) => g.usd), expected)
      && near(sum(sk.linksIn, (l) => l[2]), expected) && near(sum(sk.winners, (w) => w.usd), paid) && near(sum(sk.linksOut, (l) => l[2]), paid)
      && sum(sk.posters, (p) => p.tasks) === tasks.filter(keep).length && sum(sk.gates, (g) => g.tasks) === tasks.filter(keep).length;
    check(ok, `5f. Flow river (${key}): posters = outcomes = links = $${expected.toFixed(2)} escrowed; winners = paid $${paid.toFixed(2)}`,
      `total=${sk.totalUsd} posters=${sum(sk.posters, (p) => p.usd)} gates=${sum(sk.gates, (g) => g.usd)} links=${sum(sk.linksIn, (l) => l[2])}`);
  }
  check(near(market.sankey.all.totalUsd, usdTotal) && near(market.sankey.tempo.totalUsd + market.sankey.base.totalUsd, usdTotal), '5g. Tempo + Base flow totals equal the all-chain total');
  const weeks = market.weeklyPosters.weeks;
  check(weeks.length > 0 && weeks.every((w) => w.combined <= w.tempo + w.base && w.combined >= Math.max(w.tempo, w.base)), '5h. Weekly posters: combined is between max(Tempo, Base) and Tempo + Base every week');
  const h = market.headlines;
  check(h.allPlatformIdentical, '5i. Platform-wide headline numbers are identical for both chainIds, so they are shown once');
}

// ---------- 6. brand ----------
{
  const off = new Set();
  for (const f of [...jsFiles, ...htmlFiles, 'assets/styles.css']) {
    const src = text.get(f) || '';
    for (const m of src.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g)) {
      if (/^#[0-9a-fA-F]{3}$/.test(m[0]) && !f.endsWith('.css')) continue; // short hex-looking anchors in text
      if (!BRAND_COLORS.has(m[0].toUpperCase())) off.add(`${f}: ${m[0]}`);
    }
    for (const m of src.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) if (!BRAND_RGB.has(`${m[1]},${m[2]},${m[3]}`)) off.add(`${f}: ${m[0]})`);
  }
  check(!off.size, '6. Only the nine brand-kit colours are used in CSS, JS and HTML', [...off].join(', '));
  const css = text.get('assets/styles.css') || '';
  const families = new Set([...css.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]));
  check(families.size === 3 && ['Instrument Serif', 'Inter Tight', 'Departure Mono'].every((f) => families.has(f)), '6b. Only the three brand faces are declared, all self-hosted', [...families].join(', '));
  check(!/fonts\.googleapis|fonts\.gstatic|use\.typekit|cdn\./i.test([...text.values()].join('\n')), '6c. No font or script CDN anywhere');
}

// ---------- 7. weight and freshness ----------
{
  const gz = async (f) => gzipSync(await readFile(join(DIST, f))).length;
  const raw = async (f) => (await stat(join(DIST, f))).size;
  const shared = (await gz('assets/styles.css')) + (await gz('assets/app.mjs')) + (await gz('assets/viz-core.mjs'))
    + sum(await Promise.all(files.filter((f) => f.startsWith('assets/fonts/')).map(raw))) + (await raw('assets/brand/taskmarket-lockup.png'));
  const heavy = [];
  const sizes = [];
  for (const r of ROUTES) {
    const html = text.get(r.file);
    const mods = [...html.matchAll(/modulepreload" href="[^"]*assets\/(viz-[a-z]+\.mjs)"/g)].map((m) => m[1]).filter((m) => m !== 'viz-core.mjs');
    let total = shared + (await gz(r.file)) + (await gz(`data/${r.key}.json`));
    for (const m of mods) total += await gz(`assets/${m}`);
    sizes.push(`${r.key} ${(total / 1024).toFixed(0)} KB`);
    if (total / 1024 > MAX_ROUTE_GZIP_KB) heavy.push(`${r.key} ${(total / 1024).toFixed(0)} KB`);
  }
  check(!heavy.length, `7. Each route's full first load is under ${MAX_ROUTE_GZIP_KB} KB gzipped (${sizes.join(', ')})`, heavy.join(', '));
  if (args['max-age-min']) {
    const meta = JSON.parse(text.get('data/meta.json'));
    const age = (Date.now() - Date.parse(meta.dataAsOf)) / 60000;
    check(age <= Number(args['max-age-min']), `7b. Data is ${age.toFixed(1)} minutes old (limit ${args['max-age-min']})`);
  }
}

// ---------- report ----------
const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '  ok  ' : ' FAIL '} ${r.name}${!r.ok && r.detail ? `\n        ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, 0 warnings. Data as of ${asOfLabel}.`);
process.exit(failed.length ? 1 : 0);
