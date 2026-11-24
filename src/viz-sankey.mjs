// Escrow Flow River: reward dollars from the wallets that posted them,
// through what happened to the task, to the wallets that won.
// All three columns share one dollar scale, so widths compare directly.
import { svg, h, clear, fmtInt, fmtUsd, fmtPct, pillRow, tableView, responsive, state, showTip, hideTip, OUTCOME_COLOR, COLOR } from './viz-core.mjs';

const SCOPES = [{ value: 'all', label: 'All' }, { value: 'tempo', label: 'Tempo' }, { value: 'base', label: 'Base' }];

export function flowRiver(root, d) {
  let scope = state.get('chain', 'all', SCOPES.map((s) => s.value));
  const controls = h('div', { class: 'controls' }, pillRow({ label: 'chain', value: scope, options: SCOPES, onChange: (v) => { scope = v; state.set('chain', v, 'all'); build(); } }));
  const card = h('div', { class: 'card river viz' });
  const summary = h('div', { class: 'river-summary' });
  const foot = h('div');
  root.append(controls, card, summary, foot);

  let current = null;
  const redraw = responsive(card, (W) => { if (current) draw(current, W); });

  function build() {
    const s = d.sankey[scope];
    clear(summary); clear(foot);
    if (!s.totalTasks) { current = null; clear(card).append(h('p', { class: 'loading', text: 'No public tasks on this chain yet.' })); return; }
    current = s;
    redraw();
    for (const g of s.gates) {
      summary.append(h('div', {},
        h('div', { class: 'k' }, h('i', { class: `sw ${g.key}` }), h('span', { text: g.label })),
        h('div', { class: 'v', text: fmtUsd(g.usd) }),
        h('div', { class: 's', text: `${fmtInt(g.tasks)} tasks · ${fmtPct(s.totalUsd ? (g.usd / s.totalUsd) * 100 : 0)}` })));
    }
    const rows = [
      ...s.linksIn.map(([p, g, usd, n]) => ({ from: s.posters[p].label, to: s.gates[g].label, usd, n })),
      ...s.linksOut.map(([g, w, usd, n]) => ({ from: s.gates[g].label, to: s.winners[w].label, usd, n })),
    ];
    const roundNote = Math.round(s.check.netWorkerPaidUsd * 100) + Math.round(s.check.platformFeesUsd * 100) !== Math.round(s.check.paidUsd * 100)
      ? ' (exact in 6-decimal micro-units; 2-decimal display figures round independently)'
      : '';
    const feeLine = s.check.platformFeesUsd > 0
      ? `Net to workers: ${fmtUsd(s.check.netWorkerPaidUsd)} plus ${fmtUsd(s.check.platformFeesUsd)} in platform fees, matching gross Completed (${fmtUsd(s.check.paidUsd)})${roundNote}. `
      : `Net to workers: ${fmtUsd(s.check.netWorkerPaidUsd)} (no platform fees on this chain), matching Completed (${fmtUsd(s.check.paidUsd)}). `;
    foot.append(
      h('p', { class: 'note' },
        h('b', { text: 'It reconciles. ' }),
        `Posted: ${fmtUsd(s.check.postersUsd)}. Outcomes: ${fmtUsd(s.check.gatesUsd)}. Both equal the ${fmtUsd(s.totalUsd)} put up in ${fmtInt(s.totalTasks)} public tasks by ${fmtInt(s.posterWallets)} wallets. ${feeLine}Winner shares use each completed task's netReward (after platformFeeBps); multi-winner tasks are drawn as one split because the list names only the primary award.`),
      tableView('Table view of every flow', [
        { label: 'From', get: (r) => r.from },
        { label: 'To', get: (r) => r.to },
        { label: 'Amount', get: (r) => r.usd, fmt: fmtUsd },
        { label: 'Tasks', get: (r) => r.n, fmt: fmtInt },
      ], rows));
  }

  function draw(s, W) {
    const small = W < 560;
    const H = small ? 600 : 580;
    const top = 30, bottom = 6, nw = small ? 8 : 10;
    const avail = H - top - bottom;
    const gatePad = 28, leftPad = small ? 6 : 8;
    const gates = s.gates.map((g, i) => ({ ...g, i })).filter((g) => g.tasks > 0);
    const k = Math.min(
      (avail - leftPad * (s.posters.length - 1)) / s.totalUsd,
      (avail - gatePad * (gates.length - 1)) / s.totalUsd,
    );
    const paidUsd = s.check.paidUsd;
    const rightPad = s.winners.length > 1 ? Math.min(22, Math.max(3, (avail - paidUsd * k) / (s.winners.length - 1))) : 0;
    const xL = 0, xM = Math.round(W * (small ? 0.5 : 0.47)) - nw / 2, xR = W - nw;
    const thick = (usd) => Math.max(usd > 0 ? 1 : 0, usd * k);

    // node positions
    const stack = (nodes, pad) => { let y = top; return nodes.map((n) => { const hh = thick(n.usd); const out = { ...n, y, h: hh }; y += hh + pad; return out; }); };
    const L = stack(s.posters, leftPad);
    const M = stack(gates, gatePad);
    const R = stack(s.winners, rightPad);
    const gateAt = Object.fromEntries(M.map((g) => [g.i, g]));

    const root$ = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `Flow of ${fmtUsd(s.totalUsd)} in task rewards from posting wallets, through task outcomes, to winning wallets. The table view below lists every flow.` });
    root$.append(
      svg('text', { x: 0, y: 11 }, 'posted by'),
      svg('text', { x: xM + nw / 2, y: 11, 'text-anchor': 'middle' }, 'what happened'),
      svg('text', { x: W, y: 11, 'text-anchor': 'end' }, 'won by'),
    );

    // links
    const linkG = svg('g');
    const links = [];
    const ribbon = (x0, y0, x1, y1, width, cls, color, info) => {
      const mx = (x0 + x1) / 2;
      const p = svg('path', { class: `link ${cls}`, d: `M${x0},${y0.toFixed(1)}C${mx},${y0.toFixed(1)} ${mx},${y1.toFixed(1)} ${x1},${y1.toFixed(1)}`, stroke: color, 'stroke-width': Math.max(1, width).toFixed(2) });
      links.push({ node: p, ...info });
      linkG.append(p);
    };
    const offL = L.map(() => 0), offMin = {}, offMout = {}, offR = R.map(() => 0);
    // order by gate then poster so ribbons do not cross more than they must
    const sortedIn = [...s.linksIn].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const srcOrder = [...s.linksIn].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const srcY = new Map();
    for (const l of srcOrder) { const w = thick(l[2]); srcY.set(l, L[l[0]].y + offL[l[0]] + w / 2); offL[l[0]] += w; }
    for (const l of sortedIn) {
      const [p, g, usd, n] = l, gate = gateAt[g];
      if (!gate) continue;
      const w = thick(usd);
      const ty = gate.y + (offMin[g] || 0) + w / 2;
      offMin[g] = (offMin[g] || 0) + w;
      ribbon(xL + nw, srcY.get(l), xM, ty, w, gate.key, OUTCOME_COLOR[gate.key], { a: `L${p}`, b: `M${g}`, title: `${s.posters[p].label} → ${gate.label}`, usd, n });
    }
    for (const [g, wi, usd, n] of s.linksOut) {
      const gate = gateAt[g];
      if (!gate || !usd) continue;
      const w = thick(usd);
      const sy = gate.y + (offMout[g] || 0) + w / 2;
      offMout[g] = (offMout[g] || 0) + w;
      const ty = R[wi].y + offR[wi] + w / 2;
      offR[wi] += w;
      const isFee = !!s.winners[wi].isFee;
      ribbon(xM + nw, sy, xR, ty, w, isFee ? 'progress' : 'paid', isFee ? COLOR.muted : COLOR.cream, { a: `M${g}`, b: `R${wi}`, title: `${gate.label} → ${s.winners[wi].label}`, usd, n });
    }

    // nodes + labels
    const nodeG = svg('g'), labelG = svg('g');
    const labels = [];
    const addNode = (id, n, x, color, labelX, anchor, above) => {
      const rect = svg('rect', { class: 'node', x, y: n.y.toFixed(1), width: nw, height: Math.max(1.5, n.h).toFixed(1), rx: 2, fill: color, tabindex: 0, 'aria-label': `${n.label}: ${fmtUsd(n.usd)}, ${fmtInt(n.tasks)} tasks` });
      // a wider invisible target so thin nodes are easy to hit
      const hit = svg('rect', { class: 'node', x: x - 10, y: (n.y - 3).toFixed(1), width: nw + 20, height: (Math.max(1.5, n.h) + 6).toFixed(1), fill: 'transparent' });
      const info = { id, n };
      for (const el of [rect, hit]) {
        el.addEventListener('pointerenter', (ev) => focus(info, ev));
        el.addEventListener('pointermove', (ev) => focus(info, ev));
        el.addEventListener('pointerleave', blur);
        el.addEventListener('click', (ev) => { ev.stopPropagation(); pin(info, ev); });
      }
      rect.addEventListener('focus', () => { const b = rect.getBoundingClientRect(); focus(info, { clientX: b.right, clientY: b.top }); });
      rect.addEventListener('blur', blur);
      nodeG.append(hit, rect);
      const showText = above || n.h >= 9 || id.startsWith('R');
      if (showText) {
        const y = above ? n.y - 7 : n.y + Math.max(1.5, n.h) / 2 + 3.5;
        const t = svg('text', { class: 'halo val', x: labelX, y: y.toFixed(1), 'text-anchor': anchor });
        t.append(svg('tspan', { class: n.addr ? '' : 'lbl' }, small ? n.label.replace('Other single-winner wallets', 'Other winners').replace('Multi-winner splits', 'Multi-winner').replace('Rest of posters', 'Others').replace('Platform fees', 'Fees') : n.label));
        if (!small) t.append(svg('tspan', { dx: 8, fill: COLOR.muted }, fmtUsd(n.usd)));
        labels.push({ id, node: t });
        labelG.append(t);
      }
    };
    L.forEach((n, i) => addNode(`L${i}`, n, xL, COLOR.muted, xL + nw + 6, 'start', false));
    M.forEach((n) => addNode(`M${n.i}`, n, xM, n.key === 'died' ? COLOR.line : OUTCOME_COLOR[n.key], xM + nw / 2, 'middle', true));
    R.forEach((n, i) => addNode(`R${i}`, n, xR, n.isFee ? COLOR.muted : COLOR.cream, xR - 6, 'end', false));
    // died gate needs an outline to read against the panel
    M.filter((g) => g.key === 'died').forEach((g) => nodeG.append(svg('rect', { x: xM + 0.5, y: (g.y + 0.5).toFixed(1), width: nw - 1, height: Math.max(1, g.h - 1).toFixed(1), rx: 2, fill: 'none', stroke: COLOR.muted, 'pointer-events': 'none' })));

    let pinned = null;
    function paint(info) {
      const touches = (l) => !info || l.a === info.id || l.b === info.id || (info.link && l === info.link);
      for (const l of links) {
        const on = info ? (info.link ? l === info.link : touches(l)) : false;
        l.node.classList.toggle('hot', !!info && on);
        l.node.classList.toggle('dim', !!info && !on);
      }
      const lit = new Set();
      if (info) for (const l of links) if (info.link ? l === info.link : touches(l)) { lit.add(l.a); lit.add(l.b); }
      for (const lab of labels) lab.node.classList.toggle('dim', !!info && !lit.has(lab.id));
    }
    function tip(info, ev) {
      if (info.link) { showTip(ev.clientX, ev.clientY, info.link.title, [['Reward', fmtUsd(info.link.usd)], ['Tasks', fmtInt(info.link.n)], ['Share of total', fmtPct((info.link.usd / s.totalUsd) * 100)]]); return; }
      const n = info.n;
      const rows = [['Reward', fmtUsd(n.usd)], ['Tasks', fmtInt(n.tasks)], ['Share of total', fmtPct((n.usd / s.totalUsd) * 100)]];
      if (n.wallets > 1) rows.push(['Wallets', fmtInt(n.wallets)]);
      showTip(ev.clientX, ev.clientY, n.long || n.label, rows, n.addr || null);
    }
    function focus(info, ev) { paint(info); tip(info, ev); }
    function blur() { hideTip(); paint(pinned); }
    function pin(info, ev) { pinned = pinned && pinned.id === info.id && pinned.link === info.link ? null : info; paint(pinned); if (pinned) tip(info, ev); else hideTip(); }
    for (const l of links) {
      const info = { id: null, link: l };
      l.node.addEventListener('pointerenter', (ev) => focus(info, ev));
      l.node.addEventListener('pointermove', (ev) => focus(info, ev));
      l.node.addEventListener('pointerleave', blur);
      l.node.addEventListener('click', (ev) => { ev.stopPropagation(); pin(info, ev); });
    }
    root$.addEventListener('click', () => { pinned = null; paint(null); hideTip(); });

    root$.append(linkG, nodeG, labelG);
    clear(card).append(root$);
  }

  build();
}
