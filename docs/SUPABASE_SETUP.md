# Supabase setup

**This file is the single source of truth for the backend.** If any other
document disagrees with it, this one is right and the other one is stale.

> **Already done for the `young-lists` project.** A Supabase project called
> `young-lists` (`qxxhzvbwkcxhmlzwriuq`, ca-central-1, free tier) exists with
> every migration applied, and `young-lists/config.js` already points at it.
> Steps 1-4, 6, 7 and 8 are complete; pick up at **step 5** to check the auth
> settings, then **step 9** to make your household.
>
> Follow the whole thing from the top only if you are setting up a *different*
> project — a second one for development, say, or because you would rather own
> the project yourself.

You do this once. It takes about fifteen minutes and costs nothing — a
two-person grocery list sits comfortably inside Supabase's free tier.

> **The one rule that matters:** the *publishable* key belongs in the browser.
> The *secret* / `service_role` key, the database password, and anything else
> privileged must never appear in `young-lists/`, because every file in that
> directory is served to the public web exactly as written.

---

## 1. Create the project

1. Sign in at <https://supabase.com> and create a new project.
2. Pick a region near you (`ca-central-1` for Atlantic Canada).
3. Choose a strong database password and store it in your password manager.
   **You will not need it for this app** — nothing in the browser uses it.

Wait for the project to finish provisioning before continuing.

## 2. Project URL

Dashboard → **Project Settings → API** → **Project URL**.

It looks like `https://abcdefghijklmnop.supabase.co`. Copy it.

## 3. Publishable key

Same page. Copy the key labelled **Publishable key** (older projects call it
the **anon public** key — either works).

It is safe in the browser: it identifies the project and grants nothing on its
own. Every row this app can read or write is decided by Supabase Auth plus the
Row Level Security policies you install in the next step.

Do **not** copy the *secret* key or the `service_role` key. They bypass RLS
entirely. If one of them ever ends up in the browser, rotate it immediately
from this same page.

## 4. Run the database migrations

Dashboard → **SQL Editor** → **New query**.

Open [`supabase/schema.sql`](../supabase/schema.sql), paste the whole file, and
run it. That single file is generated from the numbered migrations and is safe
to re-run.

If you would rather apply them one at a time — which makes any error easier to
place — run the files in [`supabase/migrations/`](../supabase/migrations/) in
filename order:

| File | What it does |
| --- | --- |
| `0001_helpers.sql` | small utility functions the tables depend on |
| `0002_tables.sql` | tables, foreign keys, cascade rules, indexes |
| `0003_authorization.sql` | the two household-membership checks every policy uses |
| `0004_triggers.sql` | `updated_at`, `checked_at`, immutable `household_id`, last-owner guard |
| `0005_rls.sql` | grants and every Row Level Security policy |
| `0006_functions.sql` | the RPCs the app calls |
| `0007_realtime.sql` | publishes the tables that need live sync |
| `0008_trigger_function_grants.sql` | stops the trigger functions being reachable as REST endpoints |

Each one prints `Success. No rows returned`.

After changing anything under `supabase/migrations/`, regenerate the combined
file with `supabase/build_schema.sh`.

## 5. Configure Auth

Dashboard → **Authentication → Providers**.

* **Email** — enabled. This is the only provider the app uses.
* **Confirm email** — your call:
  * **Off** is simpler for two people who are standing next to each other. An
    account works the moment it is created.
  * **On** is stricter and means each person must click a link in their inbox
    before signing in. The app handles this and says so on screen.
* Turn off any provider you are not using.

Dashboard → **Authentication → URL Configuration**: set **Site URL** to
wherever you deploy (for example `https://<your-github-user>.github.io`). This
only matters for confirmation and password-reset links.

Optionally, under **Authentication → Sign In / Providers**, disable **Allow new
users to sign up** *after* both of you have accounts. Nobody else can see your
lists either way — RLS makes a stranger's account useless — but it keeps the
user list tidy.

## 6. Row Level Security

Nothing to do: step 4 enabled RLS on every table and installed the policies.

To confirm, go to **Database → Tables**. Every table in `public` should show
**RLS enabled**. If any table does not, re-run `0005_rls.sql`.

What the policies actually enforce is described in
[`../SECURITY.md`](../SECURITY.md).

## 7. Realtime

Step 4 also did this — `0007_realtime.sql` adds the tables to the
`supabase_realtime` publication and sets `REPLICA IDENTITY FULL` so that
deletes carry enough information to be filtered and authorised.

To confirm: **Database → Publications → `supabase_realtime`** should list
`shopping_lists`, `list_items`, `stores`, `store_sections`, `shopping_trips`,
`household_items` and `household_members`.

## 8. Point the app at your project

Edit [`young-lists/config.js`](../young-lists/config.js):

```js
export const SUPABASE_URL = "https://abcdefghijklmnop.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_...";
```

Commit it. The publishable key is designed to be public, so putting it in the
repository is normal and is what makes the app deployable to any static host
without a build step or environment variables.

## 9. Create the first household

Open the app, choose **Create account**, and sign up with your own email and
password. You will land on a screen asking you to start a household — give it a
name (for example *The Youngs*). You become its **owner**.

## 10. Add the second person

1. The second person opens the app **on their own phone** and chooses
   **Create account** with *their own* email and password. Do not share one
   login: each person having their own account is what makes "who added this?"
   answerable and what lets either of you be removed later.
2. They will land on the same onboarding screen. They should leave the
   *Start a household* box alone.
3. On the owner's phone: **Settings → Household → Create an invite code**.
4. Read the eight-character code out, or copy and send it.
5. The second person types it into **Join with a code** and taps **Join**.

The code is single-use and expires after seven days. If it is spent or stale,
the owner makes another.

If you would rather not use codes at all, membership is just a row: in the
dashboard, **Table Editor → household_members → Insert row** with the
`household_id` and the other person's `user_id` (from
**Authentication → Users**) and `role` = `member`.

## 11. Deploy

See [`DEPLOYMENT.md`](DEPLOYMENT.md). The short version: push to `main` and the
included GitHub Actions workflow publishes `young-lists/` to GitHub Pages.

## 12. Test on both phones

Worth five minutes before you rely on it:

1. Both people sign in, on their own phones.
2. One creates a list. It appears on the other phone within a second or two.
3. One adds *Milk*. It appears on the other phone.
4. The other ticks *Milk* off. The first phone shows it ticked.
5. Untick it. The first phone updates again.
6. Add a store under **Stores**, put its departments in walking order, and
   assign the list to it. Both phones show the items in that order.
7. Add the app to the home screen on both phones (Safari → Share → *Add to
   Home Screen*) and repeat steps 3 and 4 from there.

---

## Keeping it free

* Supabase pauses a free project after a week with no activity. Opening the app
  is enough to keep it awake; if it ever does pause, un-pause it from the
  dashboard and nothing is lost.
* Nothing in this app polls. It holds one realtime subscription while open and
  makes a handful of small queries per session.

## If something is not working

| Symptom | Likely cause |
| --- | --- |
| "Setup needed" screen | `config.js` is still empty, or the URL does not start with `https://` |
| Sign-in says the address is not confirmed | *Confirm email* is on; check the inbox |
| Signed in but stuck on onboarding | You have an account but no household. Create one, or redeem an invite |
| "You do not have permission to do that" | Your user is not in the household that owns the row. Check `household_members` |
| Changes do not appear on the other phone | Check **Database → Publications**; re-run `0007_realtime.sql` |
| Everything 401s after a while | The session expired. Sign out and back in |
| An action fails with "Could not find the function" | PostgREST has a stale schema cache. Run `NOTIFY pgrst, 'reload schema';` in the SQL editor |

## Checking it over yourself

Supabase has a built-in linter: **Advisors → Security Advisor** in the
dashboard. On a correctly migrated project it reports five warnings, all of the
same kind — "Signed-In Users Can Execute SECURITY DEFINER Function", for
`create_household`, `create_household_invite`, `redeem_household_invite`,
`is_household_member` and `is_household_owner`.

**Those five are intentional and must not be "fixed".** They are the functions
that deliberately run with elevated rights, and each one re-checks the caller on
its first lines — see [`../SECURITY.md`](../SECURITY.md). Switching them to
`SECURITY INVOKER` would break household creation and joining outright.

Anything *else* the advisor reports is worth looking at.

Console logs are safe to share when asking for help: the app deliberately never
logs passwords, tokens or keys.
