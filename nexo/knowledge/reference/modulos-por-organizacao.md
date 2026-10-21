# Modulos por organizacao

Reference for the per-organization module flags (phase 3, slice 11).
The rules live in `CLAUDE.md` (Edicao Leads and Auth Model); this file holds the reasoning and the tables.

## Tabela

The module set of an organization lives only in `sales_ops_org_modules`.
One row per key of `CRM_MODULE_KEYS` (`orcamentos`, `comissoes`, `financeiro`, `finders`, `catalogo`, `importacao`, `clientes`).
A key with no row reads as `false`, a row with an unknown key is ignored, and an unknown `source` reads as `default`.

## Backfill do token (compat)

An organization with NO row is backfilled once from the token's `entitlements.modules`, through `modulesForEdition(resolveSalesEdition(modules))`, with `source = 'token_backfill'`.
The backfill runs in one tenant transaction under a per-org advisory lock with `ON CONFLICT DO NOTHING`, so twelve concurrent first calls with mixed tokens write one coherent set.
After the backfill the token decides nothing for that org.
The backfill uses the first token seen, so a staging org whose first call carries an old session token would be backfilled `full`; before a release, compare each org against its Hub entitlement with a read-only query on `sales_ops_org_modules`, and fix with `PUT /org-modules` as an operator.

## Capability para modulo

`CAPABILITY_MODULES` in `@fxl-sales/shared-utils/crm-model` maps each capability to the modules that must all be enabled.
`proposals` -> `orcamentos`, `commissions` -> `comissoes`, `catalog` and `leadFullFields` -> `catalogo`, `clients` -> `clientes`, `import` -> `importacao`, `finders` -> `finders`, `history` -> `financeiro`.
`modulesAllowCapability` reproduces `hasCapability` for both editions, which is the parity oracle in `crm-model.test.ts`.

## Projecao de edicao

`editionFromModules(modules)` is `full` while `orcamentos` is on and `leads` while it is off.
It is a projection for the places that still take an edition (the people and lead service arguments, the web shell), never a capability decision.
`getSalesEdition(c)` in `apps/api/src/domains/org-modules/context.ts` is its request-level form.

## Rota de administracao

`GET /api/v1/sales-ops/org-modules` is `requireAdmin` and answers the modules and their sources.
`PUT /api/v1/sales-ops/org-modules` is `requireAdmin` plus `requireModuleOperator`: the account id must be listed in `SALES_MODULE_OPERATOR_ACCOUNT_IDS`, which is empty by default, so nobody can toggle until an operator is configured.
A refusal of the operator check is `403 {"error":"forbidden","code":"module_operator_required"}`, distinct from the admin body.
Neither route is capability gated, because an admin must always reach them.
`GET /bootstrap` carries `orgModules` next to every existing key.

## Etapa de orcamento

An `orcamento` stage opens a proposta (and answers `sale_required_for_conversion` on a move or advance) only while `orcamentos` is on (`stageActsAsOrcamento`).
With it off the stage is an ordinary stage: `GET /lead-stages` and `GET /pipelines` project `kind: 'normal'` and `behavior: 'none'`, and the import catalog reads it as a normal stage.
The stored `type` and `behavior` are never rewritten, so turning the module back on restores the stage exactly.

## Dev-fake

The two leads identities (`leads-owner`, `leads-seller`) backfill into the LOCAL database on their first request, because they carry the `sales.edition.leads` module claim.
`make db-reset` clears them.
To toggle a module by hand in development, set `SALES_MODULE_OPERATOR_ACCOUNT_IDS` to the fake identity's account id.

## Fora do escopo

There is no module screen: onboarding and module configuration are out of scope, and a toggle is an operator API call.
Turning `orcamentos` off for an organization that already has propostas hides the screens but keeps the data.
No audit entry is written for a module change yet (`source` and `updated_at` only); an `AuditActionSchema` addition is the natural follow-up.

## Oraculos

- `packages/shared-utils/src/__tests__/crm-model.test.ts` (parity and the pure helpers)
- `apps/api/test/rls/org-modules.test.ts` (backfill, concurrency, RLS, admin update)
- `apps/api/src/middleware/__tests__/edition-gate-map.test.ts` (exhaustive gate map)
- `apps/api/src/middleware/__tests__/require-capability.test.ts` (one query per request, store failure)
- `apps/api/src/middleware/__tests__/require-module-operator.test.ts` (operator allow-list)
- `apps/api/src/domains/org-modules/__tests__/org-modules-routes.test.ts` (admin routes, unit)
- `apps/api/src/domains/org-modules/__tests__/org-modules-routes.integration.test.ts` (the acceptance, real DB)

## Web (slice 12)

The navigation catalogue is one list per workspace in `apps/web/src/sales-ops/navigation.ts`, and every entry carries `requires` (the modules that must ALL be on).
The compact profile (`orcamentos` off) relabels `pessoas` to Vendedores and moves it first, and relabels the seller's `leads` to Prospecção.
The exact table of entries and the literal lists the equivalence oracle pins are in `navigation-edition.test.ts` and `navigation-modules.test.ts`.
The shell takes the modules from `GET /bootstrap` (`orgModules`); until the bootstrap settles, `modulesHintFromEdition(profile.edition)` stands in, and a failed bootstrap settles on the hint.
No `<Navigate>` fires while the modules are unknown, so a valid deep link of an organization whose modules differ from the token hint is never rewritten.
The shell publishes its modules through `OrgModulesContext` (`apps/web/src/auth/org-modules-context.ts`), and `useSalesEdition()` projects them (`orcamentos` off => `leads`) for the leaf chrome.
`profile.edition` is the token-derived hint: `NoRoleGuard` runs before any bootstrap, so a finder-only operator of an organization toggled away from its token may see `/no-role` until a reload.
That limitation is accepted; a second fetch in the auth provider would touch the token invariants.
The conversion kind of a board stage follows the effective `behavior` the API projects, never the stored `type`, so with `orcamentos` off a drop on the Proposta stage moves the lead and never opens the wizard.
There is still no module screen: a toggle is the operator API call above.
