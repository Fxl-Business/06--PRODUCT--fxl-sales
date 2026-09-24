# Verify report - 01-make-run-selector

Worktree: `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260924T005511Z-make-run-selector`
Branch: `fix/make-run-selector`, one commit `bc1566a` on top of `master`.
Machine make: GNU Make 3.81. Shell for recipes: `/bin/sh` -> bash 3.2.57 (macOS default).

## 1. Diff review

`git diff master...HEAD --stat`:
```
Makefile                                                               | 23 +++++++++++-------
nexo/plans/quick-20260924-make-run-selector/01-make-run-selector.md    | 28 ++++++++++++++++++++++
scripts/__tests__/dev-localhost-only.test.mjs                          | 28 ++++++++++++++++++----
```

Makefile change:
- `.DEFAULT_GOAL` moved from `help` back to `dev`.
- `dev:` recipe menu now offers `1) api`, `2) web`, `3) dev-fake`, `4) back-fake`, `5) front-fake`, prompt `Selection [1-5]:`.
- `case "$$choice"` dispatches `1) $(MAKE) back`, `2) $(MAKE) front`, `3) $(MAKE) dev-fake`, `4) $(MAKE) back-fake`, `5) $(MAKE) front-fake`, `*) echo "Invalid choice: $$choice"; exit 1`.
- Checked against the real targets further down the file: `back` runs `build-shared` then `pnpm --filter @fxl-sales/api dev` (api, port 3006); `front` runs `pnpm --filter @fxl-sales/web dev` (web, port 8006); `dev-fake` runs both concurrently with `SALES_AUTH_FAKE=1`/`VITE_AUTH_FAKE=1`, no Hub; `back-fake` and `front-fake` run one side each with the fake flag. Every number maps to the target the comment and menu line claim.
- `dev-fake-setup` is NOT in the menu (confirmed absent from both the printf lines and the case arms) - matches "human's choice, deliberately excluded."
- `stg` target (staging selector) is untouched, still a separate opt-in-by-name target; no staging string appears anywhere in the `dev` recipe.
- `help:` target comment changed from "Show this help (the default goal)" to "Show this help" - accurate now that `dev` is the default goal again.
- Top-of-file comment above `.DEFAULT_GOAL` correctly describes the new behaviour and the staging exclusion.
- Shell syntax (`@read choice; \` + `case ... esac`) is the same pattern already used by the pre-existing `stg` target one section down, so it is proven idiomatic for this repo's toolchain (BSD/GNU make 3.81 + macOS `/bin/sh`/bash). No GNU-only or POSIX-incompatible constructs introduced.
- `.PHONY` list unchanged and still correct (all targets referenced were already phony).

Test file change (`scripts/__tests__/dev-localhost-only.test.mjs`):
- Old single test "a bare `make` prints every target" replaced by two tests: one asserting the bare-`make` menu (regex-extracts `N) name` lines from stdout, asserts exact 5-item list in order, asserts the `Selection [1-5]:` prompt, and asserts `stg|staging` does NOT appear anywhere in stdout) and one asserting `make help` (invoked explicitly as `make help`, not bare) still lists every `##`-documented target including `dev-fake`, `back-fake`, `front-fake`, `dev-fake-setup`.
- The bare-`make` test passes `input: ''` (empty stdin) so `read choice` hits EOF, the case falls to `*)`, and the process exits non-zero without invoking any real sub-target - correct and side-effect-free.
- Docstring at the top of the file updated to describe the new bare-`make` behaviour accurately.

No defects found in the diff.

## 2. Named oracle - non-vacuity proof

`node --test scripts/__tests__/dev-localhost-only.test.mjs` (clean tree): **6/6 pass**, exit 0.

```
# tests 6
# pass 6
# fail 0
```

Non-vacuity, mutation A (drop the `5) front-fake` **menu printf line** only, leaving the case dispatch untouched):
- Re-ran the suite: test 5 ("a bare `make` opens the numbered selector...") went **RED** - `not ok 5`, diff shows missing `['5','front-fake']` entry.
- Full run: exit 1, `# pass 5 / # fail 1`.

Non-vacuity, mutation B (`.DEFAULT_GOAL := dev` -> `.DEFAULT_GOAL := help`):
- Full run: exit 1, `# pass 5 / # fail 1` (same test goes red, since `make` now shows the grouped help listing instead of the 5-item selector).

Both mutations independently proved the oracle is not vacuous. Restored with `git checkout -- Makefile` after each; `git status --short` was empty (clean) afterward, confirmed by `git diff --stat` showing no output. Re-ran the oracle post-restore: 6/6 pass again.

## 3. E2E dry run (`make -n`, no real servers started)

For each `n` in 1..5, `printf "$n\n" | make -n --no-print-directory` was run. Because the recipe's shell block references `$(MAKE)`, GNU Make executes that block for real even under `-n` (documented GNU Make behaviour for recursive `$(MAKE)` invocations) and then shows what the recursive sub-make would run:

| choice | resolved command tail |
|---|---|
| 1 | `pnpm --filter @fxl-sales/shared-types build`, `...shared-utils build`, `pnpm --filter @fxl-sales/api dev` (api) |
| 2 | `pnpm --filter @fxl-sales/web dev` (web) |
| 3 | build-shared, echo banner, `SALES_AUTH_FAKE=1 pnpm --filter @fxl-sales/api dev &` + `VITE_AUTH_FAKE=1 pnpm --filter @fxl-sales/web dev &` under `set -m` with a `trap ... kill -- -$api -$web` (dev-fake, both, no Hub) |
| 4 | build-shared, `SALES_AUTH_FAKE=1 pnpm --filter @fxl-sales/api dev` (back-fake) |
| 5 | `VITE_AUTH_FAKE=1 pnpm --filter @fxl-sales/web dev` (front-fake) |

All five match their claimed target exactly.

Invalid input:
- `printf "9\n" | make -n ...` -> prints `Invalid choice: 9`, `make: *** [dev] Error 1`, exit 2. No sub-target command was ever printed/run.
- `printf "\n" | make -n ...` (empty line) -> same refusal, exit 2.
- `make -n ... < /dev/null` (EOF, no input at all) -> same refusal, exit 2.

No real dev servers (`pnpm --filter ... dev` actually spawning a live process) were started during this step; only `-n`'s implicit recursive-make preview ran, which itself only prints commands.

## 4. Full gates (run-once)

The worktree had no `node_modules` anywhere (fresh worktree, never installed). Ran `pnpm install --frozen-lockfile` first (exit 0, lockfile up to date, 419 packages) - this is setup, not part of the slice's own correctness, noted for the record.

- `pnpm run lint` - **PASS**, exit 0. `apps/api` and `apps/web` eslint both `Done`; package stubs are no-ops by design.
- `pnpm run type-check` - **PASS**, exit 0. `build:packages` then `tsc --noEmit` across all 5 workspaces with type-check scripts, all `Done`.
- `pnpm test` (run-once, `vitest run`/`node --test`, no watch mode anywhere in the script) - **PASS**, exit 0 overall (confirmed by the chain's final `node scripts/build-contract.mjs` step printing `build-contract: ok`, which only runs if every earlier `&&`-chained step exited 0). The aggregated `node --test` step reported `# tests 55 / # pass 55 / # fail 0`.
  - Verified the KNOWN PRE-EXISTING gap directly: `package.json`'s `test` script lists `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs`, which does not exist in `scripts/__tests__/`. Reproduced in isolation: `node --test scripts/__tests__/dev-localhost-only.test.mjs scripts/__tests__/dev-identity-docs-reconciliation.test.mjs` exits 0 with no "Could not find" text anywhere in stdout/stderr and no test-count change - Node's test runner silently drops the nonexistent path from the file list. This is pre-existing (present before this slice's changes; this slice's only touch to the test file list is unrelated) and, per instructions, is noted but does not fail this slice.
- `pnpm run build` - **PASS**, exit 0. API `tsc && tsc-alias` clean, web Vite build clean (`✓ built in 1.82s`), and the build's own `[assert-web-bundle-clean]` check reported `clean: FXL_SALES_DEV_FAKE_ROSTER_SENTINEL is absent from apps/web/dist and still present under packages/auth-fake/src` (unrelated invariant, also healthy).

Integration tests (`pnpm --filter @fxl-sales/api test:integration`) were correctly judged out of scope per the task brief: the diff touches only `Makefile`, a test file for a Makefile behaviour, and a plan-record markdown - no API/DB code.

## 5. Cleanup

No real dev servers, watchers, or other long-running processes were started by this verify pass (only `make -n` dry-run previews and one-shot `pnpm run lint/type-check/test/build` invocations, all of which exited on their own). `ps aux` at the end shows no `fxl-sales` dev processes; the only `fxl-sales`-tagged process present is the orchestrator's own `agent-wait.sh` watcher, which this session did not start. `git status --short` is clean (working tree matches the single commit; `node_modules` is gitignored).

## Verdict

All gates green, oracle proven non-vacuous by two independent mutations, E2E dispatch table matches spec exactly for all 5 choices plus invalid/empty/EOF input, no staging leakage into the default selector, `dev-fake-setup` correctly absent from the menu, `make help` still lists everything. No defects found.
