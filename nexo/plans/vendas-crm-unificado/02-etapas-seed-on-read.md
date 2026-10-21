---
id: 02-etapas-seed-on-read
milestone: v4.8.0
status: todo
depends_on: []
files_modified: ["apps/api/src/domains/sales-ops/leads/stage-service.ts", "apps/api/src/domains/sales-ops/routes.ts", "apps/api/src/domains/sales-ops/leads/__tests__/leads-edition-no-seed.test.ts", "apps/api/src/domains/sales-ops/leads/__tests__/stages-seed-callers.test.ts", "apps/api/test/rls/lead-stages-seed-on-read.test.ts", "CLAUDE.md", "nexo/knowledge/reference/kanban-de-leads.md"]
affected_tests: [
  {path: apps/api/src/domains/sales-ops/leads/__tests__/leads-edition-no-seed.test.ts, impact: "asserts the ONLY ensureLeadStages callers are import/routes.ts and stages-seed.ts, titled 'leads edition: no lazy etapa seed' - this is exactly the rule the owner reverses", update: "git mv to stages-seed-callers.test.ts, rewrite title and expected list to the four allowed callers (see Tests); not weakened, the new allow-list is asserted exactly", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/stages-seed-callers.test.ts", owner: builder},
  {path: apps/api/src/domains/sales-ops/__tests__/lead-stages-routes.test.ts, impact: "mocks listLeadStages from stage-service; GET route unchanged so the mock still applies", update: "none expected", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/lead-stages-routes.test.ts", owner: builder},
  {path: apps/api/test/rls/lead-stages-rls.test.ts, impact: "calls listLeadStages on orgs it already seeded or created stages in; every call site (lines 80, 81, 98, 210, 232, 294, 295, 313) follows ensureLeadStagesForOrg or createLeadStage so the org is never empty", update: "none expected; if a call site hits an empty org, seed it first in the test, do not change the service", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/lead-stages-rls.test.ts", owner: builder},
  {path: apps/api/src/middleware/__tests__/edition-gate-map.test.ts, impact: "GET /bootstrap and GET /lead-stages reach the handler over a Proxy db that throws on any access; the new seed call also touches the db first so the 500 handler_reached marker is unchanged", update: "none expected", command: "pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/edition-gate-map.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-edition.test.ts, impact: "lines 341-358 assert no_open_stage for an org with no etapa at the SERVICE level (createContactLead); service behaviour is unchanged because only GET/bootstrap seed", update: "none expected", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-edition.test.ts", owner: builder},
  {path: apps/api/test/rls/leads-no-financial-impact.test.ts, impact: "deep-equals the getSalesOpsSnapshot payload; seeding lives in the ROUTE handler, not in the snapshot function, so the payload is untouched", update: "none expected", command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-no-financial-impact.test.ts", owner: builder},
  {path: apps/api/scripts/__tests__/seed-plan.test.ts, impact: "line 678 'seeds no etapa' is about the dev SEED PLAN for org_fake_leads, still true (the first GET seeds at runtime)", update: "none; the CLAUDE.md sentence is reworded to say so", command: "pnpm --filter @fxl-sales/api exec vitest run scripts/__tests__/seed-plan.test.ts", owner: builder}
]
acceptance: "given an org (either edition) with no etapas, when GET /lead-stages or GET /bootstrap runs, then the org has exactly the four default etapas; a second call adds none; an org that renamed or archived etapas gets nothing re-inserted; eight concurrent GETs all answer 200 and leave exactly four rows"
goal: "Fix the ECV bug: an org created after migration 0022 gets the default etapas on first read instead of an empty board"
must_not_break: ["leads-edition createContactLead still answers 400 no_open_stage when the org really has no active normal etapa", "getSalesOpsSnapshot payload byte-identical", "GET /lead-stages stays readable by seller and finder (no requireAdmin on the read)", "archived etapas still returned by GET /lead-stages", "LEAD_STAGE_SEEDS unchanged (4 stages, byte-identical to migration 0022)", "tenant isolation: seeding org A never touches org B"]
rules: ["The owner's items 9 and 0b order seeding on load and win over the old 'no etapa is ever seeded in the leads edition' rule; the new rule applies to BOTH editions", "has-any-stage guard in ensureLeadStages is never replaced by a per-stage check", "Seed only inside the tenant transaction; isSystem and kind never come from a caller", "Update CLAUDE.md and kanban-de-leads.md in the same change"]
verifier_focus: "Run the new integration oracle twice (no leftover rows between runs); confirm the concurrency test really fires parallel requests (Promise.all of 8) and that dropping the has-any-stage guard or the bare ON CONFLICT makes a test fail; grep that no other file calls ensureLeadStages"
oracle: "apps/api/test/rls/lead-stages-seed-on-read.test.ts"
---

# 02 - Etapas semeadas na leitura (request 0b, ECV bug)

## Context
- Bug: `listLeadStages` (`apps/api/src/domains/sales-ops/leads/stage-service.ts:79`) is a plain `SELECT`; the only runtime caller of the seed is `apps/api/src/domains/import/routes.ts:52`. Orgs created after migration 0022 (ECV Control) therefore see an empty board forever (`[data-no-stages]`).
- Seed module `apps/api/src/domains/sales-ops/leads/stages-seed.ts`: `LEAD_STAGE_SEEDS` (lines 22-34: Novo normal pos 1, Em negociação normal pos 2, Proposta conversion system pos 3, Perdido lost system pos 4), `ensureLeadStages(tx, orgId)` (line 63, takes an open tenant tx) and `ensureLeadStagesForOrg(db, orgId)` (line 96, opens `withTenant`).
- Idempotent and concurrency-safe by construction (verified by reading the code):
  1. `ensureLeadStages` returns early when the org has ANY stage row (`existing.length > 0`, line 66-68). So an org that renamed `Novo` or archived a stage is never reseeded, and an org that created its own first stage is never seeded.
  2. The INSERT is a single multi-row statement with a BARE `.onConflictDoNothing()` (line 84) covering every unique index of the table: `sales_ops_lead_stages_org_name_idx (org_id, name)` and the partial `(org_id, kind)` index for system kinds (migration 0022 lines 81-83 and the partial one). Two first-readers racing both pass the empty check, both insert; the loser blocks on the winner's uncommitted unique entry, then takes DO NOTHING instead of 23505. Both statements insert the rows in the same order (the VALUES order) so there is no lock-order cycle, hence no deadlock.
  3. It re-reads with `selectStages` (line 87) instead of `.returning()`, so the loser also returns all four rows.
- Callers to change: `GET /lead-stages` at `stage-routes.ts:33-36` calls `listLeadStages(getDb(), orgId)`; the bootstrap handler is `salesOpsRouter.get('/bootstrap', ...)` at `apps/api/src/domains/sales-ops/routes.ts:93-96` calling `getSalesOpsSnapshot` (`service.ts:3147`). The bootstrap payload carries NO stages (leads never enter `/bootstrap`), so the bootstrap seed is a side effect before the snapshot, which also covers pages that open the board without a prior stages fetch.
- Rules that currently assert the opposite (all updated in this slice): `CLAUDE.md` line 88 ("The seed gives that org no etapas"), `CLAUDE.md` line 366-368 (Edição Leads "No etapa is ever seeded in the leads edition. ..."), `nexo/knowledge/reference/kanban-de-leads.md` lines 75-76 ("The leads edition has no system etapa ... nothing ... seeds one", `leads-edition-no-seed.test.ts`), and the oracle `apps/api/src/domains/sales-ops/leads/__tests__/leads-edition-no-seed.test.ts`. Also `kanban-de-leads.md` line 87 (`[data-no-stages]` for zero active etapas) stays true but gets a sentence on when it is still reachable.
- Still reachable after the change (kept, tested elsewhere): `[data-no-stages]` and `400 no_open_stage` when an admin has archived every `normal` etapa (rows exist, so no reseed), and `restoreLead` `no_open_stage`.
- Side effect to record (see Risks): in the leads edition (no `proposals` capability, `onRequestConversion` never wired) the seeded `Proposta` (conversion) column cannot receive a lead: `moveLead` refuses with `sale_required_for_conversion` (`lead-service.ts:1309-1310`). That is the stage model phase 1 replaces; it is NOT worked around here.

## Design (decided)
- Seeding applies to BOTH editions and to every role that can call the read (seller, finder, admin): the request says "ao carregar" with no qualifier. A GET therefore performs a one-time write inside the tenant transaction (policy `tenant_isolation` WITH CHECK allows it for the app role; `lead-stages-rls.test.ts` already calls `ensureLeadStagesForOrg` over the app connection).
- GET /lead-stages: change `listLeadStages` in `stage-service.ts` so it runs the seed in ITS OWN tenant transaction and returns the seeded list in one round trip:
  ```ts
  import { ensureLeadStages } from './stages-seed.js';
  ...
  export function listLeadStages(db: Db, orgId: string): Promise<LeadStageRow[]> {
    return withTenant(db, orgId, (tx) => ensureLeadStages(tx, orgId));
  }
  ```
  `ensureLeadStages` already returns every stage (archived included) ordered by `position, name` through `selectStages` - the exact order and filter `listLeadStages` had. Keep the long doc comment above the function and append: "Seeds the default pipeline when the org has no stage row at all (ECV bug); see ensureLeadStages." The route file is unchanged, so the route unit test that mocks `listLeadStages` stays valid.
  Import direction check: `stages-seed.ts` imports only `db/client` types, `db/schema` and `./with-tenant.js`; `stage-service.ts` importing it creates no cycle.
- Bootstrap: in `routes.ts` add `import { ensureLeadStagesForOrg } from './leads/stages-seed.js';` next to the other leads imports (line 13-14) and change the handler to:
  ```ts
  salesOpsRouter.get('/bootstrap', async (c) => {
    const orgId = c.get('orgId');
    // ECV bug: an org created after migration 0022 has no etapas until something seeds them.
    await ensureLeadStagesForOrg(getDb(), orgId);
    const snapshot = await getSalesOpsSnapshot(getDb(), orgId);
    return c.json(snapshot);
  });
  ```
  Separate transaction on purpose: `getSalesOpsSnapshot` is untouched so its payload and the `leads-no-financial-impact` deep-equal oracle are unaffected. Cost: one extra indexed SELECT per bootstrap (the seed INSERT only ever runs once per org).
- No change to `lead-service.ts`, `lead-trash-service.ts`, import routes, `LEAD_STAGE_SEEDS`, schema or migrations.

## Steps (TDD)
1. RED: create `apps/api/test/rls/lead-stages-seed-on-read.test.ts` (Tests section). Run it: the seed tests fail (empty stage lists / 0 rows).
2. RED: `git mv apps/api/src/domains/sales-ops/leads/__tests__/leads-edition-no-seed.test.ts apps/api/src/domains/sales-ops/leads/__tests__/stages-seed-callers.test.ts` and rewrite it per Tests; it fails because `stage-service.ts` and `routes.ts` do not call the seed yet.
3. GREEN: edit `stage-service.ts` `listLeadStages` and `routes.ts` bootstrap exactly as in Design.
4. Run the new oracle and the affected suites; fix only by adjusting production code, or, where a test seeds an empty org, by seeding in the test setup.
5. Docs (same change): edit `CLAUDE.md` and `kanban-de-leads.md` as listed below.
6. Run lint, type-check.

Doc edits (exact intent):
- `CLAUDE.md` Development identity mode, line 88: replace "The seed gives that org no etapas, no settings row and one UNBOUND vendedor pessoa with `leads-seller`'s email." with "The seed plan gives that org no etapas, no settings row and one UNBOUND vendedor pessoa with `leads-seller`'s email; the first `GET /lead-stages` or `GET /bootstrap` seeds the four default etapas at runtime (see Edição Leads)."
- `CLAUDE.md` Edição Leads: replace the bullet starting "No etapa is ever seeded in the leads edition." with: "Etapas are seeded ON READ in BOTH editions: `GET /lead-stages` (inside `listLeadStages`, same transaction) and `GET /bootstrap` (before the snapshot, via `ensureLeadStagesForOrg`) seed the four default etapas when the org has NO stage row at all. The guard is 'any row', never 'each of the four', so a renamed or archived etapa is never reinserted; the INSERT is bare `ON CONFLICT DO NOTHING` plus a re-read, so two concurrent first reads never 500. Nothing else on a request path seeds (oracle `leads/__tests__/stages-seed-callers.test.ts`, `test/rls/lead-stages-seed-on-read.test.ts`). Creating a lead when every `normal` etapa is archived still answers the existing `400` `reason: 'no_open_stage'`; the web keys on status 400 plus `ApiError.reason`. The board shows `[data-no-stages]` in that case and never receives `onRequestConversion` / `onOpenSale`."
- `CLAUDE.md` Kanban de leads: after the bullet "Etapas follow the funções precedent..." append " The default four are seeded on first read (see Edição Leads)."
- `kanban-de-leads.md` lines 75-76: replace the two bullets by one stating the new rule, the callers (`stage-service.ts` `listLeadStages`, `routes.ts` bootstrap, `import/routes.ts`, `stages-seed.ts`), the renamed oracle, and add a dated paragraph "Seed on read (2026-10-21, vendas-crm-unificado 02)" with: the ECV cause (post-0022 orgs, only the import seeded), why idempotent (has-any-row guard, bare ON CONFLICT, re-read), the leads-edition conversion-column side effect, and the oracles. Line 87: append "After seed-on-read this state is reachable only when every normal etapa was archived."

## Tests
`apps/api/test/rls/lead-stages-seed-on-read.test.ts` (new; Postgres, VITEST_INTEGRATION). Copy the header of `apps/api/test/rls/leads-lixeira.test.ts` lines 16-34 (the `vi.hoisted` blanking of `FXL_HUB_*`, `SALES_ENV_FILE`, `SALES_AUTH_FAKE`, needed because `routes.ts` imports `middleware/app-auth.js`) and the imports from `lead-stages-rls.test.ts` (`testDatabaseUrls`, `postgres`, `closeDb` from `src/db/client.js`, `hubAuthContext` from `src/auth/__tests__/hub-auth-context-fixture.js`). Helpers:
- `newOrg(label)`: `org_seedread_${label}_${Date.now()}_${randomUUID().slice(0,8)}`, pushed to `orgIds`; `afterAll` deletes `sales_ops_lead_stages` rows for them through an `adminClient` (`app.fxl_admin` connection), then `closeDb()` and ends clients.
- `appFor(orgId, { roles, edition })`: `new Hono()`, `use('*')` setting `userId`, `orgId`, `userRole`, `userRoles`, `salesEdition`, `hubAuth` (as lixeira lines 695-707), then `hono.route('/', leadStagesRouter)` for the stages tests and `hono.route('/', salesOpsRouter)` for the bootstrap test.
- `countStages(orgId)`: `adminClient\`SELECT count(*)::int AS n FROM sales_ops_lead_stages WHERE org_id = ${orgId}\``.
Cases (names exact):
1. `GET /lead-stages seeds the four default etapas for an org with none` - fresh org, admin role; status 200; `stages.map(s => [s.name, s.kind, s.isSystem, s.position])` equals `LEAD_STAGE_SEEDS` mapped the same way; `countStages === 4`.
2. `a second GET /lead-stages does not duplicate` - call twice; ids of both responses equal; count 4.
3. `GET /lead-stages seeds in both editions and for a vendedor` - `it.each([['full','seller'],['leads','seller'],['leads','admin']])`; each on its own fresh org; count 4 and status 200.
4. `GET /bootstrap seeds the four etapas and a second bootstrap adds none` - fresh org through `salesOpsRouter`; status 200; count 4; second call count 4; the JSON payload has no `stages` key (leads never enter bootstrap).
5. `an org that renamed one etapa and archived another gets no reinsertion` - seed via `ensureLeadStagesForOrg`; `updateLeadStage` rename `Novo` to `Prospecção` and archive `Em negociação`; GET twice; names are exactly `['Prospecção','Em negociação','Proposta','Perdido']` (archived still listed), count 4, no row named `Novo`.
6. `an org that created its own first etapa is never seeded` - fresh org, `createLeadStage(db, org, {name:'Somente minha'})`; GET returns exactly one stage; count 1.
7. `seeding org A leaves org B untouched` - GET for A; `countStages(B) === 0`.
8. `eight concurrent first GETs all answer 200 and leave exactly four rows` - fresh org; `await Promise.all(Array.from({length: 8}, () => app.request('/lead-stages')))`; every status 200 (never 500), every body has 4 stages with identical id sets, `countStages === 4`. Repeat the whole case for 3 fresh orgs in a loop to make a race likely.
9. `eight concurrent first bootstraps ...` is NOT required; the stages case covers the shared function.
Changed test: `apps/api/src/domains/sales-ops/leads/__tests__/stages-seed-callers.test.ts` (renamed from `leads-edition-no-seed.test.ts`). Keep the walker, `visited.count > 50` and `toContain('domains/sales-ops/leads/stages-seed.ts')` unchanged; change `describe` to `'default etapa seed: only the allowed callers'`, the `it` to `'only the import route, listLeadStages, the bootstrap route and the seed module itself call the seed'` and the final assertion to
```ts
expect(hits.sort()).toEqual([
  'domains/import/routes.ts',
  'domains/sales-ops/leads/stage-service.ts',
  'domains/sales-ops/leads/stages-seed.ts',
  'domains/sales-ops/routes.ts',
]);
```
Update the header comment to state the new rule (seed-on-read in both editions). Do not leave the file name or title claiming "leads edition: no lazy etapa seed". Keep any comment text in `stage-service.ts` and `routes.ts` free of the literal `ensureLeadStages(` apart from the real calls (the regex also matches comments).

## Commands
- Oracle: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/lead-stages-seed-on-read.test.ts`
- Caller guard: `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/stages-seed-callers.test.ts src/domains/sales-ops/__tests__/lead-stages-routes.test.ts src/middleware/__tests__/edition-gate-map.test.ts`
- Affected integration: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/lead-stages-rls.test.ts test/rls/leads-edition.test.ts test/rls/leads-no-financial-impact.test.ts test/rls/leads-lixeira.test.ts test/rls/leads-stage-summary.test.ts test/rls/leads-schema-migration.test.ts`
- Whole api unit suite: `pnpm --filter @fxl-sales/api test`
- Lint and types: `pnpm --filter @fxl-sales/api lint && pnpm --filter @fxl-sales/api type-check`
- Local DB must be up on port 5006 and `apps/api/.env` present in the worktree.

## Risks
- A GET now writes once per org. If the DB role ever loses INSERT on `sales_ops_lead_stages` the read would 500; the app role already inserts through `createLeadStage`, so this holds.
- Leads edition: the seeded `Proposta` column cannot accept a drag (`sale_required_for_conversion`, no proposta flow in that edition) and `Perdido` needs a reason. Owner decision needed only if this is unwanted before phase 1 replaces the stage model; the plan follows the request as written.
- Any test that lists stages of a deliberately empty org through `GET /lead-stages` or `/bootstrap` would now see four rows; the grep found none (service-level `listLeadStages` callers all pre-seed or create).
- `leads-stage-summary.test.ts:416` ("an org with no etapas answers []") uses the summary function, not the GET stages route, so it is unaffected; run it to confirm.
