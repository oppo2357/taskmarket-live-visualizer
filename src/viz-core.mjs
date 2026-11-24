// Shared drawing helpers. No dependencies, no network.

export const COLOR = {
  ground: '#12100E', maroon: '#3A1420', panel: '#221E1A', line: '#453E37', cream: '#EFE9E2',
  paper: '#FFF6E8', muted: '#B0A79D', magenta: '#E74079', salmon: '#D9A097',
};
export const OUTCOME_COLOR = { paid: COLOR.cream, live: COLOR.magenta, stale: COLOR.salmon, progress: COLOR.muted, died: COLOR.line };
export const CHAIN_NAME = { 4217: 'Tempo', 8453: 'Base' };
export const CHAIN_TOKEN = { 4217: 'OUSD', 8453: 'USDC' };

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element with attributes and children. */
export function svg(tag, attrs = {}, ...kids) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) node.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}
/** Create an HTML element. Text is always set with textContent. */
export function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}
export const clear = (node) => { node.replaceChildren(); return node; };

// ---------- formatting ----------
const INT = new Intl.NumberFormat('en-US');
export const fmtInt = (v) => (v == null ? 'n/a' : INT.format(v));
export function fmtUsd(v) {
  if (v == null) return 'n/a';
  if (v !== 0 && Math.abs(v) < 0.01) return `$${v.toFixed(6).replace(/0+$/, '')}`;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtUsdShort(v) {
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  if (v >= 10 || v === 0) return `$${Math.round(v)}`;
  return `$${v.toFixed(v >= 1 ? 1 : 2)}`;
}
export const fmtIntShort = (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));
export function fmtPct(v) {
  if (v == null) return 'n/a';
  if (v > 0 && v < 0.05) return '<0.1%';
  if (v < 100 && v >= 99.95) return '>99.9%';
  return `${v.toFixed(1)}%`;
}
export function fmtHours(hours) {
  if (hours == null) return 'n/a';
  if (hours < 48) return `${(Math.round(hours * 10) / 10).toLocaleString('en-US')} h`;
  return `${(Math.round((hours / 24) * 10) / 10).toLocaleString('en-US')} d`;
}
const pad = (n) => String(n).padStart(2, '0');
/** Unix seconds or ISO string to "2026-11-24 19:13 UTC". */
export function fmtTime(t, withSeconds = false) {
  const d = new Date(typeof t === 'number' ? t * 1000 : t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${withSeconds ? `:${pad(d.getUTCSeconds())}` : ''} UTC`;
}
export const fmtDay = (t) => fmtTime(t).slice(0, 10);

// ---------- scales ----------
export const linear = (d0, d1, r0, r1) => (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
/** "Nice" upper bound and ticks for a zero-based axis. */
export function niceMax(max, ticks = 3) {
  if (!(max > 0)) return { max: 1, step: 1, ticks: [0, 1] };
  const raw = max / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  const out = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return { max: top, step, ticks: out };
}

// ---------- tooltip ----------
let tipNode;
/** Show the shared tooltip. `rows` is [[label, value], ...]; all text is set safely. */
export function showTip(x, y, title, rows = [], foot) {
  if (!tipNode) { tipNode = h('div', { class: 'tip', role: 'status' }); document.body.append(tipNode); }
  clear(tipNode);
  if (title) tipNode.append(h('b', { text: title }));
  for (const [k, v] of rows) tipNode.append(h('div', { class: 'row' }, h('span', { text: k }), h('span', { text: v })));
  if (foot) tipNode.append(h('div', { text: foot }));
  tipNode.classList.add('on');
  const r = tipNode.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - r.width - 8);
  const top = y + 16 + r.height > window.innerHeight ? Math.max(8, y - r.height - 12) : y + 16;
  tipNode.style.left = `${left}px`;
  tipNode.style.top = `${top}px`;
}
export const hideTip = () => tipNode?.classList.remove('on');

// ---------- controls ----------
/**
 * A row of toggle pills bound to one value.
 * options: [{ value, label, swatch?, count? }]
 */
export function pillRow({ label, options, value, onChange }) {
  const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  if (label) wrap.append(h('span', { class: 'seg-label', text: label }));
  const buttons = options.map((o) => {
    const b = h('button', { class: 'pill', type: 'button', 'aria-pressed': String(o.value === value) },
      o.swatch ? h('i', { class: `sw ${o.swatch}` }) : null,
      h('span', { text: o.label }),
      o.count != null ? h('span', { class: 'n', text: fmtInt(o.count) }) : null);
    b.addEventListener('click', () => {
      buttons.forEach((x, i) => x.setAttribute('aria-pressed', String(options[i].value === o.value)));
      onChange(o.value);
    });
    return b;
  });
  wrap.append(...buttons);
  return wrap;
}

/** A collapsible table twin for a chart. columns: [{ label, get, fmt? }] */
export function tableView(summary, columns, rows) {
  const d = h('details', { class: 'table' }, h('summary', { text: summary }));
  let built = false;
  d.addEventListener('toggle', () => {
    if (built || !d.open) return;
    built = true;
    const thead = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', text: c.label }))));
    const tbody = h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => h('td', { text: String((c.fmt || ((v) => v))(c.get(r))) })))));
    d.append(h('div', { class: 'scroll' }, h('table', {}, thead, tbody)));
  });
  return d;
}

/** Re-run `draw(width)` whenever the container's width changes. */
export function responsive(node, draw) {
  let last = 0, frame = 0;
  const run = () => {
    const cs = getComputedStyle(node);
    const w = Math.floor(node.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    if (!(w > 0) || w === last) return;
    last = w;
    draw(w);
  };
  new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(run); }).observe(node);
  run();
  return () => { last = 0; run(); };
}

// ---------- shareable state in the URL hash ----------
// "#range=30d&chain=tempo". A plain anchor such as "#methods" is left alone.
function readHash() {
  const raw = location.hash.slice(1);
  return raw.includes('=') ? new URLSearchParams(raw) : new URLSearchParams();
}
export const state = {
  get(key, fallback, allowed) {
    const v = readHash().get(key);
    if (v == null) return fallback;
    return !allowed || allowed.includes(v) ? v : fallback;
  },
  set(key, value, fallback) {
    const p = readHash();
    if (value == null || value === fallback) p.delete(key); else p.set(key, value);
    const s = p.toString();
    history.replaceState(null, '', s ? `#${s}` : location.pathname + location.search);
  },
};

/** Small deterministic hash for stable jitter. */
export function hash32(str) {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  return x >>> 0;
}
