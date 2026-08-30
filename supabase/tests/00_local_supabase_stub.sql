-- =============================================================================
-- LOCAL TEST HARNESS ONLY — do NOT run this against a real Supabase project.
-- =============================================================================
-- Supabase provides the `auth` schema, the `anon`/`authenticated`/`service_role`
-- roles and the `supabase_realtime` publication out of the box. A stock
-- PostgreSQL server does not, so this file recreates just enough of them for
-- tests/run_db_tests.sh to run the real migrations unmodified.
--
-- auth.uid() below is the same shape Supabase uses: it reads the `sub` claim of
-- the verified JWT out of a per-transaction setting. In tests we set that
-- setting directly to impersonate a user.
-- =============================================================================

create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth   to anon, authenticated, service_role;

-- Minimal stand-in for auth.users. Only the id column is referenced by the app
-- schema; email is here so tests read more clearly.
create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;

-- Supabase ships this publication; 0006_realtime.sql adds tables to it.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;
