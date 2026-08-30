# Deployment

The app is a directory of static files. Any host that can serve HTML over HTTPS
will run it, and moving between hosts needs no code changes.

**Serve `young-lists/` as the site root.** That is the only requirement. The app
uses relative paths throughout, so it also works from a subdirectory
(`https://user.github.io/grocery-list/`).

Before deploying anywhere, fill in `young-lists/config.js` — see
[`SUPABASE_SETUP.md`](SUPABASE_SETUP.md).

---

## GitHub Pages (already set up)

`.github/workflows/deploy.yml` publishes `young-lists/` on every push to `main`.

One-time setup, in the repository on GitHub:

1. **Settings → Pages → Build and deployment → Source**: *GitHub Actions*.
2. Push to `main`. The workflow runs and prints the URL.

Deploying is deliberately independent of the test workflow
(`.github/workflows/tests.yml`), so a broken test run can never leave you
unable to ship a fix to a list you are standing in a shop holding.

## Netlify

No configuration file is needed.

* **Base directory:** leave empty
* **Build command:** leave empty
* **Publish directory:** `young-lists`

Or from the CLI:

```sh
netlify deploy --dir young-lists --prod
```

## Vercel

* **Framework preset:** *Other*
* **Root directory:** `young-lists`
* **Build command:** leave empty
* **Output directory:** leave empty

Or:

```sh
vercel deploy young-lists --prod
```

## Cloudflare Pages, Surge, S3, a Raspberry Pi…

Upload the contents of `young-lists/`. Nothing else is required.

## Running it locally

```sh
cd young-lists
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works. Do **not** open `index.html` with `file://` — ES
modules and service workers both need a real origin.

Service workers require a secure context. `https://` and `http://localhost`
both qualify; `http://` on a LAN address does not, so the PWA parts will not
register when testing from another device over plain HTTP.

---

## After a deploy

The service worker is network-first, so a returning user gets the new version
on their next load without clearing anything. If they have the app open at the
time, a "A new version is ready" prompt appears and reloads on tap.

When you change files under `young-lists/`, bump `CACHE_VERSION` in
`young-lists/sw.js`. Correctness does not depend on it — that was the point of
moving off cache-first — but it drops the previous cache instead of leaving
stale entries behind.

## What is safe to commit

`young-lists/config.js` holds the Supabase project URL and the **publishable**
key. Both are meant to be visible in the browser, so both belong in the
repository. That is what makes this deployable to any host with no environment
variables and no build step.

Never commit, and never put in `young-lists/` at all:

* the Supabase **secret** key or the legacy `service_role` key
* the database password
* any JWT signing secret or server credential

Everything under `young-lists/` is published verbatim to the public web. If one
of those ever lands there, rotate it in the Supabase dashboard immediately —
removing the commit is not enough.

## Custom domain

Nothing in the app depends on the hostname. After pointing a domain at your
host, update **Site URL** in the Supabase dashboard
(**Authentication → URL Configuration**) so confirmation and password-reset
links point at the right place.
