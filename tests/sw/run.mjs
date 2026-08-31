// =============================================================================
// Young Lists — service worker tests
// =============================================================================
// The bug being guarded against: the previous worker was cache-first for every
// same-origin request, so once index.html / app.js / styles.css were cached a
// phone kept serving them forever. Deploys did not reach people until they
// cleared Safari's website data.
//
// These tests copy the app into a temp directory, serve it over http on
// localhost (a secure context, so service workers run), and check both halves
// of the contract:
//
//   1. a file changed on the server is picked up on the next load, and
//   2. the app still opens with the network switched off.
//
//   node tests/sw/run.mjs
// =============================================================================

import { createServer } from 'node:http';
import { readFile, writeFile, cp, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');

// Playwright and Chromium are found in whatever way this machine provides them:
// the pre-installed browser in the dev container, or a locally installed
// playwright package in CI.
function chromiumPath() {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit) return explicit;
  const bundled = '/opt/pw-browsers/chromium';
  return existsSync(bundled) ? bundled : undefined;   // undefined = let Playwright decide
}


const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png'
};

let passed = 0;
const failures = [];
const ok = (condition, label) => {
  if (condition) { passed += 1; console.log(`  ok  ${label}`); }
  else { failures.push(label); console.log(`  FAIL ${label}`); }
};

async function main() {
  // A writable copy, so a "deploy" is just editing a file.
  const dir = await mkdtemp(path.join(tmpdir(), 'young-lists-sw-'));
  await cp(path.join(ROOT, 'young-lists'), dir, { recursive: true });

  // Test doubles for the two files that would otherwise need a real backend.
  const mock = await readFile(path.join(ROOT, 'tests/browser/mock-supabase.js'), 'utf8');
  const vendor = (await readFile(path.join(ROOT, 'young-lists/index.html'), 'utf8'))
    .match(/vendor\/(supabase-js-[^"]+\.umd\.js)/)[1];
  await writeFile(path.join(dir, 'vendor', vendor), mock);
  await writeFile(path.join(dir, 'config.js'),
    'export const SUPABASE_URL = "https://test.supabase.co";\n' +
    'export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";\n' +
    'export const APP_VERSION = "2.0.0-test";\n');

  const server = createServer(async (req, res) => {
    const rel = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      const body = await readFile(path.join(dir, rel));
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumPath()
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  console.log('\n--- service worker ---------------------------------------------------');

  await page.goto(base, { waitUntil: 'networkidle' });
  const controlled = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    // activate() claims clients, but the very first load may still be
    // uncontrolled for a moment.
    for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return Boolean(navigator.serviceWorker.controller);
  });
  ok(controlled, 'the service worker registers and takes control of the page');

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    if (!names.length) return [];
    const cache = await caches.open(names[0]);
    return (await cache.keys()).map((request) => new URL(request.url).pathname);
  });
  ok(cached.includes('/index.html'), 'index.html is precached');
  ok(cached.includes('/styles.css'), 'styles.css is precached');
  ok(cached.some((p) => p.startsWith('/js/')), 'the application modules are precached');

  // -------------------------------------------------------------------------
  // 1. A deploy is picked up. This is what the old cache-first worker got wrong.
  // -------------------------------------------------------------------------
  const marker = '/* deployed-version-2 */\n.deployed-marker { color: rgb(1, 2, 3); }\n';
  const css = await readFile(path.join(dir, 'styles.css'), 'utf8');
  await writeFile(path.join(dir, 'styles.css'), css + marker);

  await page.reload({ waitUntil: 'networkidle' });
  const servedCss = await page.evaluate(async () => (await fetch('./styles.css')).text());
  ok(servedCss.includes('deployed-marker'),
     'a redeployed stylesheet is served fresh, not from a stale cache');

  const newHtml = (await readFile(path.join(dir, 'index.html'), 'utf8'))
    .replace('<title>Young Lists</title>', '<title>Young Lists v2</title>');
  await writeFile(path.join(dir, 'index.html'), newHtml);
  await page.reload({ waitUntil: 'networkidle' });
  ok((await page.title()) === 'Young Lists v2',
     'a redeployed index.html reaches the user on the next load, with no cache clearing');

  // -------------------------------------------------------------------------
  // 2. Offline behaviour: the shell opens, and the app says so plainly.
  // -------------------------------------------------------------------------
  // Sign in first, so we are looking at the app rather than the sign-in screen.
  await page.fill('#auth-email', 'alice@example.com');
  await page.fill('#auth-password', 'password123');
  await page.click('#btn-signin');
  await page.waitForTimeout(400);
  await page.fill('#onboard-household-name', 'The Youngs');
  await page.click('#btn-create-household');
  await page.waitForTimeout(500);
  ok(await page.locator('#view-main').isVisible(), 'signed in and inside the app');
  ok(!(await page.locator('#offline-banner').isVisible()), 'no offline banner while connected');

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.waitForTimeout(300);
  ok(await page.locator('#offline-banner').isVisible(),
     'going offline shows an honest banner instead of pretending data is live');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);           // the worker races a 4s timeout first

  ok(await page.locator('#app').isVisible(), 'the app shell still renders with no network');
  ok((await page.title()).startsWith('Young Lists'), 'it is served from the cache, not an error page');

  await context.setOffline(false);

  await browser.close();
  server.close();
  await rm(dir, { recursive: true, force: true });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log('ALL SERVICE WORKER TESTS PASSED');
}

main().catch((error) => { console.error(error); process.exit(1); });
