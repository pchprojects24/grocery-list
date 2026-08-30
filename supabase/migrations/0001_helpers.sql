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
