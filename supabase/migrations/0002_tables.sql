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
