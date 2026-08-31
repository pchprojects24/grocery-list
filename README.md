# Young Lists

A shared household grocery list for two phones.

Add *milk* on one phone; it is on the other phone a second later. Tell the app
the order you walk through Atlantic Superstore and it sorts your list to match
that route — and sorts it differently for Sobeys.

It is a Progressive Web App: a folder of static files on a free host, talking
to a free Supabase project. No server of ours, no framework, no build step, no
subscription.

---

## What it does

**Lists**
- as many lists as you like — groceries, hardware store, pharmacy
- add several things at once: `milk, eggs, bread`
- quantity and a note per item (*2 L*, *the oat one, not the almond*)
- search within a list
- rename, archive, restore, delete

**Store routes** — the reason this exists
- define a store's departments in the order you actually walk them
- assign a list to a store and the items group and sort to match
- reorder a department and every list using that store re-sorts
- rename a department without losing what was in it
- Atlantic Superstore, Sobeys, Costco and a pharmacy are offered as starting
  points; add any store you like and edit any of them

**Shopping mode**
- big tap targets, one-handed, portrait
- ticked items drop to a *Picked up* group instead of vanishing — a mis-tap is
  one tap to undo
- removing an item offers Undo
- finish the trip and the ticked items move into History

**History and repeat shopping**
- open a past trip and see exactly what was bought
- **Add again** on any line, or **Add everything again** for the whole trip
- the app remembers what your household buys: things you buy often appear as
  one-tap chips, typing suggests from what you have bought before, and it
  remembers the quantity you usually get

**Two people, properly**
- each person has their own account — no shared password
- the first account creates the household; the second joins with an
  eight-character invite code
- everything syncs live between the phones
- a stranger with an account of their own can see nothing at all, because the
  database refuses them, not because a button is hidden

## Getting started

1. **[`docs/SUPABASE_SETUP.md`](docs/SUPABASE_SETUP.md)** — create the free
   project, run the SQL, fill in `young-lists/config.js`, add the second
   person. This is the only setup document; if anything else disagrees with it,
   it is stale.
2. **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** — GitHub Pages, Netlify,
   Vercel, or a folder on any web server.

To try it locally first:

```sh
cd young-lists
python3 -m http.server 8000     # then open http://localhost:8000
```

## Install it on a phone

**iPhone** — open the site in Safari, tap Share, then *Add to Home Screen*. It
then runs full-screen with its own icon.

**Android** — Chrome offers *Install app* from the menu.

## How it is built

```
GitHub  →  static host (GitHub Pages / Netlify / Vercel)  →  Supabase
             young-lists/ served verbatim                     Auth
             vanilla HTML, CSS, ES modules                    PostgreSQL + RLS
             no build step                                    Realtime
```

* **Frontend** — plain HTML, CSS and ES modules. No React, no bundler, no npm
  install. The files in `young-lists/` are exactly what the browser runs.
* **Backend** — one Supabase project. Auth for sign-in, PostgreSQL for the
  data, Row Level Security for who may see what, Realtime for live sync.
* **Cost** — nothing. Two people generate a tiny fraction of the free tier.

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the map: what each file does,
the data model, and the rules to follow when changing it.
[`SECURITY.md`](SECURITY.md) explains what actually protects the data.

### About offline

Being straight about this, because the previous version of this README was not:

**The app opens offline. It does not work offline.** Tapping the home-screen
icon with no signal gives you the interface rather than a browser error,
because the service worker caches the app itself. Your lists are not cached and
there is no queue of pending changes — reading and writing both need
connectivity. When you are offline the app says so in a banner and failed saves
tell you why.

## Repository layout

| Path | What it is |
| --- | --- |
| `young-lists/` | the app — this directory is what gets deployed |
| `supabase/migrations/` | the database: tables, RLS policies, functions, realtime |
| `supabase/schema.sql` | all of the above concatenated, for pasting in one go |
| `tests/` | database, browser and service-worker test suites |
| `tools/make_icons.py` | regenerates the PWA icons |
| `docs/` | setup, deployment, architecture |

## Tests

```sh
tests/run_all.sh          # everything
tests/run_db_tests.sh     # PostgreSQL: schema, RLS, cascades, RPCs
node tests/browser/run.mjs   # the real app in headless Chromium
node tests/sw/run.mjs        # service worker: deploys land, offline shell opens
```

The database suite starts a throwaway PostgreSQL cluster and applies the real
migrations, then checks permissions as an owner, a second member, an unrelated
signed-in user and a signed-out one. Requires a local PostgreSQL installation
(`initdb`, `pg_ctl`, `psql`). The browser suites need Node 22 and Playwright's
Chromium.

## Changing it

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first — it is short, and it
lists the handful of rules that keep this app safe and predictable. The two
that catch people out:

* never put user-supplied text into `innerHTML`; use the helpers in `js/ui.js`
* never rely on a hidden button for security; add an RLS policy and a test

## History

This app previously ran on Firebase. Version 2.0.0 migrated it to Supabase and
fixed a set of defects found in an audit of the Firebase build — see
[`CHANGELOG.md`](CHANGELOG.md).
