#!/usr/bin/env bash
# Wave gate for run vendas-crm-unificado: lint, type-check, unit + guards, API integration (local Docker DB only).
set -euo pipefail
MAIN=/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales
[ -f apps/api/.env ] || cp "$MAIN/apps/api/.env" apps/api/.env
pnpm install --frozen-lockfile --prefer-offline >/dev/null
pnpm run lint
pnpm run type-check
pnpm test
pnpm --filter @fxl-sales/api test:integration
