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
