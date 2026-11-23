#!/usr/bin/env bash
# fxl-doctor.sh — FXL contract health check
# Runs in CI (.github/workflows/ci.yml) and locally via `make doctor`.
#
# Exits non-zero if any of the following fail:
# - pnpm install completes cleanly
# - All workspaces type-check
# - All workspaces lint
# - Required FXL contract files exist at expected paths
set -euo pipefail

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
blue() { printf '\033[34m%s\033[0m\n' "$*"; }

fail=0

check() {
  local label=$1
  shift
  blue "==> $label"
  if "$@"; then
    green "    ok"
  else
    red "    FAIL"
    fail=1
  fi
}

require_file() {
  if [[ ! -f $1 ]]; then
    red "Missing required file: $1"
    fail=1
  fi
}

blue "FXL doctor — checking contract integrity"
echo

# --- Contract files ---
require_file package.json
require_file pnpm-workspace.yaml
require_file tsconfig.base.json
require_file Makefile
require_file CLAUDE.md
require_file nexo/state.json
require_file fxl-doctor.sh

# --- fxlContractVersion present ---
if ! grep -q '"fxlContractVersion"' package.json; then
  red 'Root package.json missing "fxlContractVersion"'
  fail=1
fi

# --- Install ---
check "pnpm install" pnpm install --frozen-lockfile=false

# --- Type-check ---
check "pnpm run type-check" pnpm run type-check

# --- Lint ---
check "pnpm -r lint" pnpm -r --if-present lint

if [[ $fail -ne 0 ]]; then
  red "doctor: FAIL"
  exit 1
fi

green "doctor: OK"
