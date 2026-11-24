// Platform time-series explorer: four small multiples that share one range,
// one bucket size and one crosshair. Each measure keeps its own zero-based
// axis; nothing is drawn against two scales.
import { svg, h, clear, fmtInt, fmtUsd, fmtUsdShort, fmtIntShort, niceMax, linear, pillRow, tableView, responsive, state } from './viz-core.mjs';

const RANGES = ['7d', '30d', '90d', 'all'];
const BUCKETS = ['day', 'week'];
const METRICS = [
  { key: 'activeAgents', label: 'Active agents', fmt: fmtInt, axis: fmtIntShort, total: false },
  { key: 'tasksCreated', label: 'Tasks posted', fmt: fmtInt, axis: fmtIntShort, total: true },
  { key: 'rewardVolume', label: 'Rewards put up', fmt: fmtUsd, axis: fmtUsdShort, total: true },
  { key: 'paidVolume', label: 'Rewards paid', fmt: fmtUsd, axis: fmtUsdShort, total: true },
];

export function seriesExplorer(root, data) {
  let range = state.get('range', '30d', RANGES);
  let bucket = state.get('bucket', 'day', BUCKETS);
  let hover = null; // index into the current series
  const controls = h('div', { class: 'controls' });
  const grid = h('div', { class: 'series-grid' });
  const foot = h('div');
  root.append(controls, grid, foot);

  controls.append(
    pillRow({ label: 'range', value: range, options: RANGES.map((r) => ({ value: r, label: r === 'all' ? 'All time' : r })), onChange: (v) => { range = v; hover = null; state.set('range', v, '30d'); build(); } }),
    pillRow({ label: 'bucket', value: bucket, options: BUCKETS.map((b) => ({ value: b, label: b === 'day' ? 'Daily' : 'Weekly' })), onChange: (v) => { bucket = v; hover = null; state.set('bucket', v, 'day'); build(); } }),
  );

  let panels = [];
  const current = () => data.series[`${range}|${bucket}`];

  function build() {
    const s = current();
    clear(grid); clear(foot);
    panels = [];
    if (!s || !s.bucket.length) { grid.append(h('p', { class: 'loading', text: 'No data for this range.' })); return; }
    for (const metric of METRICS) {
      const value = h('div', { class: 'v' });
      const when = h('div', { class: 'when' });
      const plot = h('div', { class: 'viz' });
      const card = h('div', { class: 'card series-card' }, h('h3', { text: metric.label }), value, when, plot);
      grid.append(card);
      const panel = { metric, value, when, plot, parts: null };
      panels.push(panel);
      responsive(plot, (W) => drawPanel(panel, W));
    }
    foot.append(
      h('p', { class: 'note', text: `${bucket === 'day' ? 'Days' : 'Weeks'} are UTC, as the API buckets them. The last ${bucket} is still filling. Move across any chart to read all four at the same ${bucket}.` }),
      tableView('Table view of this range', [
        { label: bucket === 'day' ? 'Day (UTC)' : 'Week starting (UTC)', get: (i) => s.bucket[i] },
        { label: 'activeAgents', get: (i) => s.activeAgents[i], fmt: fmtInt },
        { label: 'tasksCreated', get: (i) => s.tasksCreated[i], fmt: fmtInt },
        { label: 'rewardVolume', get: (i) => s.rewardVolume[i], fmt: fmtUsd },
        { label: 'paidVolume', get: (i) => s.paidVolume[i], fmt: fmtUsd },
        { label: 'completedTasks', get: (i) => s.completedTasks[i], fmt: fmtInt },
        { label: 'settlements', get: (i) => s.settlements[i], fmt: fmtInt },
      ], s.bucket.map((_, i) => i).reverse()),
    );
    readout();
  }

  function drawPanel(panel, W) {
    const s = current();
    const vals = s[panel.metric.key], n = vals.length;
    const H = 142, m = { l: 4, r: 4, t: 18, b: 20 };
    const scale = niceMax(Math.max(...vals), 2);
    const x = n > 1 ? linear(0, n - 1, m.l + 2, W - m.r - 2) : () => W / 2;
    const y = linear(0, scale.max, H - m.b, m.t);
    const root$ = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${panel.metric.label}, ${range === 'all' ? 'all time' : `last ${range}`}, by ${bucket}. Latest value ${panel.metric.fmt(vals[n - 1])}.` });
    for (const t of scale.ticks) {
      const yy = Math.round(y(t)) + 0.5;
      root$.append(svg('line', { class: t === 0 ? 'axis-line' : 'grid-line', x1: m.l, x2: W - m.r, y1: yy, y2: yy }));
      if (t > 0) root$.append(svg('text', { x: m.l, y: yy - 4 }, panel.metric.axis(t)));
    }
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    if (n > 1) {
      root$.append(
        svg('path', { class: 'ar', d: `M${x(0).toFixed(1)},${y(0)}L${pts.join('L')}L${x(n - 1).toFixed(1)},${y(0)}Z` }),
        svg('path', { class: 'ln', d: `M${pts.join('L')}` }),
      );
    }
    if (n <= 16) vals.forEach((v, i) => root$.append(svg('circle', { cx: x(i).toFixed(1), cy: y(v).toFixed(1), r: 2.2, fill: '#EFE9E2' })));
    root$.append(
      svg('text', { x: m.l, y: H - 5 }, s.bucket[0]),
      svg('text', { x: W - m.r, y: H - 5, 'text-anchor': 'end' }, s.bucket[n - 1]),
    );
    const cross = svg('line', { class: 'cross', y1: m.t, y2: H - m.b, display: 'none' });
    const dot = svg('circle', { class: 'dot', r: 4.5, display: 'none' });
    root$.append(cross, dot);
    panel.parts = { x, y, cross, dot, vals };

    const pick = (ev) => {
      const box = root$.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      const i = n > 1 ? Math.round(((px - m.l - 2) / (W - m.l - m.r - 4)) * (n - 1)) : 0;
      hover = Math.min(n - 1, Math.max(0, i));
      readout();
    };
    root$.addEventListener('pointermove', pick);
    root$.addEventListener('pointerdown', pick);
    root$.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') { hover = null; readout(); } });
    clear(panel.plot).append(root$);
    readout();
  }

  // One readout for all four panels: values lead, the bucket follows.
  function readout() {
    const s = current();
    if (!s) return;
    const n = s.bucket.length;
    for (const p of panels) {
      const vals = s[p.metric.key];
      if (hover == null) {
        const total = p.metric.total ? vals.reduce((a, b) => a + b, 0) : vals[n - 1];
        p.value.textContent = p.metric.fmt(p.metric.key.endsWith('Volume') ? Math.round(total * 1e6) / 1e6 : total);
        p.when.textContent = p.metric.total ? `total, ${s.bucket[0]} to ${s.bucket[n - 1]}` : `latest ${bucket}, ${s.bucket[n - 1]}`;
      } else {
        p.value.textContent = p.metric.fmt(vals[hover]);
        p.when.textContent = `${bucket === 'week' ? 'week of ' : ''}${s.bucket[hover]}${hover === n - 1 ? ' (still filling)' : ''}`;
      }
      if (!p.parts) continue;
      const { x, y, cross, dot } = p.parts;
      if (hover == null) { cross.setAttribute('display', 'none'); dot.setAttribute('display', 'none'); continue; }
      const cx = x(hover);
      cross.removeAttribute('display'); dot.removeAttribute('display');
      cross.setAttribute('x1', Math.round(cx) + 0.5); cross.setAttribute('x2', Math.round(cx) + 0.5);
      dot.setAttribute('cx', cx); dot.setAttribute('cy', y(vals[hover]));
    }
  }

  build();
}
