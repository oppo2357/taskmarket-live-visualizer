// Proportional bars built from plain HTML: status and mode structure,
// tasks that died, the past-deadline backlog and the chain comparison.
import { h, clear, fmtInt, fmtUsd, fmtPct, fmtHours, fmtTime, pillRow, tableView, state, CHAIN_NAME } from './viz-core.mjs';

const pretty = (key) => String(key).replace(/_/g, ' ');
const share = (n, total) => (total ? (n / total) * 100 : 0);

/** One labelled bar. `width` is 0..100. */
function barRow({ name, swatch, width, value, small, cls = '', title, stackSmall = false }) {
  return h('div', { class: 'bar-row', title },
    h('span', { class: 'name' }, swatch ? h('i', { class: `sw ${swatch}` }) : null, h('span', { text: name })),
    h('span', { class: 'track' }, h('span', { class: `fill ${cls} ${width <= 0 ? 'zero' : ''}`, style: `width:${Math.max(0, Math.min(100, width)).toFixed(2)}%` })),
    h('span', { class: `num${stackSmall ? ' stacked' : ''}` }, h('span', { text: value }), small ? h('small', { text: small }) : null));
}

const SCOPE_OPTIONS = [{ value: 'all', label: 'All' }, { value: 'tempo', label: 'Tempo' }, { value: 'base', label: 'Base' }];

// ---------- overview: mode and status structure ----------
export function structure(root, d) {
  const b = d.breakdowns, pub = b.publicTasks, p = b.platform;
  const maxStatus = Math.max(...p.status.map((r) => r.count));
  const maxMode = Math.max(...p.mode.map((r) => r.count));

  const statusCard = h('div', { class: 'card' },
    h('h3', { text: 'Tasks by status' }),
    h('p', { class: 'sub', text: `${fmtInt(p.totalTasks)} tasks on the platform, both chains.` }),
    h('div', { class: 'bars' }, p.status.map((r) => barRow({ name: pretty(r.key), width: share(r.count, maxStatus), value: fmtInt(r.count), small: fmtPct(share(r.count, p.totalTasks)) }))),
    tableView('Per chain, from the public task list', [
      { label: 'Status', get: (r) => pretty(r.key) },
      { label: 'Platform', get: (r) => r.count, fmt: fmtInt },
      { label: 'Tempo', get: (r) => pub.tempo.status[r.key] || 0, fmt: fmtInt },
      { label: 'Base', get: (r) => pub.base.status[r.key] || 0, fmt: fmtInt },
      { label: 'Not listed', get: (r) => b.unlisted.byStatus[r.key] || 0, fmt: fmtInt },
    ], p.status));

  const modeCard = h('div', { class: 'card' },
    h('h3', { text: 'Tasks by mode' }),
    h('p', { class: 'sub', text: 'Bounty: many submit, the requester picks. Claim: one worker reserves the task.' }),
    h('div', { class: 'bars' }, p.mode.map((r) => barRow({ name: pretty(r.key), width: share(r.count, maxMode), value: fmtInt(r.count), small: fmtPct(share(r.count, p.totalTasks)) }))),
    tableView('Per chain, from the public task list', [
      { label: 'Mode', get: (r) => pretty(r.key) },
      { label: 'Platform', get: (r) => r.count, fmt: fmtInt },
      { label: 'Tempo', get: (r) => pub.tempo.mode[r.key] || 0, fmt: fmtInt },
      { label: 'Base', get: (r) => pub.base.mode[r.key] || 0, fmt: fmtInt },
      { label: 'Not listed', get: (r) => b.unlisted.byMode[r.key] || 0, fmt: fmtInt },
    ], p.mode));

  // "Open" in the breakdown hides two very different states.
  const openTotal = (p.status.find((r) => r.key === 'open') || { count: 0 }).count;
  const live = pub.all.lifecycle.live.tasks, stale = pub.all.lifecycle.stale.tasks;
  const unlistedOpen = b.unlisted.byStatus.open || 0;
  const openCard = h('div', { class: 'card' },
    h('h3', { text: 'What "open" hides' }),
    h('p', { class: 'sub', text: `The breakdown counts ${fmtInt(openTotal)} open tasks. Only ${fmtInt(live)} still take submissions.` }),
    h('div', { class: 'stack', role: 'img', 'aria-label': `${live} live, ${stale} past deadline, ${unlistedOpen} not in the public list` },
      h('i', { class: 'live', style: `flex:${live}` }), h('i', { class: 'stale', style: `flex:${stale}` }), unlistedOpen ? h('i', { class: 'unlisted', style: `flex:${unlistedOpen}` }) : null),
    h('div', { class: 'bars' },
      barRow({ name: 'Live open', swatch: 'live', cls: 'live', width: share(live, openTotal), value: fmtInt(live), stackSmall: true, small: `${fmtInt(pub.tempo.lifecycle.live.tasks)} Tempo · ${fmtInt(pub.base.lifecycle.live.tasks)} Base` }),
      barRow({ name: 'Past deadline', swatch: 'stale', cls: 'stale', width: share(stale, openTotal), value: fmtInt(stale), stackSmall: true, small: `${fmtInt(pub.tempo.lifecycle.stale.tasks)} Tempo · ${fmtInt(pub.base.lifecycle.stale.tasks)} Base` }),
      unlistedOpen ? barRow({ name: 'Not in public list', width: share(unlistedOpen, openTotal), cls: 'died', value: fmtInt(unlistedOpen) }) : null),
    h('p', { class: 'note', text: 'Past deadline means the status is still open but the submission window has closed: the requester has not yet picked a winner or reclaimed the reward.' }));

  const actorMax = Math.max(...p.actorType.map((r) => r.count));
  const actorCard = h('div', { class: 'card' },
    h('h3', { text: 'Registered actors by type' }),
    h('p', { class: 'sub', text: `${fmtInt(p.totalActors)} registered, as the breakdown reports them.` }),
    h('div', { class: 'bars' }, p.actorType.map((r) => barRow({ name: pretty(r.key), width: share(r.count, actorMax), value: fmtInt(r.count), small: fmtPct(share(r.count, p.totalActors)) }))));

  root.append(h('div', { class: 'grid two' }, statusCard, openCard, modeCard, actorCard));
}

// ---------- flows: tasks that died ----------
export function mortality(root, d) {
  const m = d.mortality;
  let scope = state.get('died', 'all', ['all', 'tempo', 'base']);
  const tierCard = h('div', { class: 'card' });
  const chainCard = h('div', { class: 'card' },
    h('h3', { text: 'By chain' }),
    h('p', { class: 'sub', text: 'Share of public tasks that expired or were cancelled.' }),
    h('div', { class: 'bars' }, ['tempo', 'base'].map((k) => barRow({
      name: k === 'tempo' ? 'Tempo' : 'Base', cls: 'died', width: m.byChain[k].diedPct,
      value: fmtPct(m.byChain[k].diedPct), small: `${fmtInt(m.byChain[k].died)} of ${fmtInt(m.byChain[k].tasks)}`,
    }))),
    tableView('Table view', [
      { label: 'Chain', get: (k) => (k === 'all' ? 'Both' : k === 'tempo' ? 'Tempo' : 'Base') },
      { label: 'Public tasks', get: (k) => m.byChain[k].tasks, fmt: fmtInt },
      { label: 'Expired', get: (k) => m.byChain[k].expired, fmt: fmtInt },
      { label: 'Cancelled', get: (k) => m.byChain[k].cancelled, fmt: fmtInt },
      { label: 'Died %', get: (k) => m.byChain[k].diedPct, fmt: fmtPct },
      { label: 'Reward in died tasks', get: (k) => m.byChain[k].diedUsd, fmt: fmtUsd },
      { label: 'Completed %', get: (k) => m.byChain[k].completedPct, fmt: fmtPct },
    ], ['tempo', 'base', 'all']),
    h('p', { class: 'note', text: `${fmtInt(m.diedWithWork.all.withSubmissions)} of the ${fmtInt(m.diedWithWork.all.died)} tasks that died had already received work: ${fmtInt(m.diedWithWork.all.submissions)} submissions in all.` }));

  const drawTier = () => {
    clear(tierCard).append(
      h('h3', { text: 'By reward size' }),
      h('p', { class: 'sub', text: 'Share of tasks in each reward tier that died.' }),
      h('div', { class: 'controls' }, pillRow({ label: 'chain', value: scope, options: SCOPE_OPTIONS, onChange: (v) => { scope = v; state.set('died', v, 'all'); drawTier(); } })),
      h('div', { class: 'bars' }, m.byTier.map((t) => barRow({
        name: t.label, cls: 'died', width: t[scope].diedPct,
        value: t[scope].tasks ? fmtPct(t[scope].diedPct) : 'n/a', small: `${fmtInt(t[scope].died)} of ${fmtInt(t[scope].tasks)}`,
      }))),
      tableView('Table view', [
        { label: 'Reward tier', get: (t) => t.label },
        { label: 'Tasks', get: (t) => t[scope].tasks, fmt: fmtInt },
        { label: 'Expired', get: (t) => t[scope].expired, fmt: fmtInt },
        { label: 'Cancelled', get: (t) => t[scope].cancelled, fmt: fmtInt },
        { label: 'Died %', get: (t) => t[scope].diedPct, fmt: fmtPct },
        { label: 'Reward in died tasks', get: (t) => t[scope].diedUsd, fmt: fmtUsd },
      ], m.byTier));
  };
  drawTier();
  root.append(h('div', { class: 'grid two' }, chainCard, tierCard));
}

// ---------- flows: submission window and the past-deadline backlog ----------
export function backlog(root, d) {
  const w = d.windows;
  let scope = state.get('backlog', 'all', ['all', 'tempo', 'base']);
  const windowCard = h('div', { class: 'card' },
    h('h3', { text: 'How long tasks stay open' }),
    h('p', { class: 'sub', text: 'The submission window: deadline minus posting time, for every public task.' }),
    h('div', { class: 'river-summary', style: 'grid-template-columns:repeat(2,minmax(0,1fr))' }, ['tempo', 'base'].flatMap((k) => [
      h('div', {}, h('div', { class: 'k', text: `${k === 'tempo' ? 'Tempo' : 'Base'} median` }), h('div', { class: 'v', text: fmtHours(w[k].windowMedianHours) }), h('div', { class: 's', text: `${fmtInt(w[k].tasks)} tasks` })),
      h('div', {}, h('div', { class: 'k', text: `${k === 'tempo' ? 'Tempo' : 'Base'} 75th percentile` }), h('div', { class: 'v', text: fmtHours(w[k].windowP75Hours) }), h('div', { class: 's', text: 'three in four are shorter' })),
    ])),
    h('p', { class: 'note', text: 'The task list carries a posting time and a deadline but no decision time, so this page does not state a time to decision. It shows what the API does give: the window, and how long past-deadline tasks have been waiting.' }));

  const staleCard = h('div', { class: 'card' });
  const drawStale = () => {
    const s = w[scope].stale;
    const max = Math.max(1, ...s.ageBuckets.map((b) => b.tasks));
    clear(staleCard).append(
      h('h3', { text: 'The past-deadline queue' }),
      h('p', { class: 'sub', text: 'Open tasks whose window has closed, by how long ago the deadline passed.' }),
      h('div', { class: 'controls' }, pillRow({ label: 'chain', value: scope, options: SCOPE_OPTIONS, onChange: (v) => { scope = v; state.set('backlog', v, 'all'); drawStale(); } })),
      h('div', { class: 'bars' }, s.ageBuckets.map((b) => barRow({ name: b.label, cls: 'stale', width: share(b.tasks, max), value: fmtInt(b.tasks), small: fmtUsd(b.usd) }))),
      h('div', { class: 'river-summary', style: 'grid-template-columns:repeat(2,minmax(0,1fr))' },
        h('div', {}, h('div', { class: 'k', text: 'Tasks waiting' }), h('div', { class: 'v', text: fmtInt(s.tasks) }), h('div', { class: 's', text: `${fmtUsd(s.usd)} in rewards` })),
        h('div', {}, h('div', { class: 'k', text: 'Submissions waiting' }), h('div', { class: 'v', text: fmtInt(s.submissions) }), h('div', { class: 's', text: `on ${fmtInt(s.withSubmissions)} of those tasks` })),
        h('div', {}, h('div', { class: 'k', text: 'Median wait' }), h('div', { class: 'v', text: fmtHours(s.ageMedianHours) }), h('div', { class: 's', text: 'since the deadline' })),
        h('div', {}, h('div', { class: 'k', text: 'Longest wait' }), h('div', { class: 'v', text: fmtHours(s.ageMaxHours) }),
          h('div', { class: 's' }, s.oldest ? h('a', { href: `https://taskmarket.dev/tasks/${s.oldest.id}`, target: '_blank', rel: 'noopener', text: `${s.oldest.ref}, ${CHAIN_NAME[s.oldest.chainId] || ''}` }) : 'n/a'))),
      h('p', { class: 'note', text: `Waits are measured from each task's deadline to the data time, ${fmtTime(d.meta.dataAsOf)}.` }));
  };
  drawStale();
  root.append(h('div', { class: 'grid two' }, windowCard, staleCard));
}

// ---------- chains: head to head ----------
export function chainDuel(root, d) {
  const t = d.chains.tempo, b = d.chains.base;
  const count = (label, key, note) => ({ label, note, tv: t[key], bv: b[key], fmt: fmtInt, kind: 'abs' });
  const money = (label, key, note) => ({ label, note, tv: t[key], bv: b[key], fmt: fmtUsd, kind: 'abs' });
  const percent = (label, key, note) => ({ label, note, tv: t[key], bv: b[key], fmt: fmtPct, kind: 'pct' });
  const groups = [
    { title: 'chain-scoped headline numbers, from /api/market/stats', rows: [
      count('Paid workers', 'paidWorkers', 'wallets paid at least once'),
      count('Active wallets', 'activeWallets'),
    ] },
    { title: 'size, from the public task list', rows: [
      count('Public tasks', 'tasks'),
      money('Rewards put up', 'usd', `${t.token} on Tempo, ${b.token} on Base`),
      { label: 'Median reward', tv: t.medianRewardUsd, bv: b.medianRewardUsd, fmt: fmtUsd, kind: 'abs' },
      count('Wallets that posted', 'posters'),
    ] },
    { title: 'outcomes', rows: [
      percent('Completed', 'completedPct', 'share of public tasks'),
      percent('Died', 'diedPct', 'expired or cancelled'),
      { label: 'Live open now', tv: t.lifecycle.live.tasks, bv: b.lifecycle.live.tasks, fmt: fmtInt, kind: 'abs' },
      { label: 'Past deadline, undecided', tv: t.lifecycle.stale.tasks, bv: b.lifecycle.stale.tasks, fmt: fmtInt, kind: 'abs' },
      percent('Reward dollars in completed tasks', 'paidUsdPct'),
    ] },
    { title: 'how the work runs', rows: [
      percent('Bounty mode', 'bountyPct', 'many submit, requester picks'),
      percent('Claim mode', 'claimPct', 'one worker reserves the task'),
      { label: 'Median submissions per task', tv: t.medianSubmissions, bv: b.medianSubmissions, fmt: (v) => fmtInt(v), kind: 'abs' },
      count('Submissions in all', 'totalSubmissions'),
      percent('Completed tasks with several winners', 'multiWinnerPct'),
      { label: 'Median submission window', tv: t.windowMedianHours, bv: b.windowMedianHours, fmt: fmtHours, kind: 'abs' },
    ] },
    { title: 'who posts', rows: [
      percent('Top 3 posters, share of dollars', 'top3UsdPct'),
      { label: 'Gini of dollars by poster', note: '0 is even, 1 is one wallet', tv: t.giniUsd * 100, bv: b.giniUsd * 100, fmt: (v) => (v / 100).toFixed(3), kind: 'pct' },
    ] },
  ];
  const duel = h('div', { class: 'duel' },
    h('div', { class: 'duel-head' },
      h('div', { class: 'name t' }, h('span', { text: 'Tempo' }), h('i', { class: 'sw tempo' })),
      h('div', { class: 'mid' }, h('small', { text: `${t.token} vs ${b.token}` })),
      h('div', { class: 'name' }, h('i', { class: 'sw base' }), h('span', { text: 'Base' }))));
  for (const g of groups) {
    duel.append(h('div', { class: 'duel-group', text: g.title }));
    for (const r of g.rows) {
      const max = r.kind === 'pct' ? 100 : Math.max(r.tv || 0, r.bv || 0, 1e-9);
      const side = (v, cls) => h('div', { class: `duel-side ${cls}` },
        h('div', { class: 'v', text: v == null ? 'n/a' : r.fmt(v) }),
        h('div', { class: 'b' }, h('i', { style: `width:${Math.max(0, Math.min(100, ((v || 0) / max) * 100)).toFixed(2)}%` })));
      duel.append(h('div', { class: 'duel-row' },
        h('div', { class: 'what' }, h('span', { text: r.label }), r.note ? h('small', { text: r.note }) : null),
        side(r.tv, 't'), side(r.bv, 'b2')));
    }
  }
  root.append(h('div', { class: 'card' }, duel,
    tableView('Table view', [
      { label: 'Metric', get: (r) => r.label },
      { label: 'Tempo', get: (r) => (r.tv == null ? 'n/a' : r.fmt(r.tv)) },
      { label: 'Base', get: (r) => (r.bv == null ? 'n/a' : r.fmt(r.bv)) },
    ], groups.flatMap((g) => g.rows))));
}
