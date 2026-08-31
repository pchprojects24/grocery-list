-- =============================================================================
-- Young Lists — complete database schema
--
-- GENERATED FILE — do not edit. Run supabase/build_schema.sh after changing
-- anything in supabase/migrations/. Concatenated in filename order; safe to
-- run more than once.
-- =============================================================================


-- >>> migrations/0001_helpers.sql
-- =============================================================================
-- Young Lists — 0001 Table-independent helper functions
-- =============================================================================
-- Small utilities that the table definitions themselves depend on, so they must
-- be created first. The authorization helpers live in 0003, after the tables
-- they query.
--
-- Every function here sets `search_path = ''` and schema-qualifies its
-- identifiers, so it cannot be hijacked by an object planted on the caller's
-- search path.
-- =============================================================================

-- No extensions are required: gen_random_uuid() is built into PostgreSQL 13+
-- and invite codes are derived from it, so this schema installs cleanly on a
-- stock Postgres as well as on Supabase.

-- -----------------------------------------------------------------------------
-- normalize_item_name(text) -> text
-- Canonical form used to match "Milk", " milk " and "MILK" to one catalog row.
-- IMMUTABLE because it is used in a generated column and in unique indexes.
-- -----------------------------------------------------------------------------
create or replace function public.normalize_item_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(coalesce(p_name, '')));
$$;

-- -----------------------------------------------------------------------------
-- set_updated_at() — generic BEFORE UPDATE trigger.
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- guard_household_id_immutable() — BEFORE UPDATE trigger.
--
-- RLS already blocks moving a row into a household you are not a member of, but
-- household_id should never change at all. This makes that explicit and cheap to
-- audit, and closes the "member of A and B moves a row between them" case.
-- -----------------------------------------------------------------------------
create or replace function public.guard_household_id_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id then
    raise exception 'household_id is immutable (row %)', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- >>> migrations/0002_tables.sql
-- =============================================================================
-- Young Lists — 0002 Tables, keys and indexes
-- =============================================================================
-- Design notes that are easy to miss when skimming:
--
-- 1. Composite foreign keys.
--    `list_items` references `shopping_lists (id, household_id)` rather than
--    just `(id)`. The extra column makes it impossible for an item to claim a
--    household different from its list's household — the database rejects it,
--    not the browser. The same trick links store_sections -> stores and
--    shopping_trip_items -> shopping_trips.
--
-- 2. ON DELETE CASCADE replaces the Firebase "orphaned subcollection" bug.
--    Deleting a list deletes its items in the same transaction.
--
-- 3. Store sections are rows with stable UUIDs and a numeric sort_order, not
--    strings inside an array on the store. Renaming "Produce" -> "Fruit & Veg"
--    therefore does not orphan any item.
--
-- 4. History rows keep *snapshots* (list name, store name, section name) so a
--    past trip stays readable after the list, store or section is renamed or
--    deleted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- households
-- -----------------------------------------------------------------------------
create table if not exists public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- household_members
-- Compound primary key == the "same user cannot be added twice" constraint.
-- -----------------------------------------------------------------------------
create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('owner', 'member')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Every RLS policy filters on (household_id, user_id) via is_household_member();
-- the primary key already indexes that direction. This index covers the reverse
-- lookup "which households does this user belong to?", which the app runs on
-- every sign-in.
create index if not exists household_members_user_id_idx
  on public.household_members (user_id);

-- -----------------------------------------------------------------------------
-- household_invites
-- Join codes. A code is a short, single-use-by-default secret; it is redeemed
-- through the redeem_household_invite() function so that no privileged key is
-- ever needed in the browser.
-- -----------------------------------------------------------------------------
create table if not exists public.household_invites (
  code         text primary key check (code ~ '^[A-Z0-9]{8}$'),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  max_uses     integer not null default 1 check (max_uses between 1 and 10),
  uses         integer not null default 0 check (uses >= 0),
  revoked_at   timestamptz
);

create index if not exists household_invites_household_id_idx
  on public.household_invites (household_id);

-- -----------------------------------------------------------------------------
-- stores
-- `location` distinguishes two branches of the same chain
-- (e.g. "Atlantic Superstore" / "Bayers Lake").
-- -----------------------------------------------------------------------------
create table if not exists public.stores (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  location     text check (char_length(location) <= 120),
  address      text check (char_length(address) <= 250),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Target for the composite foreign keys below.
  unique (id, household_id)
);

create index if not exists stores_household_id_idx
  on public.stores (household_id, name);

-- -----------------------------------------------------------------------------
-- store_sections  (the "walking order" of a store)
-- -----------------------------------------------------------------------------
create table if not exists public.store_sections (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null,
  household_id uuid not null,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (store_id, household_id)
    references public.stores (id, household_id) on delete cascade,
  unique (id, household_id)
);

create index if not exists store_sections_store_order_idx
  on public.store_sections (store_id, sort_order);
create index if not exists store_sections_household_id_idx
  on public.store_sections (household_id);

-- One section name per store (case-insensitive), so "Dairy" cannot be added twice.
create unique index if not exists store_sections_store_name_key
  on public.store_sections (store_id, public.normalize_item_name(name));

-- -----------------------------------------------------------------------------
-- shopping_lists
-- -----------------------------------------------------------------------------
create table if not exists public.shopping_lists (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  store_id     uuid,
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- A list may only point at a store in its own household.
  -- PostgreSQL 15+ column-list form: only store_id is nulled, household_id
  -- (NOT NULL) is left alone. Deleting a store un-assigns it from its lists.
  foreign key (store_id, household_id)
    references public.stores (id, household_id) on delete set null (store_id),
  unique (id, household_id)
);

create index if not exists shopping_lists_household_active_idx
  on public.shopping_lists (household_id, is_archived, updated_at desc);
create index if not exists shopping_lists_store_id_idx
  on public.shopping_lists (store_id);

-- -----------------------------------------------------------------------------
-- list_items
-- `quantity` is free text ("2", "2 lbs", "a dozen") because that is what people
-- actually write on a grocery list; forcing a numeric + unit pair here would
-- make the fast-add path slower without making anything more reliable.
-- -----------------------------------------------------------------------------
create table if not exists public.list_items (
  id              uuid primary key default gen_random_uuid(),
  list_id         uuid not null,
  household_id    uuid not null,
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  quantity        text check (char_length(quantity) <= 40),
  note            text check (char_length(note) <= 500),
  store_section_id uuid,
  checked         boolean not null default false,
  checked_at      timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Deleting a list deletes its items. This is the fix for the Firebase
  -- implementation, which left item subcollections orphaned forever.
  foreign key (list_id, household_id)
    references public.shopping_lists (id, household_id) on delete cascade,
  -- Removing a section leaves its items in place, unsorted, rather than
  -- silently deleting groceries.
  foreign key (store_section_id, household_id)
    references public.store_sections (id, household_id)
    on delete set null (store_section_id)
);

create index if not exists list_items_list_idx
  on public.list_items (list_id, checked, created_at);
create index if not exists list_items_household_id_idx
  on public.list_items (household_id);
create index if not exists list_items_section_idx
  on public.list_items (store_section_id);

-- -----------------------------------------------------------------------------
-- shopping_trips  (one completed shopping trip)
-- -----------------------------------------------------------------------------
create table if not exists public.shopping_trips (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households (id) on delete cascade,
  shopping_list_id uuid,
  list_name        text not null,          -- snapshot: survives list rename/delete
  store_id         uuid,
  store_name       text,                   -- snapshot: survives store rename/delete
  item_count       integer not null default 0,
  completed_by     uuid references auth.users (id) on delete set null,
  completed_at     timestamptz not null default now(),
  -- The list may be deleted later; the trip must survive it.
  foreign key (shopping_list_id, household_id)
    references public.shopping_lists (id, household_id)
    on delete set null (shopping_list_id),
  foreign key (store_id, household_id)
    references public.stores (id, household_id) on delete set null (store_id),
  unique (id, household_id)
);

create index if not exists shopping_trips_household_completed_idx
  on public.shopping_trips (household_id, completed_at desc);

-- -----------------------------------------------------------------------------
-- shopping_trip_items
-- Deliberately denormalised: everything needed to re-add the item later is
-- stored as text, so history stays useful even if the store/section is gone.
-- -----------------------------------------------------------------------------
create table if not exists public.shopping_trip_items (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null,
  household_id     uuid not null,
  name             text not null,
  quantity         text,
  note             text,
  store_name       text,
  section_name     text,
  source_item_id   uuid,                   -- original list_items.id, for reference only
  purchased_at     timestamptz not null default now(),
  foreign key (trip_id, household_id)
    references public.shopping_trips (id, household_id) on delete cascade
);

create index if not exists shopping_trip_items_trip_idx
  on public.shopping_trip_items (trip_id, name);
create index if not exists shopping_trip_items_household_idx
  on public.shopping_trip_items (household_id, purchased_at desc);

-- -----------------------------------------------------------------------------
-- household_items  (the household product catalog)
-- Powers autocomplete, "recently bought", "frequently bought", one-tap re-add
-- and remembered defaults. Populated automatically when a trip is completed.
-- -----------------------------------------------------------------------------
create table if not exists public.household_items (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid not null references public.households (id) on delete cascade,
  display_name        text not null check (char_length(btrim(display_name)) between 1 and 120),
  -- Generated, so the unique index below can never drift from display_name.
  normalized_name     text generated always as (public.normalize_item_name(display_name)) stored,
  default_quantity    text check (char_length(default_quantity) <= 40),
  default_note        text check (char_length(default_note) <= 500),
  preferred_store_id  uuid,
  preferred_section_id uuid,
  times_purchased     integer not null default 0 check (times_purchased >= 0),
  last_purchased_at   timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (preferred_store_id, household_id)
    references public.stores (id, household_id) on delete set null (preferred_store_id),
  foreign key (preferred_section_id, household_id)
    references public.store_sections (id, household_id)
    on delete set null (preferred_section_id),
  unique (household_id, normalized_name)
);

create index if not exists household_items_frequent_idx
  on public.household_items (household_id, times_purchased desc);
create index if not exists household_items_recent_idx
  on public.household_items (household_id, last_purchased_at desc nulls last);
-- Prefix search for autocomplete ("mil" -> "Milk").
create index if not exists household_items_prefix_idx
  on public.household_items (household_id, normalized_name text_pattern_ops);

-- >>> migrations/0003_authorization.sql
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

-- >>> migrations/0004_triggers.sql
-- =============================================================================
-- Young Lists — 0004 Defaults and triggers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Authorship defaults.
-- The client never sends created_by; the database stamps it from the verified
-- JWT. RLS additionally rejects an insert that tries to claim someone else's id
-- (see 0005_rls.sql), so this is a convenience, not the security boundary.
-- -----------------------------------------------------------------------------
alter table public.households      alter column created_by   set default auth.uid();
alter table public.shopping_lists  alter column created_by   set default auth.uid();
alter table public.list_items      alter column created_by   set default auth.uid();
alter table public.shopping_trips  alter column completed_by set default auth.uid();
alter table public.household_invites alter column created_by set default auth.uid();

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'households', 'stores', 'store_sections', 'shopping_lists',
    'list_items', 'household_items'
  ]
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I;
       create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at();', t, t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- household_id immutability
--
-- RLS stops a user from moving a row into a household they do not belong to.
-- This trigger stops the row from moving at all, including between two
-- households the same user happens to belong to.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'stores', 'store_sections', 'shopping_lists', 'list_items',
    'shopping_trips', 'shopping_trip_items', 'household_items'
  ]
  loop
    execute format(
      'drop trigger if exists guard_household_id on public.%I;
       create trigger guard_household_id before update on public.%I
         for each row execute function public.guard_household_id_immutable();', t, t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- checked / checked_at stay consistent no matter what the client sends.
-- -----------------------------------------------------------------------------
create or replace function public.sync_item_checked_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.checked_at := case when new.checked then coalesce(new.checked_at, now()) else null end;
  elsif new.checked is distinct from old.checked then
    new.checked_at := case when new.checked then now() else null end;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_checked_at on public.list_items;
create trigger sync_checked_at
  before insert or update on public.list_items
  for each row execute function public.sync_item_checked_at();

-- -----------------------------------------------------------------------------
-- Touch the parent list whenever its items change.
-- Home orders lists by updated_at, so "the list someone just added to" floats to
-- the top, and the other device receives a realtime event on shopping_lists.
-- -----------------------------------------------------------------------------
create or replace function public.touch_parent_list()
returns trigger
language plpgsql
security definer          -- the item's owner may not hold UPDATE on the list row
set search_path = ''
as $$
declare
  v_list_id uuid := coalesce(new.list_id, old.list_id);
begin
  update public.shopping_lists set updated_at = now() where id = v_list_id;
  return null;
end;
$$;

drop trigger if exists touch_list on public.list_items;
create trigger touch_list
  after insert or update or delete on public.list_items
  for each row execute function public.touch_parent_list();

-- -----------------------------------------------------------------------------
-- A household must never lose its last owner, or nobody could ever invite
-- again. Applies to both DELETE and a role demotion.
-- -----------------------------------------------------------------------------
create or replace function public.guard_last_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_remaining integer;
begin
  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;                      -- still an owner, nothing to check
  end if;

  if old.role <> 'owner' then
    return coalesce(new, old);       -- was not an owner, cannot be the last one
  end if;

  select count(*) into v_remaining
  from public.household_members hm
  where hm.household_id = old.household_id
    and hm.role = 'owner'
    and hm.user_id <> old.user_id;

  if v_remaining = 0 then
    raise exception 'A household must keep at least one owner'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists guard_last_owner on public.household_members;
create trigger guard_last_owner
  before update or delete on public.household_members
  for each row execute function public.guard_last_owner();

-- >>> migrations/0005_rls.sql
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

-- >>> migrations/0006_functions.sql
-- =============================================================================
-- Young Lists — 0006 Application functions (RPC)
-- =============================================================================
-- Four of these are SECURITY INVOKER: they run with the caller's privileges and
-- are therefore filtered by exactly the same RLS policies as a direct query.
-- They exist for atomicity (one transaction) rather than for extra permission.
--
-- Three are SECURITY DEFINER because they must write rows that RLS deliberately
-- has no INSERT policy for — creating a household, minting an invite, redeeming
-- an invite. Each one re-checks the caller explicitly on its first lines.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- create_household(name) -> household id
-- Creates the household and makes the caller its first owner, atomically.
-- Without this, RLS would be a chicken-and-egg problem: you cannot insert a
-- membership row for a household you are not yet a member of.
-- -----------------------------------------------------------------------------
create or replace function public.create_household(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Household name is required' using errcode = '22023';
  end if;

  insert into public.households (name, created_by)
  values (btrim(p_name), v_uid)
  returning id into v_id;

  insert into public.household_members (household_id, user_id, role)
  values (v_id, v_uid, 'owner');

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_household_invite(household_id, ttl_hours, max_uses) -> code
-- Owners only. Returns a short code the second person types on the sign-in
-- screen. No privileged key is involved anywhere in this flow.
-- -----------------------------------------------------------------------------
create or replace function public.create_household_invite(
  p_household_id uuid,
  p_ttl_hours    integer default 168,   -- 7 days
  p_max_uses     integer default 1
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- No I, O, 0 or 1: these codes get read aloud and typed on a phone.
  v_charset constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code    text;
  v_hex     text;
  i         integer;
  attempt   integer;
begin
  if not public.is_household_owner(p_household_id) then
    raise exception 'Only a household owner can create an invite'
      using errcode = '42501';
  end if;
  if p_ttl_hours not between 1 and 720 then
    raise exception 'Invite lifetime must be between 1 and 720 hours'
      using errcode = '22023';
  end if;

  for attempt in 1..5 loop
    -- gen_random_uuid() uses the platform CSPRNG, unlike random().
    -- 256 is an exact multiple of 32, so this mapping is unbiased.
    v_hex := replace(gen_random_uuid()::text, '-', '');
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(
        v_charset,
        1 + (('x' || substr(v_hex, i * 2 - 1, 2))::bit(8)::integer % 32),
        1);
    end loop;

    begin
      insert into public.household_invites
        (code, household_id, created_by, expires_at, max_uses)
      values
        (v_code, p_household_id, (select auth.uid()),
         now() + make_interval(hours => p_ttl_hours),
         greatest(1, least(10, p_max_uses)));
      return v_code;
    exception when unique_violation then
      -- Astronomically unlikely; try again rather than failing the user.
      null;
    end;
  end loop;

  raise exception 'Could not generate an invite code, please try again';
end;
$$;

-- -----------------------------------------------------------------------------
-- redeem_household_invite(code) -> household id
-- The redeeming user cannot SELECT household_invites (RLS restricts it to
-- owners), so codes cannot be enumerated. This function does the lookup on
-- their behalf and refuses expired, revoked, or used-up codes.
-- -----------------------------------------------------------------------------
create or replace function public.redeem_household_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_invite public.household_invites;
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_invite
  from public.household_invites
  where code = upper(btrim(coalesce(p_code, '')))
  for update;

  -- One deliberately vague message for every failure mode, so a wrong code
  -- cannot be distinguished from an expired or spent one.
  if v_invite.code is null
     or v_invite.revoked_at is not null
     or v_invite.expires_at <= now()
     or v_invite.uses >= v_invite.max_uses
  then
    raise exception 'That invite code is not valid' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.household_members
    where household_id = v_invite.household_id and user_id = v_uid
  ) then
    return v_invite.household_id;    -- already a member: idempotent, no use spent
  end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_invite.household_id, v_uid, 'member');

  update public.household_invites
  set uses = uses + 1
  where code = v_invite.code;

  return v_invite.household_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- create_store_with_sections(household, name, location, sections[])
-- One transaction, so a store is never left half-built. SECURITY INVOKER: RLS
-- rejects the insert if the caller is not in the household.
-- -----------------------------------------------------------------------------
create or replace function public.create_store_with_sections(
  p_household_id uuid,
  p_name         text,
  p_location     text default null,
  p_sections     text[] default '{}'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_store_id uuid;
  v_name     text;
  i          integer := 0;
begin
  insert into public.stores (household_id, name, location)
  values (p_household_id, btrim(p_name), nullif(btrim(coalesce(p_location, '')), ''))
  returning id into v_store_id;

  foreach v_name in array coalesce(p_sections, '{}')
  loop
    if btrim(v_name) <> '' then
      i := i + 1;
      insert into public.store_sections (store_id, household_id, name, sort_order)
      values (v_store_id, p_household_id, btrim(v_name), i * 10)
      on conflict do nothing;
    end if;
  end loop;

  return v_store_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- reorder_store_sections(store, ordered section ids)
-- Rewrites sort_order to match the array. Any section of the store missing from
-- the array keeps a position after the listed ones instead of disappearing.
-- -----------------------------------------------------------------------------
create or replace function public.reorder_store_sections(
  p_store_id     uuid,
  p_section_ids  uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.store_sections s
  set sort_order = o.ord * 10
  from (
    select id, ord::integer as ord
    from unnest(p_section_ids) with ordinality as t(id, ord)
  ) o
  where s.id = o.id
    and s.store_id = p_store_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- add_items_to_list(list, items jsonb) -> {added, merged, merged_names}
--
-- Shared by quick-add, "Add again" and "Add all again" so that all three behave
-- identically. Two behaviours worth knowing:
--   * Merge, don't duplicate. If an unchecked item with the same normalized
--     name is already on the list, the existing row is updated instead of a
--     second copy being created, and its name is reported back so the UI can
--     tell the user.
--   * Remembered defaults. Quantity, note and section fall back to the
--     household catalog when the caller leaves them out — but a remembered
--     section is only applied if it belongs to the store this list is currently
--     assigned to.
--
-- p_items: [{"name": "Milk", "quantity": "2L", "note": null, "store_section_id": null}, ...]
-- -----------------------------------------------------------------------------
create or replace function public.add_items_to_list(
  p_list_id uuid,
  p_items   jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_list        public.shopping_lists;
  v_item        jsonb;
  v_name        text;
  v_norm        text;
  v_quantity    text;
  v_note        text;
  v_section     uuid;
  v_catalog     public.household_items;
  v_existing_id uuid;
  v_added       integer := 0;
  v_merged      integer := 0;
  v_merged_names text[] := '{}';
begin
  select * into v_list from public.shopping_lists where id = p_list_id;
  if v_list.id is null then
    -- Either it does not exist or RLS hid it; the caller must not learn which.
    raise exception 'List not found' using errcode = '42501';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_name := btrim(coalesce(v_item ->> 'name', ''));
    continue when v_name = '';
    v_norm := public.normalize_item_name(v_name);

    v_quantity := nullif(btrim(coalesce(v_item ->> 'quantity', '')), '');
    v_note     := nullif(btrim(coalesce(v_item ->> 'note', '')), '');
    v_section  := nullif(v_item ->> 'store_section_id', '')::uuid;

    select * into v_catalog
    from public.household_items
    where household_id = v_list.household_id and normalized_name = v_norm;

    v_quantity := coalesce(v_quantity, v_catalog.default_quantity);
    v_note     := coalesce(v_note, v_catalog.default_note);

    if v_section is null and v_catalog.preferred_section_id is not null then
      -- Only reuse a remembered section when it belongs to this list's store.
      select ss.id into v_section
      from public.store_sections ss
      where ss.id = v_catalog.preferred_section_id
        and ss.store_id is not distinct from v_list.store_id;
    end if;

    select li.id into v_existing_id
    from public.list_items li
    where li.list_id = p_list_id
      and li.checked = false
      and public.normalize_item_name(li.name) = v_norm
    limit 1;

    if v_existing_id is not null then
      update public.list_items
      set quantity = coalesce(v_quantity, quantity),
          note     = coalesce(v_note, note),
          store_section_id = coalesce(v_section, store_section_id)
      where id = v_existing_id;
      v_merged := v_merged + 1;
      v_merged_names := v_merged_names || v_name;
    else
      insert into public.list_items
        (list_id, household_id, name, quantity, note, store_section_id)
      values
        (p_list_id, v_list.household_id, v_name, v_quantity, v_note, v_section);
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'added', v_added,
    'merged', v_merged,
    'merged_names', to_jsonb(v_merged_names));
end;
$$;

-- -----------------------------------------------------------------------------
-- complete_shopping_trip(list) -> trip id
--
-- Everything that happens when you finish shopping, in one transaction:
--   1. snapshot the trip (list name and store name as text, so history survives
--      a later rename or delete),
--   2. copy every checked item into shopping_trip_items,
--   3. update the household catalog (times_purchased, last_purchased_at,
--      remembered store/section) so repeat shopping gets smarter,
--   4. remove the checked items from the active list.
-- Unchecked items stay on the list for next time.
-- -----------------------------------------------------------------------------
create or replace function public.complete_shopping_trip(p_list_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_list    public.shopping_lists;
  v_store   public.stores;
  v_count   integer;
  v_trip_id uuid;
begin
  select * into v_list from public.shopping_lists where id = p_list_id;
  if v_list.id is null then
    raise exception 'List not found' using errcode = '42501';
  end if;

  select count(*) into v_count
  from public.list_items where list_id = p_list_id and checked;

  if v_count = 0 then
    raise exception 'NO_CHECKED_ITEMS' using errcode = '22023';
  end if;

  select * into v_store from public.stores where id = v_list.store_id;

  insert into public.shopping_trips
    (household_id, shopping_list_id, list_name, store_id, store_name, item_count)
  values
    (v_list.household_id, v_list.id, v_list.name, v_store.id,
     case when v_store.id is null then null
          else v_store.name || coalesce(' (' || v_store.location || ')', '') end,
     v_count)
  returning id into v_trip_id;

  insert into public.shopping_trip_items
    (trip_id, household_id, name, quantity, note, store_name, section_name,
     source_item_id, purchased_at)
  select
    v_trip_id, v_list.household_id, li.name, li.quantity, li.note,
    case when v_store.id is null then null
         else v_store.name || coalesce(' (' || v_store.location || ')', '') end,
    ss.name, li.id, coalesce(li.checked_at, now())
  from public.list_items li
  left join public.store_sections ss on ss.id = li.store_section_id
  where li.list_id = p_list_id and li.checked;

  -- Catalog. DISTINCT ON collapses duplicates within this one trip, because
  -- ON CONFLICT DO UPDATE cannot touch the same row twice in one statement.
  insert into public.household_items as hi
    (household_id, display_name, default_quantity, default_note,
     preferred_store_id, preferred_section_id, times_purchased, last_purchased_at)
  select distinct on (public.normalize_item_name(li.name))
    v_list.household_id, li.name, li.quantity, li.note,
    v_list.store_id, li.store_section_id, 1, now()
  from public.list_items li
  where li.list_id = p_list_id and li.checked
  order by public.normalize_item_name(li.name), li.created_at desc
  on conflict (household_id, normalized_name) do update
  set times_purchased      = hi.times_purchased + 1,
      last_purchased_at    = now(),
      display_name         = excluded.display_name,
      default_quantity     = coalesce(excluded.default_quantity, hi.default_quantity),
      default_note         = coalesce(excluded.default_note, hi.default_note),
      preferred_store_id   = coalesce(excluded.preferred_store_id, hi.preferred_store_id),
      preferred_section_id = coalesce(excluded.preferred_section_id, hi.preferred_section_id);

  delete from public.list_items where list_id = p_list_id and checked;

  return v_trip_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Execute privileges. `anon` (signed out) can call nothing.
-- -----------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_household_member(uuid)',
    'public.is_household_owner(uuid)',
    'public.normalize_item_name(text)',
    'public.create_household(text)',
    'public.create_household_invite(uuid, integer, integer)',
    'public.redeem_household_invite(text)',
    'public.create_store_with_sections(uuid, text, text, text[])',
    'public.reorder_store_sections(uuid, uuid[])',
    'public.add_items_to_list(uuid, jsonb)',
    'public.complete_shopping_trip(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon;', fn);
    execute format('grant execute on function %s to authenticated;', fn);
  end loop;
end;
$$;

-- >>> migrations/0007_realtime.sql
-- =============================================================================
-- Young Lists — 0007 Realtime
-- =============================================================================
-- Two devices in the same household must see each other's changes without a
-- manual refresh. Supabase Realtime streams Postgres changes to subscribers and
-- re-evaluates RLS per subscriber, so a member of another household receives
-- nothing even though the publication itself is table-wide.
--
-- REPLICA IDENTITY FULL matters more than it looks:
--   By default a DELETE only publishes the primary key. The app subscribes with
--   a `household_id=eq.<id>` filter, and RLS needs household_id too — with the
--   default replica identity both would see a payload with no household_id and
--   the delete would silently never arrive on the other device. FULL makes the
--   old row available so deletes filter and authorize correctly.
--   Cost: slightly larger WAL records. At household scale this is irrelevant.
--
-- This file is safe to re-run: adding a table that is already in the
-- publication raises duplicate_object, which is swallowed below.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'shopping_lists',
    'list_items',
    'stores',
    'store_sections',
    'shopping_trips',
    'household_items',
    'household_members'
  ]
  loop
    execute format('alter table public.%I replica identity full;', t);

    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception
      when duplicate_object then null;   -- already published
      when undefined_object then         -- publication missing (plain Postgres)
        raise notice 'publication supabase_realtime not found; skipping %', t;
    end;
  end loop;
end;
$$;

-- >>> migrations/0008_trigger_function_grants.sql
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
