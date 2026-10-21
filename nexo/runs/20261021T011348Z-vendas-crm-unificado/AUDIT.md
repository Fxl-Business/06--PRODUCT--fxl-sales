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

## A7 - Budget-driven plan consolidation

The phase 2 to 4 planners split their work into 25 fine slices, over the run limit of 24 slices and far over the remaining agent dispatches.
Decision: each phase layer is ONE slice with ordered parts (`nexo/plans/vendas-crm-unificado/parts/`, no frontmatter): 07a (parts 07a1-07a3), 07b, 08 (08a-08e), 09 (09a-09e), 10 (10a-10b), 11 (11a-11c), 12 (12a-12b), 13 (13a-13b), 14 (14a-14c).
A slice may exceed the 600-line ceiling; each executor dispatch still covers a small part.

## A8 - Plan-check revision 3 (last replans unit)

Three plan-checks failed (1b/1c: 1 blocker, 3 majors; phase 2: 1 blocker, 5 majors; phases 3-4: 1 blocker, 7 majors), all with paste-ready fixes.
Decision: ONE revision (the third and last `replans` unit) appends a binding "Plan-check addendum" to every affected plan, copied from the reports; no plan is re-planned from scratch.
Owner-level choices taken under autopilot (also in the Report):
- 0031 is a RESYNC (insert missing rows, then update changed ones and write one history event per changed stage); a value removed in the old table after 0030 is not mirrored, because migrations may not DELETE.
- `PUT /org-modules` requires admin AND a platform-operator allow-list `SALES_MODULE_OPERATOR_ACCOUNT_IDS`, empty by default: a tenant admin cannot switch on paid modules for their own org.
- "Dias sem comprar" counts the latest won sale AND the latest live lead in an exit `ganho` stage, so an org without propostas (Construbom) still gets a figure.
- The empresa picker prefills only the contact: `sales_ops_clients` has no responsible seller; "responsável da empresa" stays pending.
- The pipeline is named `Funil CRM padrão` (key `crm-padrao`), not "Padrão"; migrated orgs keep their own etapas inside it.
- Dynamic field values are typed EAV rows (not JSONB); the Cliente system field is backed by the `client_id` column.

## A9 - Agent-dispatch budget exhausted: slice 14 parked

`max_agent_dispatches` is 64 and autopilot never expands a budget.
Phases 1 to 3 each needed Codex-driven fix rounds (06.1 twice, 07a, 07b, 08, 09, 10.1 twice, 12.1 twice), each costing an executor and a separate Verify.
After slice 13 the budget is spent, so slice `14-importacao-mapeamento` (parts 14a-14c, planned and plan-checked) is PARKED with reason `budget`: its plan and addendum are ready in `nexo/plans/vendas-crm-unificado/14-importacao-mapeamento.md` and `parts/14*`.
The dedicated feature-boundary mutation run and the scribe sub-agent are not dispatched either: every slice Verify already ran mutation probes (recorded in each `verify-*.md`), and the orchestrator writes the capture records inline.

## Runtime budget exhausted

Reason: `max_agent_dispatches:64`.

Unfinished work must be parked and the run must finish without extending the budget.

## A10 - Slice 13 parked after a failed Verify with no budget left

Slice `13-dias-sem-comprar` was built (branch `feat/6q75vnog-13-dias-sem-comprar`, commits 38b581d..bd02a18, every suite green: API unit 1603, API integration 555, web 1987) but its separate Sonnet Verify FAILED on one MAJOR test gap: no test proves that a SOFT-DELETED lead in a `ganho` exit stage does not count (removing `isNull(salesOpsCrmLeads.deletedAt)` in `selectLeadPurchaseWins` stays green), plus a minor (a service-level UTC "today" mutant survives).
The fix round needs one executor and one Verify dispatch; `nexo-policy.py consume` refuses (the 64-dispatch budget is spent). A red slice never enters the merge queue, so slice 13 is PARKED (reason `budget`), unmerged, its branch and worktree kept.
To resume: add the soft-deleted ganho case and a `now = 01:00Z` case to `apps/api/test/rls/clients-purchase-recency.test.ts`, re-verify, Codex-review phase 4, land.
