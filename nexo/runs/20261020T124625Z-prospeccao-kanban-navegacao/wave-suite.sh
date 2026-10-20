#!/usr/bin/env bash
set -euo pipefail
pnpm run build:packages
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api lint
NODE_ENV=test CI=true pnpm --filter @fxl-sales/api test
NODE_ENV=test VITEST_INTEGRATION=1 CI=true pnpm --filter @fxl-sales/api exec vitest run test/rls/leads-lixeira.test.ts
