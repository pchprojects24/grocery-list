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
