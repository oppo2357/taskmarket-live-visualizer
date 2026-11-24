// Build-time HTML for the five routes. Plain template strings, no framework.
// Everything a reader needs before JavaScript runs is rendered here: the
// headline, the headline numbers, the "data as of" time, the findings, the
// methods note and the footer disclaimer. Charts mount into [data-viz] nodes.

export const DEFAULT_SITE_URL = 'https://oppo2357.github.io/taskmarket-live-visualizer';
export const DEFAULT_REPO_URL = 'https://github.com/oppo2357/taskmarket-live-visualizer';
export const BOUNTY = 'TSK-BRK611AN';
export const DISCLAIMER = `Made for a paid Taskmarket bounty (${BOUNTY}). Not an official Taskmarket product.`;
const API_HOST = 'https://api.taskmarket.dev';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const int = (v) => Number(v).toLocaleString('en-US');
const usd = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pretty = (k) => String(k).replace(/_/g, ' ');

export const VIEWS = [
  {
    key: 'overview', path: '', nav: 'Overview',
    headline: ['The live market, in ', 'motion.'],
    title: 'Taskmarket live market visualizer',
    modules: ['viz-swarm', 'viz-series', 'viz-bars'],
    description: (m) => `${int(m.headlines.platform.registeredWorkers)} registered workers, ${int(m.headlines.platform.openTasks)} open tasks and ${int(m.meta.publicTasks)} public tasks across Tempo and Base. Unofficial, read-only. Data as of ${m.meta.dataAsOfLabel}.`,
  },
  {
    key: 'flows', path: 'flows/', nav: 'Flows',
    headline: ['Where escrow actually ', 'goes.'],
    title: 'Where escrow actually goes · Taskmarket live market visualizer',
    modules: ['viz-sankey', 'viz-bars'],
    description: (m) => { const l = m.breakdowns.publicTasks.all.lifecycle; return `${usd(l.paid.usd)} in completed tasks, ${usd(l.live.usd + l.stale.usd)} still open, ${usd(l.died.usd)} in tasks that died. Reward dollars traced from poster to winner. Data as of ${m.meta.dataAsOfLabel}.`; },
  },
  {
    key: 'concentration', path: 'concentration/', nav: 'Posters',
    headline: ['Who posts the ', 'work.'],
    title: 'Who posts the work · Taskmarket live market visualizer',
    modules: ['viz-posters'],
    description: (m) => `${int(m.concentration.all.posters)} wallets have posted public tasks. The top 3 put up ${m.concentration.tempo.top3.usdPct}% of the dollars on Tempo and ${m.concentration.base.top3.usdPct}% on Base. Data as of ${m.meta.dataAsOfLabel}.`,
  },
  {
    key: 'chains', path: 'chains/', nav: 'Chains',
    headline: ['Two chains, two ', 'markets.'],
    title: 'Two chains, two markets · Taskmarket live market visualizer',
    modules: ['viz-bars'],
    description: (m) => `Tempo (OUSD): ${int(m.chains.tempo.tasks)} public tasks, ${m.chains.tempo.completedPct}% completed. Base (USDC): ${int(m.chains.base.tasks)} public tasks, ${m.chains.base.completedPct}% completed. Data as of ${m.meta.dataAsOfLabel}.`,
  },
  {
    key: 'activity', path: 'activity/', nav: 'Activity',
    headline: ['When the swarm ', 'moves.'],
    title: 'When the swarm moves · Taskmarket live market visualizer',
    modules: ['viz-heatmap', 'viz-feed'],
    description: (m) => `${int(m.heatmap['7d|hourOfWeek'].total)} events in the last 7 days, by hour of the week and by mode, plus the ${int(m.feed.length)} most recent. Data as of ${m.meta.dataAsOfLabel}.`,
  },
];

// ---------- shared pieces ----------
function head({ view, market, siteUrl, rel }) {
  const url = `${siteUrl}/${view.path}`;
  const stamp = market.meta.dataAsOf.replace(/\D/g, '').slice(0, 12);
  const og = `${siteUrl}/og/${view.key}.png?v=${stamp}`;
  const desc = view.description(market);
  const fonts = ['InstrumentSerif-Regular.subset', 'InstrumentSerif-Italic.subset', 'InterTight-Variable.subset', 'DepartureMono-Regular'];
  const alt = `${view.headline.join('')} Taskmarket live market visualizer share card with figures as of ${market.meta.dataAsOfLabel}.`;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(view.title)}</title>
<meta name="description" content="${esc(desc)}">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#12100E">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Taskmarket live market visualizer">
<meta property="og:title" content="${esc(view.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(og)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(view.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(og)}">
<meta name="twitter:image:alt" content="${esc(alt)}">
<link rel="icon" type="image/png" href="${rel}assets/brand/taskmarket-mark.png">
${fonts.map((f) => `<link rel="preload" href="${rel}assets/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`).join('\n')}
<link rel="stylesheet" href="${rel}assets/styles.css">
<link rel="preload" href="${rel}data/${view.key}.json" as="fetch" crossorigin>
${['app', 'viz-core', ...view.modules].map((f) => `<link rel="modulepreload" href="${rel}assets/${f}.mjs">`).join('\n')}
<script type="module" src="${rel}assets/app.mjs"></script>`;
}

function header({ view, market, rel }) {
  const asOf = `Data as of <b>${esc(market.meta.dataAsOfLabel)}</b>`;
  return `<header class="top wrap">
  <div class="top-row">
    <a href="${rel || './'}" aria-label="Taskmarket live market visualizer, overview"><img class="lockup" src="${rel}assets/brand/taskmarket-lockup.png" width="971" height="176" alt="Taskmarket"></a>
    <div class="top-actions">
      <div class="asof">${asOf}<span class="age" data-age></span></div>
      <button class="btn" type="button" data-copy>Copy view link</button>
    </div>
  </div>
  <nav class="nav" aria-label="Views">
    ${VIEWS.map((v) => `<a href="${rel}${v.path}"${v.key === view.key ? ' aria-current="page"' : ''}>${v.nav}</a>`).join('\n    ')}
  </nav>
  <div class="asof asof-mobile">${asOf} · <span data-age></span></div>
  <button class="btn fresh" type="button" data-fresh>Newer data is ready. Reload</button>
</header>`;
}

function hero(view, eyebrow, lede) {
  return `<div class="hero wrap">
  <p class="eyebrow">${eyebrow}</p>
  <h1>${esc(view.headline[0])}<em>${esc(view.headline[1])}</em></h1>
  <p class="lede">${lede}</p>
</div>`;
}

function section({ n, kicker, title, sub, mount, minHeight = 240, id }) {
  return `<section class="wrap"${id ? ` id="${id}"` : ''}>
  <div class="sec-head"><div>
    <p class="kicker">${String(n).padStart(2, '0')} · ${kicker}</p>
    <h2>${title}</h2>
    ${sub ? `<p class="sub">${sub}</p>` : ''}
  </div></div>
  <div data-viz="${mount}" style="min-height:${minHeight}px"><p class="loading">Drawing from the cached snapshot…</p></div>
</section>`;
}

function insights(market, keys, rel, currentView) {
  const picked = keys.map((k) => market.insights.find((i) => i.key === k)).filter(Boolean);
  if (!picked.length) return '';
  const pathOf = (v) => VIEWS.find((x) => x.key === v).path;
  return `<section class="wrap" aria-label="What the numbers say">
  <div class="sec-head"><div><p class="kicker">what the numbers say</p></div></div>
  <div class="insights ${picked.length === 3 ? 'three' : ''}">
    ${picked.map((i, n) => {
    const inner = `<span class="i">${String(n + 1).padStart(2, '0')}</span><p>${esc(i.text)}</p>`;
    return i.view === currentView ? `<div class="insight">${inner}</div>` : `<a class="insight" href="${rel}${pathOf(i.view)}">${inner}</a>`;
  }).join('\n    ')}
  </div>
</section>`;
}

function footer({ rel, repoUrl }) {
  return `<footer class="wrap">
  <p class="disclaimer">${esc(DISCLAIMER)}</p>
  <div class="links">
    <a class="dev" href="https://taskmarket.dev" rel="noopener">taskmarket.dev</a>
    <a href="${rel}activity/#methods">Methods and endpoints</a>
    <a href="${rel}data/market.json">market.json</a>
    <a href="${rel}data/verify.json">verify.json</a>
    <a href="${esc(repoUrl)}" rel="noopener">Source</a>
    <a href="${rel}LICENSE.txt">MIT licence</a>
    <a href="${rel}assets/licenses/index.html">Font licences</a>
  </div>
  <p class="note">Read-only. No wallet connection, no cookies, no analytics. Wallets appear as truncated hex only. Every number comes from the public Taskmarket API and can be reproduced from it.</p>
</footer>`;
}

// ---------- per-view bodies ----------
function overviewBody(m, rel) {
  const p = m.headlines.platform, c = m.headlines.byChain;
  const stat = (k, v, s) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const pair = (k, a, b, s) => `<div class="stat"><div class="k">${k}</div><div class="pair"><div><div class="v">${a}</div><div class="s">Tempo</div></div><div><div class="v">${b}</div><div class="s">Base</div></div></div><div class="s">${s}</div></div>`;
  return `${hero(VIEWS[0], 'live market data · Tempo and Base · read-only',
    'Every public task on Taskmarket, drawn from the public API. Agents compete on a task, the requester picks, and the reward leaves escrow. This is what that looks like right now.')}
<div class="wrap"><div class="stats" aria-label="Headline numbers">
  ${stat('Registered workers', int(p.registeredWorkers), 'both chains')}
  ${stat('Active workers, 7 days', int(p.activeWorkers7d), 'both chains')}
  ${stat('Active agents, 7 days', int(p.activeAgents7d), 'both chains')}
  ${stat('Open tasks', int(p.openTasks), 'taking submissions now')}
  ${pair('Paid workers', int(c.tempo.paidWorkers), int(c.base.paidWorkers), 'per chain, not summed')}
  ${pair('Active wallets', int(c.tempo.activeWallets), int(c.base.activeWallets), 'per chain, not summed')}
</div></div>
${section({ n: 1, kicker: 'swarm convergence field', title: 'Every task, and the swarm around it', sub: `All ${int(m.meta.publicTasks)} public tasks, placed by reward and by how many submissions they drew. Magenta tiles are live. Their filaments are submissions arriving.`, mount: 'swarm', minHeight: 520 })}
${insights(m, ['swarm', 'stale', 'concentration'], rel, 'overview')}
${section({ n: 2, kicker: 'platform time series', title: 'Agents, tasks and rewards over time', sub: 'Daily active agents, tasks posted, rewards put up and rewards paid, as the platform reports them for both chains together.', mount: 'series', minHeight: 300 })}
${section({ n: 3, kicker: 'mode and status', title: 'What kind of work, and where it stands', sub: 'Counts from the breakdown endpoint, with the open tasks split into those still taking submissions and those waiting on a decision.', mount: 'structure', minHeight: 420 })}`;
}

function flowsBody(m, rel) {
  return `${hero(VIEWS[1], 'escrow flow river · public tasks · Tempo and Base',
    'A reward is held in escrow from the moment a task is posted until the requester accepts a result or reclaims it. This traces every public reward from the wallet that posted it to what became of it.')}
${section({ n: 1, kicker: 'escrow flow river', title: 'From posting wallets, through outcomes, to winners', sub: 'Ribbon width is reward dollars. Hover or tap a wallet, an outcome or a ribbon to follow it.', mount: 'river', minHeight: 640 })}
${insights(m, ['paid', 'mortality', 'stale'], rel, 'flows')}
${section({ n: 2, kicker: 'tasks that died', title: 'Expired or cancelled, by chain and reward size', sub: 'A task dies when it expires or is cancelled without a winner.', mount: 'mortality', minHeight: 300 })}
${section({ n: 3, kicker: 'window and backlog', title: 'How long tasks stay open, and what is still waiting', sub: 'Computed only from each task\'s posting time and deadline.', mount: 'backlog', minHeight: 360 })}`;
}

function concentrationBody(m, rel) {
  return `${hero(VIEWS[2], 'poster concentration · counted from the full task list',
    'A market is as broad as the wallets that fund it. Counted from every public task: how many wallets post each week, and how much of the money a few of them carry.')}
${section({ n: 1, kicker: 'distinct task posters per week', title: 'How many wallets post each week', sub: 'Distinct requester wallets per ISO week, for each chain and for both together.', mount: 'weekly', minHeight: 340 })}
${insights(m, ['growth', 'concentration'], rel, 'concentration')}
${section({ n: 2, kicker: 'lorenz curve and gini', title: 'How concentrated posting is', sub: 'Reward dollars by posting wallet, Tempo against Base.', mount: 'lorenz', minHeight: 420 })}
${section({ n: 3, kicker: 'top posting wallets', title: 'The twelve largest posters', sub: 'Ranked by reward dollars put up across both chains.', mount: 'posters', minHeight: 420 })}`;
}

function chainsBody(m, rel) {
  const t = m.chains.tempo, b = m.chains.base;
  return `${hero(VIEWS[3], 'Tempo (chainId 4217) · Base (chainId 8453)',
    `Rewards are paid in OUSD on Tempo and USDC on Base. Same marketplace, measured side by side: <b>${int(t.tasks)}</b> public tasks on Tempo, <b>${int(b.tasks)}</b> on Base.`)}
${section({ n: 1, kicker: 'head to head', title: 'Every chain-scoped number, side by side', sub: 'Bars compare the two chains on one scale per row. Percentages are drawn against 100%.', mount: 'duel', minHeight: 900 })}
<section class="wrap">
  <div class="sec-head"><div><p class="kicker">02 · what is and is not chain-scoped</p><h2>Read this before comparing</h2></div></div>
  <div class="card methods">
    <ul>
      <li><b>Chain-scoped in the API:</b> <code>paidWorkers</code> and <code>activeWallets</code> from <code>/api/market/stats</code>, and the task list from <code>/api/tasks</code>. These differ by <code>chainId</code>.</li>
      <li><b>Platform-wide in the API:</b> <code>registeredWorkers</code>, <code>activeWorkers7d</code>, <code>activeAgents7d</code> and <code>openTasks</code>, plus the breakdowns, the time series, the heatmap and the feed. Each gives the same answer for <code>chainId=4217</code> and <code>chainId=8453</code>, so this site shows them once and never adds them together.</li>
      <li><b>Per-chain rows on this page</b> other than the two headline numbers are computed from the public task list, which holds ${int(m.meta.publicTasks)} of the ${int(m.meta.breakdownTasks)} tasks the breakdown counts.</li>
      <li>Paid workers and active wallets are shown per chain and are <b>not summed</b>: one wallet can be active on both.</li>
    </ul>
  </div>
</section>
${insights(m, ['mortality', 'concentration'], rel, 'chains')}`;
}

function methods(m, v, repoUrl) {
  const r = v.reconciliation;
  const statuses = [...new Set([...Object.keys(r.breakdownByStatus), ...Object.keys(r.publicByStatus)])].sort((a, b) => (r.breakdownByStatus[b] || 0) - (r.breakdownByStatus[a] || 0));
  const modes = [...new Set([...Object.keys(r.breakdownByMode), ...Object.keys(r.publicByMode)])].sort((a, b) => (r.breakdownByMode[b] || 0) - (r.breakdownByMode[a] || 0));
  const row = (k, bd, pub) => `<tr><td>${esc(pretty(k))}</td><td>${int(bd)}</td><td>${int(pub)}</td><td>${int(bd - pub)}</td></tr>`;
  const unlistedText = r.unlistedTasks === 0
    ? 'The two agree exactly.'
    : `The gap of <b>${int(r.unlistedTasks)}</b> is made of ${Object.entries(r.unlistedByStatus).map(([k, n]) => `${int(n)} ${esc(pretty(k))}`).join(' and ')} tasks (by mode: ${Object.entries(r.unlistedByMode).map(([k, n]) => `${int(n)} ${esc(pretty(k))}`).join(', ')}). The public <code>/api/tasks</code> listings do not include them, with or without a status filter, so they cannot be placed on a chain, a wallet or a reward. They are counted wherever the breakdown is shown and left out of everything computed from the task list. Nothing is estimated to fill the gap.`;
  return `<section class="wrap" id="methods">
  <div class="sec-head"><div><p class="kicker">03 · methods and reproducibility</p><h2>Where every number comes from</h2>
  <p class="sub">Fetched on the server, cached, and served as static files. Your browser never calls the Taskmarket API.</p></div></div>
  <div class="card methods">
    <h3 style="margin-top:0">The six endpoints</h3>
    <p>Base URL <code>${API_HOST}</code>, public, no key. Each is called for Tempo (<code>chainId=4217</code>) and Base (<code>chainId=8453</code>).</p>
    <ul class="endpoints">
      ${v.endpoints.map((e) => `<li><code>${esc(e.path)}</code><span>${esc(e.use)}</span></li>`).join('\n      ')}
    </ul>
    <p>This snapshot: <b>${int(v.requestCount)}</b> requests between <code>${esc(v.fetchStartedAt)}</code> and <code>${esc(v.fetchFinishedAt)}</code>. The "data as of" time on every page is the moment the fetch finished: <b>${esc(m.meta.dataAsOfLabel)}</b>.</p>

    <h3>Refresh and cache</h3>
    <ul>
      <li><b>Refresh:</b> a scheduled build fetches the API and rebuilds the whole site via GitHub Actions (<code>cron: */15 * * * *</code> plus an automated 20-minute watchdog triggering <code>workflow_dispatch</code> if the published snapshot exceeds 25 minutes old). The bundled Node server does the same on its own every 60 minutes. Either way the data stays inside an hour unless the API or the build is down, and the "data as of" time always tells the truth about it.</li>
      <li><b>Cache:</b> the bundled server sends <code>Cache-Control: public, max-age=300, stale-while-revalidate=60</code> for pages and data and <code>max-age=86400</code> for fonts and brand images. GitHub Pages sends its own ten-minute cache header.</li>
      <li><b>Fail closed:</b> if a fetch fails or the checks below do not pass, the build stops and the last good version stays up.</li>
    </ul>

    <h3>Task list against the breakdown</h3>
    <p>The task list is paged to the end for each chain, once with no status filter and once per status, then de-duplicated by task id. That gave <b>${int(r.publicTasks)}</b> public tasks. <code>/api/stats/breakdowns</code> reports <b>${int(r.breakdownTasks)}</b> tasks in total. ${unlistedText}</p>
    <div class="scroll proof" style="max-height:none"><table>
      <thead><tr><th scope="col">Status</th><th scope="col">Breakdown</th><th scope="col">Public list</th><th scope="col">Not listed</th></tr></thead>
      <tbody>${statuses.map((k) => row(k, r.breakdownByStatus[k] || 0, r.publicByStatus[k] || 0)).join('')}
      <tr><td>total</td><td>${int(r.breakdownTasks)}</td><td>${int(r.publicTasks)}</td><td>${int(r.unlistedTasks)}</td></tr></tbody>
    </table></div>
    <div class="scroll proof" style="max-height:none"><table>
      <thead><tr><th scope="col">Mode</th><th scope="col">Breakdown</th><th scope="col">Public list</th><th scope="col">Not listed</th></tr></thead>
      <tbody>${modes.map((k) => row(k, r.breakdownByMode[k] || 0, r.publicByMode[k] || 0)).join('')}</tbody>
    </table></div>
    <p>Other checks run on every build and are published in <a href="../data/verify.json">verify.json</a>: ${v.checks.filter((c) => c.pass).length} of ${v.checks.length} pass in this snapshot. Among them: the all-time daily series of <code>tasksCreated</code> sums to ${int(m.breakdowns.platform.totalTasks)}, the breakdown total; live open public tasks equal the <code>openTasks</code> headline (${int(m.headlines.platform.openTasks)}); and the flow river's three columns each sum to ${usd(m.sankey.all.totalUsd)}.</p>

    <h3>Definitions</h3>
    <ul>
      <li><b>Money</b> is the API's integer amount divided by 1,000,000. OUSD on Tempo and USDC on Base are both shown as dollars and only added together where a view says "both chains".</li>
      <li><b>Live open:</b> <code>status = open</code> and <code>submissionWindowOpen = true</code>. <b>Past deadline:</b> <code>status = open</code> and <code>submissionWindowOpen = false</code>. <b>Died:</b> <code>expired</code> or <code>cancelled</code>. <b>Paid:</b> <code>completed</code>. <b>In progress:</b> any other status (<code>claimed</code>, <code>pending_approval</code>, <code>worker_selected</code>).</li>
      <li><b>Distinct task posters per week:</b> distinct <code>requester</code> addresses among tasks whose <code>createdAt</code> falls in each ISO week (Monday 00:00 UTC), per chain and combined. A wallet active on both chains counts once in the combined figure.</li>
      <li><b>Flow river:</b> each task's <code>reward</code>, grouped by <code>requester</code>, then by the outcome above, then (for completed tasks with <code>awardCount = 1</code>) by <code>primaryAward.workerAddress</code>. Completed tasks with <code>awardCount</code> above 1 are grouped as multi-winner splits, because the list names only the primary award. These are task rewards by status, not on-chain transfers.</li>
      <li><b>Concentration:</b> the Lorenz curve sorts posting wallets by reward dollars; Gini is computed from the same sorted list. Top-wallet shares rank wallets by dollars for the dollar share and by task count for the task share.</li>
      <li><b>Submission window:</b> <code>expiryTime - createdAt</code>. <b>Wait past deadline:</b> data time minus <code>expiryTime</code>, for past-deadline tasks. The list has no decision timestamp, so no time to decision is stated.</li>
      <li><b>Heatmap:</b> cells as the API gives them. For <code>hourOfWeek</code>, each cell counts activity events; row 0 is Sunday and hours are UTC, which was checked against the feed's own timestamps. For <code>mode</code>, each cell counts tasks posted that day in that mode, with their reward volume.</li>
      <li><b>Time series:</b> shown as the API gives them. <code>completedTasks</code> and <code>settlements</code> appear in the table view under the API's own field names.</li>
      <li><b>Wallets</b> are shown as truncated hex (<code>0xeecd…a5e2</code>). Display names, descriptions and tags are dropped at fetch time and never stored.</li>
    </ul>

    <h3>Reproduce it</h3>
    <p><code>git clone ${esc(repoUrl)} &amp;&amp; cd taskmarket-live-visualizer &amp;&amp; npm ci &amp;&amp; npm run build &amp;&amp; npm run check</code></p>
    <p>The full computed dataset is <a href="../data/market.json">market.json</a>; the checks and ten ready-made audit recipes are in <a href="../data/verify.json">verify.json</a>.</p>
  </div>
</section>`;
}

function activityBody(m, rel, v, repoUrl) {
  return `${hero(VIEWS[4], 'activity heatmap · live feed · methods',
    'Activity as the API reports it: by hour of the week, by mode, and event by event for the most recent 200.')}
${section({ n: 1, kicker: 'activity heatmap', title: 'When agents and requesters are active', sub: 'Each square is one hour of the week in UTC, or one mode on one day. Brighter means more activity.', mount: 'heatmap', minHeight: 300 })}
${section({ n: 2, kicker: 'live activity feed', title: 'The latest 200 events', sub: 'Newest first, as of the data time. Filter by chain or by event.', mount: 'feed', minHeight: 600 })}
${methods(m, v, repoUrl)}`;
}

// ---------- page ----------
export function renderPage(viewKey, { market, verify, siteUrl = DEFAULT_SITE_URL, repoUrl = DEFAULT_REPO_URL }) {
  const view = VIEWS.find((v) => v.key === viewKey);
  const rel = view.path ? '../' : '';
  const site = siteUrl.replace(/\/+$/, '');
  const body = {
    overview: () => overviewBody(market, rel),
    flows: () => flowsBody(market, rel),
    concentration: () => concentrationBody(market, rel),
    chains: () => chainsBody(market, rel),
    activity: () => activityBody(market, rel, verify, repoUrl),
  }[viewKey]();
  return `<!doctype html>
<html lang="en">
<head>
${head({ view, market, siteUrl: site, rel })}
</head>
<body data-view="${view.key}" data-asof="${esc(market.meta.dataAsOf)}">
<div class="glow" aria-hidden="true"></div>
${header({ view, market, rel })}
<main>
${body}
<noscript><p class="wrap note">The charts on this page are drawn with JavaScript. The numbers behind them are in <a href="${rel}data/market.json">market.json</a>.</p></noscript>
</main>
${footer({ rel, repoUrl })}
</body>
</html>
`;
}

export function notFoundPage({ market, siteUrl = DEFAULT_SITE_URL, repoUrl = DEFAULT_REPO_URL }) {
  const base = `${siteUrl.replace(/\/+$/, '')}/`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found · Taskmarket live market visualizer</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="${base}assets/styles.css"></head>
<body><div class="glow" aria-hidden="true"></div>
<header class="top wrap"><div class="top-row"><a href="${base}"><img class="lockup" src="${base}assets/brand/taskmarket-lockup.png" width="971" height="176" alt="Taskmarket"></a></div></header>
<main><div class="hero wrap"><p class="eyebrow">404</p><h1>Nothing at this <em>address.</em></h1>
<p class="lede">The five views live here: ${VIEWS.map((v) => `<a href="${base}${v.path}">${v.nav}</a>`).join(', ')}. Data as of ${esc(market.meta.dataAsOfLabel)}.</p></div></main>
<footer class="wrap"><p class="disclaimer">${esc(DISCLAIMER)}</p><div class="links"><a class="dev" href="https://taskmarket.dev">taskmarket.dev</a><a href="${esc(repoUrl)}">Source</a></div></footer>
</body></html>
`;
}
