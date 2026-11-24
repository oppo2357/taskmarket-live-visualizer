// Activity heatmap: a pixel grid of rounded squares.
// Hour of week (7 x 24, UTC) or mode by day, for 7d / 30d / 90d / all time.
// One hue, brighter = more events (linear by hour, square-root by mode).
import { svg, h, clear, fmtInt, fmtUsd, pillRow, responsive, state, showTip, hideTip, COLOR } from './viz-core.mjs';

const RANGES = ['7d', '30d', '90d', 'all'];
const DIMS = [{ value: 'hourOfWeek', label: 'Hour of week' }, { value: 'mode', label: 'By mode' }];
const hourLabel = (c) => `${String(c).padStart(2, '0')}:00`;

export function heatmap(root, d) {
  let dim = state.get('dim', 'hourOfWeek', DIMS.map((x) => x.value));
  let range = state.get('range', '30d', RANGES);
  const controls = h('div', { class: 'controls' },
    pillRow({ label: 'grid', value: dim, options: DIMS, onChange: (v) => { dim = v; state.set('dim', v, 'hourOfWeek'); build(); } }),
    pillRow({ label: 'range', value: range, options: RANGES.map((r) => ({ value: r, label: r === 'all' ? 'All time' : r })), onChange: (v) => { range = v; state.set('range', v, '30d'); build(); } }));
  const plot = h('div');
  const scale = h('div', { class: 'scale' });
  const plotCard = h('div', { class: 'card heat viz' }, plot, scale);
  const side = h('div', { class: 'card' });
  root.append(controls, h('div', { class: 'grid wide-left' }, plotCard, side));

  let current = null;
  const redraw = responsive(plot, (W) => { if (current) draw(current, W); });

  function build() {
    const m = d.heatmap[`${range}|${dim}`];
    current = m;
    clear(side); clear(scale);
    if (!m || !m.total) { current = null; clear(plot).append(h('p', { class: 'loading', text: 'No activity in this range.' })); return; }
    const max = Math.max(...m.count.flat());
    scale.append(h('span', { text: 'fewer' }), h('span', { class: 'ramp' }), h('span', { text: `more · ${dim === 'mode' ? 'square-root' : 'linear'} scale · brightest cell ${fmtInt(max)} ${dim === 'mode' ? 'tasks posted' : 'events'}` }));

    const rangeText = range === 'all' ? 'all time' : `last ${range}`;
    if (dim === 'hourOfWeek') {
      const cells = [];
      m.count.forEach((row, r) => row.forEach((v, c) => cells.push({ r, c, v })));
      const top = cells.sort((a, b) => b.v - a.v).slice(0, 6);
      const dayTotals = m.rows.map((name, r) => ({ name, v: m.count[r].reduce((a, b) => a + b, 0) })).sort((a, b) => b.v - a.v);
      side.append(
        h('h3', { text: 'Busiest hours' }),
        h('p', { class: 'sub', text: `${fmtInt(m.total)} events, ${rangeText}. Hours are UTC.` }),
        h('ol', { class: 'rank' }, top.map((x) => h('li', {}, h('span', { text: `${m.rows[x.r]} ${hourLabel(m.cols[x.c])}` }), h('span', { text: fmtInt(x.v) })))),
        h('p', { class: 'note', text: `Busiest day: ${dayTotals[0].name}, ${fmtInt(dayTotals[0].v)} events. Quietest: ${dayTotals.at(-1).name}, ${fmtInt(dayTotals.at(-1).v)}.` }));
    } else {
      const rows = m.rows.map((name, r) => ({ name, v: m.count[r].reduce((a, b) => a + b, 0), usd: m.usd ? m.usd[r].reduce((a, b) => a + b, 0) : 0 })).sort((a, b) => b.v - a.v);
      side.append(
        h('h3', { text: 'Tasks posted by mode' }),
        h('p', { class: 'sub', text: `${fmtInt(m.total)} tasks posted, ${rangeText}, from ${m.cols[0]} to ${m.cols.at(-1)}.` }),
        h('ol', { class: 'rank' }, rows.map((x) => h('li', {}, h('span', { text: x.name }), h('span', { text: `${fmtInt(x.v)} · ${fmtUsd(Math.round(x.usd * 1e6) / 1e6)}` })))),
        h('p', { class: 'note', text: 'In this grid the heatmap endpoint counts tasks posted per day in each mode. The dollar figure is the reward volume it reports for them.' }));
    }
    redraw();
  }

  function draw(m, W) {
    const nR = m.rows.length, nC = m.cols.length;
    const labelW = dim === 'hourOfWeek' ? 30 : 68;
    const step = (W - labelW) / nC;
    const gap = step >= 9 ? 2 : step >= 5 ? 1 : 0;
    const rowH = dim === 'hourOfWeek' ? step : Math.max(22, Math.min(30, W / 22));
    const top = 16, H = top + rowH * nR + 4;
    const max = Math.max(1, ...m.count.flat());
    const root$ = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': dim === 'hourOfWeek' ? `Heatmap of activity by day of week and hour, UTC. ${fmtInt(m.total)} events.` : `Heatmap of tasks posted by mode and day. ${fmtInt(m.total)} tasks.` });
    m.rows.forEach((name, r) => root$.append(svg('text', { x: 0, y: top + rowH * r + rowH / 2 + 3.5 }, name)));
    const tickEvery = dim === 'hourOfWeek' ? (W < 520 ? 6 : 3) : Math.max(1, Math.ceil(nC / (W < 520 ? 3 : 6)));
    m.cols.forEach((c, i) => {
      if (i % tickEvery !== 0) return;
      root$.append(svg('text', { x: labelW + step * i + (dim === 'hourOfWeek' ? step / 2 : 0), y: 9, 'text-anchor': dim === 'hourOfWeek' ? 'middle' : 'start' }, dim === 'hourOfWeek' ? String(c).padStart(2, '0') : c.slice(5)));
    });
    const rx = gap ? Math.min(4, (step - gap) * 0.26) : 0;
    for (let r = 0; r < nR; r++) {
      for (let c = 0; c < nC; c++) {
        const v = m.count[r][c];
        const peak = m.peak && m.peak.row === r && m.peak.col === c && dim === 'hourOfWeek';
        root$.append(svg('rect', {
          class: `cell${peak ? ' peak' : ''}`, x: (labelW + step * c + gap / 2).toFixed(2), y: (top + rowH * r + gap / 2).toFixed(2),
          width: Math.max(0.6, step - gap).toFixed(2), height: Math.max(1, rowH - gap).toFixed(2), rx: rx.toFixed(1),
          fill: v ? COLOR.cream : COLOR.line, 'fill-opacity': v ? (0.07 + 0.93 * (dim === 'mode' ? Math.sqrt(v / max) : v / max)).toFixed(3) : 0.28,
        }));
      }
    }
    const pick = (ev) => {
      const box = root$.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W, py = ((ev.clientY - box.top) / box.height) * H;
      const c = Math.floor((px - labelW) / step), r = Math.floor((py - top) / rowH);
      if (c < 0 || c >= nC || r < 0 || r >= nR) { hideTip(); return; }
      const rows = [[dim === 'mode' ? 'Tasks posted' : 'Events', fmtInt(m.count[r][c])]];
      if (m.usd) rows.push(['Rewards put up', fmtUsd(m.usd[r][c])]);
      rows.push(['Share of range', `${((m.count[r][c] / m.total) * 100).toFixed(1)}%`]);
      showTip(ev.clientX, ev.clientY, dim === 'hourOfWeek' ? `${m.rows[r]} ${hourLabel(m.cols[c])} UTC` : `${m.rows[r]} · ${m.cols[c]}`, rows);
    };
    root$.addEventListener('pointermove', pick);
    root$.addEventListener('pointerdown', pick);
    root$.addEventListener('pointerleave', hideTip);
    clear(plot).append(root$);
  }

  build();
}
