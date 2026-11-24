// Swarm Convergence Field.
// Every public task is one rounded-square tile: reward up (log scale),
// submissions to the right (log scale, with its own column for zero).
// Tiles snap to a pixel grid at the nearest free spot to their true position.
// Live tasks draw one magenta filament per submission, converging on the tile.
import { svg, h, clear, fmtInt, fmtUsd, fmtTime, pillRow, responsive, state, OUTCOME_COLOR, CHAIN_NAME, CHAIN_TOKEN } from './viz-core.mjs';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'live', label: 'Live swarm', swatch: 'live' },
  { value: 'paid', label: 'Completed', swatch: 'paid' },
  { value: 'stale', label: 'Past deadline', swatch: 'stale' },
  { value: 'progress', label: 'In progress', swatch: 'progress' },
  { value: 'died', label: 'Died', swatch: 'died' },
];
const OUTCOME_TEXT = { live: 'Live: taking submissions', paid: 'Completed', stale: 'Past deadline, awaiting a decision', progress: 'In progress', died: 'Died' };
const DRAW_ORDER = ['died', 'paid', 'progress', 'stale', 'live'];
const PLACE_ORDER = ['live', 'stale', 'progress', 'paid', 'died'];
const MAX_FILAMENTS = 12;
const Y_FLOOR = 0.01;

function outcomeOf(status, windowOpen) {
  if (status === 'completed') return 'paid';
  if (status === 'open') return windowOpen ? 'live' : 'stale';
  if (status === 'expired' || status === 'cancelled') return 'died';
  return 'progress';
}

// Grid offsets sorted by distance, used to find the nearest free cell.
const OFFSETS = (() => {
  const out = [];
  for (let dx = -42; dx <= 42; dx++) for (let dy = -42; dy <= 42; dy++) out.push([dx, dy, dx * dx + dy * dy]);
  return out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
})();

export function swarmField(root, data) {
  const tasks = data.swarm.tasks.map((t, i) => ({
    i, id: t[0], ref: t[1], chain: t[2], status: t[3], mode: t[5], usd: t[6], subs: t[7], awards: t[8],
    req: t[9], win: t[10], created: t[11], expiry: t[12], outcome: outcomeOf(t[3], t[4]),
  }));
  const maxSubs = Math.max(1, ...tasks.map((t) => t.subs));
  const maxUsd = Math.max(1, ...tasks.map((t) => t.usd));
  const counts = { all: tasks.length };
  for (const t of tasks) counts[t.outcome] = (counts[t.outcome] || 0) + 1;

  let filter = state.get('status', 'all', FILTERS.map((f) => f.value));
  let chain = state.get('chain', 'all', ['all', 'tempo', 'base']);
  const visible = (t) => (filter === 'all' || t.outcome === filter) && (chain === 'all' || (chain === 'tempo' ? t.chain === 4217 : t.chain === 8453));

  const byRef = new Map(tasks.map((t) => [t.ref, t]));
  const mostContested = (list) => [...list].sort((a, b) => b.subs - a.subs || b.usd - a.usd)[0];
  let pinned = byRef.get(state.get('task', '')) || mostContested(tasks.filter((t) => t.outcome === 'live')) || tasks[0];
  if (pinned && !visible(pinned)) pinned = mostContested(tasks.filter(visible)) || pinned; // a deep link may filter it out
  let hovered = null;

  // ----- skeleton -----
  const controls = h('div', { class: 'controls' });
  const plotCard = h('div', { class: 'card swarm-plot viz' });
  const inspector = h('aside', { class: 'card inspector', 'aria-live': 'polite' });
  const caption = h('p', { class: 'note' });
  root.append(controls, h('div', { class: 'swarm' }, plotCard, inspector), caption);

  let redraw = () => {};
  const renderControls = () => {
    clear(controls).append(
      pillRow({ label: 'show', value: filter, options: FILTERS.filter((f) => f.value === 'all' || counts[f.value]).map((f) => ({ ...f, count: counts[f.value] })), onChange: (v) => { filter = v; state.set('status', v, 'all'); update(); } }),
      pillRow({ label: 'chain', value: chain, options: [{ value: 'all', label: 'All' }, { value: 'tempo', label: 'Tempo' }, { value: 'base', label: 'Base' }], onChange: (v) => { chain = v; state.set('chain', v, 'all'); update(); } }),
    );
  };

  // ----- inspector -----
  function renderInspector() {
    const t = hovered || pinned;
    clear(inspector);
    if (!t) return;
    const list = tasks.filter(visible).sort((a, b) => b.subs - a.subs || b.usd - a.usd || (a.ref < b.ref ? -1 : 1));
    const pos = list.indexOf(pinned);
    const step = (d) => { if (!list.length) return; pinned = list[(pos + d + list.length) % list.length] || list[0]; hovered = null; state.set('task', pinned.ref); update(); };
    const rows = [
      ['Reward', `${fmtUsd(t.usd)} ${CHAIN_TOKEN[t.chain] || ''}`.trim()],
      ['Submissions', fmtInt(t.subs)],
      ['Mode', t.mode],
      ['Posted by', t.req || 'n/a'],
      [t.awards > 1 ? `Primary award (of ${t.awards})` : 'Winner', t.win || (t.outcome === 'paid' ? 'n/a' : 'none yet')],
      ['Posted', fmtTime(t.created)],
      ['Deadline', fmtTime(t.expiry)],
    ];
    inspector.append(
      h('div', {}, h('p', { class: 'kicker', text: hovered ? 'task under the pointer' : 'selected task' }), h('div', { class: 'ref', text: t.ref })),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, h('i', { class: `sw ${t.outcome}` }), h('span', { text: OUTCOME_TEXT[t.outcome] })),
        h('span', { class: 'chip', text: `${CHAIN_NAME[t.chain] || t.chain} · ${t.status}` })),
      h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
      h('a', { class: 'btn', href: `https://taskmarket.dev/tasks/${t.id}`, target: '_blank', rel: 'noopener', text: 'Open on taskmarket.dev' }),
      h('div', { class: 'step' },
        h('button', { class: 'pill', type: 'button', text: 'Previous', onclick: () => step(-1) }),
        h('button', { class: 'pill', type: 'button', text: 'Next', onclick: () => step(1) })),
      h('p', { class: 'note', text: `Previous and Next walk the ${fmtInt(list.length)} tasks shown, most submissions first.` }),
    );
  }

  // ----- plot -----
  let geo = null; // layout for the current width
  function layout(W) {
    const small = W < 520;
    const H = small ? Math.round(W * 1.3) : Math.round(Math.min(580, W * 0.68));
    const m = { l: 42, r: 8, t: 22, b: 36 };
    const cell = small ? 5 : W < 760 ? 7 : 8;
    const tile = cell - (cell >= 7 ? 2 : 1);
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const cols = Math.floor(pw / cell), rows = Math.floor(ph / cell);
    const zeroCols = Math.max(4, Math.round(cols * 0.12)); // the "0 submissions" column
    const gapCols = 1;
    const xCol = (s) => (s <= 0 ? (zeroCols - 1) / 2 : zeroCols + gapCols + (Math.log(s) / Math.log(maxSubs * 1.08)) * (cols - zeroCols - gapCols - 1));
    const yTop = Math.log10(maxUsd * 1.25), yBot = Math.log10(Y_FLOOR);
    const yRow = (u) => ((yTop - Math.log10(Math.max(Y_FLOOR, u))) / (yTop - yBot)) * (rows - 1);

    const taken = new Uint8Array(cols * rows);
    const place = new Array(tasks.length);
    const ordered = [...tasks].sort((a, b) => PLACE_ORDER.indexOf(a.outcome) - PLACE_ORDER.indexOf(b.outcome) || b.subs - a.subs || b.usd - a.usd || (a.id < b.id ? -1 : 1));
    for (const t of ordered) {
      const cx = Math.round(xCol(t.subs)), cy = Math.round(yRow(t.usd));
      const lo = t.subs <= 0 ? 0 : zeroCols + gapCols, hi = t.subs <= 0 ? zeroCols - 1 : cols - 1;
      let spot = null;
      for (const [dx, dy] of OFFSETS) {
        const x = cx + dx, y = cy + dy;
        if (x < lo || x > hi || y < 0 || y >= rows || taken[y * cols + x]) continue;
        spot = [x, y]; break;
      }
      if (!spot) spot = [Math.min(hi, Math.max(lo, cx)), Math.min(rows - 1, Math.max(0, cy))];
      taken[spot[1] * cols + spot[0]] = 1;
      place[t.i] = { x: m.l + spot[0] * cell + (cell - tile) / 2, y: m.t + spot[1] * cell + (cell - tile) / 2 };
    }
    return { W, H, m, cell, tile, pw, ph, cols, rows, zeroCols, gapCols, xCol, yRow, place, small };
  }

  let nodes = null;
  function draw(W) {
    geo = layout(W);
    const { H, m, cell, tile, pw, ph, cols, zeroCols, gapCols, xCol, yRow, place, small } = geo;
    const bottom = m.t + ph;
    const root$ = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', tabindex: 0, 'aria-label': `Swarm field of ${tasks.length} public tasks by reward and number of submissions. Use the Previous and Next buttons to step through tasks.` });

    // axes
    const axes = svg('g');
    for (const v of [0.01, 0.1, 1, 10, 100, 1000].filter((v) => v <= maxUsd * 1.25)) {
      const y = m.t + yRow(v) * cell + cell / 2;
      axes.append(svg('line', { class: 'grid-line', x1: m.l, x2: m.l + pw, y1: y, y2: y }),
        svg('text', { x: m.l - 6, y: y + 3.5, 'text-anchor': 'end' }, v === 0.01 ? '≤$0.01' : v < 1 ? `$${v.toFixed(2)}` : `$${v}`));
    }
    const xAt = (s) => m.l + xCol(s) * cell + cell / 2;
    const ticks = [1, 3, 10, 30, 100, 300, 1000].filter((v) => v <= maxSubs && (!small || ![3, 30, 300].includes(v) || v === 3));
    axes.append(svg('text', { x: xAt(0), y: bottom + 14, 'text-anchor': 'middle' }, '0'));
    for (const v of ticks) axes.append(svg('text', { x: xAt(v), y: bottom + 14, 'text-anchor': 'middle' }, String(v)));
    const sepX = m.l + (zeroCols + gapCols / 2) * cell;
    axes.append(svg('line', { class: 'axis-line', x1: sepX, x2: sepX, y1: m.t, y2: bottom }),
      svg('line', { class: 'axis-line', x1: m.l, x2: m.l + pw, y1: bottom, y2: bottom }),
      svg('text', { x: m.l + pw, y: bottom + 29, 'text-anchor': 'end' }, small ? 'submissions per task, log scale →' : 'submissions per task (log scale) →'),
      svg('text', { x: 0, y: 10 }, 'reward ↑ (log scale)'));

    // filaments: one per submission to a live task
    const filG = svg('g', { 'aria-hidden': 'true' });
    const filaments = new Map();
    for (const t of tasks) {
      if (t.outcome !== 'live' || t.subs <= 0) continue;
      const p = place[t.i], tx = p.x + tile / 2, ty = p.y + tile / 2;
      const n = Math.min(t.subs, MAX_FILAMENTS);
      const spread = Math.min(pw * 0.2, (small ? 20 : 34) + t.subs * (small ? 1 : 1.8));
      let d = '';
      for (let k = 0; k < n; k++) {
        const dx = ((k + 0.5) / n - 0.5) * spread;
        const sx = Math.min(m.l + pw, Math.max(m.l, tx + dx));
        d += `M${sx.toFixed(1)},${bottom}Q${(tx + dx * 0.12).toFixed(1)},${(ty + (bottom - ty) * 0.42).toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
      }
      const path = svg('path', { class: 'fil', d });
      filaments.set(t.i, path);
      filG.append(path);
    }

    // tiles
    const tileG = svg('g');
    const rects = new Array(tasks.length);
    for (const outcome of DRAW_ORDER) {
      for (const t of tasks) {
        if (t.outcome !== outcome) continue;
        const p = place[t.i];
        const r = svg('rect', { class: 'tile', x: p.x.toFixed(1), y: p.y.toFixed(1), width: tile, height: tile, rx: (tile * 0.28).toFixed(1), fill: OUTCOME_COLOR[outcome] });
        rects[t.i] = r;
        tileG.append(r);
      }
    }
    const ring = svg('rect', { fill: 'none', stroke: '#FFF6E8', 'stroke-width': 1.5, rx: 3, 'pointer-events': 'none' });
    const hoverRing = svg('rect', { fill: 'none', stroke: '#B0A79D', 'stroke-width': 1.2, rx: 3, 'pointer-events': 'none' });
    root$.append(axes, filG, tileG, hoverRing, ring);
    nodes = { rects, filaments, ring, hoverRing };

    // pointer: nearest visible tile wins, so nobody has to land on 6 pixels
    const nearest = (ev) => {
      const box = root$.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W, py = ((ev.clientY - box.top) / box.height) * H;
      let best = null, bestD = (ev.pointerType === 'mouse' ? 20 : 30) ** 2;
      for (const t of tasks) {
        if (!visible(t)) continue;
        const p = place[t.i], dx = p.x + tile / 2 - px, dy = p.y + tile / 2 - py, dd = dx * dx + dy * dy;
        if (dd < bestD) { bestD = dd; best = t; }
      }
      return best;
    };
    root$.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'mouse') return; const t = nearest(ev); if (t !== hovered) { hovered = t; paint(); renderInspector(); } });
    root$.addEventListener('pointerleave', () => { if (hovered) { hovered = null; paint(); renderInspector(); } });
    root$.addEventListener('click', (ev) => { const t = nearest(ev); if (!t) return; pinned = t; hovered = null; state.set('task', t.ref); paint(); renderInspector(); });
    root$.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
      ev.preventDefault();
      const list = tasks.filter(visible).sort((a, b) => b.subs - a.subs || b.usd - a.usd || (a.ref < b.ref ? -1 : 1));
      if (!list.length) return;
      pinned = list[(list.indexOf(pinned) + (ev.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
      state.set('task', pinned.ref); paint(); renderInspector();
    });

    clear(plotCard).append(root$);
    paint();
  }

  function paint() {
    if (!nodes || !geo) return;
    const { tile } = geo;
    let shown = 0;
    for (const t of tasks) {
      const on = visible(t);
      if (on) shown++;
      nodes.rects[t.i].setAttribute('opacity', on ? 1 : 0.1);
      const f = nodes.filaments.get(t.i);
      if (f) { f.style.display = on ? '' : 'none'; f.classList.toggle('hot', t === (hovered || pinned)); }
    }
    const setRing = (node, t) => {
      if (!t || !visible(t)) { node.setAttribute('display', 'none'); return; }
      const p = geo.place[t.i];
      node.removeAttribute('display');
      node.setAttribute('x', p.x - 2.5); node.setAttribute('y', p.y - 2.5);
      node.setAttribute('width', tile + 5); node.setAttribute('height', tile + 5);
    };
    setRing(nodes.ring, pinned);
    setRing(nodes.hoverRing, hovered && hovered !== pinned ? hovered : null);
    caption.textContent = `Showing ${fmtInt(shown)} of ${fmtInt(tasks.length)} public tasks. Each tile is one task, set on a grid at the free spot nearest its true position. Each filament is one submission to a live task; at most ${MAX_FILAMENTS} are drawn per task. Tap a tile to inspect it.`;
  }

  function update() {
    if (pinned && !visible(pinned)) pinned = mostContested(tasks.filter(visible)) || pinned;
    paint();
    renderInspector();
  }

  renderControls();
  redraw = responsive(plotCard, draw);
  renderInspector();
  return { redraw };
}
