// Builds the whole static site into dist/.
//
//   node scripts/build.mjs             fetch the API, then build
//   node scripts/build.mjs --offline   build from .cache/snapshot.json
//
// Environment:
//   SITE_URL   public URL of the deployment (canonical and share-card URLs)
//   REPO_URL   source repository linked from the footer
//
// The build is fail-closed: if the fetch fails or the task list does not
// reconcile with the breakdown, it throws and dist/ is left as it was.
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchSnapshot } from './fetch-data.mjs';
import { analyze, sliceFor, VIEW_SLICES } from './analyze.mjs';
import { generateOg } from './generate-og.mjs';
import { VIEWS, renderPage, notFoundPage, DEFAULT_SITE_URL, DEFAULT_REPO_URL } from './pages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, '.cache', 'snapshot.json');
const FONTS = ['DepartureMono-Regular.woff2', 'InstrumentSerif-Regular.subset.woff2', 'InstrumentSerif-Italic.subset.woff2', 'InterTight-Variable.subset.woff2'];
const LICENSES = ['font-license-departure-mono.OFL.txt', 'font-license-instrument-serif.OFL.txt', 'font-license-inter-tight.OFL.txt'];

async function dirSize(dir) {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await stat(p)).size;
  }
  return total;
}

// Windows can briefly hold a directory open (indexers, a server reading it).
async function retry(fn, tries = 6) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (err) {
      if (i >= tries - 1 || !['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
}

export async function build({
  offline = false,
  outDir = join(ROOT, 'dist'),
  // On Vercel the production hostname is known at build time.
  siteUrl = process.env.SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : DEFAULT_SITE_URL),
  repoUrl = process.env.REPO_URL || DEFAULT_REPO_URL,
  log = console.log,
} = {}) {
  const t0 = Date.now();
  siteUrl = siteUrl.replace(/\/+$/, '');

  // 1. Data: fetched here, on the server. The browser never calls the API.
  let snapshot;
  if (offline) {
    snapshot = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
    log(`[build] offline: using snapshot from ${snapshot.dataAsOf}`);
  } else {
    snapshot = await fetchSnapshot({ log });
    await mkdir(dirname(SNAPSHOT), { recursive: true });
    await writeFile(SNAPSHOT, JSON.stringify(snapshot));
  }

  // 2. Analysis, and the checks that gate publication.
  const { market, verify } = analyze(snapshot);
  if (!verify.allRequiredPass) {
    const failed = verify.checks.filter((c) => c.level === 'required' && !c.pass).map((c) => c.name);
    throw new Error(`reconciliation failed, not publishing: ${failed.join('; ')}`);
  }

  // 3. Write everything into a staging directory, then swap it in.
  const stage = `${outDir}.staging`;
  await retry(() => rm(stage, { recursive: true, force: true }));
  for (const d of ['data', 'assets/fonts', 'assets/brand', 'assets/licenses']) await mkdir(join(stage, d), { recursive: true });

  await writeFile(join(stage, 'data', 'market.json'), JSON.stringify(market));
  await writeFile(join(stage, 'data', 'verify.json'), JSON.stringify(verify, null, 1));
  await writeFile(join(stage, 'data', 'meta.json'), JSON.stringify({ dataAsOf: market.meta.dataAsOf, dataAsOfLabel: market.meta.dataAsOfLabel, builtAt: new Date().toISOString() }));
  for (const view of Object.keys(VIEW_SLICES)) await writeFile(join(stage, 'data', `${view}.json`), JSON.stringify(sliceFor(market, view)));

  for (const f of await readdir(join(ROOT, 'src'))) {
    if (f.endsWith('.mjs') || f.endsWith('.css')) await cp(join(ROOT, 'src', f), join(stage, 'assets', f));
  }
  for (const f of FONTS) await cp(join(ROOT, 'assets', 'fonts', f), join(stage, 'assets', 'fonts', f));
  for (const f of ['taskmarket-lockup.png', 'taskmarket-mark.png']) await cp(join(ROOT, 'assets', 'brand', f), join(stage, 'assets', 'brand', f));
  for (const f of LICENSES) await cp(join(ROOT, 'assets', 'brand', f), join(stage, 'assets', 'licenses', f));
  await writeFile(join(stage, 'assets', 'licenses', 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Font licences</title><link rel="stylesheet" href="../styles.css"><body><main class="wrap" style="padding-top:40px"><h2>Font licences</h2><p class="sub">Instrument Serif, Inter Tight and Departure Mono are used under the SIL Open Font License 1.1.</p><ul>${LICENSES.map((f) => `<li><a href="${f}">${f}</a></li>`).join('')}</ul><p class="note"><a href="../../">Back to the visualizer</a></p></main></body></html>\n`);
  await cp(join(ROOT, 'LICENSE'), join(stage, 'LICENSE.txt'));

  for (const view of VIEWS) {
    const dir = join(stage, view.path);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.html'), renderPage(view.key, { market, verify, siteUrl, repoUrl }));
  }
  await writeFile(join(stage, '404.html'), notFoundPage({ market, siteUrl, repoUrl }));
  await writeFile(join(stage, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`);
  await writeFile(join(stage, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${VIEWS.map((v) => `  <url><loc>${siteUrl}/${v.path}</loc><lastmod>${market.meta.dataAsOf}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  await writeFile(join(stage, '.nojekyll'), '');

  await generateOg(market, join(stage, 'og'), { log });

  // Swap. A server reading dist/ from memory (server.mjs) never sees the gap.
  await retry(() => rm(outDir, { recursive: true, force: true }));
  await retry(() => rename(stage, outDir));

  const bytes = await dirSize(outDir);
  log(`[build] ${outDir} ready: data as of ${market.meta.dataAsOfLabel}, ${market.meta.publicTasks} public tasks of ${market.meta.breakdownTasks} in breakdowns, ${(bytes / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { market, verify, outDir, bytes, siteUrl };
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await build({ offline: process.argv.includes('--offline') });
  } catch (err) {
    console.error(`[build] FAILED: ${err.stack || err.message}`);
    process.exitCode = 1;
  }
}
