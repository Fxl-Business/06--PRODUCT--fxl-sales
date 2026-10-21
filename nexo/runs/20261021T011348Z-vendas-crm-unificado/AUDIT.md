# AUDIT - 20261021T011348Z-vendas-crm-unificado

Autopilot run; every gray-area decision and blocker taken without the owner is recorded here.

## A1 - Nexo agents gate unreadable (configuration)

`nexo-agent.py enabled` exits 2: `configuration global agents.json: unknown top-level key: "claudeProfiles"`.
The flow says an invalid agent policy is audited and no fallback team is dispatched through `nexo-agent.py`.
The request (section 3) anticipates this case: when `agents.enabled` is not on, the reviewer role runs with `codex exec -m gpt-6-astra` and reasoning `high`, read-only, in the worktree.
Decision: the legacy Verify (Gate 2) path runs with a separate Sonnet agent, and the Codex review runs through `codex exec -m gpt-6-astra -c model_reasoning_effort=high --sandbox read-only`, authenticated by the ChatGPT login (`codex login status`: "Logged in using ChatGPT", smoke test session `01a15c05-4c00-7570-84ef-fbc3c025ffb6`).
The global `agents.json` was not edited (outside this repo).

## A2 - Per-phase trunk entry

The request requires each phase to be green on local `master` before the next one starts, while the Nexo feature flow enters the trunk once.
Decision: each phase enters local `master` through `nexo-trunk-merge.sh` (merge `--no-ff` of the run branch, `full-suite.sh` on the exact merge tree, fast-forward only), so the run branch enters the trunk once per phase.
No push, no staging, no production.

## A3 - Just-in-time planning of phases 1b to 4

The request forbids any data model before the entity survey passes its separate Verify, so slices 05 to 14 cannot be planned before slice 04 lands.
Decision: all 14 slices are registered at Frame; slices 01 to 04 are planned now; slices 05 to 14 are planned after the survey Verify, consuming one `replans` unit.

## A4 - Docker daemon

The local Docker daemon (OrbStack) was not running; it was started to run the integration suite, and the container `06--product--fxl-sales-db-1` was started (it was stopped).
Both are local; no remote database was touched.

## A5 - Plan-check round 1 fixes applied by the orchestrator

Plan-check (Sonnet) returned FAIL with one major defect: slice 04's oracle used `--git-base`, which reports untracked run records as changes.
The fix was mechanical, so the orchestrator applied it to the plan text (one `replans` unit): the oracle runs without `--git-base`, and a separate `git status`/`git diff` outside `nexo/runs` proves no product file changed; 04 now depends on 01, 02 and 03; slice 02's test 6 parses its input through `LeadStageSchema`.
The two stale "zero etapas" comments (`seed-dev.ts:298`, `lead-service.ts:1090`) stay as they are for now (comments only).
Gate 1 skipped (autopilot), recorded in `nexo/state.json` at Capture.

## A6 - Parallel builds inside a wave

Pace `economico` builds serially; the wave-1 slices have disjoint `files_modified`, so they are built concurrently in their own worktrees to save wall-clock time.
Merges into the run branch stay serial, and only one slice runs Postgres integration tests at a time.
