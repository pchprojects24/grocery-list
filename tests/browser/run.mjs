// =============================================================================
// Young Lists — browser tests
// =============================================================================
// Drives the real young-lists/index.html in headless Chromium at an iPhone
// viewport. The only thing swapped out is the network layer: the vendored
// supabase-js bundle is replaced by tests/browser/mock-supabase.js, and
// config.js by a stub, so the HTML, CSS and every module under young-lists/js/
// are exactly the files that ship.
//
// The database itself (RLS, cascades, RPC behaviour) is tested separately and
// for real by tests/run_db_tests.sh.
//
//   node tests/browser/run.mjs            # headless
//   node tests/browser/run.mjs --headed   # watch it happen
// =============================================================================

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const APP_DIR = path.join(ROOT, 'young-lists');

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png'
};

// -----------------------------------------------------------------------------
// Assertions
// -----------------------------------------------------------------------------
let passed = 0;
const failures = [];

function ok(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}`);
  }
}

function eq(actual, expected, label) {
  ok(actual === expected, `${label}${actual === expected ? '' : ` (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`}`);
}

const section = (title) => console.log(`\n--- ${title} ${'-'.repeat(Math.max(0, 70 - title.length))}`);

// -----------------------------------------------------------------------------
// Static server for young-lists/
// -----------------------------------------------------------------------------
/**
 * Serves young-lists/ as-is, except for three files that are swapped for test
 * doubles. Substituting here rather than intercepting in the browser keeps the
 * behaviour identical for page requests and service-worker requests alike.
 */
function startServer(overrides) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;

    const send = (body, type) => {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };

    for (const [pattern, body] of overrides) {
      if (pattern.test(rel)) return send(body, 'text/javascript');
    }

    const file = path.join(APP_DIR, rel);
    if (!file.startsWith(APP_DIR)) { res.writeHead(403).end(); return; }
    try {
      send(await readFile(file), TYPES[path.extname(file)] || 'application/octet-stream');
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// -----------------------------------------------------------------------------
// Page helpers
// -----------------------------------------------------------------------------
const visible = (page, selector) => page.locator(selector).isVisible();
const settle = (page, ms = 220) => page.waitForTimeout(ms);

/** Click a button in the action sheet / dialog by its visible label. */
async function clickDialog(page, label) {
  await page.locator('#app-dialog').getByText(label, { exact: true }).first().click();
  await settle(page);
}

async function main() {
  // Only the network layer is replaced: the vendored supabase-js bundle becomes
  // an in-memory fake, config.js gets test credentials, and the service worker
  // is disabled here (it has its own test in tests/sw/run.mjs).
  const mock = await readFile(path.join(HERE, 'mock-supabase.js'), 'utf8');
  const { server, port } = await startServer([
    [/^\/vendor\/supabase-js-.*\.umd\.js$/, mock],
    [/^\/config\.js$/, `export const SUPABASE_URL = "https://test.supabase.co";
      export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
      export const APP_VERSION = "2.0.0-test";`],
    [/^\/sw\.js$/, '/* service worker disabled for these tests */']
  ]);
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({
    headless: !process.argv.includes('--headed'),
    executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'
  });

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },        // iPhone 14
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(String(error)));

  await page.goto(base, { waitUntil: 'networkidle' });

  // ===========================================================================
  section('1. authentication');
  // ===========================================================================
  ok(await visible(page, '#view-auth'), 'signed out, the app shows the sign-in screen');
  ok(!(await visible(page, '#view-main')), 'no household data is on screen while signed out');

  await page.fill('#auth-email', 'alice@example.com');
  await page.fill('#auth-password', 'wrong-password');
  await page.click('#btn-signin');
  await settle(page);
  ok(await visible(page, '#auth-error'), 'a wrong password shows an error');
  eq(await page.textContent('#auth-error'),
     'That email and password do not match an account.',
     'the error is a sentence, not a raw API message');

  // The Sign in button is the form's submit button. Both a click handler and a
  // submit handler used to call login(), sending two requests per tap.
  await page.fill('#auth-password', 'password123');
  await page.click('#btn-signin');
  await settle(page, 400);
  eq(await page.evaluate(() => window.__signInCount), 1,
     'one tap on Sign in sends exactly one sign-in request');

  ok(await visible(page, '#view-onboarding'),
     'a user with no household is sent to onboarding, not to an "access denied" wall');

  // ===========================================================================
  section('2. household onboarding');
  // ===========================================================================
  await page.fill('#onboard-household-name', 'The Youngs');
  await page.click('#btn-create-household');
  await settle(page, 400);
  ok(await visible(page, '#view-main'), 'creating a household opens the app');
  eq(await page.evaluate(() => window.__db.household_members[0].role), 'owner',
     'the creator becomes the household owner');

  // ===========================================================================
  section('3. stores and walking order');
  // ===========================================================================
  await page.click('.nav-btn[data-tab="stores"]');
  await settle(page);
  ok(await visible(page, '#tab-stores'), 'the Stores tab opens');

  await page.locator('#store-templates .chip', { hasText: 'Atlantic Superstore' }).click();
  await settle(page, 400);
  ok(await visible(page, '#view-store-detail'), 'a starter layout opens its route editor');

  const order = () => page.locator('#store-sections-container .section-name')
    .allTextContents();
  const superstoreOrder = await order();
  eq(superstoreOrder.slice(0, 4).join('>'), 'Produce>Bakery>Deli>Meat',
     'the Superstore starter route is in walking order');

  // Reorder: move Bakery up one.
  await page.locator('#store-sections-container .section-row').nth(1)
    .locator('button[aria-label^="Move Bakery earlier"]').click();
  await settle(page, 300);
  eq((await order()).slice(0, 2).join('>'), 'Bakery>Produce', 'a section can be moved earlier');
  await page.locator('#store-sections-container .section-row').nth(0)
    .locator('button[aria-label^="Move Bakery later"]').click();
  await settle(page, 300);
  eq((await order()).slice(0, 2).join('>'), 'Produce>Bakery', 'and moved back');

  // Rename keeps the id, so items stay attached.
  const produceId = await page.evaluate(() =>
    window.__db.store_sections.find((s) => s.name === 'Produce').id);
  await page.locator('#store-sections-container .section-name', { hasText: 'Produce' }).click();
  await settle(page);
  await page.fill('#dlg-value', 'Fruit & Veg');
  await clickDialog(page, 'Rename');
  eq((await order())[0], 'Fruit & Veg', 'a section can be renamed');
  eq(await page.evaluate((id) => window.__db.store_sections.find((s) => s.id === id).name, produceId),
     'Fruit & Veg', 'the renamed section keeps its stable id');

  // Put the name back for the ordering test below.
  await page.locator('#store-sections-container .section-name', { hasText: 'Fruit & Veg' }).click();
  await settle(page);
  await page.fill('#dlg-value', 'Produce');
  await clickDialog(page, 'Rename');

  await page.click('#btn-back');
  await settle(page);

  // A second store with a different route.
  await page.locator('#store-templates .chip', { hasText: 'Sobeys' }).click();
  await settle(page, 400);
  eq((await order()).slice(0, 3).join('>'), 'Bakery>Produce>Deli',
     'Sobeys has a different walking order from Superstore');
  await page.click('#btn-back');
  await settle(page);

  // ===========================================================================
  section('4. lists and items');
  // ===========================================================================
  await page.click('.nav-btn[data-tab="home"]');
  await settle(page);
  await page.fill('#new-list-name', 'Weekly Groceries');
  await page.click('#btn-create-list');
  await settle(page, 400);
  ok(await visible(page, '#view-list-detail'), 'creating a list opens it straight away');

  // Comma-separated multi-add, a feature worth keeping from the old build.
  await page.fill('#quick-add-input', 'Milk, Bananas, Sourdough, Chicken Thighs');
  await page.click('#btn-quick-add');
  await settle(page, 400);
  eq(await page.locator('#list-items-container .item-row').count(), 4,
     'one comma-separated entry adds four items');

  // Merge rather than duplicate.
  await page.fill('#quick-add-input', 'milk');
  await page.click('#btn-quick-add');
  await settle(page, 400);
  eq(await page.locator('#list-items-container .item-row').count(), 4,
     'adding "milk" again does not create a duplicate');
  ok((await page.textContent('#toast-host')).includes('already on the list'),
     'the user is told the item was merged rather than duplicated');

  // Edit: quantity, note and section.
  await page.locator('.item-content', { hasText: 'Milk' }).first().click();
  await settle(page);
  await page.fill('#dlg-quantity', '2 L');
  await page.fill('#dlg-note', 'the oat one');
  await clickDialog(page, 'Save');
  ok((await page.textContent('#list-items-container')).includes('2 L'),
     'a quantity can be added and is shown on the row');
  ok((await page.textContent('#list-items-container')).includes('the oat one'),
     'a note can be added and is shown on the row');

  // ===========================================================================
  section('5. store route drives the item order');
  // ===========================================================================
  await page.selectOption('#list-store-select', { label: 'Atlantic Superstore' });
  await settle(page, 400);
  ok(await visible(page, '#quick-add-section'), 'choosing a store reveals the section picker');

  const setSection = async (itemName, sectionName) => {
    await page.locator('.item-content', { hasText: itemName }).first().click();
    await settle(page);
    await page.selectOption('#dlg-store_section_id', { label: sectionName });
    await clickDialog(page, 'Save');
  };
  await setSection('Milk', 'Dairy');
  await setSection('Bananas', 'Produce');
  await setSection('Sourdough', 'Bakery');
  await setSection('Chicken Thighs', 'Meat');

  const itemOrder = () => page.locator('#list-items-container .item-text').allTextContents();
  eq((await itemOrder()).join(','), 'Bananas,Sourdough,Chicken Thighs,Milk',
     'items follow the Superstore route (Produce > Bakery > Meat > Dairy)');

  const headers = await page.locator('#list-items-container .section-header').allTextContents();
  eq(headers.join(','), 'Produce,Bakery,Meat,Dairy', 'each section gets a heading, in route order');

  // Reordering the store must reorder the list.
  await page.click('.nav-btn[data-tab="stores"]');
  await settle(page);
  await page.locator('#stores-container .list-card', { hasText: 'Atlantic Superstore' }).click();
  await settle(page, 300);
  // Move Dairy to the very top by repeatedly moving it earlier.
  for (let i = 0; i < 10; i += 1) {
    const button = page.locator('button[aria-label="Move Dairy earlier"]');
    if (await button.isDisabled()) break;
    await button.click();
    await settle(page, 150);
  }
  eq((await order())[0], 'Dairy', 'Dairy is now first on the Superstore route');

  await page.click('#btn-back');
  await settle(page);
  await page.click('.nav-btn[data-tab="home"]');
  await settle(page);
  await page.locator('#lists-container .list-card', { hasText: 'Weekly Groceries' }).click();
  await settle(page, 400);
  eq((await itemOrder()).join(','), 'Milk,Bananas,Sourdough,Chicken Thighs',
     'the shopping list re-sorts to match the changed store route');

  // ===========================================================================
  section('6. shopping mode: check, undo, search');
  // ===========================================================================
  await page.locator('.item-row', { hasText: 'Bananas' }).locator('.item-checkbox').check();
  await settle(page, 300);
  ok((await page.locator('#list-items-container .section-header').allTextContents())
       .some((h) => h.startsWith('Picked up')),
     'a ticked item moves to a "Picked up" group instead of vanishing');
  eq(await page.evaluate(() => window.__db.list_items.find((i) => i.name === 'Bananas').checked), true,
     'the tick is saved to the database');
  ok(await page.locator('.item-row.item-checked', { hasText: 'Bananas' }).isVisible(),
     'the ticked item is still on screen, just de-emphasised');

  await page.locator('.item-row', { hasText: 'Bananas' }).locator('.item-checkbox').uncheck();
  await settle(page, 300);
  eq(await page.evaluate(() => window.__db.list_items.find((i) => i.name === 'Bananas').checked), false,
     'unticking is one tap and saves immediately');

  // Delete + undo.
  await page.locator('.item-row', { hasText: 'Sourdough' }).locator('.item-delete').click();
  await settle(page, 300);
  eq(await page.locator('#list-items-container .item-row').count(), 3, 'an item can be removed');
  await page.locator('#toast-host .toast-action', { hasText: 'Undo' }).click();
  await settle(page, 400);
  eq(await page.locator('#list-items-container .item-row').count(), 4, 'and the removal can be undone');

  // Search.
  await page.fill('#item-search', 'chick');
  await settle(page, 250);
  eq(await page.locator('#list-items-container .item-row').count(), 1, 'search filters the list');
  await page.fill('#item-search', '');
  await settle(page, 250);
  eq(await page.locator('#list-items-container .item-row').count(), 4, 'clearing the search restores it');

  // ===========================================================================
  section('7. cross-site scripting');
  // ===========================================================================
  const PAYLOAD = '<img src=x onerror=window.__xss=1>';
  await page.fill('#quick-add-input', PAYLOAD);
  await page.click('#btn-quick-add');
  await settle(page, 400);

  eq(await page.evaluate(() => window.__xss), undefined,
     'an item named like an HTML tag does not execute');
  eq(await page.locator('#list-items-container img').count(), 0,
     'and does not become an element');
  ok((await page.locator('#list-items-container .item-text').allTextContents()).includes(PAYLOAD),
     'it is displayed as literal text, exactly as typed');

  // The same payload as a list name, a store name and a section name.
  await page.locator('.item-row', { hasText: PAYLOAD }).locator('.item-delete').click();
  await settle(page, 300);

  await page.click('#btn-back');
  await settle(page);
  await page.fill('#new-list-name', PAYLOAD);
  await page.click('#btn-create-list');
  await settle(page, 400);
  eq(await page.evaluate(() => window.__xss), undefined, 'a list named like a tag does not execute');
  eq(await page.locator('#header-title').textContent(), PAYLOAD,
     'the payload appears verbatim in the header');
  await page.click('#btn-back');
  await settle(page);

  await page.click('.nav-btn[data-tab="stores"]');
  await settle(page);
  await page.fill('#new-store-name', PAYLOAD);
  await page.click('#btn-create-store');
  await settle(page, 400);
  await page.fill('#new-section-input', PAYLOAD);
  await page.click('#btn-add-section');
  await settle(page, 400);
  eq(await page.evaluate(() => window.__xss), undefined,
     'a store and a section named like a tag do not execute');
  eq(await page.locator('#store-sections-container img').count(), 0,
     'the section name is text, not markup');

  // Clean up the hostile store so later assertions count real data.
  await page.click('#btn-menu');
  await settle(page);
  await clickDialog(page, 'Delete store');
  await clickDialog(page, 'Delete');
  await settle(page, 300);
  await page.click('.nav-btn[data-tab="home"]');
  await settle(page);
  await page.locator('#lists-container .list-card', { hasText: PAYLOAD })
    .locator('.list-actions-btn').click();
  await settle(page);
  await clickDialog(page, 'Delete');
  await clickDialog(page, 'Delete');
  await settle(page, 300);

  // ===========================================================================
  section('8. no browser prompt(), confirm() or alert()');
  // ===========================================================================
  let nativeDialogs = 0;
  page.on('dialog', async (dialog) => { nativeDialogs += 1; await dialog.dismiss(); });
  await page.evaluate(() => {
    window.__nativeCalls = 0;
    for (const name of ['prompt', 'confirm', 'alert']) {
      window[name] = () => { window.__nativeCalls += 1; return null; };
    }
  });

  await page.locator('#lists-container .list-card').first().locator('.list-actions-btn').click();
  await settle(page);
  ok(await page.locator('#app-dialog').isVisible(), 'list actions open an in-app sheet');
  await clickDialog(page, 'Rename');
  ok(await page.locator('#dlg-value').isVisible(), 'rename uses an in-app form field');
  await clickDialog(page, 'Cancel');

  eq(await page.evaluate(() => window.__nativeCalls), 0,
     'no native prompt/confirm/alert is used anywhere in those flows');
  eq(nativeDialogs, 0, 'and the browser never showed a native dialog');

  // ===========================================================================
  section('9. duplicate event listeners');
  // ===========================================================================
  // Re-render Settings many times, the way a burst of realtime events would,
  // then check one tap still does one thing. This is the shape of the bug in
  // the Firebase build: updateSettingsUI() called addEventListener each time.
  await page.click('.nav-btn[data-tab="settings"]');
  await settle(page);
  await page.evaluate(() => { for (let i = 0; i < 20; i += 1) window.__notify('household_members'); });
  await settle(page, 500);

  const beforeInvites = await page.evaluate(() => window.__db.household_invites.length);
  await page.click('#btn-create-invite');
  await settle(page, 400);
  eq(await page.evaluate((n) => window.__db.household_invites.length - n, beforeInvites), 1,
     'after 20 re-renders, one tap still creates exactly one invite');
  ok((await page.textContent('#invite-area')).includes('TESTCODE'),
     'the invite code is shown to the owner');

  // ===========================================================================
  section('10. realtime sync from the other phone');
  // ===========================================================================
  await page.click('.nav-btn[data-tab="home"]');
  await settle(page);
  await page.locator('#lists-container .list-card', { hasText: 'Weekly Groceries' }).click();
  await settle(page, 400);
  const beforeCount = await page.locator('#list-items-container .item-row').count();

  // Person B adds an item, then ticks one off.
  await page.evaluate(() => {
    const list = window.__db.shopping_lists.find((l) => l.name === 'Weekly Groceries');
    window.__db.list_items.push({
      id: 'item-from-b', list_id: list.id, household_id: list.household_id,
      name: 'Coffee', quantity: null, note: null, store_section_id: null,
      checked: false, checked_at: null, created_by: 'user-bob',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    window.__notify('list_items');
  });
  await settle(page, 500);
  eq(await page.locator('#list-items-container .item-row').count(), beforeCount + 1,
     'an item added on the other device appears without a refresh');
  ok((await page.textContent('#list-items-container')).includes('Coffee'),
     'and it is the right item');

  await page.evaluate(() => {
    window.__db.list_items.find((i) => i.id === 'item-from-b').checked = true;
    window.__notify('list_items');
  });
  await settle(page, 500);
  ok(await page.locator('.item-row.item-checked', { hasText: 'Coffee' }).isVisible(),
     'a tick on the other device shows up here too');

  await page.evaluate(() => {
    window.__db.list_items = window.__db.list_items.filter((i) => i.id !== 'item-from-b');
    window.__notify('list_items');
  });
  await settle(page, 500);
  ok(!(await page.textContent('#list-items-container')).includes('Coffee'),
     'a delete on the other device removes it here');

  // ===========================================================================
  section('11. channels do not accumulate');
  // ===========================================================================
  eq(await page.evaluate(() => window.__openChannels()), 1,
     'exactly one realtime channel is open for the household');
  await page.click('#btn-back');
  await settle(page);
  for (const tab of ['history', 'stores', 'settings', 'home']) {
    await page.click(`.nav-btn[data-tab="${tab}"]`);
    await settle(page, 120);
  }
  eq(await page.evaluate(() => window.__openChannels()), 1,
     'moving between tabs and lists does not open more channels');

  // ===========================================================================
  section('12. finishing a trip, history and add-again');
  // ===========================================================================
  await page.locator('#lists-container .list-card', { hasText: 'Weekly Groceries' }).click();
  await settle(page, 400);
  await page.locator('.item-row', { hasText: 'Milk' }).locator('.item-checkbox').check();
  await page.locator('.item-row', { hasText: 'Bananas' }).locator('.item-checkbox').check();
  await settle(page, 400);

  await page.click('#btn-menu');
  await settle(page);
  await clickDialog(page, 'Finish shopping trip');
  await clickDialog(page, 'Finish trip');
  await settle(page, 600);

  eq(await page.locator('#list-items-container .item-row').count(), 2,
     'unticked items stay on the list after the trip');
  ok(!(await page.textContent('#list-items-container')).includes('Milk'),
     'purchased items leave the active list');

  await page.click('#btn-back');
  await settle(page);
  await page.click('.nav-btn[data-tab="history"]');
  await settle(page, 300);
  eq(await page.locator('#history-container .history-item').count(), 1, 'the trip appears in History');

  await page.locator('#history-container .history-item').first().click();
  await settle(page, 400);
  ok(await visible(page, '#view-trip-detail'), 'a past trip can be opened');
  eq(await page.locator('#trip-items-container .item-row').count(), 2,
     'the items bought on that trip are listed');
  ok((await page.textContent('#trip-items-container')).includes('2 L'),
     'history kept the quantity that was bought');

  await page.locator('#trip-items-container .btn', { hasText: 'Add again' }).first().click();
  await settle(page, 500);
  eq(await page.evaluate(() =>
      window.__db.list_items.filter((i) => i.name === 'Milk').length), 1,
     '"Add again" puts the item back on the active list');
  ok((await page.textContent('#toast-host')).includes('added to'),
     'and says which list it went to');

  // Add again when it is already there must merge, not duplicate.
  await page.locator('#trip-items-container .btn', { hasText: 'Add again' }).first().click();
  await settle(page, 500);
  eq(await page.evaluate(() =>
      window.__db.list_items.filter((i) => i.name === 'Milk').length), 1,
     'adding it again does not create a second copy');
  ok((await page.textContent('#toast-host')).includes('already there'),
     'and the user is told why');

  // ===========================================================================
  section('13. remembered defaults and quick picks');
  // ===========================================================================
  eq(await page.evaluate(() => window.__db.household_items.length), 2,
     'completing a trip filled the household catalog');
  eq(await page.evaluate(() =>
      window.__db.list_items.find((i) => i.name === 'Milk').quantity), '2 L',
     'the remembered quantity is applied when the item is re-added');

  await page.click('#btn-back');
  await settle(page);
  await page.click('.nav-btn[data-tab="home"]');
  await settle(page);
  await page.locator('#lists-container .list-card', { hasText: 'Weekly Groceries' }).click();
  await settle(page, 400);
  ok(await visible(page, '#quick-picks'),
     'previously bought items are offered as one-tap quick picks');
  const suggestions = await page.locator('#catalog-suggestions option').count();
  ok(suggestions >= 2, 'the type-ahead datalist is populated from the catalog');

  // ===========================================================================
  section('14. archive, restore and delete');
  // ===========================================================================
  await page.click('#btn-menu');
  await settle(page);
  await clickDialog(page, 'Archive list');
  await settle(page, 500);
  eq(await page.locator('#lists-container .list-card').count(), 0, 'archiving removes it from Lists');

  await page.click('.nav-btn[data-tab="history"]');
  await settle(page, 300);
  eq(await page.locator('#archived-lists-container .list-card').count(), 1,
     'the archived list is under History');
  await page.locator('#archived-lists-container .btn', { hasText: 'Restore' }).click();
  await settle(page, 500);
  await page.click('.nav-btn[data-tab="home"]');
  await settle(page, 300);
  eq(await page.locator('#lists-container .list-card').count(), 1, 'and it can be restored');

  // Deleting a list must take its items with it — the Firebase bug.
  const listId = await page.evaluate(() => window.__db.shopping_lists[0].id);
  await page.locator('#lists-container .list-card').first().locator('.list-actions-btn').click();
  await settle(page);
  await clickDialog(page, 'Delete');
  await clickDialog(page, 'Delete');
  await settle(page, 500);
  eq(await page.evaluate((id) => window.__db.list_items.filter((i) => i.list_id === id).length, listId), 0,
     'deleting a list deletes its items, leaving no orphans');
  eq(await page.evaluate(() => window.__db.shopping_trips.length), 1,
     'the shopping trip survives the list being deleted');

  // ===========================================================================
  section('15. mobile layout and accessibility');
  // ===========================================================================
  const viewportMeta = await page.getAttribute('meta[name="viewport"]', 'content');
  ok(!/user-scalable\s*=\s*no/.test(viewportMeta) && !/maximum-scale/.test(viewportMeta),
     'pinch zoom is not disabled');
  ok(viewportMeta.includes('viewport-fit=cover'), 'safe-area insets are enabled');

  const horizontalOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok(!horizontalOverflow, 'nothing overflows horizontally at 390px wide');

  const smallTargets = await page.evaluate(() => {
    const tooSmall = [];
    for (const node of document.querySelectorAll('button:not(.hidden), .nav-btn, input[type=checkbox]')) {
      if (!node.offsetParent) continue;
      const rect = node.getBoundingClientRect();
      const label = node.getAttribute('aria-label') || node.textContent.trim().slice(0, 24);
      // The checkbox itself is small on purpose; its 56px-wide label is the
      // real target, so measure that instead.
      const box = node.type === 'checkbox' ? node.closest('label').getBoundingClientRect() : rect;
      if (box.height < 40 || box.width < 36) tooSmall.push(`${label} ${Math.round(box.width)}x${Math.round(box.height)}`);
    }
    return tooSmall;
  });
  ok(smallTargets.length === 0, `every visible control is at least 36x40 (offenders: ${smallTargets.join(', ') || 'none'})`);

  const inputFontSizes = await page.evaluate(() =>
    [...document.querySelectorAll('input, select, textarea')]
      .filter((n) => n.offsetParent)
      .map((n) => parseFloat(getComputedStyle(n).fontSize)));
  ok(inputFontSizes.every((size) => size >= 16),
     'inputs are >= 16px so iOS does not zoom the page on focus');

  // ===========================================================================
  section('16. sign out');
  // ===========================================================================
  await page.click('.nav-btn[data-tab="settings"]');
  await settle(page);
  await page.click('#btn-logout');
  await settle(page);
  await clickDialog(page, 'Sign out');
  await settle(page, 400);
  ok(await visible(page, '#view-auth'), 'signing out returns to the sign-in screen');
  eq(await page.evaluate(() => window.__openChannels()), 0,
     'signing out closes the realtime channel');

  ok(consoleErrors.length === 0,
     `no uncaught page errors during the run (${consoleErrors.slice(0, 2).join(' | ') || 'none'})`);

  await browser.close();
  server.close();

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exit(1);
  }
  console.log('ALL BROWSER TESTS PASSED');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
