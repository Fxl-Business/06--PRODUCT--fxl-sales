#!/usr/bin/env bash
# Wave gate for run importacao-funil.
set -euo pipefail
MAIN=/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales
[ -f apps/api/.env ] || cp "$MAIN/apps/api/.env" apps/api/.env
pnpm install --frozen-lockfile --prefer-offline >/dev/null
pnpm run lint
pnpm run type-check
CI=true pnpm test
pnpm --filter @fxl-sales/api test:integration
cp "/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20261123T111719Z-importacao-funil/run/nexo/runs/20261123T111719Z-importacao-funil/acceptance.api.config.mts" apps/api/.vitest.acceptance.config.mts
for p in tests/acceptance/*/; do
  d="$(basename "$p")"
  (cd apps/api && SLICE="$d" VITEST_INTEGRATION=1 npx vitest run --passWithNoTests -c .vitest.acceptance.config.mts && SLICE="$d" npx vitest run --passWithNoTests -c .vitest.acceptance.config.mts)
  if [ -f "$p/vitest.web.config.ts" ]; then apps/web/node_modules/.bin/vitest run --passWithNoTests -c "$p/vitest.web.config.ts"; fi
done
rm -f apps/api/.vitest.acceptance.config.mts
