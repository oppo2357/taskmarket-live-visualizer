// Renders the five 1200 x 630 share cards into dist/og/ with resvg.
//
//   node scripts/generate-og.mjs        -> uses dist/data/market.json
//   import { generateOg } from './generate-og.mjs'
//
// Each card follows the brand kit's checklist: the lockup (unchanged) and
// taskmarket.dev in Departure Mono, warm black with the maroon glow top-right,
// only the three brand faces and nine brand colours, one serif headline with
// one magenta italic word. The figures are the live numbers from the snapshot,
// with the "data as of" time and the not-official line on every card.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = join(ROOT, 'assets', 'brand');
const C = { ground: '#12100E', maroon: '#3A1420', panel: '#221E1A', line: '#453E37', cream: '#EFE9E2', paper: '#FFF6E8', muted: '#B0A79D', magenta: '#E74079', salmon: '#D9A097' };
const W = 1200, H = 630, PAD = 64;
const SERIF = 'Instrument Serif', SANS = 'Inter Tight', MONO = 'Departure Mono';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const int = (v) => Number(v).toLocaleString('en-US');
const usd = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = (x, y, str, { size = 18, family = SANS, fill = C.cream, anchor = 'start', weight = 500 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${family === SANS ? weight : 400}" fill="${fill}" text-anchor="${anchor}">${esc(str)}</text>`;
const mono = (x, y, str, o = {}) => text(x, y, str, { family: MONO, ...o });

/** A number with its label underneath. */
function stat(x, y, value, label, { size = 44, sub } = {}) {
  return mono(x, y, value, { size }) + text(x, y + 30, label, { size: 18, fill: C.muted }) + (sub ? mono(x, y + 54, sub, { size: 14, fill: C.muted }) : '');
}

function frame({ headline, asOf, lockup, body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><radialGradient id="glow" cx="${W}" cy="0" r="820" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${C.maroon}"/><stop offset="0.35" stop-color="${C.maroon}" stop-opacity="0.6"/><stop offset="1" stop-color="${C.ground}" stop-opacity="0"/></radialGradient></defs>
<rect width="${W}" height="${H}" fill="${C.ground}"/><rect width="${W}" height="${H}" fill="url(#glow)"/>
<image x="${PAD}" y="50" width="360" height="${(360 * 176 / 971).toFixed(2)}" xlink:href="${lockup}" href="${lockup}"/>
${mono(W - PAD, 92, 'taskmarket.dev', { size: 22, anchor: 'end' })}
<text x="${PAD}" y="226" font-family="${SERIF}" font-size="84" fill="${C.cream}" letter-spacing="-1">${esc(headline[0])}<tspan font-style="italic" fill="${C.magenta}">${esc(headline[1])}</tspan></text>
${body}
<rect x="${PAD}" y="560" width="${W - PAD * 2}" height="1" fill="${C.line}"/>
${mono(PAD, 595, `Data as of ${asOf}`, { size: 17, fill: C.muted })}
${text(W - PAD, 595, 'Not an official Taskmarket product', { size: 17, fill: C.muted, anchor: 'end' })}
</svg>`;
}

// ---------- card bodies ----------
function outcomeOf(status, open) {
  if (status === 'completed') return 'paid';
  if (status === 'open') return open ? 'live' : 'stale';
  if (status === 'expired' || status === 'cancelled') return 'died';
  return 'progress';
}

/** A strip of the real swarm: every public task as a tile, reward up, submissions right. */
function swarmStrip(m, x0, y0, w, h) {
  const cell = 6, tile = 4.6;
  const cols = Math.floor(w / cell), rows = Math.floor(h / cell);
  const tasks = m.swarm.tasks.map((t) => ({ id: t[0], usd: t[6], subs: t[7], o: outcomeOf(t[3], t[4]) }));
  const maxSubs = Math.max(1, ...tasks.map((t) => t.subs)), maxUsd = Math.max(1, ...tasks.map((t) => t.usd));
  const zero = Math.round(cols * 0.1);
  const xCol = (s) => (s <= 0 ? (zero - 1) / 2 : zero + 1 + (Math.log(s) / Math.log(maxSubs * 1.08)) * (cols - zero - 2));
  const yTop = Math.log10(maxUsd * 1.25), yBot = Math.log10(0.01);
  const yRow = (u) => ((yTop - Math.log10(Math.max(0.01, u))) / (yTop - yBot)) * (rows - 1);
  const offsets = [];
  for (let dx = -60; dx <= 60; dx++) for (let dy = -rows; dy <= rows; dy++) offsets.push([dx, dy, dx * dx + dy * dy]);
  offsets.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  const order = ['live', 'stale', 'progress', 'paid', 'died'];
  const taken = new Uint8Array(cols * rows);
  const fill = { live: C.paper, stale: C.salmon, progress: C.muted, paid: C.cream, died: C.line };
  const opacity = { live: 1, stale: 0.95, progress: 0.8, paid: 0.5, died: 1 };
  let out = '';
  for (const t of [...tasks].sort((a, b) => order.indexOf(a.o) - order.indexOf(b.o) || b.subs - a.subs || (a.id < b.id ? -1 : 1))) {
    const cx = Math.round(xCol(t.subs)), cy = Math.round(yRow(t.usd));
    const lo = t.subs <= 0 ? 0 : zero + 1, hi = t.subs <= 0 ? zero - 1 : cols - 1;
    for (const [dx, dy] of offsets) {
      const x = cx + dx, y = cy + dy;
      if (x < lo || x > hi || y < 0 || y >= rows || taken[y * cols + x]) continue;
      taken[y * cols + x] = 1;
      out += `<rect x="${(x0 + x * cell).toFixed(1)}" y="${(y0 + y * cell).toFixed(1)}" width="${tile}" height="${tile}" rx="1.3" fill="${fill[t.o]}" fill-opacity="${opacity[t.o]}"/>`;
      break;
    }
  }
  return out;
}

function overviewCard(m) {
  const p = m.headlines.platform, col = (W - PAD * 2) / 4;
  return [
    stat(PAD, 304, int(p.registeredWorkers), 'Registered workers'),
    stat(PAD + col, 304, int(p.activeAgents7d), 'Active agents, 7 days'),
    stat(PAD + col * 2, 304, int(p.openTasks), 'Open tasks'),
    stat(PAD + col * 3, 304, int(m.meta.publicTasks), 'Public tasks, both chains'),
    mono(PAD, 372, 'every public task · reward ↑ · submissions →', { size: 13, fill: C.muted }),
    swarmStrip(m, PAD, 386, W - PAD * 2, 156),
  ].join('\n');
}

function flowsCard(m) {
  const all = m.sankey.all, g = Object.fromEntries(all.gates.map((x) => [x.key, x]));
  const col = (W - PAD * 2) / 4;
  const segs = [['paid', C.cream], ['live', C.paper], ['stale', C.salmon], ['progress', C.muted], ['died', C.line]];
  const barW = W - PAD * 2, gap = 4;
  const usable = barW - gap * (segs.filter(([k]) => g[k].usd > 0).length - 1);
  let x = PAD, bar = '';
  for (const [k, fill] of segs) {
    if (!(g[k].usd > 0)) continue;
    const w = Math.max(3, (g[k].usd / all.totalUsd) * usable);
    bar += `<rect x="${x.toFixed(1)}" y="412" width="${w.toFixed(1)}" height="46" rx="7" fill="${fill}"${k === 'died' ? ` stroke="${C.muted}" stroke-width="1"` : ''}/>`;
    if (w > 70) bar += mono(x + 2, 482, `${g[k].label.toLowerCase()} ${((g[k].usd / all.totalUsd) * 100).toFixed(1)}%`, { size: 13, fill: C.muted });
    x += w + gap;
  }
  return [
    stat(PAD, 304, usd(g.paid.usd), 'Paid: completed tasks', { size: 38 }),
    stat(PAD + col, 304, usd(g.live.usd), 'Live open', { size: 38 }),
    stat(PAD + col * 2, 304, usd(g.stale.usd), 'Past deadline, undecided', { size: 38 }),
    stat(PAD + col * 3, 304, usd(g.died.usd), 'Died: expired or cancelled', { size: 38 }),
    bar,
    text(PAD, 528, `${usd(all.totalUsd)} put up in ${int(all.totalTasks)} public tasks by ${int(all.posterWallets)} wallets, traced from poster to winner.`, { size: 20, fill: C.cream }),
  ].join('\n');
}

function concentrationCard(m) {
  const c = m.concentration, weeks = m.weeklyPosters.weeks;
  const x1 = 640, cw = W - PAD - x1, ch = 150, y0 = 378;
  const max = Math.max(1, ...weeks.map((w) => w.combined));
  const band = cw / Math.max(1, weeks.length);
  const bw = Math.max(2, band - 4);
  const bars = weeks.map((w, i) => {
    const hh = Math.max(w.combined ? 2 : 0, (w.combined / max) * ch);
    return `<rect x="${(x1 + i * band + 2).toFixed(1)}" y="${(y0 + ch - hh).toFixed(1)}" width="${bw.toFixed(1)}" height="${hh.toFixed(1)}" rx="${Math.min(3, bw / 2).toFixed(1)}" fill="${C.cream}" fill-opacity="${w.partial ? 0.4 : 1}"/>`;
  }).join('');
  const full = weeks.filter((w) => !w.partial).at(-1);
  return [
    stat(PAD, 318, `${c.tempo.top3.usdPct}%`, 'Tempo: top 3 posters, share of dollars', { size: 56, sub: `${int(c.tempo.posters)} wallets · Gini ${c.tempo.giniUsd.toFixed(3)}` }),
    stat(PAD, 462, `${c.base.top3.usdPct}%`, 'Base: top 3 posters, share of dollars', { size: 56, sub: `${int(c.base.posters)} wallets · Gini ${c.base.giniUsd.toFixed(3)}` }),
    text(x1, 304, 'Distinct task posters per week', { size: 20 }),
    mono(x1, 330, full ? `${int(full.combined)} wallets in the week of ${full.week}` : '', { size: 14, fill: C.muted }),
    mono(x1, 352, `peak ${int(max)} · ${weeks.length} weeks · both chains`, { size: 14, fill: C.muted }),
    bars,
    `<rect x="${x1}" y="${y0 + ch + 1}" width="${cw}" height="1" fill="${C.line}"/>`,
  ].join('\n');
}

function chainsCard(m) {
  const panel = (x, ch, swatch) => {
    const w = (W - PAD * 2 - 24) / 2;
    const rows = [
      ['Public tasks', int(ch.tasks)],
      ['Rewards put up', usd(ch.usd)],
      ['Completed', `${ch.completedPct}%`],
      ['Died', `${ch.diedPct}%`],
      ['Paid workers', int(ch.paidWorkers)],
    ];
    return `<rect x="${x}" y="262" width="${w}" height="278" rx="14" fill="${C.panel}" stroke="${C.line}"/>
<rect x="${x + 24}" y="287" width="14" height="14" rx="4" fill="${swatch}"/>
${text(x + 48, 301, ch.name, { size: 24, weight: 600 })}${mono(x + w - 24, 300, `${ch.token} · chainId ${ch.chainId}`, { size: 14, fill: C.muted, anchor: 'end' })}
${rows.map(([k, v], i) => `${text(x + 24, 346 + i * 42, k, { size: 19, fill: C.muted })}${mono(x + w - 24, 346 + i * 42, v, { size: 24, anchor: 'end' })}${i < rows.length - 1 ? `<rect x="${x + 24}" y="${360 + i * 42}" width="${w - 48}" height="1" fill="${C.line}"/>` : ''}`).join('\n')}`;
  };
  return panel(PAD, m.chains.tempo, C.salmon) + panel(PAD + (W - PAD * 2 - 24) / 2 + 24, m.chains.base, C.cream);
}

function activityCard(m) {
  const hm = m.heatmap['30d|hourOfWeek'] || m.heatmap['all|hourOfWeek'];
  const week = m.heatmap['7d|hourOfWeek'];
  const max = Math.max(1, ...hm.count.flat());
  const x0 = PAD + 44, y0 = 284, cell = 23, gap = 3;
  let grid = '';
  hm.rows.forEach((name, r) => {
    grid += mono(PAD, y0 + r * cell + 15, name, { size: 13, fill: C.muted });
    hm.cols.forEach((_, c) => {
      const v = hm.count[r][c];
      grid += `<rect x="${x0 + c * cell}" y="${y0 + r * cell}" width="${cell - gap}" height="${cell - gap}" rx="5" fill="${v ? C.cream : C.line}" fill-opacity="${v ? (0.07 + 0.93 * (v / max)).toFixed(3) : 0.3}"/>`;
    });
  });
  for (const hr of [0, 6, 12, 18, 23]) grid += mono(x0 + hr * cell + (cell - gap) / 2, y0 + 7 * cell + 14, String(hr).padStart(2, '0'), { size: 12, fill: C.muted, anchor: 'middle' });
  const peak = hm.peak, x1 = 700;
  const feed = m.feed, span = feed.length ? Math.max(1, Math.round((Date.parse(feed[0].ts) - Date.parse(feed.at(-1).ts)) / 60000)) : 0;
  return [
    grid,
    mono(x0 + 24 * cell - gap, y0 - 10, 'hour of week · UTC · last 30 days', { size: 12, fill: C.muted, anchor: 'end' }),
    stat(x1, 316, int(week.total), 'Events in the last 7 days', { size: 44 }),
    stat(x1, 412, peak ? `${hm.rows[peak.row]} ${String(hm.cols[peak.col]).padStart(2, '0')}:00` : 'n/a', 'Busiest hour of the week, UTC, 30 days', { size: 44 }),
    stat(x1, 508, `${int(feed.length)} in ${int(span)} min`, 'Span of the latest events in the feed', { size: 34 }),
  ].join('\n');
}

export const OG_CARDS = [
  { key: 'overview', headline: ['The live market, in ', 'motion.'], body: overviewCard },
  { key: 'flows', headline: ['Where escrow actually ', 'goes.'], body: flowsCard },
  { key: 'concentration', headline: ['Who posts the ', 'work.'], body: concentrationCard },
  { key: 'chains', headline: ['Two chains, two ', 'markets.'], body: chainsCard },
  { key: 'activity', headline: ['When the swarm ', 'moves.'], body: activityCard },
];

export async function generateOg(market, outDir, { log = () => {} } = {}) {
  await mkdir(outDir, { recursive: true });
  const lockup = `data:image/png;base64,${(await readFile(join(BRAND, 'taskmarket-lockup.png'))).toString('base64')}`;
  const fontFiles = ['InstrumentSerif-Regular.ttf', 'InstrumentSerif-Italic.ttf', 'InterTight-Variable.ttf', 'DepartureMono-Regular.otf'].map((f) => join(BRAND, f));
  const written = [];
  for (const card of OG_CARDS) {
    const svg = frame({ headline: card.headline, asOf: market.meta.dataAsOfLabel, lockup, body: card.body(market) });
    const png = new Resvg(svg, {
      fitTo: { mode: 'width', value: W },
      font: { fontFiles, loadSystemFonts: false, defaultFontFamily: SANS },
      background: C.ground,
    }).render().asPng();
    const file = join(outDir, `${card.key}.png`);
    await writeFile(file, png);
    written.push({ file, bytes: png.length });
    log(`[og] ${card.key}.png ${(png.length / 1024).toFixed(0)} KB`);
  }
  return written;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const market = JSON.parse(await readFile(join(ROOT, 'dist', 'data', 'market.json'), 'utf8'));
  await generateOg(market, join(ROOT, 'dist', 'og'), { log: console.log });
}
