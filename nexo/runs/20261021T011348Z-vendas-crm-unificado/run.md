# Run 20261021T011348Z-vendas-crm-unificado - FXL Vendas: CRM unificado (v1)

Flow: `/nexo-feature --autopilot`, pace `economico`, trunk `master` (local only), request `.nexo/tmp/vendas-crm-prompt-v1.md`.
Token `6q75vnog`; run branch `nexo/20261021T011348Z-vendas-crm-unificado`; worktrees under `.worktrees/20261021T011348Z-vendas-crm-unificado/` (all kept, by order of the owner).
Decisions taken without the owner are in `AUDIT.md` (A1 to A10).

## Delivered to local master

| Phase | Slices | Trunk entry |
| --- | --- | --- |
| 0 | 01 brand FXL Vendas + technical-id guard; 02 etapas seeded on read (ECV bug); 03 default CRM pipeline constant + additive-migration guard; 03.1 review minors | 73a009a |
| 1 | 04 entity survey (separate Verify of every citation and risk); 05a ADR + schema + migration 0029 with RLS; 05b default pipeline, Cliente field, module vocabulary; 06 additive copy 0030 + migration oracle; 06.1 Codex fixes | c15a0ca |
| 2 | 07a API cutover to the unified tables (0031 copy + resync); 07b pipelines, Avançar, history, notes, follow-ups, period and dynamic filters; 08 one LeadForm; 09 lead summary page and follow-ups agenda; 10 Kanban per pipeline, period filter, Propostas routes; 10.1 Codex fixes | 60c57fd |
| 3 | 11 per-org modules in the database (capability gate, token backfill, operator-only toggle); 12 navigation by module; 12.1 Codex fixes + DB-clock `stage_changed_at` | 3dc3739 |

Not delivered: slice 13 (built, Verify FAIL on a missing test, no budget for the fix round; branch `feat/6q75vnog-13-dias-sem-comprar`), slice 14 (planned, not executed). See `AUDIT.md` A9 and A10.

## Effective model per role (read from `status.json` agent tags and the Codex logs)

| Role | Model | Evidence |
| --- | --- | --- |
| Orchestrator (host) | Opus 5.5 (`claude-opus-5-5`) | host session; root node of `status.json` |
| Planner | `sonnet` (Claude Sonnet 5.5; the API error of one planner names `claude-sonnet-5-5`) | 7 planner dispatches (`plan-fase*.result.json`), spawned with `model: sonnet` |
| Plan-checker | `sonnet` | 4 plan-check dispatches (`plan-check*.md`), spawned with `model: sonnet` |
| Executor | `haiku` | 19 executor legs tagged `--agent-model haiku` |
| Verify (Gate 2) | `sonnet`, always a different agent from the executor | 27 sonnet-tagged legs include every `verify-*` report |
| Reviewer | Codex CLI 0.161.0, `gpt-6-astra`, reasoning `high`, sandbox `read-only`, ChatGPT login (`codex login status`: "Logged in using ChatGPT"), never an API key | `agents/review-*/codex-log.txt` headers |
| Scribe | none dispatched (budget); capture written by the orchestrator | `AUDIT.md` A9 |

## Codex review per wave (all through the subscription)

| Wave/phase | Session | Rounds and verdicts |
| --- | --- | --- |
| Wave 1 (phase 0) | 01a15c28 | r1 APPROVED (2 minor, fixed by 03.1), r2 APPROVED, r3 APPROVED (0 findings) |
| Wave 2 (phase 1a, survey) | 01a15c37 | r1 APPROVED (2 minor, routed to the 05/06 planner) |
| Phase 1 (waves 3-5) | 01a15d65 | r1 CHANGES_REQUESTED (2 major), r2 CHANGES_REQUESTED (1 major), r3 APPROVED |
| Phase 2 (waves 6-10) | 01a15dd8 | r1 CHANGES_REQUESTED (5 major), r2 CHANGES_REQUESTED (1 major), r3 APPROVED |
| Phase 3 (waves 11-12) | 01a15e0c | r1 CHANGES_REQUESTED (1 major, 2 minor), r2 APPROVED |

## Gate 2 and wave gates

- Baseline before the run: unit 3493 (auth-fake 48, shared-utils 174, api 1482, web 1789), guards 91, integration 404.
- Wave 1: unit 3538, guards 111, integration 414.
- Phase 1: unit 3576, guards 112, integration 485.
- Phase 2: unit 3741, guards 112, integration 527 (531 after 10.1).
- Phase 3: unit 3810 (api 1603, web 1961, shared-utils 198, auth-fake 48), guards 112, integration 549; the run exposed and fixed a clock flake (`stage_changed_at` now uses the database `now()`).
- Every trunk entry ran `full-suite.sh` (lint, type-check, unit + guards, production build, API integration) on the exact merge tree and landed green.
- Verify attempts that failed and were fixed: 07a (audit_log leak), 07b (lock-order case did not bite), 08 (lost coverage), 09 (Escape/undo coverage, stale docs), 12.1 (contract test pinned old text), 06.1 and 10.1 needed second Codex rounds.
- Feature-boundary mutation run: not dispatched (budget); every slice Verify ran its own mutation probes (recorded in each `agents/verify-*.md`).

## Budget

`agent_dispatches` 64/64, `replans` 3/3, `total_slices` 20/24, no wave recovery.
Pace note: `economico` built the three wave-1 slices concurrently in their own worktrees (A6).
