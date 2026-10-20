#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
pnpm run type-check
pnpm run lint
CI=true pnpm test
