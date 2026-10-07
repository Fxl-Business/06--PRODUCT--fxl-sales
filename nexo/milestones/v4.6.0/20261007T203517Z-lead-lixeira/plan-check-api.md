# Plan check - API slices 01-api-lixeira and 02-api-stage-summary

Verdict: PASS (no blocking defect). Nits below are optional and none changes a design decision.

## 1. Coverage
- AC5 (409 converted): 01 deleteLead refuses `saleId !== null` after the row lock; route maps it through the existing `failureResponse`; oracle case 4 and route case 2.
- AC6 (soft delete, dense column): 01 Step 4 plus oracle cases 1 and 2 (create MAX, move, delete-first renumber all discriminate against an unfiltered read).
- AC7 (scope = read scope, no claim): oracle case 3 (own, pool, colleague 404, inactive vendedor 404, unmapped 403, seller columns untouched).
- AC8 (audit, same tx): oracle cases 1, 5, 6, 7 (probe trigger proves commit-together; the entry hash is recomputed).
- AC9 server (deleted list): `listDeletedLeads`, oracle case 9 (microsecond keyset with a tie, org scoped, no actor id) and case 10.
- AC10 (restore, admin only, archived etapa fallback, no_open_stage): oracle cases 6, 8, 10.
- AC11 server: 02 `summarizeLeadStages`, 9 oracle cases, 3 route cases.
- Nothing silently dropped.

## 2. Live filter inventory (grep of `lead-service.ts`, repo-wide)
Every `salesOpsLeads` site in lead-service.ts is covered by 01: readLeadView (:530), count and page (:656, :669), getLead (:717), MAX(position) (:968), insert (:974, no filter needed), applyLeadUpdate select and UPDATE (:1052, :1099), moveLead select and UPDATE (:1153, :1210), renumberStage select (:1250); the raw UPDATE at :1269 only touches ids from the live select. Outside lead-service.ts only `scripts/seed-dev.ts` and `scripts/seed/plan.ts` touch the table (delete and insert, correct as planned); no other `src/` reader exists (grep confirmed). The import domain reaches leads only through createLead/moveLead.
`leadIdentityConditions` (:746) gains the live predicate, so get, PATCH, move and delete cannot see a deleted row for any caller, admin included. Board lock is taken after the scope gate and before the row lock in both delete and restore (the documented single order); the audit write is last. No unique index on (org, stage, position) exists (only a plain index, schema.ts:1058), so a deleted row's stale position cannot collide with a live renumber.

## 3. Authorization
Delete reuses `resolveLeadScopePredicate` + `leadIdentityConditions` (admin any; active vendedor own + pool; others own). Restore and `GET /deleted` are `requireAdmin` (the one mechanism, `ADMIN_ROLE_REQUIRED_BODY`). `deleted_by_user_id` is never selected in the list; `toLeadView` builds field by field (lead-service.ts:582) so the view cannot leak it either. Oracle case 9 asserts the exact key set and absence of the actor id in the JSON.

## 4. Audit
`writeAuditEntry(tx, ...)` with the same tx, last. Actor name from `getHubActorDisplayName` (the archive path's snapshot rule), also stored as `actorLabel`/`label` so the org history read can name it. `CADASTRO_LIFECYCLE_ACTIONS` and `CadastroEntityTypeSchema` unchanged (precedent: `import.completed`); the web history panel filters by explicit action list so lead entries do not appear. `lead-contract.test.ts` regexes (no writeAuditEntry/auditLog/getAdminDb in lead-service.ts, single `isNull(salesOpsLeads.deletedAt)` literal, no `ensureLeadStages(` anywhere per leads-edition-no-seed) are all respected by the planned comment texts.

## 5. Migration
Three nullable columns without default, pair CHECK, partial index; ordinary (non-phased) like 0027; the header avoids `fxl-migration-mode` and `fxl-phase`. 0027 snapshot format for `where` and `checkConstraints` matches the strings the unit oracle expects. No backfill. `leads-schema-migration.test.ts` column list update is placed in correct alphabetical position (created_at, deleted_at, deleted_by_name, deleted_by_user_id, description).

## 6. 01/02 consistency
- 02 builds `leadBoardConditions` on `liveLeadCondition()` and the exported `LeadScopeAllowed` from 01; its instruction to drop 01's `liveLeadCondition()` push from listLeads so it appears once is correct.
- Route order: `/deleted` then `/summary`, both above `/:id`.
- edition-gate-map: 01 adds `/leads/deleted`, `/leads/:id/delete`, `/leads/:id/restore`; 02 adds `/leads/summary`; the exhaustive test is green after each slice alone.
- files_modified of 02 is a subset-compatible declaration (lead-schemas, lead-service, lead-routes, lead-routes.test, edition-gate-map, new test); both declare the shared files.

## 7. Oracles
All new integration and unit oracles import symbols or files that do not exist yet, so they are red on the current code. Assertions are discriminating (unfiltered MAX gives 4, ms cursor skips a tied row, pooled-db audit survives the probe). Run commands list existing files only. Deterministic: ties are ordered by id, audit cleanup relies on `fileParallelism: false` like the existing audit test.

## 8. Style
No em dash in any plan file (grep count 0). Comments explain why.

## Nits (non-blocking)
1. `leadActor` in lead-routes.ts duplicates `cadastroActor` (`sales-ops/cadastro-actor.ts`); mapping `displayName` to `name` would reuse the one snapshot helper.
2. 02 does not pin where `deleteLead` is imported from in `leads-stage-summary.test.ts` (its precondition hedges). It is `./lead-trash-service.js`.
3. 02 case 8 calls `listLeads` for the unmapped scope without saying which `stageId`; any `randomUUID()` works.
4. No concurrency oracle for delete vs move on one column. The lock order is by construction identical to moveLead, but a two-connection test in the style of `leads-move-concurrency.test.ts` would pin it.
5. Records trashed leads keep FK references to pessoas and clientes, so the nightly purge will skip those rows through 23503 (correct behaviour, worth one line in the reference doc at capture).
