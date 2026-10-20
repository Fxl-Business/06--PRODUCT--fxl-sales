#!/usr/bin/env bash
set -euo pipefail
pnpm install --frozen-lockfile --offline
pnpm run type-check
pnpm run lint
NODE_ENV=test CI=true pnpm test
