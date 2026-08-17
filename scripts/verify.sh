#!/usr/bin/env bash
# Full production verification: clean install, lint, typecheck, build, tests.
set -euo pipefail
cd "$(dirname "$0")/.."

npm ci
npm run lint
npm run typecheck
npm run build
npm test
bash scripts/deno-check.sh
deno test --allow-all --no-check supabase/functions/
echo "All verification steps passed."
