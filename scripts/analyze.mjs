// Turns the raw API snapshot into everything the site draws.
//
//   import { analyze } from './analyze.mjs'
//   const { market, verify } = analyze(snapshot)
//
// Pure: no network, no clock, no randomness. Every number is computed from
// `.cache/snapshot.json`, which holds API responses as received. Money is
// summed in integer micro-units (the API's 6-decimal strings) and only divided
// by 1e6 on the way out, so totals reconcile to the cent.
//
// Wallets are only ever shown as truncated hex (0xeecd…a5e2). No names.
import { reconcile } from './fetch-data.mjs';

export const SCOPES = [
  { key: 'all', label: 'All', chainId: null },
  { key: 'tempo', label: 'Tempo', chainId: 4217 },
  { key: 'base', label: 'Base', chainId: 8453 },
];
export const OUTCOMES = [
  { key: 'paid', label: 'Paid', long: 'Paid: completed' },
  { key: 'live', label: 'Live open', long: 'Live open: taking submissions' },
  { key: 'stale', label: 'Past deadline', long: 'Past deadline: awaiting a decision' },
  { key: 'progress', label: 'In progress', long: 'In progress: claimed or pending approval' },
  { key: 'died', label: 'Died', long: 'Died: expired or cancelled' },
];
export const TIERS = [
  { key: 'lt1', label: 'under $1', min: 0, max: 1 },
  { key: '1to5', label: '$1 to $4.99', min: 1, max: 5 },
  { key: '5to10', label: '$5 to $9.99', min: 5, max: 10 },
  { key: 'gte10', label: '$10 and up', min: 10, max: Infinity },
];
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TOP_N = 8;

// ---------- small helpers ----------
const lower = (a) => (a ? String(a).toLowerCase() : null);
export const shortHex = (a) => (a ? `${lower(a).slice(0, 6)}…${lower(a).slice(-4)}` : null);
const micro = (v) => Number(BigInt(v ?? 0)); // safe: totals are far below 2^53
const usd = (m) => Math.round(m) / 1e6;
const pct = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const sum = (list, fn = (x) => x) => list.reduce((acc, x) => acc + fn(x), 0);

function quantile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const pos = (sortedAsc.length - 1) * p;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}
const sortedNums = (list) => [...list].sort((a, b) => a - b);

export function outcomeOf(t) {
  if (t.status === 'completed') return 'paid';
  if (t.status === 'open') return t.submissionWindowOpen ? 'live' : 'stale';
  if (t.status === 'expired' || t.status === 'cancelled') return 'died';
  return 'progress'; // claimed, pending_approval, worker_selected, anything new
}

function isoWeekStart(iso) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}
const addDays = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function formatAsOf(iso) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
const fmtUsd = (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (v) => v.toLocaleString('en-US');
const fmtDuration = (hours) => {
  if (hours == null) return 'n/a';
  if (hours < 48) return `${round(hours, 1)} hours`;
  return `${round(hours / 24, 1)} days`;
};

// ---------- sections ----------
function buildHeadlines(snap) {
  const [a, b] = snap.chains.map((c) => snap.marketStats[c.id]);
  const platformKeys = ['registeredWorkers', 'activeWorkers7d', 'activeAgents7d', 'openTasks'];
  const chainKeys = ['paidWorkers', 'activeWallets'];
  const platform = {}, identical = {};
  for (const k of platformKeys) { platform[k] = a[k]; identical[k] = a[k] === b[k]; }
  const byChain = {};
  for (const c of snap.chains) {
    byChain[c.key] = {};
    for (const k of chainKeys) byChain[c.key][k] = snap.marketStats[c.id][k];
  }
  // A field only counts as platform-wide if both chainId calls return the same value.
  return { platform, byChain, platformFieldsIdentical: identical, allPlatformIdentical: Object.values(identical).every(Boolean) };
}

function buildSeries(snap) {
  const out = {};
  for (const [key, entry] of Object.entries(snap.timeSeries)) {
    const rows = entry.scope === 'platform' ? entry.data : entry.byChain[snap.chains[0].id];
    out[key] = {
      bucket: rows.map((r) => r.bucket),
      activeAgents: rows.map((r) => r.activeAgents),
      tasksCreated: rows.map((r) => r.tasksCreated),
      rewardVolume: rows.map((r) => usd(micro(r.rewardVolume))),
      paidVolume: rows.map((r) => usd(micro(r.paidVolume))),
      completedTasks: rows.map((r) => r.completedTasks),
      settlements: rows.map((r) => r.settlements),
    };
  }
  return out;
}

function tally(tasks) {
  const status = {}, mode = {}, lifecycle = {};
  for (const o of OUTCOMES) lifecycle[o.key] = { tasks: 0, usdMicro: 0 };
  lifecycle.died.expired = 0; lifecycle.died.cancelled = 0;
  let totalMicro = 0;
  for (const t of tasks) {
    status[t.status] = (status[t.status] || 0) + 1;
    mode[t.mode] = (mode[t.mode] || 0) + 1;
    const o = lifecycle[outcomeOf(t)];
    o.tasks++; o.usdMicro += micro(t.reward);
    if (t.status === 'expired') lifecycle.died.expired++;
    if (t.status === 'cancelled') lifecycle.died.cancelled++;
    totalMicro += micro(t.reward);
  }
  for (const o of OUTCOMES) { lifecycle[o.key].usd = usd(lifecycle[o.key].usdMicro); delete lifecycle[o.key].usdMicro; }
  return { total: tasks.length, usd: usd(totalMicro), status, mode, lifecycle };
}

function buildBreakdowns(snap, byScope, rec) {
  const b = snap.breakdowns[snap.chains[0].id];
  const list = (field) => [...(b[field] || [])].map((r) => ({ key: r[field], count: r.count })).sort((x, y) => y.count - x.count);
  const platform = { status: list('status'), mode: list('mode'), actorType: list('actorType') };
  platform.totalTasks = sum(platform.status, (r) => r.count);
  platform.totalActors = sum(platform.actorType, (r) => r.count);
  const publicTasks = {};
  for (const s of SCOPES) publicTasks[s.key] = tally(byScope[s.key]);
  return {
    platform,
    identicalAcrossChains: snap.fetchMeta.breakdownsIdenticalAcrossChains,
    publicTasks,
    unlisted: { total: rec.unlistedTotal, byStatus: rec.unlistedByStatus, byMode: rec.unlistedByMode },
  };
}

function buildSwarm(tasks) {
  return {
    fields: ['id', 'ref', 'chainId', 'status', 'submissionWindowOpen', 'mode', 'rewardUsd', 'submissionCount', 'awardCount', 'requesterShort', 'winnerShort', 'createdAt', 'expiryTime'],
    note: 'createdAt and expiryTime are Unix seconds (UTC). winnerShort is primaryAward.workerAddress, truncated.',
    tasks: tasks.map((t) => [
      t.id, t.referenceCode, t.chainId, t.status, t.submissionWindowOpen ? 1 : 0, t.mode,
      usd(micro(t.reward)), t.submissionCount, t.awardCount,
      shortHex(t.requester), shortHex(t.primaryAward?.workerAddress),
      Math.floor(Date.parse(t.createdAt) / 1000), Math.floor(Date.parse(t.expiryTime) / 1000),
    ]),
  };
}

function buildSankey(tasks) {
  const posterMap = new Map(); // addr -> { usdMicro, tasks, byGate }
  const gateIndex = Object.fromEntries(OUTCOMES.map((o, i) => [o.key, i]));
  let totalMicro = 0;
  for (const t of tasks) {
    const a = lower(t.requester), m = micro(t.reward), g = outcomeOf(t);
    let p = posterMap.get(a);
    if (!p) posterMap.set(a, (p = { addr: a, usdMicro: 0, tasks: 0, byGate: {} }));
    p.usdMicro += m; p.tasks++;
    (p.byGate[g] ||= { usdMicro: 0, tasks: 0 });
    p.byGate[g].usdMicro += m; p.byGate[g].tasks++;
    totalMicro += m;
  }
  const ranked = [...posterMap.values()].sort((x, y) => y.usdMicro - x.usdMicro || y.tasks - x.tasks || (x.addr < y.addr ? -1 : 1));
  const top = ranked.slice(0, TOP_N), rest = ranked.slice(TOP_N);
  const posters = top.map((p) => ({ addr: p.addr, label: shortHex(p.addr), wallets: 1, usdMicro: p.usdMicro, tasks: p.tasks, byGate: p.byGate }));
  if (rest.length) {
    const agg = { addr: null, label: 'Rest of posters', wallets: rest.length, usdMicro: 0, tasks: 0, byGate: {} };
    for (const p of rest) {
      agg.usdMicro += p.usdMicro; agg.tasks += p.tasks;
      for (const [g, v] of Object.entries(p.byGate)) { (agg.byGate[g] ||= { usdMicro: 0, tasks: 0 }); agg.byGate[g].usdMicro += v.usdMicro; agg.byGate[g].tasks += v.tasks; }
    }
    posters.push(agg);
  }
  const gates = OUTCOMES.map((o) => ({ key: o.key, label: o.label, long: o.long, usdMicro: 0, tasks: 0 }));
  const linksIn = [];
  posters.forEach((p, pi) => {
    for (const o of OUTCOMES) {
      const v = p.byGate[o.key];
      if (!v) continue;
      gates[gateIndex[o.key]].usdMicro += v.usdMicro; gates[gateIndex[o.key]].tasks += v.tasks;
      linksIn.push([pi, gateIndex[o.key], v.usdMicro, v.tasks]);
    }
  });

  // Right side: only paid escrow moves on to a winner.
  const winMap = new Map();
  const multi = { addr: null, label: 'Multi-winner splits', wallets: null, usdMicro: 0, tasks: 0 };
  const unknown = { addr: null, label: 'Winner not listed', wallets: null, usdMicro: 0, tasks: 0 };
  for (const t of tasks) {
    if (outcomeOf(t) !== 'paid') continue;
    const m = micro(t.reward);
    if (t.awardCount > 1) { multi.usdMicro += m; multi.tasks++; continue; }
    const a = lower(t.primaryAward?.workerAddress);
    if (t.awardCount !== 1 || !a) { unknown.usdMicro += m; unknown.tasks++; continue; }
    let w = winMap.get(a);
    if (!w) winMap.set(a, (w = { addr: a, usdMicro: 0, tasks: 0 }));
    w.usdMicro += m; w.tasks++;
  }
  const wRanked = [...winMap.values()].sort((x, y) => y.usdMicro - x.usdMicro || y.tasks - x.tasks || (x.addr < y.addr ? -1 : 1));
  const winners = wRanked.slice(0, TOP_N).map((w) => ({ addr: w.addr, label: shortHex(w.addr), wallets: 1, usdMicro: w.usdMicro, tasks: w.tasks }));
  const wRest = wRanked.slice(TOP_N);
  if (wRest.length) winners.push({ addr: null, label: 'Other single-winner wallets', wallets: wRest.length, usdMicro: sum(wRest, (w) => w.usdMicro), tasks: sum(wRest, (w) => w.tasks) });
  if (multi.tasks) winners.push(multi);
  if (unknown.tasks) winners.push(unknown);
  const paidIdx = gateIndex.paid;
  const linksOut = winners.map((w, wi) => [paidIdx, wi, w.usdMicro, w.tasks]);

  const check = {
    totalUsd: usd(totalMicro),
    postersUsd: usd(sum(posters, (p) => p.usdMicro)),
    gatesUsd: usd(sum(gates, (g) => g.usdMicro)),
    linksInUsd: usd(sum(linksIn, (l) => l[2])),
    paidUsd: usd(gates[paidIdx].usdMicro),
    winnersUsd: usd(sum(winners, (w) => w.usdMicro)),
    linksOutUsd: usd(sum(linksOut, (l) => l[2])),
  };
  check.ok = [check.postersUsd, check.gatesUsd, check.linksInUsd].every((v) => Math.abs(v - check.totalUsd) < 0.01)
    && [check.winnersUsd, check.linksOutUsd].every((v) => Math.abs(v - check.paidUsd) < 0.01);

  const clean = (n) => { const { usdMicro, byGate, ...rest } = n; return { ...rest, usd: usd(usdMicro) }; };
  return {
    totalUsd: usd(totalMicro),
    totalTasks: tasks.length,
    posterWallets: posterMap.size,
    winnerWallets: winMap.size,
    posters: posters.map(clean),
    gates: gates.map(clean),
    winners: winners.map(clean),
    linksIn: linksIn.map(([a, b, m, n]) => [a, b, usd(m), n]),
    linksOut: linksOut.map(([a, b, m, n]) => [a, b, usd(m), n]),
    check,
  };
}

function buildWeeklyPosters(snap, tasks) {
  if (!tasks.length) return { weeks: [], note: '' };
  const firstSeen = new Map(); // addr -> first week
  const weeks = new Map();
  const ordered = [...tasks].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const t of ordered) {
    const w = isoWeekStart(t.createdAt), a = lower(t.requester);
    let row = weeks.get(w);
    if (!row) weeks.set(w, (row = { all: new Set(), 4217: new Set(), 8453: new Set(), fresh: new Set(), tasks: { 4217: 0, 8453: 0 } }));
    row.all.add(a); row[t.chainId]?.add(a);
    if (row.tasks[t.chainId] != null) row.tasks[t.chainId]++;
    if (!firstSeen.has(a)) { firstSeen.set(a, w); row.fresh.add(a); }
  }
  const first = isoWeekStart(ordered[0].createdAt), last = isoWeekStart(snap.dataAsOf);
  const out = [];
  for (let w = first; w <= last; w = addDays(w, 7)) {
    const r = weeks.get(w);
    out.push({
      week: w,
      combined: r ? r.all.size : 0,
      tempo: r ? r[4217].size : 0,
      base: r ? r[8453].size : 0,
      firstTime: r ? r.fresh.size : 0,
      tempoTasks: r ? r.tasks[4217] : 0,
      baseTasks: r ? r.tasks[8453] : 0,
      partial: w === last,
    });
  }
  return { weeks: out, note: 'Weeks start Monday 00:00 UTC (ISO weeks). Combined counts a wallet once even if it posted on both chains.' };
}

function gini(valuesAsc) {
  const n = valuesAsc.length, total = sum(valuesAsc);
  if (!n || !total) return 0;
  let weighted = 0;
  valuesAsc.forEach((v, i) => { weighted += (i + 1) * v; });
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

function posterStats(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const a = lower(t.requester);
    let p = map.get(a);
    if (!p) map.set(a, (p = { addr: a, tasks: 0, usdMicro: 0, paid: 0, died: 0, live: 0, stale: 0, progress: 0, chains: {} }));
    p.tasks++; p.usdMicro += micro(t.reward); p[outcomeOf(t)]++;
    p.chains[t.chainId] = (p.chains[t.chainId] || 0) + 1;
  }
  return [...map.values()];
}

function buildConcentration(tasks) {
  const posters = posterStats(tasks);
  const n = posters.length;
  const totalMicro = sum(posters, (p) => p.usdMicro), totalTasks = tasks.length;
  const byUsdAsc = sortedNums(posters.map((p) => p.usdMicro));
  const byTasksAsc = sortedNums(posters.map((p) => p.tasks));
  const lorenz = [[0, 0]];
  let cum = 0;
  byUsdAsc.forEach((v, i) => { cum += v; lorenz.push([round(((i + 1) / n) * 100, 2), round(totalMicro ? (cum / totalMicro) * 100 : 0, 2)]); });
  const topShare = (asc, total, k) => pct(sum(asc.slice(-k)), total);
  const share = (k) => ({ usdPct: topShare(byUsdAsc, totalMicro, k), tasksPct: topShare(byTasksAsc, totalTasks, k) });
  return {
    posters: n,
    tasks: totalTasks,
    usd: usd(totalMicro),
    giniUsd: round(gini(byUsdAsc), 3),
    giniTasks: round(gini(byTasksAsc), 3),
    top1: share(1), top3: share(3), top10: share(10),
    lorenz,
  };
}

function buildTopPosters(tasks, limit = 12) {
  return posterStats(tasks)
    .sort((a, b) => b.usdMicro - a.usdMicro || b.tasks - a.tasks || (a.addr < b.addr ? -1 : 1))
    .slice(0, limit)
    .map((p, i) => ({
      rank: i + 1,
      addr: p.addr,
      short: shortHex(p.addr),
      tasks: p.tasks,
      usd: usd(p.usdMicro),
      completedPct: pct(p.paid, p.tasks),
      diedPct: pct(p.died, p.tasks),
      openPct: pct(p.live + p.stale + p.progress, p.tasks),
      tempoTasks: p.chains[4217] || 0,
      baseTasks: p.chains[8453] || 0,
    }));
}

function mortalityRow(tasks) {
  const died = tasks.filter((t) => outcomeOf(t) === 'died');
  return {
    tasks: tasks.length,
    usd: usd(sum(tasks, (t) => micro(t.reward))),
    died: died.length,
    diedPct: pct(died.length, tasks.length),
    expired: died.filter((t) => t.status === 'expired').length,
    cancelled: died.filter((t) => t.status === 'cancelled').length,
    diedUsd: usd(sum(died, (t) => micro(t.reward))),
    completed: tasks.filter((t) => t.status === 'completed').length,
    completedPct: pct(tasks.filter((t) => t.status === 'completed').length, tasks.length),
  };
}

function buildMortality(byScope) {
  const byChain = {}, byTier = [];
  for (const s of SCOPES) byChain[s.key] = mortalityRow(byScope[s.key]);
  for (const tier of TIERS) {
    const row = { key: tier.key, label: tier.label };
    for (const s of SCOPES) {
      row[s.key] = mortalityRow(byScope[s.key].filter((t) => { const r = micro(t.reward) / 1e6; return r >= tier.min && r < tier.max; }));
    }
    byTier.push(row);
  }
  // Died tasks that had attracted work: the costliest kind of death.
  const diedWithWork = {};
  for (const s of SCOPES) {
    const died = byScope[s.key].filter((t) => outcomeOf(t) === 'died');
    const withSubs = died.filter((t) => t.submissionCount > 0);
    diedWithWork[s.key] = { died: died.length, withSubmissions: withSubs.length, withSubmissionsPct: pct(withSubs.length, died.length), submissions: sum(withSubs, (t) => t.submissionCount) };
  }
  return { byChain, byTier, diedWithWork };
}

function buildWindows(snap, byScope) {
  const asOf = Date.parse(snap.dataAsOf);
  const out = {};
  for (const s of SCOPES) {
    const tasks = byScope[s.key];
    const windows = sortedNums(tasks.map((t) => (Date.parse(t.expiryTime) - Date.parse(t.createdAt)) / 36e5));
    const stale = tasks.filter((t) => outcomeOf(t) === 'stale');
    const ages = sortedNums(stale.map((t) => (asOf - Date.parse(t.expiryTime)) / 36e5));
    const live = tasks.filter((t) => outcomeOf(t) === 'live');
    const left = sortedNums(live.map((t) => (Date.parse(t.expiryTime) - asOf) / 36e5));
    const oldest = stale.length ? stale.reduce((a, b) => (a.expiryTime < b.expiryTime ? a : b)) : null;
    out[s.key] = {
      tasks: tasks.length,
      windowMedianHours: windows.length ? round(quantile(windows, 0.5), 1) : null,
      windowP75Hours: windows.length ? round(quantile(windows, 0.75), 1) : null,
      stale: {
        tasks: stale.length,
        usd: usd(sum(stale, (t) => micro(t.reward))),
        submissions: sum(stale, (t) => t.submissionCount),
        withSubmissions: stale.filter((t) => t.submissionCount > 0).length,
        ageMedianHours: ages.length ? round(quantile(ages, 0.5), 1) : null,
        ageP75Hours: ages.length ? round(quantile(ages, 0.75), 1) : null,
        ageMaxHours: ages.length ? round(ages.at(-1), 1) : null,
        oldest: oldest ? { id: oldest.id, ref: oldest.referenceCode, chainId: oldest.chainId, expiryTime: oldest.expiryTime } : null,
        // Buckets for the backlog chart: how long past the deadline.
        ageBuckets: [
          ['under 1 day', 0, 24], ['1 to 3 days', 24, 72], ['3 to 7 days', 72, 168], ['7 to 30 days', 168, 720], ['over 30 days', 720, Infinity],
        ].map(([label, a, b]) => {
          const inB = stale.filter((t) => { const h = (asOf - Date.parse(t.expiryTime)) / 36e5; return h >= a && h < b; });
          return { label, tasks: inB.length, usd: usd(sum(inB, (t) => micro(t.reward))) };
        }),
      },
      live: { tasks: live.length, usd: usd(sum(live, (t) => micro(t.reward))), timeLeftMedianHours: left.length ? round(quantile(left, 0.5), 1) : null },
    };
  }
  return out;
}

function buildChains(snap, byScope, headlines, concentration, mortality, windows) {
  const out = {};
  for (const c of snap.chains) {
    const tasks = byScope[c.key];
    const t = tally(tasks);
    const rewards = sortedNums(tasks.map((x) => micro(x.reward) / 1e6));
    const subs = sortedNums(tasks.map((x) => x.submissionCount));
    const completed = tasks.filter((x) => x.status === 'completed');
    const multi = completed.filter((x) => x.awardCount > 1).length;
    out[c.key] = {
      chainId: c.id, name: c.name, token: c.token,
      paidWorkers: headlines.byChain[c.key].paidWorkers,
      activeWallets: headlines.byChain[c.key].activeWallets,
      tasks: t.total,
      usd: t.usd,
      lifecycle: t.lifecycle,
      mode: t.mode,
      status: t.status,
      completedPct: mortality.byChain[c.key].completedPct,
      diedPct: mortality.byChain[c.key].diedPct,
      paidUsdPct: pct(t.lifecycle.paid.usd, t.usd),
      medianRewardUsd: rewards.length ? round(quantile(rewards, 0.5), 2) : null,
      maxRewardUsd: rewards.length ? rewards.at(-1) : null,
      medianSubmissions: subs.length ? round(quantile(subs, 0.5), 1) : null,
      totalSubmissions: sum(subs),
      multiWinnerPct: pct(multi, completed.length),
      bountyPct: pct(t.mode.bounty || 0, t.total),
      claimPct: pct(t.mode.claim || 0, t.total),
      posters: concentration[c.key].posters,
      top3UsdPct: concentration[c.key].top3.usdPct,
      giniUsd: concentration[c.key].giniUsd,
      windowMedianHours: windows[c.key].windowMedianHours,
      staleTasks: windows[c.key].stale.tasks,
      staleMedianHours: windows[c.key].stale.ageMedianHours,
    };
  }
  return out;
}

function buildHeatmaps(snap) {
  const out = {};
  for (const [key, entry] of Object.entries(snap.heatmap)) {
    const d = entry.scope === 'platform' ? entry.data : entry.byChain[snap.chains[0].id];
    const [, dimension] = key.split('|');
    const ri = Object.fromEntries(d.rowKeys.map((k, i) => [k, i]));
    const ci = Object.fromEntries(d.colKeys.map((k, i) => [k, i]));
    const count = d.rowKeys.map(() => d.colKeys.map(() => 0));
    const vol = d.rowKeys.map(() => d.colKeys.map(() => 0));
    let total = 0, peak = null;
    for (const c of d.cells) {
      const r = ri[c.row], k = ci[c.col];
      if (r == null || k == null) continue;
      count[r][k] = c.count; vol[r][k] = usd(micro(c.volume));
      total += c.count;
      if (!peak || c.count > peak.count) peak = { row: r, col: k, count: c.count };
    }
    out[key] = {
      dimension,
      rows: dimension === 'hourOfWeek' ? d.rowKeys.map((k) => DAY_LABELS[Number(k)] ?? k) : d.rowKeys,
      cols: d.colKeys,
      count,
      usd: dimension === 'mode' ? vol : null,
      total,
      peak,
    };
  }
  return out;
}

function buildFeed(snap, tasks) {
  const ref = new Map(tasks.map((t) => [t.id, t.referenceCode]));
  return snap.feed.items.map((i) => ({
    type: i.type,
    ts: i.timestamp,
    taskId: i.taskId,
    ref: ref.get(i.taskId) || null,
    chainId: i.chainId,
    actor: shortHex(i.actor),
    actorType: i.actorType,
    usd: i.amount == null ? null : usd(micro(i.amount)),
  }));
}

function buildInsights(m) {
  const out = [];
  const c = m.concentration.all, pub = m.breakdowns.publicTasks.all;
  out.push({
    key: 'concentration',
    view: 'concentration',
    text: `${fmtInt(c.posters)} wallets have posted public tasks. The top 3 put up ${c.top3.usdPct}% of the dollars.`,
  });
  const mt = m.mortality.byChain;
  out.push({
    key: 'mortality',
    view: 'flows',
    text: `On Base, ${mt.base.diedPct}% of public tasks expired or were cancelled. On Tempo, ${mt.tempo.diedPct}%.`,
  });
  const st = m.windows.all.stale;
  if (st.tasks) {
    out.push({
      key: 'stale',
      view: 'flows',
      text: `${fmtInt(st.tasks)} open tasks are past their deadline and still waiting on a decision. The median has waited ${fmtDuration(st.ageMedianHours)}.`,
    });
  }
  out.push({
    key: 'paid',
    view: 'flows',
    text: `${fmtUsd(pub.lifecycle.paid.usd)} of the ${fmtUsd(pub.usd)} put up in public tasks sits in completed tasks. ${fmtUsd(pub.lifecycle.died.usd)} sat in tasks that died.`,
  });
  const full = m.weeklyPosters.weeks.filter((w) => !w.partial);
  if (full.length >= 2) {
    const a = full.at(-1), b = full.at(-2);
    out.push({
      key: 'growth',
      view: 'concentration',
      text: `${fmtInt(a.combined)} distinct wallets posted in the week of ${a.week}, against ${fmtInt(b.combined)} the week before. ${fmtInt(a.firstTime)} were posting for the first time.`,
    });
  }
  const live = m.swarm.tasks.filter((t) => t[3] === 'open' && t[4] === 1).sort((x, y) => y[7] - x[7])[0];
  if (live) {
    out.push({
      key: 'swarm',
      view: 'overview',
      text: `The most contested live task, ${live[1]}, has ${fmtInt(live[7])} submissions for a ${fmtUsd(live[6])} reward.`,
    });
  }
  return out.slice(0, 6);
}

function buildVerify(snap, market, rec) {
  const all = market.series['all|day'];
  const tsTasks = all ? sum(all.tasksCreated) : null;
  const sk = market.sankey;
  const pub = market.breakdowns.publicTasks;
  const checks = [
    { name: 'Public task list never exceeds the breakdown, per status and per mode', pass: rec.pass, detail: { unlistedByStatus: rec.unlistedByStatus, unlistedByMode: rec.unlistedByMode } },
    { name: 'Unlisted tasks = breakdown total - public tasks', expected: rec.breakdownTotal - rec.publicTotal, actual: rec.unlistedTotal, pass: rec.unlistedTotal === rec.breakdownTotal - rec.publicTotal && rec.unlistedTotal >= 0 },
    ...['completed', 'expired', 'cancelled', 'pending_approval', 'open'].map((s) => ({
      name: `Status "${s}": public task list vs breakdown`,
      expected: rec.breakdownStatus[s] || 0,
      actual: rec.tasksStatus[s] || 0,
      delta: (rec.breakdownStatus[s] || 0) - (rec.tasksStatus[s] || 0),
      pass: (rec.breakdownStatus[s] || 0) - (rec.tasksStatus[s] || 0) >= 0,
    })),
    { name: 'Tempo public tasks + Base public tasks = all public tasks', expected: pub.all.total, actual: pub.tempo.total + pub.base.total, pass: pub.all.total === pub.tempo.total + pub.base.total },
    { name: 'Time series (all, day) tasksCreated sums to the breakdown total', expected: market.breakdowns.platform.totalTasks, actual: tsTasks, pass: tsTasks === market.breakdowns.platform.totalTasks },
    { name: 'Platform-wide headline fields are identical for chainId=4217 and chainId=8453', pass: market.headlines.allPlatformIdentical, detail: market.headlines.platformFieldsIdentical },
    { name: 'Live open public tasks = openTasks headline', expected: market.headlines.platform.openTasks, actual: pub.all.lifecycle.live.tasks, pass: pub.all.lifecycle.live.tasks === market.headlines.platform.openTasks },
    ...SCOPES.map((s) => ({
      name: `Flow river (${s.label}): poster flows, gates and links each sum to total escrowed`,
      expected: sk[s.key].check.totalUsd,
      actual: sk[s.key].check.linksInUsd,
      pass: sk[s.key].check.ok,
      detail: sk[s.key].check,
    })),
    { name: 'Flow river: Tempo total + Base total = All total', expected: sk.all.totalUsd, actual: round(sk.tempo.totalUsd + sk.base.totalUsd, 6), pass: Math.abs(sk.all.totalUsd - sk.tempo.totalUsd - sk.base.totalUsd) < 0.01 },
    { name: 'Heatmap (all, mode) cell counts sum to the breakdown total', expected: market.breakdowns.platform.totalTasks, actual: market.heatmap['all|mode']?.total ?? null, pass: market.heatmap['all|mode']?.total === market.breakdowns.platform.totalTasks },
    { name: 'Lifecycle groups sum to public tasks', expected: pub.all.total, actual: sum(OUTCOMES, (o) => pub.all.lifecycle[o.key].tasks), pass: pub.all.total === sum(OUTCOMES, (o) => pub.all.lifecycle[o.key].tasks) },
  ];
  // The two checks that are informational when the API itself disagrees.
  const soft = new Set(['Time series (all, day) tasksCreated sums to the breakdown total', 'Live open public tasks = openTasks headline', 'Heatmap (all, mode) cell counts sum to the breakdown total']);
  for (const c of checks) c.level = soft.has(c.name) ? 'info' : 'required';

  const host = snap.source;
  return {
    dataAsOf: snap.dataAsOf,
    fetchStartedAt: snap.fetchStartedAt,
    fetchFinishedAt: snap.fetchFinishedAt,
    source: host,
    requestCount: snap.requestCount,
    endpoints: [
      { path: '/api/market/stats?chainId={4217|8453}', use: 'Headline numbers' },
      { path: '/api/stats/breakdowns?chainId={4217|8453}', use: 'Tasks by status, mode and actor type (platform-wide)' },
      { path: '/api/stats/platform-time-series?chainId=…&range={7d|30d|90d|all}&bucket={day|week}', use: 'Active agents, tasks posted, rewards put up and paid over time' },
      { path: '/api/stats/activity-heatmap?chainId=…&range=…&dimension={hourOfWeek|mode}', use: 'Activity heatmap' },
      { path: '/api/stats/activity-feed?chainId=…&limit=50&cursor=…', use: 'The 200 most recent events' },
      { path: '/api/tasks?chainId=…&status=…&sort=newest&limit=100&cursor=…', use: 'Every public task: swarm field, flow river, posters per week, concentration, mortality' },
    ],
    reconciliation: {
      publicTasks: rec.publicTotal,
      breakdownTasks: rec.breakdownTotal,
      unlistedTasks: rec.unlistedTotal,
      unlistedByStatus: rec.unlistedByStatus,
      unlistedByMode: rec.unlistedByMode,
      exact: rec.exact,
      pass: rec.pass,
      publicByStatus: rec.tasksStatus,
      breakdownByStatus: rec.breakdownStatus,
      publicByMode: rec.tasksMode,
      breakdownByMode: rec.breakdownMode,
      taskListings: snap.fetchMeta.taskListings,
      statusConflictsDuringFetch: snap.fetchMeta.statusConflictsDuringFetch,
      chainScopeCheck: snap.fetchMeta.chainScopeCheck,
    },
    checks,
    allRequiredPass: checks.filter((c) => c.level === 'required').every((c) => c.pass),
    audit: [
      { label: 'Registered workers', value: market.headlines.platform.registeredWorkers, how: `GET ${host}/api/market/stats?chainId=4217 -> registeredWorkers` },
      { label: 'Active agents, 7 days', value: market.headlines.platform.activeAgents7d, how: `GET ${host}/api/market/stats?chainId=4217 -> activeAgents7d` },
      { label: 'Open tasks', value: market.headlines.platform.openTasks, how: `GET ${host}/api/market/stats?chainId=4217 -> openTasks` },
      { label: 'Paid workers on Tempo', value: market.headlines.byChain.tempo.paidWorkers, how: `GET ${host}/api/market/stats?chainId=4217 -> paidWorkers` },
      { label: 'Paid workers on Base', value: market.headlines.byChain.base.paidWorkers, how: `GET ${host}/api/market/stats?chainId=8453 -> paidWorkers` },
      { label: 'Completed tasks', value: rec.breakdownStatus.completed || 0, how: `GET ${host}/api/stats/breakdowns?chainId=4217 -> status[status=completed].count` },
      { label: 'Bounty-mode tasks', value: rec.breakdownMode.bounty || 0, how: `GET ${host}/api/stats/breakdowns?chainId=4217 -> mode[mode=bounty].count` },
      { label: 'Public tasks on Tempo', value: pub.tempo.total, how: `Page GET ${host}/api/tasks?chainId=4217&sort=newest&limit=100 with no status and with each status, de-duplicate by id, count` },
      { label: 'Public tasks on Base', value: pub.base.total, how: `Page GET ${host}/api/tasks?chainId=8453&sort=newest&limit=100 with no status and with each status, de-duplicate by id, count` },
      { label: 'Total put up in public tasks (USD)', value: pub.all.usd, how: 'Sum reward / 1e6 over every public task on both chains' },
    ],
  };
}

// ---------- entry point ----------
export function analyze(snap) {
  const tasks = snap.tasks;
  const byScope = { all: tasks };
  for (const c of snap.chains) byScope[c.key] = tasks.filter((t) => t.chainId === c.id);
  const rec = reconcile(tasks, snap.breakdowns[snap.chains[0].id]);

  const headlines = buildHeadlines(snap);
  const concentration = {};
  for (const s of SCOPES) concentration[s.key] = buildConcentration(byScope[s.key]);
  const mortality = buildMortality(byScope);
  const windows = buildWindows(snap, byScope);
  const sankey = {};
  for (const s of SCOPES) sankey[s.key] = buildSankey(byScope[s.key]);

  const market = {
    meta: {
      schema: 1,
      dataAsOf: snap.dataAsOf,
      dataAsOfLabel: formatAsOf(snap.dataAsOf),
      chains: snap.chains,
      scopes: SCOPES,
      outcomes: OUTCOMES,
      publicTasks: rec.publicTotal,
      breakdownTasks: rec.breakdownTotal,
      unlistedTasks: rec.unlistedTotal,
    },
    headlines,
    series: buildSeries(snap),
    breakdowns: buildBreakdowns(snap, byScope, rec),
    swarm: buildSwarm(tasks),
    sankey,
    weeklyPosters: buildWeeklyPosters(snap, tasks),
    concentration,
    topPosters: buildTopPosters(tasks),
    mortality,
    windows,
    chains: null,
    heatmap: buildHeatmaps(snap),
    feed: buildFeed(snap, tasks),
    insights: null,
  };
  market.chains = buildChains(snap, byScope, headlines, concentration, mortality, windows);
  market.insights = buildInsights(market);
  const verify = buildVerify(snap, market, rec);
  return { market, verify };
}

// Which top-level keys each page needs. Keeps every route's payload small.
export const VIEW_SLICES = {
  overview: ['meta', 'headlines', 'series', 'breakdowns', 'swarm', 'insights'],
  flows: ['meta', 'sankey', 'mortality', 'windows', 'insights'],
  concentration: ['meta', 'weeklyPosters', 'concentration', 'topPosters', 'insights'],
  chains: ['meta', 'headlines', 'chains', 'insights'],
  activity: ['meta', 'heatmap', 'feed', 'insights'],
};
export function sliceFor(market, view) {
  return Object.fromEntries(VIEW_SLICES[view].map((k) => [k, market[k]]));
}

// CLI: node scripts/analyze.mjs  -> prints a short summary of the cached snapshot
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/analyze.mjs')) {
  const { readFile } = await import('node:fs/promises');
  const snap = JSON.parse(await readFile(new URL('../.cache/snapshot.json', import.meta.url), 'utf8'));
  const { market, verify } = analyze(snap);
  console.log(`data as of ${market.meta.dataAsOfLabel}`);
  for (const i of market.insights) console.log(' -', i.text);
  for (const c of verify.checks) console.log(c.pass ? ' ok ' : (c.level === 'info' ? 'info' : 'FAIL'), c.name, c.expected ?? '', c.actual ?? '');
}
