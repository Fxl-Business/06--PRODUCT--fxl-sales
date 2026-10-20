#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web lint
CI=true pnpm --filter @fxl-sales/web test
