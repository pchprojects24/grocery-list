#!/usr/bin/env bash
# Regenerates supabase/schema.sql from the migration files.
# schema.sql is a convenience for pasting the whole thing into the Supabase SQL
# editor in one go; supabase/migrations/*.sql remains the source of truth.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
{
  echo "-- ============================================================================="
  echo "-- Young Lists — complete database schema"
  echo "--"
  echo "-- GENERATED FILE — do not edit. Run supabase/build_schema.sh after changing"
  echo "-- anything in supabase/migrations/. Concatenated in filename order; safe to"
  echo "-- run more than once."
  echo "-- ============================================================================="
  echo
  for f in migrations/*.sql; do
    echo
    echo "-- >>> $f"
    cat "$f"
  done
} > schema.sql
echo "wrote $(wc -l < schema.sql) lines to supabase/schema.sql"
