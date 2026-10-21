# Part 11c-api-modulos-admin of slice 11-api-modulos-org

Original frontmatter (for reference, not a slice):

```yaml
id: 11c-api-modulos-admin
milestone: v4.8.0
status: todo
depends_on: ["11b-api-modulos-cutover"]
files_modified: ["apps/api/src/domains/sales-ops/routes.ts", "apps/api/src/middleware/__tests__/edition-gate-map.test.ts", "apps/api/src/domains/org-modules/__tests__/org-modules-routes.integration.test.ts", "apps/api/src/domains/org-modules/__tests__/org-modules-routes.test.ts", "CLAUDE.md", "nexo/knowledge/reference/auth-model.md", "nexo/knowledge/reference/modulos-por-organizacao.md"]
affected_tests: [
  {path: apps/api/src/middleware/__tests__/edition-gate-map.test.ts, impact: "the router gains GET and PUT /org-modules, which the exhaustiveness test requires to be classified", update: "add the two routes to OPEN only", command: "pnpm --filter @fxl-sales/api exec vitest run src/middleware/__tests__/edition-gate-map.test.ts", owner: builder},
  {path: apps/api/src/domains/sales-ops/__tests__, impact: "any unit test that snapshots the whole GET /bootstrap body (find with grep -rln '/bootstrap' apps/api/src apps/api/test) must tolerate the additive key orgModules", update: "toMatchObject or add the key", command: "pnpm --filter @fxl-sales/api test", owner: builder},
  {path: apps/api/test/rls/lead-stages-seed-on-read.test.ts, impact: "bootstrap and GET /lead-stages are still called; the stage projection is unchanged when orcamentos is on", update: none, command: "pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/lead-stages-seed-on-read.test.ts", owner: builder}
]
acceptance: "given an org with orcamentos off, when a lead is advanced to an orcamento-type stage, then it behaves as a normal stage (200, no sale_required_for_conversion); with orcamentos on the same call answers 409 sale_required_for_conversion; and toggling a flag through PUT /org-modules changes the capability 403 on the very next request"
goal: "Admin GET/PUT /org-modules, the bootstrap exposure, the rule that an orcamento stage acts only with the orcamentos module, and the API docs"
must_not_break: ["edition-gate-map.test.ts exhaustive and un-weakened (only OPEN gains two entries)", "EDITION_CAPABILITY_BODY unchanged", "GET /bootstrap keeps every existing key (additive orgModules only)", "legacy GET /lead-stages response fields are unchanged for an org with orcamentos on", "no-legacy-*, hub-sdk-pin, fxl-contracts-pin guards", "the dev-identity docs reconciliation guard (do not touch the dev identity paragraphs of CLAUDE.md)"]
rules: ["Never use the em dash; use '-'", "GET and PUT /org-modules sit behind requireAdmin and are NOT capability gated (an admin must always be able to reach them)", "The org comes only from c.get('orgId'); a body never carries an org", "Services take modules as an argument from the route; none reads the Hono context", "CLAUDE.md and the reference docs: one sentence per line", "No migration"]
verifier_focus: "Run the integration route test 3 times; run edition-gate-map and the whole API suite; read the diff of CLAUDE.md to confirm only the listed paragraphs changed; confirm GET /org-modules for a non-admin answers the ADMIN_ROLE_REQUIRED_BODY"
oracle: "apps/api/src/domains/org-modules/__tests__/org-modules-routes.integration.test.ts"
```

# 11c - Admin toggle route, bootstrap exposure, orcamento stage rule, API docs (phase 3)

## Context

- After 11b the gates and readers use `getOrgModules` / `getSalesEdition` (`apps/api/src/domains/org-modules/context.ts`), the loader/updater are in `service.ts` (11a).
- `salesOpsRouter` (`apps/api/src/domains/sales-ops/routes.ts`) registers the capability gates at the top (lines ~82-92), then `GET /bootstrap` (~line 94: `ensureLeadStagesForOrg` or, after phase 2, `ensureCrmDefaultsForOrg`, then `getSalesOpsSnapshot`, then `return c.json(snapshot)`).
- `requireAdmin` and `ADMIN_ROLE_REQUIRED_BODY` are in `apps/api/src/middleware/require-admin.ts`.
- Phase 2 contract (`contracts/SEAM-CONTRACT-PHASE2.md`): `GET /pipelines`, `GET /lead-stages` (legacy `kind` derived: `type 'orcamento'` -> `'conversion'`, `exit_kind 'perdido'` -> `'lost'`, else `'normal'`; additive `type`, `behavior`, `exitKind`), `POST /leads/:id/advance` and `POST /leads/:id/move` answer `409 { error: 'sale_required_for_conversion' }` for a destination of type `orcamento` with behaviour `opens_orcamentos`. Today (pre phase 2) that refusal is `LeadInputError('sale_required_for_conversion')` at `apps/api/src/domains/sales-ops/leads/lead-service.ts:1310` and the import executor message at `apps/api/src/domains/import/executor.ts:91`.
- The zod import in `routes.ts` already exists (`z`).

## Design (decided)

1. Routes (in `routes.ts`, registered after the gates and before `/bootstrap`, so the gate comment "above every route" still holds):
   - `GET /org-modules` (`requireAdmin`): `{ modules: Record<CrmModuleKey, boolean>, sources: Record<CrmModuleKey, 'default'|'token_backfill'|'admin'> }` from `loadOrgModules(orgId, tokenModules)`.
   - `PUT /org-modules` (`requireAdmin`): body `{ modules: { <key>?: boolean, ... } }`, strict (an unknown key, a non-boolean or an empty `modules` is `400 { error: 'validation_error', issues }`), answers `200` with the same body as GET after `updateOrgModules`. Dependencies between modules are NOT enforced (turning `orcamentos` off while `comissoes` stays on is allowed; the screens simply have nothing to attach to). No audit entry in this run (see Risks).
   - `tokenModules` is `c.get('hubAuth')?.entitlements?.modules`.
   - Neither route is capability gated; both are added to `edition-gate-map.test.ts` `OPEN`.
2. Bootstrap: `GET /bootstrap` returns `c.json({ ...snapshot, orgModules: await getOrgModules(c) })`. This is the web's source of truth for navigation (slice 12b). Additive; every existing key is untouched.
3. Orcamento stage rule. Pure helpers `stageActsAsOrcamento(stage, modules)` and `effectiveStageBehavior(stage, modules)` exist (11a). Apply them at EVERY decision site, found with:
   `grep -rn "opens_orcamentos\|'orcamento'\|'conversion'\|sale_required_for_conversion" apps/api/src --include='*.ts' | grep -v __tests__`
   Rules per hit kind:
   - A refusal or branch that makes an `orcamento`/`opens_orcamentos` destination require a sale (`sale_required_for_conversion`, move or advance): wrap the condition with `stageActsAsOrcamento(stage, modules)`. When it is false the stage is a normal stage: the move/advance proceeds like any other.
   - A projection that derives the legacy `kind` (`'conversion'`) or exposes `behavior` for `GET /lead-stages`, `GET /pipelines` and the lead wire: `kind` is `'conversion'` only when `stageActsAsOrcamento`; `behavior` is `effectiveStageBehavior(stage, modules)`. `type` is left as stored so the data is not rewritten.
   - The import planner/executor refusal of a lead "in the conversion etapa": refuse only when `stageActsAsOrcamento`; with `orcamentos` off the stage accepts imported leads like any normal stage.
   - The route passes `await getOrgModules(c)` into the service as a new TRAILING parameter `modules: OrgModules = ALL_MODULES_ENABLED` (default = today's FXL behaviour for any forgotten caller; the route-level test below catches a missed route). Services never read the context.
   - Stored data is never mutated by the toggle: the stage stays `type 'orcamento'` and a lead already converted keeps its `sale_id`.
4. `edition_capability` is the kept code for "your organization's modules do not include this". No new code.
5. Docs: CLAUDE.md paragraphs and a new reference file (below). Web rules in CLAUDE.md belong to slice 12b; do not edit them here.

## Steps (TDD)

1. Write `org-modules-routes.test.ts` (unit, stateful fake) and `org-modules-routes.integration.test.ts` (Tests). Run: RED (routes missing).
2. Add the two routes and the bootstrap key in `routes.ts` (code below). Unit test GREEN.
3. Add the stage-rule call sites (Design 3). Integration test GREEN (3 consecutive runs).
4. Add the two entries to `OPEN` in `edition-gate-map.test.ts`.
5. Docs. Then whole API unit suite, integration for the affected seed tests, lint, type-check, guards.

### Code for `routes.ts`

```ts
import { CRM_MODULE_KEYS } from '@fxl-sales/shared-utils/crm-model';
import { getOrgModules } from '../org-modules/context.js';
import { loadOrgModules, updateOrgModules } from '../org-modules/service.js';

const OrgModulesPatchSchema = z
  .object({
    modules: z
      .object(Object.fromEntries(CRM_MODULE_KEYS.map((key) => [key, z.boolean().optional()])))
      .strict()
      .refine((value) => Object.keys(value).length > 0, { message: 'at_least_one_module' }),
  })
  .strict();

function orgTokenModules(c: Context): readonly unknown[] | undefined {
  return c.get('hubAuth')?.entitlements?.modules;
}

salesOpsRouter.get('/org-modules', requireAdmin, async (c) => {
  const state = await loadOrgModules(c.get('orgId'), orgTokenModules(c));
  return c.json({ modules: state.modules, sources: state.sources });
});

salesOpsRouter.put('/org-modules', requireAdmin, async (c) => {
  const parsed = OrgModulesPatchSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const state = await updateOrgModules(c.get('orgId'), orgTokenModules(c), parsed.data.modules);
  return c.json({ modules: state.modules, sources: state.sources });
});

// in GET /bootstrap, last line:
return c.json({ ...snapshot, orgModules: await getOrgModules(c) });
```

(`Context` is already imported in `routes.ts`; if not, `import type { Context } from 'hono'`.)

## Tests

`org-modules-routes.test.ts` (unit; `vi.mock('../service.js')` with a stateful in-memory map keyed by orgId: `loadOrgModules` backfills from the token on first call, `updateOrgModules` merges the patch with `source 'admin'`):
- `GET /org-modules and PUT /org-modules answer the admin body to a non-admin` (context `userRole = 'seller'`): 403 with `ADMIN_ROLE_REQUIRED_BODY` for both.
- `PUT rejects: {}`, `{ modules: {} }`, `{ modules: { orcamentos: 'yes' } }`, `{ modules: { nope: true } }`, `{ modules: { orcamentos: true }, org: 'x' }` -> each `400 validation_error`, `updateOrgModules` not called.
- `PUT then a gated route flips without a redeploy`: org with token `['sales.edition.leads']`, admin: `GET /sales` -> 403 byte-exact; `PUT { modules: { orcamentos: true } }` -> 200 and `modules.orcamentos === true`, `sources.orcamentos === 'admin'`; next request `GET /sales` (fresh request, fresh context) -> not 403; `PUT { modules: { orcamentos: false } }` -> next `GET /sales` is 403 again. (The handler behind `/sales` is mocked to a stub route or the test mounts `requireCapability('proposals')` on a probe path.)
- `GET /bootstrap carries orgModules` is covered in the integration test (needs the real snapshot).

`org-modules-routes.integration.test.ts` (real `salesOpsRouter`, real DB, RLS live; harness copied from `apps/api/src/domains/import/__tests__/import-routes.integration.test.ts` `createTestApp`, but the hand-built middleware sets NO `orgModules` and sets `hubAuth = hubAuthContext({ accountId, workspaceId: orgId, entitlements: { modules: tokenModules } })` where `tokenModules` is a mutable test variable, `userRole = 'admin'`, `userRoles = ['admin','seller','finder']`). Cleanup in `afterAll` through an admin connection, FK-safe: `DELETE FROM sales_ops_org_modules`, then the phase 2 tables created for the stage test (`sales_ops_crm_lead_events`, `_notes`, `_followups`, `_field_values`, `sales_ops_crm_leads`, `sales_ops_pipeline_transitions`, `sales_ops_pipeline_stages`, `sales_ops_pipelines`, `sales_ops_field_definitions`), `sales_ops_clients`, `sales_ops_people`, and `audit_log WHERE actor_org_id = ...`, all `WHERE org_id = <org>`; if phase 2 left a shared cleanup helper (`grep -rln "sales_ops_crm_leads" apps/api/test apps/api/src`), reuse it instead. Tests:
1. `a Construbom-like org (leads token, no rows) gets exactly today's leads capabilities`: first request `GET /summary` -> 403 and body text exactly `{"error":"forbidden","code":"edition_capability"}`; then for each of `GET /sales`, `GET /products`, `GET /areas`, `GET /funcoes`, `GET /history`, `PUT /settings` (body `{}`) -> byte-exact 403; for `GET /clients`, `GET /import/template` -> status 200; `GET /people`, `GET /bootstrap` -> 200. Admin read: 7 rows, all `token_backfill`, enabled keys `['clientes','importacao']`.
2. `the token no longer decides after the first request`: switch `tokenModules` to `[]` (a full token) on the same org: `GET /summary` is STILL 403.
3. `a full org (token [], no rows) is unchanged`: `GET /summary`, `/sales`, `/products`, `/areas`, `/funcoes`, `/history`, `/clients` all 200 (not 403); 7 rows all enabled.
4. `toggling a flag through the admin route changes the 403 without a redeploy`: Construbom-like org; `PUT /org-modules { modules: { orcamentos: true } }` -> 200; `GET /summary` -> 200; `GET /sales` -> 200; `PUT { modules: { orcamentos: false } }` -> `GET /summary` 403 again; `PUT { modules: { catalogo: true } }` -> `GET /products` 200 and `GET /history` still 403.
5. `ten concurrent first requests on a Construbom-like org: all 403, exactly 7 rows`: `Promise.all` of 10 `GET /summary` on a fresh org -> every status 403, no 500; admin `count(*)` is 7.
6. `GET /bootstrap exposes the org's modules`: the body has `orgModules` deep-equal to `modulesForEdition('leads')` for the leads org and all-true for the full org; existing keys (`sales`, `products`, `clients`, `people`, `settings`) still present.
7. `GET /org-modules is admin only and not capability gated`: with `userRole = 'seller'` -> 403 `ADMIN_ROLE_REQUIRED_BODY`; with admin on the Construbom-like org (every capability but clients/import off) -> 200.
8. `an orcamento stage acts only with the orcamentos module` (uses the phase 2 contract routes): `GET /pipelines` (this also seeds the default pipeline), find a transition whose target stage has `type === 'orcamento'` and take its `fromStageId`; `POST /leads` with `{ contactName: 'Lead Teste', contactPhone: '11999990000', stageId: <fromStageId> }` (create a client or seller only if the phase 2 schema demands it); then
   - orcamentos OFF (leads token): `POST /leads/:id/advance { toStageId: <orcamentoStageId>, nextStep: 'Enviar proposta', dueOn: '<today SP>' }` -> 200, and `GET /lead-stages` shows that stage with `kind: 'normal'` and `behavior: 'none'`;
   - `PUT /org-modules { modules: { orcamentos: true } }`, create a second lead the same way: the same advance -> `409 { error: 'sale_required_for_conversion' }`, and `GET /lead-stages` shows `kind: 'conversion'`, `behavior: 'opens_orcamentos'`.
   If phase 2 named a route or field differently, follow the phase 2 plan's names and keep the two assertions.

`edition-gate-map.test.ts`: append to `OPEN`:
```ts
  r('salesOps', 'GET', '/org-modules', `${SO}/org-modules`),
  r('salesOps', 'PUT', '/org-modules', `${SO}/org-modules`),
```
The existing OPEN loop (`not edition-gated for a leads-edition owner`) then covers them (PUT with body `{}` answers 400 before any store call; GET reaches the mocked loader).

## Docs (one sentence per line)

`CLAUDE.md` (edit ONLY these paragraphs; line numbers as of this plan, locate by their first words):
- Auth Model, bullet starting `- Baseline access is the boolean`: replace the final clause `, plus the Sales edition, resolved ONLY in \`applyHubAuthContext\` into \`c.get('salesEdition')\`.` by `. The token's \`modules\` are read for the product surface by exactly one place, \`loadOrgModules\` (\`apps/api/src/domains/org-modules/service.ts\`), as a one-time backfill into \`sales_ops_org_modules\`; \`applyHubAuthContext\` resolves no edition.`
- Auth Model, bullet starting `- \`requireCapability\``: replace with: `- \`requireCapability\` (\`apps/api/src/middleware/require-capability.ts\`) is a CAPABILITY gate behind the access gate, never an access gate: \`403 {"error":"forbidden","code":"edition_capability"}\` (the code is kept; it means the organization's modules do not include the capability). It reads the org's modules from \`sales_ops_org_modules\` through \`getOrgModules\` (one query per request, memoized on the context, a store failure throws and never reads as "all enabled"), maps capability to modules with \`CAPABILITY_MODULES\` (\`@fxl-sales/shared-utils/crm-model\`), a context that never loaded modules and has no Hub context is all modules, and gates are registered above every route of their router. Oracles: \`apps/api/src/middleware/__tests__/edition-gate-map.test.ts\` and \`apps/api/src/domains/org-modules/__tests__/org-modules-routes.integration.test.ts\`.`
- Edição Leads, the two bullets `- The edition is DERIVED per request from the verified token ...` (three physical lines) and `- API: \`c.get('salesEdition')\` is set only in ...`: replace with three bullets: (1) `The product surface is per-ORGANIZATION modules in \`sales_ops_org_modules\` (\`orcamentos|comissoes|financeiro|finders|catalogo|importacao|clientes\`), not an edition in the token.` plus `An org with NO module row is backfilled once, in a transaction with an advisory lock and ON CONFLICT DO NOTHING, from \`modulesForEdition(resolveSalesEdition(entitlements.modules))\` with \`source = 'token_backfill'\`; after that the token decides nothing. \`resolveSalesEdition\` and \`SALES_EDITION_LEADS_MODULE\` survive for that backfill only.` (2) `An admin toggles a flag without a redeploy through \`GET/PUT /api/v1/sales-ops/org-modules\` (\`requireAdmin\`, not capability gated); \`GET /bootstrap\` carries \`orgModules\`.` (3) `\`c.get('salesEdition')\` no longer exists: \`getSalesEdition(c)\` is the PROJECTION (\`orcamentos\` off => \`leads\`), awaited in the route and passed to services as an explicit argument; services never read the Hono context. An \`orcamento\` stage opens the wizard / answers \`sale_required_for_conversion\` only while \`orcamentos\` is on (\`stageActsAsOrcamento\`); with it off it is a normal stage (\`kind: 'normal'\`, \`behavior: 'none'\` in the projections, the stored \`type\` is untouched).`
- Edição Leads, the bullet starting `- The leads edition grants exactly two capabilities`: replace `The leads edition grants exactly two capabilities, \`clients\` and \`import\` (\`LEADS_CAPABILITIES\` in \`sales-edition.ts\`)` by `An org with only the \`clientes\` and \`importacao\` modules (the Construbom backfill, \`LEADS_CAPABILITIES\` in \`sales-edition.ts\`) is granted exactly the capabilities \`clients\` and \`import\``; keep the rest of the sentence.

`nexo/knowledge/reference/auth-model.md`: rewrite the two bullets at lines ~19-22 (the `applyHubAuthContext ... resolveSalesEdition` sentence and the `requireCapability` sentence) to the new rule in the same words as CLAUDE.md.

`nexo/knowledge/reference/modulos-por-organizacao.md` (new; one sentence per line): sections `Tabela`, `Backfill do token (compat)`, `Capability para modulo` (the `CAPABILITY_MODULES` table), `Projecao de edicao`, `Rota de administracao`, `Etapa de orcamento`, `Dev-fake` (the two leads identities backfill into the LOCAL database on their first request), `Fora do escopo` (no module screen: onboarding is out of scope; a toggle is an admin API call), `Oraculos`. Slice 12b appends a `Web` section.

## Commands

- Oracle: `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run src/domains/org-modules/__tests__/org-modules-routes.integration.test.ts` (3 runs).
- Focused: `pnpm --filter @fxl-sales/api exec vitest run src/domains/org-modules src/middleware/__tests__/edition-gate-map.test.ts`.
- Affected: `pnpm --filter @fxl-sales/api test`; `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-edition.test.ts test/rls/lead-stages-seed-on-read.test.ts`.
- `pnpm --filter @fxl-sales/api lint`, `pnpm --filter @fxl-sales/api type-check`.
- Guards: `node --test scripts/__tests__/hub-sdk-pin.test.mjs scripts/__tests__/fxl-contracts-pin.test.mjs scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs scripts/__tests__/dev-identity-docs-reconciliation.test.mjs scripts/__tests__/brand-and-technical-ids.test.mjs`.

## Risks

- ORCHESTRATOR DECISION: `PUT /org-modules` is open to any organization ADMIN (as requested), so an org admin can switch a module on for their own organization. If modules become a commercial entitlement, restrict PUT to a platform operator before onboarding. Not decided here.
- No audit trail of who toggled (`source = 'admin'` and `updated_at` only). An `AuditActionSchema` addition and a same-transaction `audit_log` write are the natural follow-up.
- Turning `orcamentos` off for an org that already has propostas hides the screens but keeps the data; the settlement and integration emitters are not gated by modules in this run.
- The stage-rule call sites depend on phase 2 names; the grep in Design 3 is the contract, and test 8 is the net.
