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
