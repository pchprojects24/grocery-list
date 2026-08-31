# Changelog

Notable changes to Young Lists.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/); the
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] — 2026-08-30

Migrated from Firebase to Supabase and fixed the defects found while auditing
the Firebase build. The Firebase implementation had never been configured — the
checked-in `firebaseConfig` was an empty object — so there was no production
data to migrate.

### Backend

- **Replaced Firebase with Supabase**: Auth for sign-in, PostgreSQL for data,
  Row Level Security for authorisation, Realtime for live sync.
- **A real relational schema**, in `supabase/migrations/`, with foreign keys,
  cascade rules and indexes. `supabase/schema.sql` is a generated concatenation
  for pasting into the SQL editor in one go.
- **Row Level Security on every table**, keyed to household membership through
  two `SECURITY DEFINER` helpers that avoid recursive policy evaluation. `anon`
  holds no privileges anywhere.
- **Households replace the manual UID whitelist.** The first account creates a
  household and becomes its owner; the second joins with a single-use invite
  code that expires in seven days. No privileged key is involved.
- **Store sections are rows with stable ids** and a numeric `sort_order`,
  rather than strings inside an array on the store record.
- **Shopping history keeps text snapshots** of the list, store and section, so
  a past trip stays readable after any of them is renamed or deleted.
- **A household product catalog** (`household_items`), maintained automatically
  when a trip is completed, recording what you buy, how often and when.

### Fixed

- **Deleting a list left its items behind.** The Firebase version deleted the
  list document but not its `items` subcollection. `list_items` now cascades
  from `shopping_lists` in the same transaction.
- **Cross-site scripting.** Item, list, store and section names were
  interpolated into template literals passed to `innerHTML`. Every
  user-supplied value now renders through `textContent`, so an item named
  `<img src=x onerror=alert(1)>` displays as those characters.
- **Sign In fired twice.** The button was the form's submit button *and* had a
  click handler that called `login()`, so one tap sent two authentication
  requests. Only the submit handler acts now.
- **Duplicate event listeners.** `updateSettingsUI()` called
  `addEventListener` and was re-run on every database update, so after a few
  syncs one tap fired the same handler several times. All wiring now happens
  once, at start-up.
- **The household access control could not work as documented.** The published
  Firestore rules said `allow write: if false` for `meta/allowedUsers`, while
  the Settings UI wrote to that document. The whole mechanism is gone.
- **Undocumented `stores` rules.** The rules in README.md and
  DEPLOYMENT_GUIDE.md omitted the `stores` collection that the rules embedded
  in `index.html` included, so following the docs broke the store feature.
- **Stale deployments.** The service worker was cache-first for every
  same-origin request, so a deploy did not reach a phone until its browser
  storage was cleared. It is now network-first with a cache fallback: new code
  arrives on the next load, and the app still opens with no connection.
- **Pinch zoom was disabled** (`maximum-scale=1, user-scalable=no`). Removed.
- **PWA icons were inline SVG data URIs**, which iOS does not use for Add to
  Home Screen. Replaced with real PNGs plus an `apple-touch-icon`.
- **The Templates screen was unreachable** — it existed in the markup and in
  the code but had no button in the navigation bar. Replaced (see below).
- **Overstated offline support.** The docs claimed the app worked offline and
  synced later. Firestore persistence was never enabled and no write queue
  existed. The behaviour is now described accurately and shown in a banner.

### Added

- **Shopping mode.** Items grouped under section headings in the store's
  walking order; ticked items demoted to a *Picked up* group instead of being
  deleted; undo on removal; search; a persistent quick-add bar.
- **Quantity, note and section per item**, edited by tapping the row.
- **Quick picks and type-ahead** from the household catalog, replacing the
  unreachable hard-coded Templates tab. Remembered quantities are applied when
  an item is re-added.
- **Browsable history.** Open a past trip, see what was bought, and use
  *Add again* on a line or *Add everything again* for the trip. Adding
  something already on the list merges instead of duplicating, and says so.
- **In-app dialogs and a bottom action sheet** replacing every `prompt()`,
  `confirm()` and `alert()`.
- **Plain-English error messages** for sign-in failure, permission denial,
  expired sessions and lost connectivity.
- **Starter store layouts** for Atlantic Superstore, Sobeys, Costco and a
  pharmacy — offered as editable starting points, not as the only options.
- **Three test suites** (`tests/run_all.sh`): the schema and RLS against a real
  PostgreSQL server, the application in headless Chromium at an iPhone
  viewport, and the service worker's update and offline behaviour.
- **`tools/make_icons.py`** to regenerate the PWA icons from the standard
  library alone.

### Changed

- `app.js` split into focused modules under `young-lists/js/`.
- `supabase-js` is vendored in `young-lists/vendor/` rather than loaded from a
  CDN, so the app shell works offline and no third party is in the critical
  path.
- Documentation consolidated. `docs/SUPABASE_SETUP.md` is now the single source
  of truth for the backend; `QUICKSTART.md`, `DEPLOYMENT_GUIDE.md`,
  `PROJECT_SUMMARY.md`, `DOCS_INDEX.md`, `EXAMPLES.md` and
  `LAUNCH_CHECKLIST.md` were removed rather than left contradicting each other
  about a backend that no longer exists.
- Tests run in their own GitHub Actions workflow, deliberately separate from
  the deploy workflow so a red run never blocks shipping a fix.

### Removed

- Firebase: the SDK, `firebaseConfig`, the Firestore security rules, the
  `meta/allowedUsers` whitelist, `firebase.config.template.json` and the old
  single-file `young-lists/app.js`.
- `icon-generator.html`, superseded by `tools/make_icons.py`.

## [0.1.0]

Initial Firebase implementation: email/password sign-in, a UID whitelist,
multiple lists, items, completing a trip, history, archived lists, store
profiles with walking order, search, PWA install and a GitHub Pages workflow.
