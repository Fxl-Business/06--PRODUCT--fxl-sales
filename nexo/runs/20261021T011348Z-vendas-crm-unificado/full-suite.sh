#!/usr/bin/env bash
# Trunk-entry gate for run vendas-crm-unificado: the wave gate plus the production build.
set -euo pipefail
MAIN=/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales
[ -f apps/api/.env ] || cp "$MAIN/apps/api/.env" apps/api/.env
pnpm install --frozen-lockfile --prefer-offline >/dev/null
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
pnpm --filter @fxl-sales/api test:integration
