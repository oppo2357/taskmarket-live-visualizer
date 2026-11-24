// Fetches every number the site shows from the public Taskmarket API.
// Server-side only: the API sends no CORS headers, and the browser never calls it.
//
//   node scripts/fetch-data.mjs            -> writes .cache/snapshot.json
//   import { fetchSnapshot } from './fetch-data.mjs'
//
// Six endpoints are used (see METHODS in README.md):
//   /api/market/stats, /api/stats/breakdowns, /api/stats/platform-time-series,
//   /api/stats/activity-heatmap, /api/stats/activity-feed, /api/tasks
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_BASE = process.env.TASKMARKET_API || 'https://api.taskmarket.dev';
export const CHAINS = [
  { id: 4217, key: 'tempo', name: 'Tempo', token: 'OUSD' },
  { id: 8453, key: 'base', name: 'Base', token: 'USDC' },
];
export const RANGES = ['7d', '30d', '90d', 'all'];
export const BUCKETS = ['day', 'week'];
export const DIMENSIONS = ['hourOfWeek', 'mode'];
// `/api/tasks` without `status` lists live and past-deadline work; the deep
// history (completed, expired, cancelled ...) only appears per status. We page
// through all of them and de-duplicate by task id.
export const TASK_LISTINGS = [null, 'open', 'completed', 'expired', 'cancelled', 'claimed', 'pending_approval', 'worker_selected'];
const FEED_PAGES = 4; // 4 x 50 = 200 most recent events
const PAGE_LIMIT = 100;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let requestCount = 0;
const requestLog = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(path, attempt = 0) {
  const url = API_BASE + path;
  requestCount++;
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'taskmarket-live-visualizer (open source, read-only)' },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    if (attempt < 5) { await sleep(800 * 2 ** attempt); return getJSON(path, attempt + 1); }
    throw new Error(`GET ${url} failed: ${err.message}`);
  }
  if (res.status === 429 || res.status >= 500) {
    if (attempt < 6) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
      return getJSON(path, attempt + 1);
    }
  }
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Small promise pool so we stay polite with the API.
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  });
  await Promise.all(workers);
  return out;
}

function trimTask(t) {
  // Only fields the site uses. Free text (description), display names and
  // tags are dropped on purpose: the site never attaches names to wallets.
  return {
    id: t.id,
    chainId: t.chainId,
    referenceCode: t.referenceCode,
    requester: t.requester,
    reward: t.reward,
    createdAt: t.createdAt,
    expiryTime: t.expiryTime,
    status: t.status,
    mode: t.mode,
    submissionCount: t.submissionCount,
    awardCount: t.awardCount,
    primaryAward: t.primaryAward ? { workerAddress: t.primaryAward.workerAddress } : null,
    claimedBy: t.claimedBy ?? null,
    submissionWindowOpen: t.submissionWindowOpen,
    phase: t.phase,
    requesterActorType: t.requesterActorType,
  };
}

function trimFeedItem(i) {
  // taskTitle and actorAgentId are dropped (free text / identity-adjacent).
  return { type: i.type, timestamp: i.timestamp, taskId: i.taskId, chainId: i.chainId, actor: i.actor, actorType: i.actorType, amount: i.amount, rating: i.rating };
}

async function paginateTasks(chainId, status) {
  const tasks = [];
  let cursor = null;
  let pages = 0;
  for (;;) {
    let p = `/api/tasks?chainId=${chainId}&sort=newest&limit=${PAGE_LIMIT}`;
    if (status) p += `&status=${status}`;
    if (cursor) p += `&cursor=${encodeURIComponent(cursor)}`;
    const page = await getJSON(p);
    pages++;
    tasks.push(...(page.tasks || []));
    if (!page.hasMore || !page.nextCursor || !page.tasks?.length) break;
    if (page.nextCursor === cursor) break;
    cursor = page.nextCursor;
    if (pages > 500) throw new Error('pagination runaway');
  }
  return { chainId, status, pages, tasks };
}

function countBy(list, key) {
  const m = {};
  for (const x of list) m[x[key]] = (m[x[key]] || 0) + 1;
  return m;
}
function breakdownMap(b, field) {
  const m = {};
  for (const row of b[field] || []) m[row[field]] = row.count;
  return m;
}
const sameMap = (a, b) => {
  const ka = Object.keys(a).filter((k) => a[k]), kb = Object.keys(b).filter((k) => b[k]);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
};

async function fetchBreakdowns() {
  const out = {};
  for (const c of CHAINS) out[c.id] = await getJSON(`/api/stats/breakdowns?chainId=${c.id}`);
  return out;
}

async function fetchAllTasks() {
  const jobs = [];
  for (const c of CHAINS) for (const s of TASK_LISTINGS) jobs.push([c.id, s]);
  const results = await pool(jobs, 4, ([cid, s]) => paginateTasks(cid, s));
  const byId = new Map();
  const listingStats = [];
  let conflicts = 0;
  for (const r of results) {
    listingStats.push({ chainId: r.chainId, status: r.status || '(default)', pages: r.pages, rows: r.tasks.length });
    for (const t of r.tasks) {
      if (t.chainId !== r.chainId) throw new Error(`task ${t.id} chain ${t.chainId} returned for chainId=${r.chainId}`);
      const prev = byId.get(t.id);
      if (prev && prev.status !== t.status) conflicts++;
      // status-filtered listings win over the default listing
      if (!prev || r.status) byId.set(t.id, t);
    }
  }
  const tasks = [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : 1));
  return { tasks, listingStats, conflicts };
}

// Compares the public, paginated task list with /api/stats/breakdowns.
//
// The breakdown counts every task on the platform. The public /api/tasks
// listings can return fewer (tasks that are not publicly listed never appear
// there), so "fewer public tasks than the breakdown" is a normal, stable state
// and is recorded as an exact per-status and per-mode delta instead of failing.
//
//   exact   every status and mode count is identical
//   pass    no count is higher in the public list than in the breakdown, and
//           the status deltas and the mode deltas add up to the same total
//   A negative delta means a task changed status between requests: retry.
export function reconcile(tasks, breakdown) {
  const tasksStatus = countBy(tasks, 'status');
  const tasksMode = countBy(tasks, 'mode');
  const breakdownStatus = breakdownMap(breakdown, 'status');
  const breakdownMode = breakdownMap(breakdown, 'mode');
  const delta = (pub, bd) => {
    const out = {};
    for (const k of new Set([...Object.keys(pub), ...Object.keys(bd)])) {
      const d = (bd[k] || 0) - (pub[k] || 0);
      if (d !== 0) out[k] = d;
    }
    return out;
  };
  const sum = (m) => Object.values(m).reduce((x, y) => x + y, 0);
  const unlistedByStatus = delta(tasksStatus, breakdownStatus);
  const unlistedByMode = delta(tasksMode, breakdownMode);
  const breakdownTotal = sum(breakdownStatus);
  const publicTotal = tasks.length;
  const negative = [...Object.values(unlistedByStatus), ...Object.values(unlistedByMode)].some((d) => d < 0);
  const consistent = sum(unlistedByStatus) === breakdownTotal - publicTotal && sum(unlistedByMode) === breakdownTotal - publicTotal;
  const exact = !Object.keys(unlistedByStatus).length && !Object.keys(unlistedByMode).length;
  const checkedStatuses = ['completed', 'expired', 'cancelled', 'pending_approval', 'open'];
  const statusMatch = {};
  for (const k of checkedStatuses) statusMatch[k] = (tasksStatus[k] || 0) === (breakdownStatus[k] || 0);
  return {
    pass: !negative && consistent,
    exact,
    publicTotal,
    breakdownTotal,
    unlistedTotal: breakdownTotal - publicTotal,
    unlistedByStatus,
    unlistedByMode,
    statusMatch,
    tasksStatus,
    breakdownStatus,
    tasksMode,
    breakdownMode,
  };
}

export async function fetchSnapshot({ log = console.log, maxAttempts = 3 } = {}) {
  requestCount = 0;
  const startedAt = new Date();
  log(`[fetch] ${API_BASE} started ${startedAt.toISOString()}`);

  // 1. Headline stats per chain.
  const marketStats = {};
  for (const c of CHAINS) marketStats[c.id] = await getJSON(`/api/market/stats?chainId=${c.id}`);

  // 2. Tasks + breakdowns. The breakdown is read before and after paging the
  //    task list. We retry only when something actually moved mid-fetch: the
  //    two breakdowns differ, a task showed two statuses, or the public list
  //    holds more of some status than the breakdown. A stable, non-negative
  //    gap (tasks the public listing does not return) is not retried.
  let attempt = 0, tasksResult, breakdowns, rec, stable;
  for (;;) {
    attempt++;
    const before = await fetchBreakdowns();
    tasksResult = await fetchAllTasks();
    breakdowns = await fetchBreakdowns();
    stable = JSON.stringify(before) === JSON.stringify(breakdowns) && tasksResult.conflicts === 0;
    rec = reconcile(tasksResult.tasks, breakdowns[CHAINS[0].id]);
    if (!rec.pass) {
      const recBefore = reconcile(tasksResult.tasks, before[CHAINS[0].id]);
      if (recBefore.pass) { rec = recBefore; breakdowns = before; }
    }
    log(`[fetch] tasks attempt ${attempt}: ${rec.publicTotal} public of ${rec.breakdownTotal} in breakdowns (unlisted ${rec.unlistedTotal}), exact=${rec.exact}, pass=${rec.pass}, stable=${stable}`);
    if ((rec.pass && stable) || attempt >= maxAttempts) break;
    await sleep(3000);
  }
  rec.stableDuringFetch = stable;

  // 3. Time series + heatmaps for every range/bucket/dimension, both chainIds.
  const tsJobs = [], hmJobs = [];
  for (const r of RANGES) for (const b of BUCKETS) for (const c of CHAINS) tsJobs.push([r, b, c.id]);
  for (const r of RANGES) for (const d of DIMENSIONS) for (const c of CHAINS) hmJobs.push([r, d, c.id]);
  const tsRes = await pool(tsJobs, 4, ([r, b, cid]) => getJSON(`/api/stats/platform-time-series?chainId=${cid}&range=${r}&bucket=${b}`));
  const hmRes = await pool(hmJobs, 4, ([r, d, cid]) => getJSON(`/api/stats/activity-heatmap?chainId=${cid}&range=${r}&dimension=${d}`));
  const timeSeries = {}, heatmap = {}, chainScopeCheck = { timeSeries: {}, heatmap: {} };
  const fold = (jobs, res, target, check) => {
    const tmp = {};
    jobs.forEach(([a, b, cid], i) => { (tmp[`${a}|${b}`] ||= {})[cid] = res[i]; });
    for (const [k, v] of Object.entries(tmp)) {
      const same = JSON.stringify(v[CHAINS[0].id]) === JSON.stringify(v[CHAINS[1].id]);
      check[k] = same;
      // Identical across chainId = platform-wide: store once. Otherwise keep both.
      target[k] = same ? { scope: 'platform', data: v[CHAINS[0].id] } : { scope: 'per-chain', byChain: v };
    }
  };
  fold(tsJobs, tsRes, timeSeries, chainScopeCheck.timeSeries);
  fold(hmJobs, hmRes, heatmap, chainScopeCheck.heatmap);

  // 4. Activity feed: the most recent 200 events (pages of 50, cursor-based).
  const feedItems = [];
  let cursor = null;
  for (let p = 0; p < FEED_PAGES; p++) {
    const page = await getJSON(`/api/stats/activity-feed?chainId=${CHAINS[0].id}&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    feedItems.push(...page.items);
    if (!page.nextCursor || !page.items.length) break;
    cursor = page.nextCursor;
  }
  const feedOther = await getJSON(`/api/stats/activity-feed?chainId=${CHAINS[1].id}&limit=50`);
  const feedChainsSeen = {
    [CHAINS[0].id]: [...new Set(feedItems.map((i) => i.chainId))].sort(),
    [CHAINS[1].id]: [...new Set(feedOther.items.map((i) => i.chainId))].sort(),
  };
  const seenFeed = new Set();
  const feed = feedItems.filter((i) => { const k = `${i.type}|${i.timestamp}|${i.taskId}|${i.actor}`; if (seenFeed.has(k)) return false; seenFeed.add(k); return true; }).map(trimFeedItem);

  const finishedAt = new Date();
  log(`[fetch] done in ${((finishedAt - startedAt) / 1000).toFixed(1)}s, ${requestCount} requests`);

  return {
    schema: 1,
    source: API_BASE,
    fetchStartedAt: startedAt.toISOString(),
    fetchFinishedAt: finishedAt.toISOString(),
    dataAsOf: finishedAt.toISOString(),
    requestCount,
    chains: CHAINS,
    marketStats,
    breakdowns,
    timeSeries,
    heatmap,
    feed: { scope: 'platform', items: feed, chainsSeen: feedChainsSeen },
    tasks: tasksResult.tasks.map(trimTask),
    fetchMeta: {
      taskAttempts: attempt,
      taskListings: tasksResult.listingStats,
      statusConflictsDuringFetch: tasksResult.conflicts,
      reconciliation: rec,
      breakdownsIdenticalAcrossChains: JSON.stringify(breakdowns[CHAINS[0].id]) === JSON.stringify(breakdowns[CHAINS[1].id]),
      chainScopeCheck,
    },
  };
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const snap = await fetchSnapshot();
  const out = join(ROOT, '.cache', 'snapshot.json');
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(snap));
  const r = snap.fetchMeta.reconciliation;
  console.log(`[fetch] wrote ${out} (${r.publicTotal} public tasks, ${r.breakdownTotal} in breakdowns, unlisted ${r.unlistedTotal}, pass=${r.pass})`);
  if (!snap.fetchMeta.reconciliation.pass) process.exitCode = 1;
}
