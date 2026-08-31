#!/usr/bin/env bash
# =============================================================================
# Young Lists — database + Row Level Security test suite
# =============================================================================
# Spins up a throwaway local PostgreSQL cluster, installs a minimal stand-in for
# the parts of Supabase the schema depends on (the `auth` schema, the
# anon/authenticated roles, the supabase_realtime publication), applies the real
# migrations from supabase/migrations unmodified, and then runs
# supabase/tests/rls_tests.sql as several different users.
#
# The point is to prove the *database* rejects unauthorized access, rather than
# trusting that the UI hides the buttons.
#
# Usage:  tests/run_db_tests.sh
# Requires: a local PostgreSQL server installation (initdb/pg_ctl/psql).
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
PGDATA="${PGDATA:-/var/tmp/yl-pgdata}"
PGPORT="${PGPORT:-55432}"
SOCKET_DIR="${SOCKET_DIR:-/var/tmp}"
DBNAME=yl_test

export PATH="$PGBIN:$PATH"
export PGHOST="$SOCKET_DIR" PGPORT PGUSER=postgres

start_cluster() {
  if pg_isready -q 2>/dev/null; then
    echo "→ using PostgreSQL already listening on port $PGPORT"
    return
  fi
  echo "→ initialising throwaway cluster in $PGDATA"
  rm -rf "$PGDATA"; mkdir -p "$PGDATA"

  # PostgreSQL refuses to run as root.
  local runas=""
  if [ "$(id -u)" -eq 0 ]; then
    id -u pgtest >/dev/null 2>&1 || useradd -m pgtest
    chown pgtest "$PGDATA"; chmod 700 "$PGDATA"
    runas="pgtest"
  fi
  local run="bash -c"
  [ -n "$runas" ] && run="su $runas -c"

  $run "PATH=$PGBIN:\$PATH initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
  # wal_level=logical mirrors Supabase, so the realtime publication is exercised.
  $run "PATH=$PGBIN:\$PATH pg_ctl -D $PGDATA -l $PGDATA/server.log \
        -o '-p $PGPORT -k $SOCKET_DIR -c wal_level=logical' -w start" >/dev/null
}

start_cluster

echo "→ recreating database $DBNAME"
psql -q -v ON_ERROR_STOP=1 -d postgres \
  -c "drop database if exists $DBNAME;" -c "create database $DBNAME;"

export PGDATABASE="$DBNAME"

echo "→ installing local Supabase stand-in"
psql -q -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/tests/00_local_supabase_stub.sql"

echo "→ applying migrations"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  printf '   %s\n' "$(basename "$f")"
  psql -q -v ON_ERROR_STOP=1 -f "$f"
done

echo "→ running RLS + behaviour tests"
psql -v ON_ERROR_STOP=1 -f "$REPO_ROOT/supabase/tests/rls_tests.sql"

echo
echo "ALL DATABASE TESTS PASSED"
