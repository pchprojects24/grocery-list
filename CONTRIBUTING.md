# Contributing

This is a small private household app. It is kept deliberately simple so that
one person — or a coding agent — can pick it up months later and change it
without ceremony.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first. It is short and it
explains where everything lives.

## Setting up

There is nothing to install for the app itself.

```sh
git clone https://github.com/pchprojects24/grocery-list.git
cd grocery-list/young-lists
python3 -m http.server 8000     # http://localhost:8000
```

You will need your own Supabase project to run it against — see
[`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md). Do not develop against the
household's live project; make a second free one.

To run the tests you need:

* a local PostgreSQL installation (`initdb`, `pg_ctl`, `psql`) for the database
  suite — no server needs to be running, the suite starts its own
* Node 22 and Playwright's Chromium for the browser suites

```sh
tests/run_all.sh
```

## Rules that are not negotiable

These exist because each one was a real bug in the previous version.

1. **Never put user-supplied text into `innerHTML`.** Use `el()` and `render()`
   from `js/ui.js`. `el('span', { text: item.name })` sets `textContent`.
2. **Never use `prompt()`, `confirm()` or `alert()`.** `js/ui.js` has
   `promptDialog`, `confirmDialog`, `formDialog` and `actionSheet`.
3. **Register event listeners once**, in a module's `init*()` function called
   from `app.js`. A render function must not `addEventListener` on an element
   it did not just create — that is how one tap ends up doing five things. For
   a shared element, assign `.onclick`.
4. **Security is a database policy.** Hiding a button is a convenience. If a
   user must not be able to do something, it needs a policy in
   `supabase/migrations/0005_rls.sql` and a test in
   `supabase/tests/rls_tests.sql`.
5. **Do not add a framework or a build step** without a concrete reason written
   down. Portability between hosts and being editable without a toolchain are
   features here, not accidents.
6. **Do not claim offline support** the app does not have. See the offline
   section of the README.

## Making a change

* Keep tap targets at 44px and inputs at 16px — the app is used one-handed in a
  shop, on an iPhone.
* Comment the non-obvious, especially anything touching security or the
  database. Skip comments that restate the code.
* Match the surrounding style: two-space indent in JS, lower-case SQL keywords,
  `snake_case` in the database and `camelCase` in JavaScript.
* Add a test. The three suites cover database behaviour, the interface, and the
  service worker; put a check in whichever fits.
* Run `tests/run_all.sh` before pushing.

## Changing the database

1. Add a new numbered file in `supabase/migrations/`. Do not edit an existing
   one that has already been applied to a live project.
2. Add assertions to `supabase/tests/rls_tests.sql`, including at least one as
   the unrelated `mallory` account.
3. Run `supabase/build_schema.sh` to regenerate `supabase/schema.sql`.
4. Run `tests/run_db_tests.sh`.
5. Note in the pull request what has to be run against the live project.

## Changing the icons

```sh
python3 tools/make_icons.py
```

Standard library only; no dependencies.

## After changing anything in `young-lists/`

Bump `CACHE_VERSION` in `young-lists/sw.js`. Correctness does not depend on it
— the worker is network-first — but it drops the old cache instead of leaving
stale entries around.

## Commits and pull requests

Write commit messages that say what changed and why, in prose. Describe user
impact rather than the diff. Say plainly what you tested and what you did not.
