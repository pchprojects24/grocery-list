-- =============================================================================
-- Young Lists — database behaviour and Row Level Security tests
-- =============================================================================
-- Run with tests/run_db_tests.sh. Every assertion raises an exception on
-- failure, and the runner uses ON_ERROR_STOP, so the script either prints a
-- clean list of passing checks or stops at the first broken one.
--
-- Cast of characters:
--   alice   — creates the household, becomes owner
--   bob     — the second household member, joins with an invite code
--   mallory — an authenticated user who is in NO household. Every check that
--             matters is repeated as mallory, because "the UI hides the button"
--             is not a security control.
--   (anon)  — signed out. Must see and do nothing at all.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on
\pset pager off
\timing off

-- -----------------------------------------------------------------------------
-- Test harness.
--
-- Everything the harness needs lives in its own `test` schema, never in
-- `public`. Section 9 audits `public` for functions an unauthenticated caller
-- could reach, and a stray helper there would either mask a real problem or
-- report itself as one.
-- -----------------------------------------------------------------------------
create schema if not exists test;

create or replace function test._assert(p_ok boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_ok is not true then
    raise exception 'FAILED: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

-- -----------------------------------------------------------------------------
-- Test context.
-- psql does not interpolate :variables inside dollar-quoted blocks, so ids
-- captured with \gset are parked in this table and read back with test.id().
-- It lives outside `public` so the privilege audit in section 9 stays honest.
-- -----------------------------------------------------------------------------
grant usage on schema test to authenticated, anon;
grant execute on function test._assert(boolean, text) to authenticated, anon;
create table if not exists test.ctx (k text primary key, v text);
grant select, insert, update, delete on test.ctx to authenticated, anon;

create or replace function test.put(p_k text, p_v text)
returns text language sql as $$
  insert into test.ctx values (p_k, p_v)
  on conflict (k) do update set v = excluded.v
  returning v;
$$;

create or replace function test.id(p_k text)
returns uuid language sql stable as $$
  select v::uuid from test.ctx where k = p_k;
$$;

create or replace function test.val(p_k text)
returns text language sql stable as $$
  select v from test.ctx where k = p_k;
$$;

-- =============================================================================
-- Fixtures
-- =============================================================================
\echo ''
\echo '--- fixtures -------------------------------------------------------------'

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'bob@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'mallory@example.com');

\set alice   '11111111-1111-4111-8111-111111111111'
\set bob     '22222222-2222-4222-8222-222222222222'
\set mallory '33333333-3333-4333-8333-333333333333'

-- =============================================================================
-- 1. Household creation and membership
-- =============================================================================
\echo ''
\echo '--- 1. household creation & membership -----------------------------------'

set role authenticated;
set request.jwt.claim.sub = :'alice';

select public.create_household('Young Household') as hh \gset
select test.put('hh', :'hh') as _ \gset

do $$ begin
  perform test._assert(
    (select count(*) = 1 from public.households),
    'alice sees exactly one household');
  perform test._assert(
    (select role = 'owner' from public.household_members
      where user_id = auth.uid()),
    'alice is the owner of the household she created');
end $$;

-- Mallory is authenticated but belongs to nothing.
set request.jwt.claim.sub = :'mallory';
do $$ begin
  perform test._assert((select count(*) = 0 from public.households),
    'mallory sees no households');
  perform test._assert((select count(*) = 0 from public.household_members),
    'mallory sees no membership rows');
end $$;

-- =============================================================================
-- 2. Invitations — the replacement for the old manual UID whitelist
-- =============================================================================
\echo ''
\echo '--- 2. invitations -------------------------------------------------------'

-- Mallory must not be able to mint an invite for a household she is not in.
do $$
declare v_hh uuid;
begin
  select id into v_hh from public.households;             -- RLS: returns null
  begin
    perform public.create_household_invite(
      (select id from public.households limit 1));
    raise exception 'FAILED: mallory minted an invite';
  exception when insufficient_privilege or null_value_not_allowed then
    perform test._assert(true, 'mallory cannot create an invite code');
  end;
end $$;

set request.jwt.claim.sub = :'alice';
select public.create_household_invite(test.id('hh'), 24, 1) as code \gset
select test.put('code', :'code') as _ \gset

do $$ begin
  perform test._assert(test.val('code') ~ '^[A-Z0-9]{8}$', 'invite code is 8 chars A-Z0-9');
  perform test._assert(
    (select count(*) = 1 from public.household_invites),
    'owner can read her own household invites');
end $$;

-- Mallory cannot enumerate invite codes even though the row exists.
set request.jwt.claim.sub = :'mallory';
do $$ begin
  perform test._assert((select count(*) = 0 from public.household_invites),
    'a non-member cannot read invite codes');
end $$;

-- A wrong code fails.
do $$ begin
  begin
    perform public.redeem_household_invite('ZZZZZZZZ');
    raise exception 'FAILED: an invalid code was accepted';
  exception when invalid_parameter_value then
    perform test._assert(true, 'an invalid invite code is rejected');
  end;
end $$;

-- Bob redeems the real code and becomes a member.
set request.jwt.claim.sub = :'bob';
do $$ begin
  perform public.redeem_household_invite(test.val('code'));
  perform test._assert(
    (select role = 'member' from public.household_members where user_id = auth.uid()),
    'bob joined the household as a member');
  perform test._assert((select count(*) = 1 from public.households),
    'bob can now see the household');
  perform test._assert((select count(*) = 2 from public.household_members),
    'bob can see both members of his household');
end $$;

-- A single-use code cannot be reused by somebody else.
set request.jwt.claim.sub = :'mallory';
do $$ begin
  begin
    perform public.redeem_household_invite(test.val('code'));
    raise exception 'FAILED: a spent invite code was accepted again';
  exception when invalid_parameter_value then
    perform test._assert(true, 'a spent invite code cannot be reused');
  end;
end $$;

-- =============================================================================
-- 3. Stores and walking order
-- =============================================================================
\echo ''
\echo '--- 3. stores & walking order --------------------------------------------'

set request.jwt.claim.sub = :'alice';
select public.create_store_with_sections(
  test.id('hh'), 'Atlantic Superstore', 'Bayers Lake',
  array['Produce','Bakery','Deli','Meat','Pantry','Dairy','Frozen','Household','Checkout']
) as superstore \gset
select test.put('superstore', :'superstore') as _ \gset

select public.create_store_with_sections(
  test.id('hh'), 'Sobeys', null,
  array['Bakery','Produce','Dairy','Deli','Meat','Frozen','Pantry','Checkout']
) as sobeys \gset
select test.put('sobeys', :'sobeys') as _ \gset

do $$ begin
  perform test._assert(
    (select count(*) = 9 from public.store_sections where store_id = test.id('superstore')),
    'Atlantic Superstore has 9 sections');
  perform test._assert(
    (select string_agg(name, '>' order by sort_order)
       from public.store_sections where store_id = test.id('superstore'))
    = 'Produce>Bakery>Deli>Meat>Pantry>Dairy>Frozen>Household>Checkout',
    'Superstore sections are stored in the order they were given');
  perform test._assert(
    (select string_agg(name, '>' order by sort_order)
       from public.store_sections where store_id = test.id('sobeys'))
    = 'Bakery>Produce>Dairy>Deli>Meat>Frozen>Pantry>Checkout',
    'Sobeys has a different walking order');
end $$;

-- Reordering: move Dairy to the front of the Superstore route.
do $$
declare
  v_ids uuid[];
begin
  select array_agg(id order by (name <> 'Dairy'), sort_order)
    into v_ids
  from public.store_sections where store_id = test.id('superstore');

  perform public.reorder_store_sections(test.id('superstore'), v_ids);

  perform test._assert(
    (select name from public.store_sections
      where store_id = test.id('superstore') order by sort_order limit 1) = 'Dairy',
    'reorder_store_sections moves Dairy to the front');
end $$;

-- Renaming a section must not break anything that points at it: the id is stable.
do $$
declare v_id uuid;
begin
  select id into v_id from public.store_sections
   where store_id = test.id('superstore') and name = 'Produce';
  update public.store_sections set name = 'Fruit & Veg' where id = v_id;
  perform test._assert(
    (select name from public.store_sections where id = v_id) = 'Fruit & Veg',
    'a section can be renamed and keeps its id');
  update public.store_sections set name = 'Produce' where id = v_id;
end $$;

-- =============================================================================
-- 4. Lists and items
-- =============================================================================
\echo ''
\echo '--- 4. lists & items -----------------------------------------------------'

insert into public.shopping_lists (household_id, name, store_id)
values (test.id('hh'), 'Weekly Groceries', test.id('superstore'))
returning id as list_id \gset
select test.put('list_id', :'list_id') as _ \gset

do $$ begin
  perform test._assert(
    (select created_by from public.shopping_lists where id = test.id('list_id')) = auth.uid(),
    'created_by is stamped from the JWT, not the client');
end $$;

-- Quick add, comma-separated, through the shared RPC.
select public.add_items_to_list(test.id('list_id'), jsonb_build_array(
  jsonb_build_object('name','Milk'),
  jsonb_build_object('name','Bananas'),
  jsonb_build_object('name','Chicken Thighs'),
  jsonb_build_object('name','Sourdough')
)) as r1 \gset
select test.put('r1', :'r1') as _ \gset

do $$ begin
  perform test._assert((test.val('r1')::jsonb ->> 'added')::int = 4, 'four items added');
  perform test._assert((select count(*) = 4 from public.list_items
                           where list_id = test.id('list_id')), 'list has four items');
end $$;

-- Merge instead of duplicating.
select public.add_items_to_list(test.id('list_id'),
  jsonb_build_array(jsonb_build_object('name','  MILK ', 'quantity','2 L'))) as r2 \gset
select test.put('r2', :'r2') as _ \gset

do $$ begin
  perform test._assert((test.val('r2')::jsonb ->> 'merged')::int = 1,
    'adding "MILK" again merges rather than duplicating');
  perform test._assert((select count(*) = 4 from public.list_items
                           where list_id = test.id('list_id')),
    'the list still has four items');
  perform test._assert(
    (select quantity from public.list_items
      where list_id = test.id('list_id') and name = 'Milk') = '2 L',
    'the merge applied the new quantity to the existing row');
end $$;

-- Assign sections and verify the store route drives the display order.
do $$
declare
  v_produce uuid; v_dairy uuid; v_meat uuid; v_bakery uuid;
begin
  select id into v_produce from public.store_sections where store_id=test.id('superstore') and name='Produce';
  select id into v_dairy   from public.store_sections where store_id=test.id('superstore') and name='Dairy';
  select id into v_meat    from public.store_sections where store_id=test.id('superstore') and name='Meat';
  select id into v_bakery  from public.store_sections where store_id=test.id('superstore') and name='Bakery';

  update public.list_items set store_section_id = v_dairy   where name = 'Milk'            and list_id=test.id('list_id');
  update public.list_items set store_section_id = v_produce where name = 'Bananas'         and list_id=test.id('list_id');
  update public.list_items set store_section_id = v_meat    where name = 'Chicken Thighs'  and list_id=test.id('list_id');
  update public.list_items set store_section_id = v_bakery  where name = 'Sourdough'       and list_id=test.id('list_id');
end $$;

-- This is the exact ordering the app renders with.
do $$ begin
  perform test._assert(
    (select string_agg(li.name, ',' order by coalesce(ss.sort_order, 2147483647), li.created_at)
       from public.list_items li
       left join public.store_sections ss on ss.id = li.store_section_id
      where li.list_id = test.id('list_id'))
    = 'Milk,Bananas,Sourdough,Chicken Thighs',
    'items follow the Superstore route (Dairy>Produce>Bakery>Meat)');
end $$;

-- Switch the list to Sobeys, whose route is different.
do $$
declare
  v_produce uuid; v_dairy uuid; v_meat uuid; v_bakery uuid;
begin
  update public.shopping_lists set store_id = test.id('sobeys') where id = test.id('list_id');

  select id into v_produce from public.store_sections where store_id=test.id('sobeys') and name='Produce';
  select id into v_dairy   from public.store_sections where store_id=test.id('sobeys') and name='Dairy';
  select id into v_meat    from public.store_sections where store_id=test.id('sobeys') and name='Meat';
  select id into v_bakery  from public.store_sections where store_id=test.id('sobeys') and name='Bakery';

  update public.list_items set store_section_id = v_dairy   where name = 'Milk'           and list_id=test.id('list_id');
  update public.list_items set store_section_id = v_produce where name = 'Bananas'        and list_id=test.id('list_id');
  update public.list_items set store_section_id = v_meat    where name = 'Chicken Thighs' and list_id=test.id('list_id');
  update public.list_items set store_section_id = v_bakery  where name = 'Sourdough'      and list_id=test.id('list_id');

  perform test._assert(
    (select string_agg(li.name, ',' order by coalesce(ss.sort_order, 2147483647), li.created_at)
       from public.list_items li
       left join public.store_sections ss on ss.id = li.store_section_id
      where li.list_id = test.id('list_id'))
    = 'Sourdough,Bananas,Milk,Chicken Thighs',
    'the same items re-sort for the Sobeys route (Bakery>Produce>Dairy>Meat)');
end $$;

-- Put the list back on the Superstore route for the remaining tests.
update public.shopping_lists set store_id = test.id('superstore') where id = test.id('list_id');
do $$
declare v_id uuid;
begin
  for v_id in select id from public.list_items where list_id = test.id('list_id') loop
    update public.list_items li
       set store_section_id = ss.id
      from public.store_sections ss, public.store_sections old
     where li.id = v_id
       and old.id = li.store_section_id
       and ss.store_id = test.id('superstore')
       and ss.name = old.name;
  end loop;
end $$;

-- checked_at is maintained by the database, not by the client.
do $$
declare v_milk uuid;
begin
  select id into v_milk from public.list_items where list_id=test.id('list_id') and name='Milk';
  update public.list_items set checked = true where id = v_milk;
  perform test._assert(
    (select checked_at is not null from public.list_items where id = v_milk),
    'checking an item stamps checked_at');
  update public.list_items set checked = false where id = v_milk;
  perform test._assert(
    (select checked_at is null from public.list_items where id = v_milk),
    'unchecking an item clears checked_at');
end $$;

-- =============================================================================
-- 5. Row Level Security — the part that actually protects the data
-- =============================================================================
\echo ''
\echo '--- 5. row level security ------------------------------------------------'

-- 5a. Signed out.
reset role;
set role anon;
set request.jwt.claim.sub = '';

do $$ begin
  begin
    perform count(*) from public.list_items;
    raise exception 'FAILED: anon could query list_items';
  exception when insufficient_privilege then
    perform test._assert(true, 'anon has no privilege on list_items at all');
  end;
  begin
    perform count(*) from public.shopping_lists;
    raise exception 'FAILED: anon could query shopping_lists';
  exception when insufficient_privilege then
    perform test._assert(true, 'anon has no privilege on shopping_lists');
  end;
  begin
    perform public.create_household('Sneaky');
    raise exception 'FAILED: anon could call create_household';
  exception when insufficient_privilege then
    perform test._assert(true, 'anon cannot execute create_household()');
  end;
end $$;

-- 5b. An unrelated authenticated user.
reset role;
set role authenticated;
set request.jwt.claim.sub = :'mallory';

do $$ begin
  perform test._assert((select count(*) = 0 from public.shopping_lists),
    'mallory cannot SELECT another household''s lists');
  perform test._assert((select count(*) = 0 from public.list_items),
    'mallory cannot SELECT another household''s items');
  perform test._assert((select count(*) = 0 from public.stores),
    'mallory cannot SELECT another household''s stores');
  perform test._assert((select count(*) = 0 from public.store_sections),
    'mallory cannot SELECT another household''s store sections');
end $$;

-- She knows the UUIDs (say, from a screenshot). They still do not help.
do $$
declare n integer;
begin
  perform test._assert(
    (select count(*) = 0 from public.list_items where list_id = test.id('list_id')),
    'knowing the list UUID does not reveal its items');

  -- UPDATE: no rows match the USING clause, so nothing changes.
  update public.list_items set name = 'hacked' where list_id = test.id('list_id');
  get diagnostics n = row_count;
  perform test._assert(n = 0, 'mallory''s UPDATE against a foreign list affects 0 rows');

  delete from public.list_items where list_id = test.id('list_id');
  get diagnostics n = row_count;
  perform test._assert(n = 0, 'mallory''s DELETE against a foreign list affects 0 rows');

  delete from public.shopping_lists where id = test.id('list_id');
  get diagnostics n = row_count;
  perform test._assert(n = 0, 'mallory cannot DELETE a foreign list');
end $$;

-- 5c. Forging household_id on INSERT — the devtools attack.
do $$ begin
  begin
    insert into public.shopping_lists (household_id, name)
    values (test.id('hh'), 'Injected list');
    raise exception 'FAILED: mallory inserted a list into a foreign household';
  exception when insufficient_privilege then
    perform test._assert(true,
      'INSERT with a forged household_id is rejected by WITH CHECK');
  end;

  begin
    insert into public.list_items (list_id, household_id, name)
    values (test.id('list_id'), test.id('hh'), 'Injected item');
    raise exception 'FAILED: mallory inserted an item into a foreign list';
  exception when insufficient_privilege then
    perform test._assert(true, 'INSERT of an item into a foreign list is rejected');
  end;

  begin
    perform public.add_items_to_list(test.id('list_id'),
      jsonb_build_array(jsonb_build_object('name','Injected')));
    raise exception 'FAILED: mallory added items through the RPC';
  exception when insufficient_privilege then
    perform test._assert(true,
      'add_items_to_list() is SECURITY INVOKER, so RLS blocks mallory too');
  end;

  begin
    perform public.complete_shopping_trip(test.id('list_id'));
    raise exception 'FAILED: mallory completed a foreign trip';
  exception when insufficient_privilege then
    perform test._assert(true, 'complete_shopping_trip() is blocked for mallory');
  end;
end $$;

-- 5d. Escalation attempt: add yourself to somebody else's household.
do $$ begin
  begin
    insert into public.household_members (household_id, user_id, role)
    values (test.id('hh'), auth.uid(), 'owner');
    raise exception 'FAILED: mallory added herself to a household';
  exception when insufficient_privilege then
    perform test._assert(true,
      'there is no INSERT policy on household_members, so self-enrolment fails');
  end;
end $$;

-- 5e. Moving a row you *can* see into another household.
reset role; set role authenticated; set request.jwt.claim.sub = :'alice';
select public.create_household('Alice Side Project') as hh2 \gset
select test.put('hh2', :'hh2') as _ \gset

do $$ begin
  begin
    update public.shopping_lists set household_id = test.id('hh2')
     where id = test.id('list_id');
    raise exception 'FAILED: a list was moved between households';
  exception when check_violation then
    perform test._assert(true,
      'household_id is immutable even between two households you belong to');
  end;
end $$;

-- 5f. Both members see the same data.
reset role; set role authenticated; set request.jwt.claim.sub = :'bob';
do $$ begin
  perform test._assert((select count(*) = 4 from public.list_items
                           where list_id = test.id('list_id')),
    'bob sees the same four items alice added');
  update public.list_items set checked = true
   where list_id = test.id('list_id') and name = 'Bananas';
  perform test._assert(
    (select checked from public.list_items
      where list_id=test.id('list_id') and name='Bananas'),
    'bob can check an item alice created');
end $$;

-- =============================================================================
-- 6. Referential integrity — the Firebase bugs that the schema now prevents
-- =============================================================================
\echo ''
\echo '--- 6. cascades & referential integrity ----------------------------------'

reset role; set role authenticated; set request.jwt.claim.sub = :'alice';

-- 6a. Deleting a section leaves its items alone (they just become unsorted).
do $$
declare
  v_section uuid;
  v_before integer;
begin
  select store_section_id into v_section from public.list_items
   where list_id = test.id('list_id') and name = 'Bananas';
  select count(*) into v_before from public.list_items where list_id = test.id('list_id');

  delete from public.store_sections where id = v_section;

  perform test._assert(
    (select count(*) from public.list_items where list_id = test.id('list_id')) = v_before,
    'deleting a store section does not delete the groceries in it');
  perform test._assert(
    (select store_section_id is null from public.list_items
      where list_id = test.id('list_id') and name = 'Bananas'),
    'items in a deleted section become unsorted, not orphaned');
end $$;

-- 6b. Deleting a store un-assigns it from lists and removes its sections.
do $$
declare v_id uuid;
begin
  select public.create_store_with_sections(test.id('hh'), 'Temp Store', null,
                                           array['A','B']) into v_id;
  insert into public.shopping_lists (household_id, name, store_id)
  values (test.id('hh'), 'Temp List', v_id);

  delete from public.stores where id = v_id;

  perform test._assert(
    (select count(*) = 0 from public.store_sections where store_id = v_id),
    'deleting a store cascades to its sections');
  perform test._assert(
    (select store_id is null from public.shopping_lists where name = 'Temp List'),
    'deleting a store un-assigns it from lists instead of deleting them');

  delete from public.shopping_lists where name = 'Temp List';
end $$;

-- 6c. Deleting a list deletes its items. This is the bug the Firebase version
--     had: it removed the list document and left the items subcollection behind.
do $$
declare
  v_list uuid;
begin
  insert into public.shopping_lists (household_id, name)
  values (test.id('hh'), 'Throwaway') returning id into v_list;
  perform public.add_items_to_list(v_list, jsonb_build_array(
    jsonb_build_object('name','One'), jsonb_build_object('name','Two')));

  perform test._assert(
    (select count(*) = 2 from public.list_items where list_id = v_list),
    'the throwaway list has two items');

  delete from public.shopping_lists where id = v_list;

  perform test._assert(
    (select count(*) = 0 from public.list_items where list_id = v_list),
    'deleting a list cascades to its items — no orphans');
end $$;

-- 6d. A household must always keep an owner.
do $$ begin
  begin
    delete from public.household_members
     where household_id = test.id('hh') and user_id = auth.uid();
    raise exception 'FAILED: the last owner was removed';
  exception when check_violation then
    perform test._assert(true, 'the last owner of a household cannot be removed');
  end;
end $$;

-- =============================================================================
-- 7. Completing a trip, history and the product catalog
-- =============================================================================
\echo ''
\echo '--- 7. trips, history & catalog ------------------------------------------'

-- Bananas is already checked (bob did it). Check Milk too, leave the rest.
update public.list_items set checked = true
 where list_id = test.id('list_id') and name in ('Milk');

select public.complete_shopping_trip(test.id('list_id')) as trip \gset
select test.put('trip', :'trip') as _ \gset

do $$ begin
  perform test._assert(
    (select count(*) = 2 from public.list_items where list_id = test.id('list_id')),
    'unchecked items stay on the list after a trip');
  perform test._assert(
    (select count(*) = 0 from public.list_items
      where list_id = test.id('list_id') and checked),
    'checked items leave the active list');
  perform test._assert(
    (select item_count = 2 from public.shopping_trips where id = test.id('trip')),
    'the trip records two purchased items');
  perform test._assert(
    (select list_name = 'Weekly Groceries' from public.shopping_trips where id = test.id('trip')),
    'the trip snapshots the list name');
  perform test._assert(
    (select store_name like 'Atlantic Superstore%' from public.shopping_trips where id = test.id('trip')),
    'the trip snapshots the store name');
  perform test._assert(
    (select count(*) = 2 from public.shopping_trip_items where trip_id = test.id('trip')),
    'the purchased items are readable in history');
  perform test._assert(
    (select quantity = '2 L' from public.shopping_trip_items
      where trip_id = test.id('trip') and name = 'Milk'),
    'history keeps the quantity that was bought');
end $$;

-- The catalog is what will power autocomplete and "frequently bought".
do $$ begin
  perform test._assert(
    (select count(*) = 2 from public.household_items where household_id = test.id('hh')),
    'both purchased items entered the household catalog');
  perform test._assert(
    (select times_purchased = 1 from public.household_items
      where household_id = test.id('hh') and normalized_name = 'milk'),
    'Milk has been purchased once');
  perform test._assert(
    (select normalized_name = 'milk' from public.household_items
      where household_id = test.id('hh') and display_name = 'Milk'),
    'normalized_name is generated from display_name');
end $$;

-- "Add again" from history, then a second trip, to prove the counter climbs and
-- that remembered defaults are applied.
do $$
declare r jsonb;
begin
  select public.add_items_to_list(test.id('list_id'),
    jsonb_build_array(jsonb_build_object('name','milk'))) into r;
  perform test._assert((r ->> 'added')::int = 1, 'Milk can be added again from history');
  perform test._assert(
    (select quantity = '2 L' from public.list_items
      where list_id = test.id('list_id') and name = 'milk'),
    'the remembered default quantity is applied on re-add');

  update public.list_items set checked = true
   where list_id = test.id('list_id') and name = 'milk';
  perform public.complete_shopping_trip(test.id('list_id'));

  perform test._assert(
    (select times_purchased = 2 from public.household_items
      where household_id = test.id('hh') and normalized_name = 'milk'),
    'the catalog counter increments on the second purchase');
  perform test._assert(
    (select count(*) = 2 from public.shopping_trips where household_id = test.id('hh')),
    'both trips are in history');
end $$;

-- Completing with nothing checked is refused with a message the UI can match on.
do $$ begin
  begin
    perform public.complete_shopping_trip(test.id('list_id'));
    raise exception 'FAILED: an empty trip was completed';
  exception when invalid_parameter_value then
    perform test._assert(sqlerrm = 'NO_CHECKED_ITEMS',
      'completing a trip with nothing checked raises NO_CHECKED_ITEMS');
  end;
end $$;

-- History survives the list being deleted.
do $$ begin
  delete from public.shopping_lists where id = test.id('list_id');
  perform test._assert(
    (select count(*) = 2 from public.shopping_trips where household_id = test.id('hh')),
    'deleting the list does not delete its shopping history');
  perform test._assert(
    (select shopping_list_id is null from public.shopping_trips where id = test.id('trip')),
    'the trip keeps its snapshot and drops the dangling list reference');
  perform test._assert(
    (select count(*) = 2 from public.shopping_trip_items where trip_id = test.id('trip')),
    'the purchased items are still browsable');
end $$;

-- =============================================================================
-- 8. Realtime configuration
-- =============================================================================
\echo ''
\echo '--- 8. realtime ----------------------------------------------------------'

reset role;
do $$
declare
  t text;
begin
  foreach t in array array['shopping_lists','list_items','stores','store_sections',
                           'shopping_trips','household_items','household_members']
  loop
    perform test._assert(
      exists (select 1 from pg_publication_tables
               where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = t),
      format('%s is published to supabase_realtime', t));
    perform test._assert(
      (select relreplident from pg_class
        where oid = format('public.%I', t)::regclass) = 'f',
      format('%s has REPLICA IDENTITY FULL (so DELETEs carry household_id)', t));
  end loop;
end $$;

-- =============================================================================
-- 9. Nothing is world-readable
-- =============================================================================
\echo ''
\echo '--- 9. privilege audit ---------------------------------------------------'

do $$
declare
  v_leaks text;
begin
  select string_agg(format('%s.%s -> %s', table_schema, table_name, privilege_type), ', ')
    into v_leaks
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public';
  perform test._assert(v_leaks is null,
    format('anon holds no privileges on any public table (found: %s)', coalesce(v_leaks, 'none')));

  select string_agg(c.relname, ', ') into v_leaks
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  perform test._assert(v_leaks is null,
    format('RLS is enabled on every public table (missing: %s)', coalesce(v_leaks, 'none')));

  -- PostgREST exposes every function in `public` as an RPC endpoint, and
  -- PostgreSQL grants EXECUTE to PUBLIC by default. Supabase's linter caught
  -- `touch_parent_list` being reachable at /rest/v1/rpc/ by a signed-out
  -- caller because 0006 only revoked the default for the ten functions the app
  -- calls. 0008 closed it; this keeps it closed.
  select string_agg(p.proname, ', ') into v_leaks
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  perform test._assert(v_leaks is null,
    format('anon cannot execute any function in public (found: %s)', coalesce(v_leaks, 'none')));

  -- Trigger functions are for the trigger machinery, never for callers.
  select string_agg(p.proname, ', ') into v_leaks
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prorettype = 'trigger'::regtype
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  perform test._assert(v_leaks is null,
    format('no trigger function is callable as an RPC (found: %s)', coalesce(v_leaks, 'none')));
end $$;

drop function test._assert(boolean, text);
drop schema test cascade;

\echo ''
