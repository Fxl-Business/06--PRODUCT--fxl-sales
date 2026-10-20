#!/usr/bin/env bash
set -euo pipefail
pnpm run build:packages
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web lint
NODE_ENV=test CI=true pnpm --filter @fxl-sales/web test
