#!/usr/bin/env bash
# Type-check every Supabase Edge Function entrypoint and shared module.
set -euo pipefail

cd "$(dirname "$0")/.."

files=$(find supabase/functions -name '*.ts' ! -name '*.test.ts' | sort)
if [ -z "$files" ]; then
  echo "No edge function sources found."
  exit 0
fi

echo "deno check:"
echo "$files" | sed 's/^/  - /'
# shellcheck disable=SC2086
deno check $files
