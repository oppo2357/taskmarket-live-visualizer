// Who posts the work: distinct posters per week, the Lorenz curve of reward
// dollars by poster, and the top posting wallets (truncated hex only).
import { svg, h, clear, fmtInt, fmtUsd, fmtPct, niceMax, linear, tableView, responsive, showTip, hideTip, COLOR } from './viz-core.mjs';

// ---------- distinct task posters per week ----------
export function weeklyPosters(root, d) {
  const weeks = d.weeklyPosters.weeks;
  const card = h('div', { class: 'card viz' });
  const plot = h('div');
  const full = weeks.filter((w) => !w.partial);
  const last = full.at(-1), peak = [...weeks].sort((a, b) => b.combined - a.combined)[0];
  card.append(
    h('div', { class: 'legend', style: 'margin:0 0 12px' },
      h('span', {}, h('i', { class: 'sw tempo' }), 'Tempo'),
      h('span', {}, h('i', { class: 'sw base' }), 'Base'),
      h('span', {}, h('i', { class: 'sw combined' }), 'Both chains, each wallet counted once')),
    plot,
    h('p', { class: 'note', text: `${d.weeklyPosters.note}${last ? ` Last full week (${last.week}): ${fmtInt(last.combined)} wallets, ${fmtInt(last.firstTime)} of them posting for the first time.` : ''}${peak ? ` Busiest week: ${peak.week}, ${fmtInt(peak.combined)} wallets.` : ''} The lighter bars on the right are the week still in progress.` }),
    tableView('Table view of every week', [
      { label: 'Week starting (UTC)', get: (w) => `${w.week}${w.partial ? ' (so far)' : ''}` },
      { label: 'Both chains', get: (w) => w.combined, fmt: fmtInt },
      { label: 'Tempo', get: (w) => w.tempo, fmt: fmtInt },
      { label: 'Base', get: (w) => w.base, fmt: fmtInt },
      { label: 'First-time posters', get: (w) => w.firstTime, fmt: fmtInt },
      { label: 'Tasks on Tempo', get: (w) => w.tempoTasks, fmt: fmtInt },
      { label: 'Tasks on Base', get: (w) => w.baseTasks, fmt: fmtInt },
    ], [...weeks].reverse()));
  root.append(card);

  responsive(plot, (W) => {
    const H = W < 520 ? 240 : 300, m = { l: 30, r: 6, t: 12, b: 26 };
    const n = weeks.length;
    const scale = niceMax(Math.max(1, ...weeks.map((w) => w.combined)), 4);
    const band = (W - m.l - m.r) / Math.max(1, n);
    const y = linear(0, scale.max, H - m.b, m.t);
    const bw = Math.max(2, Math.min(14, (band - 3) / 2));
    const root$ = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Distinct wallets that posted tasks each week, for Tempo, Base and both chains combined, over ${n} weeks. The table view lists every week.` });
    for (const t of scale.ticks) {
      const yy = Math.round(y(t)) + 0.5;
      root$.append(svg('line', { class: t === 0 ? 'axis-line' : 'grid-line', x1: m.l, x2: W - m.r, y1: yy, y2: yy }), svg('text', { x: m.l - 6, y: yy + 3.5, 'text-anchor': 'end' }, String(t)));
    }
    const every = Math.ceil(n / (W < 520 ? 4 : 8));
    const combo = [];
    const hi = svg('rect', { y: m.t, height: H - m.t - m.b, width: band, fill: COLOR.cream, opacity: 0.06, display: 'none' });
    root$.append(hi);
    weeks.forEach((w, i) => {
      const cx = m.l + band * i + band / 2;
      const op = w.partial ? 0.45 : 1;
      const bar = (v, x, fill) => {
        if (!v) return;
        const top = y(v), hh = y(0) - top;
        root$.append(svg('path', { d: roundTop(x, top, bw, hh, Math.min(3, bw / 2)), fill, opacity: op }));
      };
      bar(w.tempo, cx - bw - 1, COLOR.salmon);
      bar(w.base, cx + 1, COLOR.cream);
      combo.push([cx, y(w.combined)]);
      if (i % every === 0) root$.append(svg('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, w.week.slice(5)));
    });
    root$.append(svg('path', { d: `M${combo.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('L')}`, fill: 'none', stroke: COLOR.muted, 'stroke-width': 1.2 }));
    combo.forEach((p) => root$.append(svg('circle', { cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: Math.min(3, Math.max(1.8, band / 5)), fill: COLOR.panel, stroke: COLOR.muted, 'stroke-width': 1.3 })));

    const pick = (ev) => {
      const box = root$.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      const i = Math.min(n - 1, Math.max(0, Math.floor((px - m.l) / band)));
      const w = weeks[i];
      hi.removeAttribute('display'); hi.setAttribute('x', m.l + band * i);
      showTip(ev.clientX, ev.clientY, `Week of ${w.week}${w.partial ? ' (so far)' : ''}`, [
        ['Both chains', fmtInt(w.combined)], ['Tempo', fmtInt(w.tempo)], ['Base', fmtInt(w.base)],
        ['First-time posters', fmtInt(w.firstTime)], ['Tasks posted', fmtInt(w.tempoTasks + w.baseTasks)],
      ]);
    };
    root$.addEventListener('pointermove', pick);
    root$.addEventListener('pointerdown', pick);
    root$.addEventListener('pointerleave', () => { hi.setAttribute('display', 'none'); hideTip(); });
    clear(plot).append(root$);
  });
}

/** A bar with rounded top corners, flat on the baseline. */
function roundTop(x, y, w, hh, r) {
  r = Math.min(r, hh);
  return `M${x.toFixed(1)},${(y + hh).toFixed(1)}V${(y + r).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)}H${(x + w - r).toFixed(1)}Q${(x + w).toFixed(1)},${y.toFixed(1)} ${(x + w).toFixed(1)},${(y + r).toFixed(1)}V${(y + hh).toFixed(1)}Z`;
}

// ---------- Lorenz curve ----------
const CURVES = [
  { key: 'tempo', label: 'Tempo', color: COLOR.salmon, sw: 'tempo' },
  { key: 'base', label: 'Base', color: COLOR.cream, sw: 'base' },
];

export function lorenz(root, d) {
  const c = d.concentration;
  const plot = h('div', { class: 'viz' });
  const curveCard = h('div', { class: 'card' },
    h('h3', { text: 'Lorenz curve of reward dollars' }),
    h('p', { class: 'sub', text: 'Wallets sorted from smallest poster to largest. The further a curve sags below the diagonal, the more a few wallets carry.' }),
    h('div', { class: 'legend', style: 'margin:0 0 10px' },
      CURVES.map((k) => h('span', {}, h('i', { class: `sw ${k.sw}` }), `${k.label} · Gini ${c[k.key].giniUsd.toFixed(3)} · ${fmtInt(c[k.key].posters)} wallets`)),
      h('span', {}, h('i', { class: 'sw', style: `background:${COLOR.line}` }), 'Perfectly even')),
    plot,
    h('p', { class: 'note', text: `Both chains together: Gini ${c.all.giniUsd.toFixed(3)} across ${fmtInt(c.all.posters)} wallets. Gini is 0 when every wallet puts up the same amount and approaches 1 when one wallet puts up everything.` }));

  const shareRows = [['Top 1 wallet', 'top1'], ['Top 3 wallets', 'top3'], ['Top 10 wallets', 'top10']];
  const cell = (v) => h('td', { text: fmtPct(v) });
  const shareTable = (caption, field) => h('div', { style: 'margin-top:12px' },
    h('p', { class: 'kicker', text: caption.toLowerCase() }),
    h('div', { class: 'scroll', style: 'max-height:none' }, h('table', {},
      h('thead', {}, h('tr', {}, [caption, 'Tempo', 'Base', 'Both'].map((t, i) => h('th', { scope: 'col', class: i ? '' : 'sr-th', text: i ? t : 'Wallets' })))),
      h('tbody', {}, shareRows.map(([label, key]) => h('tr', {}, h('td', { text: label }), cell(c.tempo[key][field]), cell(c.base[key][field]), cell(c.all[key][field])))))));
  const shareCard = h('div', { class: 'card' },
    h('h3', { text: 'How much the largest posters carry' }),
    h('p', { class: 'sub', text: 'Share of reward dollars and of tasks. Each column ranks wallets by its own measure.' }),
    shareTable('Share of reward dollars', 'usdPct'),
    shareTable('Share of tasks', 'tasksPct'),
    h('p', { class: 'note', text: `Tempo: ${fmtInt(c.tempo.posters)} wallets posted ${fmtInt(c.tempo.tasks)} public tasks worth ${fmtUsd(c.tempo.usd)}. Base: ${fmtInt(c.base.posters)} wallets, ${fmtInt(c.base.tasks)} tasks, ${fmtUsd(c.base.usd)}.` }));
  root.append(h('div', { class: 'grid wide-left' }, curveCard, shareCard));

  const at = (pts, x) => { // linear interpolation on the curve
    let i = 1;
    while (i < pts.length - 1 && pts[i][0] < x) i++;
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  };

  responsive(plot, (W) => {
    const H = Math.min(W * 0.8, 400), m = { l: 34, r: 10, t: 8, b: 36 };
    const x = linear(0, 100, m.l, W - m.r), y = linear(0, 100, H - m.b, m.t);
    const root$ = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Lorenz curves of reward dollars by posting wallet. Tempo Gini ${c.tempo.giniUsd}, Base Gini ${c.base.giniUsd}.` });
    for (const t of [0, 25, 50, 75, 100]) {
      root$.append(
        svg('line', { class: t === 0 ? 'axis-line' : 'grid-line', x1: m.l, x2: W - m.r, y1: Math.round(y(t)) + 0.5, y2: Math.round(y(t)) + 0.5 }),
        svg('text', { x: m.l - 6, y: y(t) + 3.5, 'text-anchor': 'end' }, `${t}%`),
        svg('text', { x: x(t), y: H - m.b + 14, 'text-anchor': t === 0 ? 'start' : t === 100 ? 'end' : 'middle' }, `${t}%`));
    }
    root$.append(
      svg('text', { x: W - m.r, y: H - 2, 'text-anchor': 'end' }, 'share of posting wallets, smallest first →'),
      svg('line', { x1: x(0), y1: y(0), x2: x(100), y2: y(100), stroke: COLOR.line, 'stroke-width': 1.5 }));
    for (const k of CURVES) {
      const pts = c[k.key].lorenz;
      if (pts.length < 2) continue;
      root$.append(svg('path', { d: `M${pts.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('L')}`, fill: 'none', stroke: k.color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      // direct label: the curve that is higher mid-chart is named at 45%, the other at 80%
      const others = CURVES.filter((o) => o !== k && c[o.key].lorenz.length > 1);
      const higher = others.every((o) => at(pts, 45) >= at(c[o.key].lorenz, 45));
      const lx = higher ? 45 : 80;
      root$.append(svg('text', { class: 'halo val', x: x(lx), y: y(at(pts, lx)) - 7, 'text-anchor': 'middle' }, k.label));
    }
    const cross = svg('line', { y1: m.t, y2: H - m.b, stroke: COLOR.muted, 'stroke-width': 1, display: 'none' });
    root$.append(cross);
    const pick = (ev) => {
      const box = root$.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      const xv = Math.min(100, Math.max(0, ((px - m.l) / (W - m.l - m.r)) * 100));
      cross.removeAttribute('display'); cross.setAttribute('x1', x(xv)); cross.setAttribute('x2', x(xv));
      showTip(ev.clientX, ev.clientY, `Largest ${(100 - xv).toFixed(0)}% of wallets`, CURVES.filter((k) => c[k.key].lorenz.length > 1).map((k) => [`${k.label}: share of dollars`, fmtPct(100 - at(c[k.key].lorenz, xv))]));
    };
    root$.addEventListener('pointermove', pick);
    root$.addEventListener('pointerdown', pick);
    root$.addEventListener('pointerleave', () => { cross.setAttribute('display', 'none'); hideTip(); });
    clear(plot).append(root$);
  });
}

// ---------- top posting wallets ----------
export function postersTable(root, d) {
  const cols = [
    { key: 'rank', label: '#', fmt: fmtInt },
    { key: 'short', label: 'Wallet', text: true },
    { key: 'usd', label: 'Put up', fmt: fmtUsd },
    { key: 'tasks', label: 'Tasks', fmt: fmtInt },
    { key: 'completedPct', label: 'Completed', fmt: fmtPct },
    { key: 'diedPct', label: 'Died', fmt: fmtPct },
    { key: 'openPct', label: 'Still open', fmt: fmtPct },
    { key: 'tempoTasks', label: 'On Tempo', fmt: fmtInt },
    { key: 'baseTasks', label: 'On Base', fmt: fmtInt },
  ];
  let sortKey = 'usd', dir = -1;
  const table = h('table', { class: 'wallets' });
  const draw = () => {
    const rows = [...d.topPosters].sort((a, b) => (a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : a.rank - b.rank) * dir);
    clear(table).append(
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col', 'aria-sort': sortKey === c.key ? (dir < 0 ? 'descending' : 'ascending') : null },
        h('button', { type: 'button', text: c.label, title: `Sort by ${c.label}`, onclick: () => { dir = sortKey === c.key ? -dir : (c.text ? 1 : -1); sortKey = c.key; draw(); } }))))),
      h('tbody', {}, rows.map((r) => h('tr', {}, cols.map((c) => {
        if (c.key !== 'short') return h('td', { text: c.fmt(r[c.key]) });
        const b = h('button', { type: 'button', class: 'mono', style: 'background:none;border:0;padding:0;cursor:pointer;color:inherit', title: `Copy ${r.addr}`, text: r.short });
        b.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(r.addr); b.textContent = 'copied'; setTimeout(() => { b.textContent = r.short; }, 1200); } catch { /* clipboard unavailable */ }
        });
        return h('td', {}, b);
      })))));
  };
  draw();
  root.append(h('div', { class: 'card' },
    h('div', { class: 'scroll', style: 'max-height:none' }, table),
    h('p', { class: 'note', text: 'Wallets are shown as truncated hex and nothing else. Tap an address to copy it in full. Completed, died and still open are shares of that wallet\'s public tasks; still open includes live, past-deadline and in-progress tasks. Tap a column heading to sort.' })));
}
