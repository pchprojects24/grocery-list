-- =============================================================================
-- Young Lists — 0003 Authorization helpers
-- =============================================================================
-- These two functions are the ONLY place household membership is evaluated.
-- Every RLS policy in 0005_rls.sql calls them, so authorization logic lives in
-- exactly one place. They are defined after the tables because they query them.
--
-- Why SECURITY DEFINER:
--   A policy on `household_members` that queries `household_members` would
--   recurse forever. A SECURITY DEFINER function runs as its owner (postgres,
--   which bypasses RLS), so the membership lookup inside it is NOT re-filtered
--   by the policy that called it. This is the standard Supabase pattern for
--   avoiding recursive-policy errors.
--
-- Why `set search_path = ''`:
--   A SECURITY DEFINER function with a mutable search_path can be hijacked by a
--   caller who creates a same-named object in a schema earlier on the path.
--   Every identifier below is therefore schema-qualified.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- is_household_member(household_id) -> boolean
-- True when the currently authenticated user belongs to the given household.
-- -----------------------------------------------------------------------------
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = (select auth.uid())
  );
$$;

-- -----------------------------------------------------------------------------
-- is_household_owner(household_id) -> boolean
-- True when the authenticated user is an *owner* of the household.
-- Owners can invite/remove members; ordinary members cannot.
-- -----------------------------------------------------------------------------
create or replace function public.is_household_owner(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = (select auth.uid())
      and hm.role = 'owner'
  );
$$;

comment on function public.is_household_member(uuid) is
  'Authorization helper used by every RLS policy. SECURITY DEFINER to avoid recursive policy evaluation on household_members.';
comment on function public.is_household_owner(uuid) is
  'Authorization helper: household owners may manage members and invites.';
