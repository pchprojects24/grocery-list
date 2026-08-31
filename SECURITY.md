# Security

## The model in one sentence

A row is visible and writable only to users who have a row in
`household_members` for that row's `household_id` — and that is enforced by
PostgreSQL, not by the browser.

Everything else here is detail.

## What protects the data

**Authentication.** Supabase Auth, email and password, one account per person.
No shared logins. Passwords are hashed by Supabase; this app never sees, stores
or logs one.

**Authorisation.** Row Level Security on every table in `public`, defined in
[`supabase/migrations/0005_rls.sql`](supabase/migrations/0005_rls.sql). Every
policy asks one question, through one of two helper functions: *is the caller a
member of this household?* and, for managing people, *is the caller an owner?*

**Least privilege.** The `anon` role — which is what an unauthenticated visitor
is — has been revoked from every table and every function. Signed out, the API
returns nothing, not even an empty list. `authenticated` has table privileges,
but RLS then filters every row.

## The specific attacks this is built against

| Attack | What stops it |
| --- | --- |
| Reading someone else's lists by guessing a UUID | The `SELECT` policy filters on household membership, so the row simply is not there |
| Creating a row in someone else's household by editing `household_id` in devtools | `INSERT` policies use `WITH CHECK`, so the insert is rejected |
| Moving a row you *can* see into another household | `UPDATE` policies check both `USING` and `WITH CHECK`, and a trigger makes `household_id` immutable outright |
| Adding yourself to a household | `household_members` has no `INSERT` policy at all. The only way in is `redeem_household_invite()`, which validates a code |
| Enumerating invite codes | Only owners can `SELECT` `household_invites`. The person redeeming a code never reads the table — the function does the lookup for them |
| Calling an RPC to get around a policy | The four data RPCs are `SECURITY INVOKER`, so RLS applies to them exactly as it does to a direct query. The three that are `SECURITY DEFINER` re-check the caller on their first lines |
| Locking a household out by removing its last owner | A trigger refuses the delete or the demotion |
| A grocery item named `<img src=x onerror=…>` | Every user-supplied value renders through `textContent`. Nothing in the app puts user data into `innerHTML` |
| A stale, vulnerable client staying installed | The service worker is network-first, so a fix reaches a phone on its next load |

All of these are asserted in
[`supabase/tests/rls_tests.sql`](supabase/tests/rls_tests.sql) and
[`tests/browser/run.mjs`](tests/browser/run.mjs), run by `tests/run_all.sh`.
The SQL suite runs each check as four different actors: the owner, a second
member, an authenticated user in no household, and a signed-out client.

## Keys

`young-lists/config.js` contains two values, both of which belong in the
browser and therefore in the repository:

* the **project URL**
* the **publishable key** (older projects: the **anon public** key)

The publishable key identifies the project. It grants nothing on its own — with
it and no session you can read nothing, because `anon` holds no privileges.
Treating it as a password would be a mistake in the other direction: it is
visible to anyone who opens devtools, by design, and the security does not
depend on it being secret.

**Never place any of these in `young-lists/`, or anywhere else in this
repository:**

* the Supabase **secret** key, or the legacy `service_role` key — these bypass
  every RLS policy
* the database password
* a JWT signing secret or any other server credential

Everything under `young-lists/` is served verbatim to the public web. If a
privileged key is ever committed, rotate it in the Supabase dashboard
immediately; deleting the commit is not sufficient, because the value may
already have been fetched.

This application never uses the service-role key. There is no server-side
component that could.

## Logging

Errors are logged to the browser console with their code and message so a
problem can be diagnosed. Passwords, tokens, session JWTs and keys are never
logged. A console log from this app is safe to paste into a bug report.

Users see a plain sentence — "That email and password do not match an account."
— rather than a raw API error. Database codes and constraint names stay out of
the interface.

## What is *not* protected

Being explicit, so nobody relies on something that is not there:

* **Other members are trusted.** Anyone in your household can edit or delete
  anything in it. There is no per-item ownership and no audit trail beyond
  `created_by`.
* **No two-factor authentication.** Supabase supports it; this app does not set
  it up.
* **No rate limiting of our own.** Supabase applies its own limits to auth
  endpoints.
* **Member email addresses are not shown.** Supabase does not expose other
  users' addresses to the client, so Settings lists co-members by role and join
  date rather than by address. This is a privacy default, not an omission.
* **Invite codes are eight characters** from a 32-character alphabet, single-use
  by default, and expire in seven days. Generated from
  `gen_random_uuid()` (the platform CSPRNG), not `random()`. Treat one like a
  temporary password: say it out loud, do not post it publicly.
* **Nothing is encrypted beyond transport and Supabase's storage encryption.**
  Grocery lists did not seem to warrant more.

## The SECURITY DEFINER functions

Five functions run with elevated rights — the three RPCs that bootstrap a
household, plus the two authorization helpers — and Supabase's security advisor
reports each of them. That is expected. Here is why each one has to be elevated,
and what stops it being a hole:

| Function | Why it is elevated | What checks the caller |
| --- | --- | --- |
| `create_household` | RLS has no INSERT policy on `households` or `household_members`, because a brand-new user cannot yet be a member of the household they are about to create | Refuses when `auth.uid()` is null; makes the caller, and only the caller, the owner |
| `create_household_invite` | Writes a row the caller has no INSERT policy for | Returns `42501` unless `is_household_owner()` is true |
| `redeem_household_invite` | Must read `household_invites`, which RLS restricts to owners — the person redeeming a code is by definition not one yet | Validates the code, its expiry, its use count; adds only `auth.uid()`, as a `member` |
| `is_household_member` | Must not be re-filtered by the policy that called it, or policy evaluation recurses | Takes no user parameter; only ever answers about `auth.uid()` |
| `is_household_owner` | Same | Same |

All five set `search_path = ''` and schema-qualify every identifier, so none can
be hijacked by an object planted on the caller's search path. None of them is
callable by `anon`.

The trigger functions are a different matter, and were a real bug: PostgreSQL
grants EXECUTE to PUBLIC by default and PostgREST exposes every function in
`public` as a REST endpoint, so `touch_parent_list` was briefly reachable at
`/rest/v1/rpc/touch_parent_list` by a signed-out caller. PostgreSQL refuses to
run a `trigger`-returning function outside a trigger, so there was no exploit,
but the grant was wrong. `0008_trigger_function_grants.sql` revokes it, and the
suite now asserts that no function in `public` is executable by `anon` and no
trigger function is executable at all.

## Verifying it yourself

```sh
tests/run_db_tests.sh
```

Prints every check it makes. It will stop at the first failure.

To convince yourself by hand, sign in as a third account that belongs to no
household and try to read anything in the browser console:

```js
const { data, error } = await supabase.from('list_items').select('*');
// data: []   — not an error, simply nothing, because the rows are filtered away
```

## Reporting a problem

This is a private household app maintained by its owners. If you have found
something, open an issue on the repository. If it looks exploitable, describe it
privately to the repository owner first rather than in a public issue.
