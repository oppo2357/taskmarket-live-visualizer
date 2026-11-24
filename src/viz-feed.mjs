// Activity feed: the most recent events in the snapshot, filterable by chain
// and event type. Actors are truncated hex; no names are shown.
import { h, clear, fmtInt, fmtUsd, fmtTime, pillRow, state, CHAIN_NAME } from './viz-core.mjs';

const TYPE_LABEL = { task_submitted: 'Submission', task_created: 'Task posted', task_completed: 'Task completed', task_accepted: 'Work accepted', task_claimed: 'Task claimed', task_rated: 'Rating', task_expired: 'Task expired', task_cancelled: 'Task cancelled' };
const typeLabel = (t) => TYPE_LABEL[t] || String(t).replace(/^task_/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const PAGE = 30;

export function activityFeed(root, d) {
  const items = d.feed;
  const types = [...new Set(items.map((i) => i.type))];
  const chains = [...new Set(items.map((i) => i.chainId))].sort();
  let chain = state.get('fchain', 'all', ['all', ...chains.map(String)]);
  let type = state.get('ftype', 'all', ['all', ...types]);
  let shown = PAGE;

  const controls = h('div', { class: 'controls' });
  const summary = h('p', { class: 'sub', style: 'margin:0 0 6px' });
  const list = h('ol', { class: 'feed' });
  const more = h('button', { class: 'pill', type: 'button', style: 'margin-top:12px' });
  more.addEventListener('click', () => { shown += PAGE; render(); });
  root.append(controls, h('div', { class: 'card' }, summary, list, more));

  const match = (i) => (chain === 'all' || String(i.chainId) === chain) && (type === 'all' || i.type === type);
  const count = (fn) => items.filter(fn).length;

  function renderControls() {
    clear(controls).append(
      pillRow({ label: 'chain', value: chain, options: [{ value: 'all', label: 'All', count: items.length }, ...chains.map((c) => ({ value: String(c), label: CHAIN_NAME[c] || String(c), count: count((i) => i.chainId === c) }))], onChange: (v) => { chain = v; shown = PAGE; state.set('fchain', v, 'all'); render(); } }),
      pillRow({ label: 'event', value: type, options: [{ value: 'all', label: 'All' }, ...types.map((t) => ({ value: t, label: typeLabel(t), count: count((i) => i.type === t) }))], onChange: (v) => { type = v; shown = PAGE; state.set('ftype', v, 'all'); render(); } }));
  }

  function render() {
    const rows = items.filter(match);
    if (items.length) {
      const first = items.at(-1).ts, last = items[0].ts;
      const minutes = Math.max(1, Math.round((Date.parse(last) - Date.parse(first)) / 60000));
      summary.textContent = `The ${fmtInt(items.length)} most recent events span ${fmtInt(minutes)} minutes, from ${fmtTime(first)} to ${fmtTime(last)}. ${fmtInt(rows.length)} match the filters.`;
    } else summary.textContent = 'No events in this snapshot.';
    clear(list);
    for (const i of rows.slice(0, shown)) {
      const stamp = fmtTime(i.ts, true);
      const task = h('a', { href: `https://taskmarket.dev/tasks/${i.taskId}`, target: '_blank', rel: 'noopener', class: 'mono', text: i.ref || `${i.taskId.slice(0, 10)}…` });
      list.append(h('li', {},
        h('time', { datetime: i.ts, text: `${stamp.slice(11, 19)} ` }, h('span', { text: stamp.slice(0, 10) })),
        h('div', { class: 'what' }, h('b', { text: typeLabel(i.type) }), ' · ', task,
          h('span', { class: 'meta', text: `${CHAIN_NAME[i.chainId] || i.chainId} · ${i.actorType || 'actor'} ${i.actor || ''}`.trim() })),
        h('div', { class: 'amt', text: i.usd == null ? '' : fmtUsd(i.usd) })));
    }
    if (!rows.length) list.append(h('li', {}, h('time', {}), h('div', { class: 'what muted', text: 'Nothing matches these filters.' }), h('div')));
    const left = rows.length - Math.min(shown, rows.length);
    more.style.display = left > 0 ? '' : 'none';
    more.textContent = `Show ${Math.min(PAGE, left)} more (${fmtInt(left)} left)`;
  }

  renderControls();
  render();
}
