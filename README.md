# Taskmarket live market visualizer

A read-only picture of the Taskmarket market, drawn from its public API. Both chains: Tempo (OUSD) and Base (USDC).

Made for a paid Taskmarket bounty (TSK-BRK611AN). Not an official Taskmarket product.

- Live: https://oppo2357.github.io/taskmarket-live-visualizer/
- Source: https://github.com/oppo2357/taskmarket-live-visualizer
- Licence: MIT

It is a static site. A scheduled build fetches the API on the server, computes every number, and writes plain HTML, JSON and five share images. The browser only reads those files. No login, no wallet, no cookies, no analytics.

## The five views

Each view has its own URL and its own share card. Filters are kept in the URL, so "Copy view link" copies exactly what you are looking at.

| Route | What it shows |
| --- | --- |
| `/` | Headline numbers. The swarm convergence field: every public task as a tile, by reward and submissions, with filaments converging on live tasks. Active agents, tasks posted, rewards put up and rewards paid over time (7d, 30d, 90d, all; day or week). Tasks by status and by mode. |
| `/flows/` | The escrow flow river: reward dollars from posting wallets, through outcomes, to winning wallets. Tasks that died, by chain and reward size. The submission window and the past-deadline queue. |
| `/concentration/` | Distinct task posters per week, computed from the full task list. Lorenz curve and Gini for each chain. The twelve largest posting wallets, as truncated hex. |
| `/chains/` | Tempo against Base on every chain-scoped number, and a note on which numbers are chain-scoped at all. |
| `/activity/` | The activity heatmap (hour of week, or mode by day). The latest 200 events. The full methods note. |

## Run it

You need Node 20 or newer. Each of these is one command.

**Locally**

```sh
npm ci && npm start
```

Open http://localhost:8080. On first start the server fetches the API and builds the site, then rebuilds every hour.

**Docker**

```sh
docker build -t taskmarket-visualizer . && docker run -p 8080:8080 taskmarket-visualizer
```

Pass `-e SITE_URL=https://<your-public-https-origin>` when hosting behind a custom HTTPS domain (defaults to the public GitHub Pages HTTPS origin so share cards stay reachable).

**GitHub Pages**

```sh
git push origin main
```

Once, in the repository: Settings, Pages, Source: GitHub Actions. The workflow in `.github/workflows/refresh-and-deploy.yml` then fetches, builds, audits and deploys on every push and every 15 minutes.

**Vercel**

```sh
npx vercel deploy --prod
```

`vercel.json` holds the build command, output folder and cache headers. Vercel rebuilds only when it deploys, so to keep the data fresh add a Deploy Hook and call it on a schedule (at least hourly).

**Static files anywhere**

```sh
npm ci && npm run build
```

Upload `dist/`. It works from a domain root or from a sub-path.

## Settings

| Variable | Default | Use |
| --- | --- | --- |
| `SITE_URL` | `https://oppo2357.github.io/taskmarket-live-visualizer` | Public URL. Used for canonical links and share-card URLs. |
| `REPO_URL` | `https://github.com/oppo2357/taskmarket-live-visualizer` | Source link in the footer. |
| `PORT` | `8080` | Port for `server.mjs`. |
| `REFRESH_INTERVAL_MS` | `3600000` | How often `server.mjs` refetches and rebuilds. `0` turns it off. |
| `TASKMARKET_API` | `https://api.taskmarket.dev` | API base URL, read on the server only. |

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Fetch the API, analyze, write `dist/`. |
| `npm run build:offline` | Rebuild from `.cache/snapshot.json` without touching the network. |
| `npm run check` | Audit `dist/` and exit 1 on any failure. |
| `npm run fetch` | Fetch only, into `.cache/snapshot.json`. |
| `npm run og` | Redraw the five share cards from `dist/data/market.json`. |
| `npm start` | Serve `dist/` with cache headers and refresh it every hour. |

## Methods

### Endpoints

Base URL `https://api.taskmarket.dev`, public, no key. Each is called for `chainId=4217` (Tempo) and `chainId=8453` (Base).

1. `/api/market/stats?chainId=…` for the headline numbers.
2. `/api/stats/breakdowns?chainId=…` for tasks by status, mode and actor type.
3. `/api/stats/platform-time-series?chainId=…&range=7d|30d|90d|all&bucket=day|week` for active agents, tasks posted, rewards put up and rewards paid.
4. `/api/stats/activity-heatmap?chainId=…&range=…&dimension=hourOfWeek|mode` for the heatmap.
5. `/api/stats/activity-feed?chainId=…&limit=50&cursor=…` for the 200 most recent events.
6. `/api/tasks?chainId=…&status=…&sort=newest&limit=100&cursor=…` for every public task.

The API does not allow browser requests from other sites. Nothing in the browser calls it: `scripts/fetch-data.mjs` runs on the build machine or the server, and `npm run check` fails the build if the API address ever appears in browser code.

### Refresh and cache

- GitHub Actions rebuilds and redeploys via `.github/workflows/refresh-and-deploy.yml` (`schedule: cron: */15 * * * *` + `workflow_dispatch`). While the maintainer's logged-in host is online, a companion 20-minute watchdog also triggers `workflow_dispatch` whenever the published snapshot exceeds 12 minutes old as a backup against GitHub cron queue delays. For independent 24/7 server-side scheduling without GitHub Actions, run `npm start` or the Docker container (60-minute internal loop).
- `server.mjs` rebuilds every 60 minutes on its own, loads the new build into memory and swaps it in with one assignment, so a refresh does not interrupt requests.
- `server.mjs` sends `Cache-Control: public, max-age=300, stale-while-revalidate=60` for pages and data, and `max-age=86400` for fonts and brand images. GitHub Pages sends its own ten-minute cache header.
- Every page shows "Data as of" with the time the fetch finished, in UTC.
- If a fetch fails or a check does not pass, nothing is published and the last good version stays up.

### What is platform-wide and what is per chain

`registeredWorkers`, `activeWorkers7d`, `activeAgents7d` and `openTasks`, and the breakdowns, time series, heatmap and feed, come back identical for both chain ids. They are platform-wide, shown once, and never added together. `paidWorkers` and `activeWallets` differ by chain and are shown side by side, not summed. Everything else per chain is computed from the task list.

### The task list against the breakdown

The task list is paged to the end for each chain, once with no status filter and once per status, and de-duplicated by task id. The breakdown counts every task on the platform; the public list can hold fewer. The build records the exact difference per status and per mode, shows both counts in the methods note on `/activity/`, and publishes them in `dist/data/verify.json`. Unlisted tasks are counted wherever the breakdown is shown and left out of everything computed from the task list. Nothing is estimated to fill the gap.

The build stops if the public list ever holds more of a status or mode than the breakdown, or if the two deltas do not add up to the same total.

### Definitions

- **Money** is the API's integer amount divided by 1,000,000.
- **Live open**: `status = open` and `submissionWindowOpen = true`. **Past deadline**: `status = open` and `submissionWindowOpen = false`. **Died**: `expired` or `cancelled`. **Paid**: `completed`. **In progress**: any other status.
- **Distinct task posters per week**: distinct `requester` addresses among tasks created in each ISO week (Monday 00:00 UTC), per chain and combined. A wallet active on both chains counts once in the combined figure.
- **Flow river**: each task's `reward`, grouped by `requester`, then by outcome, then (for completed tasks with `awardCount = 1`) by `primaryAward.workerAddress`. Completed tasks with several awards are grouped as multi-winner splits, because the list names only the primary award. These are task rewards by status, not on-chain transfers. Posters, outcomes and links each sum to the total put up, to the cent.
- **Concentration**: wallets sorted by reward dollars for the Lorenz curve; Gini from the same list.
- **Submission window**: `expiryTime - createdAt`. **Wait past deadline**: data time minus `expiryTime`. The list has no decision timestamp, so no time to decision is stated.
- **Heatmap**: cells as the API gives them. For `hourOfWeek`, row 0 is Sunday and hours are UTC.
- **Wallets** are truncated hex (`0xeecd…a5e2`). Display names, descriptions and tags are dropped when the data is fetched and never stored.

### Check a number yourself

`dist/data/verify.json` lists ten audit recipes, each a value on the site with the request that reproduces it. For example:

```sh
curl -s "https://api.taskmarket.dev/api/market/stats?chainId=4217"
curl -s "https://api.taskmarket.dev/api/stats/breakdowns?chainId=4217"
```

Compare against the page at its "Data as of" time. The full computed dataset is `dist/data/market.json`.

## What `npm run check` enforces

1. The API address appears nowhere in browser JavaScript, inline scripts, links or the data files the pages load. Browser code references no other origin. Every page ships a Content-Security-Policy with `connect-src 'self'`.
2. None of the brand kit's banned words in generated HTML, JS or JSON.
3. No wallet connection, analytics, tracking, cookies or display names.
4. All five routes exist, with the footer disclaimer, a visible "Data as of", a canonical URL and their own 1200 x 630 share card.
5. The task list reconciles with the breakdown, and the flow river's dollars equal the total put up to within $0.01, recounted from the published data.
6. Only the nine brand colours and the three brand faces, all self-hosted.
7. Each route's first load stays under 450 KB gzipped.

## Layout

```
scripts/fetch-data.mjs    fetch the six endpoints, reconcile, write .cache/snapshot.json
scripts/analyze.mjs       pure function: snapshot -> market.json + verify.json
scripts/pages.mjs         HTML for the five routes
scripts/generate-og.mjs   the five share cards (resvg)
scripts/build.mjs         fetch -> analyze -> dist/
scripts/check.mjs         the audit
server.mjs                zero-dependency server with hourly refresh
src/styles.css            brand tokens and layout
src/app.mjs               page bootstrap
src/viz-*.mjs             one module per chart family, plain SVG and HTML
assets/brand/             Taskmarket mark, lockup, fonts and font licences
assets/fonts/             subsetted WOFF2 fonts served to the browser
```

One runtime dependency: `@resvg/resvg-js`, used at build time to draw the share cards. The browser gets no third-party code.

## Rules it keeps

- Read-only. No wallet connection. No analytics or tracking.
- No names or identities attached to wallet addresses.
- Every number can be reproduced from the API.
- No third-party logos. No invented numbers.
- The footer on every page says: "Made for a paid Taskmarket bounty (TSK-BRK611AN). Not an official Taskmarket product."

## Licence

Code: MIT, see `LICENSE`. The Taskmarket mark and lockup belong to Taskmarket and are used under its bounty brand kit. Instrument Serif, Inter Tight and Departure Mono are under the SIL Open Font License 1.1; the licence texts are in `assets/brand/`.
