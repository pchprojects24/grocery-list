#!/usr/bin/env bash
# Runs every test suite in the repository.
#
#   tests/run_all.sh
#
# Suites:
#   run_db_tests.sh  — real PostgreSQL: schema, RLS, cascades, RPC behaviour
#   browser/run.mjs  — real app in headless Chromium at an iPhone viewport
#   sw/run.mjs       — service worker: deploys land, offline shell still opens
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=============================================================="
echo " Database + Row Level Security"
echo "=============================================================="
tests/run_db_tests.sh

echo
echo "=============================================================="
echo " Application (headless Chromium)"
echo "=============================================================="
node tests/browser/run.mjs

echo
echo "=============================================================="
echo " Service worker"
echo "=============================================================="
node tests/sw/run.mjs

echo
echo "=============================================================="
echo " Every suite passed."
echo "=============================================================="
