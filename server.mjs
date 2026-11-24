// Zero-dependency server for the built site, with its own data refresh.
//
//   node server.mjs
//
// It serves dist/ from memory and, every REFRESH_INTERVAL_MS (default one
// hour), fetches the Taskmarket API on the server and rebuilds. The new build
// is loaded into memory and swapped in with a single assignment, so a refresh
// never interrupts a request. If a refresh fails, the last good build stays up
// and the "data as of" time on every page keeps telling the truth.
//
// Environment:
//   PORT                 default 8080
//   HOST                 default 0.0.0.0
//   SITE_URL             public URL, used for canonical and share-card links
//   REFRESH_INTERVAL_MS  default 3600000 (1 hour); 0 turns refresh off
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants as zc } from 'node:zlib';
import { build } from './scripts/build.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS ?? 3600000);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.svg': 'image/svg+xml',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.mjs', '.json', '.txt', '.xml', '.svg']);
// Pages and data may be cached for five minutes; fonts and brand images for a day.
const CACHE_SHORT = 'public, max-age=300, stale-while-revalidate=60';
const CACHE_LONG = 'public, max-age=86400';
const cacheFor = (path) => (path.startsWith('/assets/fonts/') || path.startsWith('/assets/brand/') ? CACHE_LONG : CACHE_SHORT);

let site = new Map(); // url path -> { body, br, gz, type, cache, etag }
const status = { dataAsOf: null, loadedAt: null, lastRefreshAt: null, lastRefreshError: null, refreshing: false };
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function walk(dir, base = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...await walk(join(dir, e.name), `${base}/${e.name}`));
    else out.push(`${base}/${e.name}`);
  }
  return out;
}

/** Read dist/ into a fresh map. Nothing is swapped in until it is complete. */
async function loadSite() {
  const next = new Map();
  for (const path of await walk(DIST)) {
    const body = await readFile(join(DIST, path));
    const ext = extname(path);
    const entry = { body, type: TYPES[ext] || 'application/octet-stream', cache: cacheFor(path), etag: `"${createHash('sha1').update(body).digest('base64url').slice(0, 20)}"` };
    if (COMPRESSIBLE.has(ext) && body.length > 512) {
      entry.br = brotliCompressSync(body, { params: { [zc.BROTLI_PARAM_QUALITY]: 9 } });
      entry.gz = gzipSync(body, { level: 9 });
    }
    next.set(path, entry);
  }
  if (!next.has('/index.html') || !next.has('/data/meta.json')) throw new Error('dist/ is incomplete');
  const meta = JSON.parse(next.get('/data/meta.json').body.toString('utf8'));
  site = next; // the atomic swap
  status.dataAsOf = meta.dataAsOf;
  status.loadedAt = new Date().toISOString();
  log(`[server] loaded ${next.size} files, data as of ${meta.dataAsOfLabel}`);
}

async function refresh() {
  if (status.refreshing) return;
  status.refreshing = true;
  try {
    await build({ log: (m) => log(m) });
    await loadSite();
    status.lastRefreshAt = new Date().toISOString();
    status.lastRefreshError = null;
  } catch (err) {
    status.lastRefreshError = String(err.message || err);
    log(`[server] refresh failed, still serving data as of ${status.dataAsOf}: ${status.lastRefreshError}`);
  } finally {
    status.refreshing = false;
  }
}

function send(req, res, code, entry, extra = {}) {
  const headers = {
    'Content-Type': entry.type,
    'Cache-Control': entry.cache,
    ETag: entry.etag,
    Vary: 'Accept-Encoding',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Data-As-Of': status.dataAsOf || '',
    ...extra,
  };
  if (code === 200 && req.headers['if-none-match'] === entry.etag) { res.writeHead(304, headers); res.end(); return; }
  const accept = String(req.headers['accept-encoding'] || '');
  let body = entry.body;
  if (entry.br && /\bbr\b/.test(accept)) { body = entry.br; headers['Content-Encoding'] = 'br'; }
  else if (entry.gz && /\bgzip\b/.test(accept)) { body = entry.gz; headers['Content-Encoding'] = 'gzip'; }
  headers['Content-Length'] = body.length;
  res.writeHead(code, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400); res.end(); return; }
  if (path.includes('..') || path.includes('\0')) { res.writeHead(400); res.end(); return; }

  if (path === '/healthz') {
    const body = Buffer.from(JSON.stringify({ ok: site.size > 0, ...status, refreshIntervalMs: REFRESH_INTERVAL_MS }));
    res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
    return;
  }
  if (path.endsWith('/')) path += 'index.html';
  const entry = site.get(path);
  if (entry) { send(req, res, 200, entry); return; }
  if (site.has(`${path}/index.html`)) { res.writeHead(301, { Location: `${path}/`, 'Cache-Control': CACHE_SHORT }); res.end(); return; }
  const missing = site.get('/404.html');
  if (missing) send(req, res, 404, missing, { 'Cache-Control': 'no-store' });
  else { res.writeHead(404); res.end('Not found'); }
});

// ----- start -----
try {
  await loadSite();
} catch {
  log('[server] no usable dist/ yet, building once before listening');
  await build({ log: (m) => log(m) });
  await loadSite();
}
server.listen(PORT, HOST, () => log(`[server] listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));

// If something else rebuilds dist/ (npm run build, a cron job), pick it up.
let seenMeta = 0;
setInterval(async () => {
  if (status.refreshing) return;
  try {
    const m = (await stat(join(DIST, 'data', 'meta.json'))).mtimeMs;
    if (seenMeta && m !== seenMeta) await loadSite();
    seenMeta = m;
  } catch { /* dist/ is mid-swap; try again next tick */ }
}, 5000).unref();

if (REFRESH_INTERVAL_MS > 0) {
  // Refresh straight away if the loaded build is already older than one interval.
  if (Date.now() - Date.parse(status.dataAsOf) > REFRESH_INTERVAL_MS) refresh();
  setInterval(refresh, REFRESH_INTERVAL_MS).unref?.();
  // unref() above would let the process exit if the server closed; the listening socket keeps it alive.
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log(`[server] ${sig}, closing`); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); });
