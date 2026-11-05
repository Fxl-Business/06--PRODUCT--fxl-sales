#!/usr/bin/env bash
# The project's gate: install, lint, types, the unit suite and the pre-commit perf audit.
# Integration tests (`pnpm --filter @fxl-sales/api test:integration`) need the local Docker DB and
# are left out, as this script starts no service.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
echo "gate: install"; CI=true pnpm install --frozen-lockfile --prefer-offline >/dev/null
[ -f apps/api/.env ] || cp apps/api/.env.dev.example apps/api/.env
echo "gate: lint";    pnpm run lint
echo "gate: types";   pnpm run type-check
echo "gate: tests";   pnpm test
echo "gate: perf";    pnpm run perf:audit
