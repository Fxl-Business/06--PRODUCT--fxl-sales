# Verify 02-etapas-seed-on-read

Verdict: PASS (the slice passes Gate 2). Two minor findings, no blocker or major.
The helper script was not used. I ran the plan's commands directly in the slice worktree.

## Commands and results
- Oracle `test/rls/lead-stages-seed-on-read.test.ts`: 10/10, run twice, both green, so no rows are left between runs.
- Caller guard, `lead-stages-routes`, `edition-gate-map` and `seed-plan` unit files: 304/304.
- Affected integration (lead-stages-rls, leads-edition, no-financial-impact, lixeira, stage-summary, schema-migration): 72/72.
- Other `ensureLeadStages` users (leads-rls, seller-scope, move-concurrency, unassigned-claim, import catalog and executor integration): 55/55.
- `pnpm --filter @fxl-sales/api test`: 1482/1482 across 100 files.
- API lint: 0 findings. API type-check (src, scripts, test): 0 errors.
- Web `src/sales-ops`: 1306/1306 across 104 files. The leads folder is included.
- The slice worktree `git status --porcelain` was empty before and after. All mutations ran on a scratch copy.

## Acceptance clauses
- Both `GET /lead-stages` and `GET /bootstrap` leave four etapas, with name, kind, isSystem and position equal to `LEAD_STAGE_SEEDS` (cases 1 and 4).
- A second call adds none (cases 2 and 4).
- A renamed or archived etapa is never reinserted, and an org's own first etapa blocks the seed (cases 5 and 6).
- The full edition seller, the leads edition seller and the leads edition admin all get the seed (case 3).
- Org A's seed leaves org B untouched (case 7).
- 8 concurrent GETs over 3 fresh orgs all answer 200 and leave exactly 4 rows. It uses a real `Promise.all` (case 8).
- The caller guard is renamed and still asserts an exact closed list of four callers with `toEqual`. The walker, `visited.count > 50` and the `toContain` check are unchanged. It is not weakened.
- A grep for `ensureLeadStages` finds no extra production caller beyond import/routes, stage-service, routes.ts, stages-seed and import/catalog (catalog.ts, see below).

## Mutation probes on the scratch copy
- Baseline: 10/10 green.
- Remove the has-any-row guard: 2 tests red (rename/archive and own-first-etapa).
- Remove `.onConflictDoNothing()`: the concurrent test goes red.
- Revert `listLeadStages` to a plain select: 7 tests red.
- Remove the bootstrap seed call: the bootstrap test goes red.
- Replace the bare conflict with a named arbiter `(org_id, name)`: stays green on 4 runs. See minor finding 1.

## Findings
- Minor 1: the concurrency oracle does not detect a named `ON CONFLICT` target. The race only trips the (org, name) index, so the "bare" rule in CLAUDE.md is only partly pinned. Optional fix: add a source assertion that the insert has no `target`.
- Minor 2: knowledge docs still state the old rule.
  - `nexo/knowledge/reference/importacao-por-planilha.md:74` and `:159` say a fresh org has no etapas until the import creates them.
  - `nexo/knowledge/reference/development-identity-mode.md:78` says the fixture org gets no etapa. That one is accurate about the seed plan.
  - Source comments at `apps/api/scripts/seed-dev.ts:298` and `lead-service.ts:1090` are the same. The plan addendum explicitly leaves those two source files to a later slice.
  - Fix: add "until the first read seeds them" to the two importacao lines.
- No em dash in the new text. No technical id was renamed. No destructive SQL, secrets or production access.
- CLAUDE.md and `kanban-de-leads.md` agree: seeded on read in both editions, has-any-row guard, bare conflict plus re-read, four callers, and `no_open_stage` still reachable when every normal etapa is archived. No contradicting rule is left in either file.
