-- =============================================================================
-- Young Lists — 0005 Grants and Row Level Security
-- =============================================================================
-- The security model in one sentence:
--
--   A row is visible and writable only to users who have a row in
--   household_members for that row's household_id — enforced by PostgreSQL,
--   not by the browser.
--
-- Consequences that matter:
--   * Signed-out (`anon`) users get nothing. Every policy names `authenticated`,
--     and `anon` holds no table privileges at all.
--   * An authenticated user from an unrelated household gets nothing, even if
--     they guess a row's UUID.
--   * INSERT policies use WITH CHECK, so a user cannot create a row that claims
--     a household_id they do not belong to by editing the request in devtools.
--   * UPDATE policies use both USING and WITH CHECK, so a user cannot move a row
--     they can see into a household they cannot. The guard_household_id trigger
--     in 0004 blocks the move outright.
--   * households and household_members have no INSERT policy on purpose: the
--     only way to create a household or gain membership is through the
--     create_household() / redeem_household_invite() functions in 0006, which
--     validate the caller first.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Privileges. Least privilege: `anon` is granted nothing anywhere.
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select, insert, update, delete on
  public.households,
  public.household_members,
  public.household_invites,
  public.stores,
  public.store_sections,
  public.shopping_lists,
  public.list_items,
  public.shopping_trips,
  public.shopping_trip_items,
  public.household_items
to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS on every exposed table.
-- -----------------------------------------------------------------------------
alter table public.households          enable row level security;
alter table public.household_members   enable row level security;
alter table public.household_invites   enable row level security;
alter table public.stores              enable row level security;
alter table public.store_sections      enable row level security;
alter table public.shopping_lists      enable row level security;
alter table public.list_items          enable row level security;
alter table public.shopping_trips      enable row level security;
alter table public.shopping_trip_items enable row level security;
alter table public.household_items     enable row level security;

-- =============================================================================
-- households
-- =============================================================================
drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (public.is_household_member(id));

-- No INSERT policy: use public.create_household().

drop policy if exists households_update on public.households;
create policy households_update on public.households
  for update to authenticated
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

drop policy if exists households_delete on public.households;
create policy households_delete on public.households
  for delete to authenticated
  using (public.is_household_owner(id));

-- =============================================================================
-- household_members
--
-- The `user_id = auth.uid()` branch is what lets a brand-new user discover that
-- they have no household yet without recursing through is_household_member().
-- =============================================================================
drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_household_member(household_id)
  );

-- No INSERT policy: use public.create_household() / public.redeem_household_invite().

drop policy if exists household_members_update on public.household_members;
create policy household_members_update on public.household_members
  for update to authenticated
  using (public.is_household_owner(household_id))
  with check (public.is_household_owner(household_id));

-- A member may remove themselves (leave); an owner may remove anyone.
-- The guard_last_owner trigger still refuses to strand a household.
drop policy if exists household_members_delete on public.household_members;
create policy household_members_delete on public.household_members
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_household_owner(household_id)
  );

-- =============================================================================
-- household_invites
--
-- Only owners can see or manage codes. A user redeeming a code never SELECTs
-- this table — redeem_household_invite() does the lookup for them — so a code
-- cannot be enumerated by an outsider.
-- =============================================================================
drop policy if exists household_invites_select on public.household_invites;
create policy household_invites_select on public.household_invites
  for select to authenticated
  using (public.is_household_owner(household_id));

drop policy if exists household_invites_delete on public.household_invites;
create policy household_invites_delete on public.household_invites
  for delete to authenticated
  using (public.is_household_owner(household_id));

-- No INSERT/UPDATE policy: use public.create_household_invite() /
-- public.redeem_household_invite().

-- =============================================================================
-- Household-scoped content tables.
-- All four verbs share the same predicate, so they are generated in a loop to
-- guarantee no table is accidentally left with a weaker rule than its siblings.
-- =============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'stores', 'store_sections', 'shopping_lists', 'list_items',
    'shopping_trips', 'shopping_trip_items', 'household_items'
  ]
  loop
    execute format($f$
      drop policy if exists %1$s_select on public.%1$I;
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (public.is_household_member(household_id));

      drop policy if exists %1$s_insert on public.%1$I;
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (public.is_household_member(household_id));

      drop policy if exists %1$s_update on public.%1$I;
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (public.is_household_member(household_id))
        with check (public.is_household_member(household_id));

      drop policy if exists %1$s_delete on public.%1$I;
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (public.is_household_member(household_id));
    $f$, t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Authorship cannot be forged. These are additive RESTRICTIVE policies: they
-- AND with the permissive policies above rather than widening them.
-- -----------------------------------------------------------------------------
drop policy if exists shopping_lists_author on public.shopping_lists;
create policy shopping_lists_author on public.shopping_lists
  as restrictive for insert to authenticated
  with check (created_by is not distinct from (select auth.uid()));

drop policy if exists list_items_author on public.list_items;
create policy list_items_author on public.list_items
  as restrictive for insert to authenticated
  with check (created_by is not distinct from (select auth.uid()));

drop policy if exists shopping_trips_author on public.shopping_trips;
create policy shopping_trips_author on public.shopping_trips
  as restrictive for insert to authenticated
  with check (completed_by is not distinct from (select auth.uid()));
