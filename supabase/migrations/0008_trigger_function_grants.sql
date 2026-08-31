-- =============================================================================
-- Young Lists — 0008 Lock down the trigger functions
-- =============================================================================
-- Found by Supabase's database linter after applying 0001-0007 to a real
-- project (lint 0028, "Public Can Execute SECURITY DEFINER Function").
--
-- The problem: PostgreSQL grants EXECUTE on a new function to PUBLIC by
-- default, and PostgREST exposes *every* function in the `public` schema as an
-- RPC endpoint. 0006 revoked that default for the ten functions the app calls,
-- but the trigger functions in 0001 and 0004 were never in that list — so
-- `/rest/v1/rpc/touch_parent_list` was reachable by a signed-out caller.
--
-- In practice PostgreSQL refuses to run a function returning `trigger` outside
-- a trigger context, so there was no exploit here. It is still wrong: a
-- SECURITY DEFINER function should never be callable by anyone who has no
-- reason to call it, and the next trigger function somebody adds might not be
-- so harmless.
--
-- Revoking EXECUTE does not stop the triggers firing. PostgreSQL checks
-- EXECUTE on a trigger function at CREATE TRIGGER time, not each time the
-- trigger fires, so ordinary inserts and updates are unaffected. The
-- verification query at the bottom of supabase/tests/rls_tests.sql covers this.
-- =============================================================================

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.set_updated_at()',
    'public.guard_household_id_immutable()',
    'public.sync_item_checked_at()',
    'public.touch_parent_list()',
    'public.guard_last_owner()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated;', fn);
  end loop;
end;
$$;
