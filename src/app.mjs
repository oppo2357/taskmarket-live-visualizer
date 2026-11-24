// Page bootstrap. Loads this view's pre-computed JSON (written at build time,
// on the server) and hands it to the view's charts. The browser only ever
// reads files from this site: it never calls the Taskmarket API.
import { h, clear } from './viz-core.mjs';

const view = document.body.dataset.view;
const dataUrl = (name) => new URL(`../data/${name}.json`, import.meta.url);

const VIEWS = {
  overview: async (d, mount) => {
    const [swarm, series, bars] = await Promise.all([import('./viz-swarm.mjs'), import('./viz-series.mjs'), import('./viz-bars.mjs')]);
    swarm.swarmField(mount('swarm'), d);
    series.seriesExplorer(mount('series'), d);
    bars.structure(mount('structure'), d);
  },
  flows: async (d, mount) => {
    const [river, bars] = await Promise.all([import('./viz-sankey.mjs'), import('./viz-bars.mjs')]);
    river.flowRiver(mount('river'), d);
    bars.mortality(mount('mortality'), d);
    bars.backlog(mount('backlog'), d);
  },
  concentration: async (d, mount) => {
    const p = await import('./viz-posters.mjs');
    p.weeklyPosters(mount('weekly'), d);
    p.lorenz(mount('lorenz'), d);
    p.postersTable(mount('posters'), d);
  },
  chains: async (d, mount) => {
    const b = await import('./viz-bars.mjs');
    b.chainDuel(mount('duel'), d);
  },
  activity: async (d, mount) => {
    const [heat, feed] = await Promise.all([import('./viz-heatmap.mjs'), import('./viz-feed.mjs')]);
    heat.heatmap(mount('heatmap'), d);
    feed.activityFeed(mount('feed'), d);
  },
};

function mountPoint(name) {
  const node = document.querySelector(`[data-viz="${name}"]`);
  if (!node) throw new Error(`missing mount point: ${name}`);
  return clear(node);
}

// ---------- header: copy link, data age, fresh-data notice ----------
function wireCopy() {
  const btn = document.querySelector('[data-copy]');
  if (!btn) return;
  const label = btn.textContent;
  btn.addEventListener('click', async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = h('textarea', { class: 'sr' });
      ta.value = url; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      ta.remove();
    }
    btn.textContent = 'Link copied'; btn.classList.add('done');
    setTimeout(() => { btn.textContent = label; btn.classList.remove('done'); }, 1600);
  });
}

function wireAge(asOfIso) {
  const nodes = document.querySelectorAll('[data-age]');
  const tick = () => {
    const mins = Math.max(0, Math.round((Date.now() - Date.parse(asOfIso)) / 60000));
    const text = mins < 1 ? 'just now' : mins < 90 ? `${mins} min ago` : mins < 2880 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
    nodes.forEach((n) => { n.textContent = text; });
  };
  tick();
  setInterval(tick, 30000);
}

// The site is rebuilt on the server on a schedule. If a newer build lands while
// the page is open, offer a reload instead of silently showing old numbers.
function watchForNewData(asOfIso) {
  const notice = document.querySelector('[data-fresh]');
  if (!notice) return;
  notice.addEventListener('click', () => location.reload());
  const check = async () => {
    if (document.hidden) return;
    try {
      const res = await fetch(dataUrl('meta'), { cache: 'no-cache' });
      if (!res.ok) return;
      const meta = await res.json();
      if (meta.dataAsOf && meta.dataAsOf !== asOfIso) notice.classList.add('on');
    } catch { /* offline: keep what we have */ }
  };
  setInterval(check, 5 * 60000);
  document.addEventListener('visibilitychange', check);
}

async function main() {
  wireCopy();
  const asOf = document.body.dataset.asof;
  if (asOf) { wireAge(asOf); watchForNewData(asOf); }
  if (!VIEWS[view]) return;
  try {
    const res = await fetch(dataUrl(view));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    await VIEWS[view](data, mountPoint);
    document.documentElement.dataset.ready = '1';
  } catch (err) {
    console.error(err);
    document.querySelectorAll('[data-viz]').forEach((n) => { if (!n.childElementCount) n.replaceChildren(h('p', { class: 'loading', text: 'The data file did not load. Reload to try again.' })); });
  }
}
main();
