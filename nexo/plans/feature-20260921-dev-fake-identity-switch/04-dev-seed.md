---
id: 04-dev-seed
milestone: v4.1.0
status: todo
depends_on: ["02-api-dev-adapter"]
files_modified:
  - apps/api/scripts/seed-dev.ts
  - apps/api/scripts/seed/plan.ts
  - apps/api/scripts/__tests__/seed-plan.test.ts
  - apps/api/tsconfig.scripts.json
  - apps/api/vitest.config.ts
  - apps/api/package.json
  - scripts/__tests__/local-database-guard.test.mjs
  - CLAUDE.md
acceptance:
  - "A deterministic, idempotent seed creates, in the LOCAL Postgres, one complete dataset per org id the dev-fake roster references, so tatico/dashboard, operacional/vendas, operacional/leads, cadastros/* and meus-dados/* all open with rows instead of empty states."
  - "The seed is a THIRD guarded entrypoint: it calls assertLocalDatabase with namedEnvFile hard-coded to null, it loads its environment only through loadEnvFiles, and it refuses any org id that is not prefixed org_fake_."
  - "scripts/__tests__/local-database-guard.test.mjs is extended from two named paths to THREE, with new negative fixture cases that re-spawn against mutated trees and assert a non-zero exit, so the guard's property stays proven rather than merely invoked."
  - "Every seeded org carries the two system funcoes vendedor and finder with isSystem true, and every pessoa carries at least one funcao through sales_ops_person_funcoes."
  - "Every identity in the roster has a pessoa in every org its workspaces list, bound by hub_account_id to that identity's accountId, so the server-side seller scoping on the leads board resolves instead of answering seller_person_unmapped."
  - "Running the seed twice leaves byte-identical database state, and the plan builder is pure: it reads no wall clock, no process.env and no database."
  - "pnpm run lint, pnpm run type-check, pnpm test and pnpm run build stay green, and no existing test title or assertion is loosened."
goal: >
  A deterministic, idempotent, local-only dev seed for the dev-fake identity roster, split into a PURE
  plan builder and a dumb writer, wired as an apps/api script, and guarded as the third
  assertLocalDatabase entrypoint with the structural guard test extended to match.
must_not_break:
  - "The two-entrypoint property of the local-database guard becomes a three-entrypoint property. It must never become 'three entrypoints, two of them proven'."
  - "apps/api/src/server.ts and apps/api/src/db/migrate.ts are BYTE-UNCHANGED by this slice."
  - "apps/api/src/db/local-database-guard.ts is BYTE-UNCHANGED by this slice. It is PURE: it imports nothing, performs no I/O and never reads process.env. The seed adapts to the guard, never the other way round."
  - "apps/api/src/config/env-files.ts is BYTE-UNCHANGED by this slice."
  - "Nothing under apps/api/src/ is added, moved or edited. The seed lives outside rootDir so tsc never emits it into dist/, which is what keeps the dev-only roster out of the production image."
  - "No migration is added, altered or re-generated. The seed writes rows, never DDL."
  - "audit_log is not written by the seed, and neither are hub_bff_sessions or hub_bff_login_txns."
  - "The Makefile is NOT edited by this slice. Slice 06 owns it."
  - "No existing test in scripts/__tests__/local-database-guard.test.mjs loses an assertion. The only permitted edit to an existing test there is one that WIDENS its scope to cover the third file."
rules:
  - "Integer CENTS everywhere. Percentages are numeric(5,2) strings such as '5.00'."
  - "Receivable labels follow the load-bearing conventions: 'N/M' for installment N of M, 'MN/M' for recurring cycle N of M with the literal M prefix, because deriveWizardPrefill parses that prefix."
  - "Every seeded row must be shaped exactly like a row the API itself would write. When a snapshot column's value is not obvious, READ buildSaleLedger and the sales-ops service and copy what they write. Do not invent a value."
  - "Tenant tables are written through getDb() inside withTenant, never through getAdminDb()."
  - "Every insert and every delete is scoped by org_id."
  - "Nothing in the seed reads user_id, org_id, account_id or workspace_id from a request body, because the seed serves no requests."
verifier_focus:
  - "Run `node --test scripts/__tests__/local-database-guard.test.mjs` and confirm the reported pass count matches the number recorded in the file's header comment and in CLAUDE.md. A vacuous run is the failure mode this file exists to prevent."
  - "Confirm every negative fixture in that file writes ALL THREE inspected sources, so 'FAILS when a file is missing' fails for the reason it names."
  - "Confirm apps/api/src/server.ts, apps/api/src/db/migrate.ts, apps/api/src/db/local-database-guard.ts and apps/api/src/config/env-files.ts are byte-unchanged in this slice's diff."
  - "Confirm apps/api/scripts/ produces nothing under apps/api/dist/ after `pnpm --filter @fxl-sales/api build`."
  - "Confirm buildDevSeedPlan is called by the pure test with no database, no dotenv and no roster import."
---

# 04 - dev seed

## 1. Why this slice has TWO obligations and not one

`CLAUDE.md`, under "Local database guard", states that there are exactly TWO entrypoints guarded by `assertLocalDatabase`, that the number two is deliberate rather than incidental, and, literally, that a third call site is not free.
The reason it gives is precise: the guard's value is not that the call exists somewhere, it is that BOTH doors are PROVEN guarded by `scripts/__tests__/local-database-guard.test.mjs`, and that test names those two paths.
It then says, in the same bullet, that adding a call site means adding its assertion in the same change.

A seed writes to the database.
It is a third door, and it is the second most dangerous one in the tree after `migrate.ts`, because it DELETES rows before it inserts them.

So this slice has two obligations, and the second one is the one that is easy to skip:

1. The seed calls `assertLocalDatabase` and refuses a non-local host.
2. `scripts/__tests__/local-database-guard.test.mjs` grows from two named paths to three, with its own new negative fixture cases.

A seed that does only (1) passes green while quietly demoting the guard from a proven property to an unproven habit.
Nothing goes red on the day somebody deletes the call, and the next person reads a test file that names two files and concludes that two is still the whole truth.
Doing only (1) is therefore not a partial implementation of this slice, it is a regression of the guard, and the slice is not done.

## 2. Where the code goes, and why not under `src/`

`apps/api/tsconfig.json` sets `rootDir: ./src` and `include: ["src/**/*"]`, and `pnpm --filter @fxl-sales/api build` runs plain `tsc`.
Anything placed under `src/` is therefore COMPILED INTO `dist/`, which is what the production image runs.
The seed reads the dev-fake identity roster, which is a devDependency that is physically absent from a production install, so a seed under `src/` would either break the production build or ship a dev-only path into the image.

The seed therefore lives in `apps/api/scripts/`, outside `rootDir`, exactly as the reference implementation in `fxl-finance` does.
That placement has two consequences this slice must wire explicitly, because `fxl-sales` does not have the seams `fxl-finance` has:

- `apps/api/tsconfig.json` does not cover `scripts/`, so the seed would be UNTYPED unless a second tsconfig is added.
- `apps/api/vitest.config.ts` includes only `src/**/__tests__/**/*.test.ts`, so a test under `scripts/__tests__/` would never run.

Both are wired in section 7.

### File layout

| Path | Role |
| --- | --- |
| `apps/api/scripts/seed/plan.ts` | The PURE plan builder. No I/O, no `process.env`, no clock, no roster import. |
| `apps/api/scripts/seed-dev.ts` | The WRITER. Guard, env, connection, delete, insert. No data decisions. |
| `apps/api/scripts/__tests__/seed-plan.test.ts` | The pure oracle for the plan. Runs with no database. |
| `apps/api/tsconfig.scripts.json` | Type-checks `scripts/` with `noEmit`. |

## 3. The pure plan builder

`apps/api/scripts/seed/plan.ts` follows the same discipline as `apps/api/src/db/local-database-guard.ts`: it DECIDES, it does not act.
Every input arrives as an argument.
It imports nothing that reads the environment, opens a connection, or looks at the clock.

### 3.1 It does not import the roster

`plan.ts` declares its OWN minimal structural input types and imports nothing from the dev-fake identity package, not even a type.

```ts
export interface SeedIdentity {
  accountId: string;
  /** Every org this identity can ever be active in, including activeWorkspaceId. */
  workspaceIds: string[];
  workspaceRole: 'owner' | 'admin' | 'member';
  productRoles: string[];
  name: string;
  email: string;
}
```

Two reasons, both load-bearing.
First, it keeps `plan.ts` testable with literal fixtures, with no dev package in the test's import graph at all.
Second, acceptance 6 requires every access to the identity package to be a DYNAMIC import, and slice 05 ships a tracked-file guard that enforces it.
A structural input type owned by this module cannot be caught by that guard and cannot drift into a static dependency.

`seed-dev.ts` performs the dynamic import and MAPS the real roster onto `SeedIdentity[]`.
That mapping is the only place in this slice that knows the roster's real field names.
If slice 01 named a field differently from the shape above, the executor adapts the MAPPING in `seed-dev.ts` and leaves `plan.ts` alone.
Under no circumstance does this slice re-declare the roster, re-derive the org ids, or hard-code an org id list.

### 3.2 Entry point

```ts
export function buildDevSeedPlan(input: {
  orgIds: string[];
  identities: SeedIdentity[];
  cutoff: SeedCutoff;      // { iso, year, month, day }
}): DevSeedPlan;
```

`DevSeedPlan` is `{ rows: { <table>: readonly Row[] } }`, one key per table in `SEED_WRITE_ORDER`.

Also exported:

- `DEV_SEED_ORG_PREFIX = 'org_fake_'`
- `assertFakeOrgIds(orgIds: string[]): string[]` - returns violation LINES, empty when clean, in the same decide-do-not-print shape as `assertLocalDatabase`.
- `SEED_WRITE_ORDER` and `SEED_DELETE_ORDER` - arrays of table keys.
- `deterministicUuid(name: string): string`
- `seededFuncaoSlugsFor(identity: SeedIdentity): string[]`

### 3.3 Determinism

Every primary key is `deterministicUuid(<stable name>)`, never `defaultRandom()`.
`deterministicUuid` takes SHA-256 of `'fxl-sales-dev-seed:' + name`, uses the first 16 bytes, forces the version nibble to `4` and the variant bits to `10`, and formats the canonical 8-4-4-4-12 hyphenation.
`node:crypto` is the one Node import `plan.ts` may make, and it is pure.

Stable names are built from the org id and a role string, for example `` `${orgId}:funcao:vendedor` `` or `` `${orgId}:sale:1:receivable:M03` ``.
Deterministic ids are what make "delete then insert" produce byte-identical state rather than merely equivalent state, and they are what let the pure test assert id stability with no database.

There is no wall clock.
`SeedCutoff` is the single time anchor.
`seed-dev.ts` defaults it to `2026-09-01` and accepts `SEED_CUTOFF=YYYY-MM-DD` as an override, validating the shape with `/^\d{4}-\d{2}-\d{2}$/` and falling back to the default on anything else.
Every `created_at`, `updated_at`, `base_date`, `won_at`, `lost_at`, `due_date` and `stage_changed_at` is written EXPLICITLY from the cutoff, never left to `defaultNow()`, because a defaulted timestamp is the one thing that would differ between two runs.

Month arithmetic CLAMPS to the last valid day of the target month and is always computed as an absolute month offset from the anchor, never stepped one month at a time.
That matches `addMonths` in `apps/api/src/domains/sales-ops/service.ts` and `addMonthsToIsoDate` in the web calculations, and it is why a January anchor does not drift after a clamped February.

### 3.4 The funcao rule for an identity-bound pessoa

```
seededFuncaoSlugsFor(identity):
  if identity.workspaceRole is 'owner' or 'admin', or productRoles includes 'admin'
      -> ['vendedor', 'finder']
  else
      -> ['vendedor' if productRoles includes 'seller'] + ['finder' if productRoles includes 'finder']
  if the result is empty
      -> ['vendedor']
```

The first branch mirrors `getRolesFromHubClaims` in `apps/web/src/auth/claims.ts`, where a workspace `owner` or `admin` yields all three app roles.
The last branch exists because CLAUDE.md states that a person write is a FULL SET REPLACEMENT and that the API rejects an empty set with `funcao_required`.
A seeded pessoa with zero funcoes would be a row the app can display and cannot save, which is a worse state than a harmless extra assignment.
The zero-role identity never reads a cadastro screen anyway, because it lands on `/no-role`.

Funcoes are not what decides workspace visibility.
Visibility comes from the claims, through `getRolesFromHubClaims` and `getVisibleWorkspaces`, and this rule must never be described as if it did.

## 4. What the seed creates

Everything below is PER ORG, for every org id in `orgIds`, with no per-org branching except where stated.
The org id enters only through `deterministicUuid` and through the identity-binding rule, so the dataset is the same shape everywhere and the org ids stay whatever the roster says they are.

### 4.1 The org itself

There is no `orgs` table in this repository.
Tenancy is keyed on a plain `org_id` text column on every tenant table, and an org "exists" by having rows.
Migrations `0012_sales_ops_funcoes.sql` and `0022_sales_ops_leads.sql` both define the set of orgs as `DISTINCT org_id` over `sales_ops_people UNION sales_ops_settings UNION sales_ops_sales`, so `sales_ops_settings` is the closest thing this schema has to an org registry, and its `org_id` is its primary key.

The seed therefore writes exactly one `sales_ops_settings` row per org, and that row IS the org.

Values: `legalName` a readable label derived from the org id, `document` `''`, `defaultSellerCommissionPct` `'5.00'`, `defaultFinderCommissionPct` `'3.00'`, `defaultTaxPct` `'12.00'`, everything else left at the column default but written explicitly.

### 4.2 Areas

Three, all `active`: `Desenvolvimento`, `Design`, `Consultoria`.
Unique on `(org_id, name)`.

### 4.3 Funcoes

Four rows.

| name | slug | isSystem | status |
| --- | --- | --- | --- |
| Vendedor | vendedor | true | active |
| Finder | finder | true | active |
| Designer | designer | false | active |
| Desenvolvedor | desenvolvedor | false | active |

The two system rows are required by acceptance 9 and by CLAUDE.md, which says `vendedor` and `finder` are the only system funcoes, are seeded per org, and cannot be renamed or archived.
The `sales_ops_funcoes_system_slug_check` CHECK permits `is_system` only on those two slugs.
The two non-system rows exist so the proposta wizard's `FUNCAO NO PROJETO` picker, the `Custos padrao por funcao` section and `cadastros/funcoes` are all non-empty, and so that `sales_ops_product_funcao_costs` has legal targets: CLAUDE.md says a new funcao cost row draws from active NON-SYSTEM funcoes only.

### 4.4 Lead etapas

Four rows, byte-identical in name, kind, is_system and position to what migration `0022_sales_ops_leads.sql` seeds, so a fake org is indistinguishable from a migrated one.

| name | kind | isSystem | position |
| --- | --- | --- | --- |
| Novo | normal | false | 1 |
| Em negociação | normal | false | 2 |
| Proposta | conversion | true | 3 |
| Perdido | lost | true | 4 |

`sales_ops_lead_stages_system_kind_check` holds `is_system` equal to `kind <> 'normal'`, and the partial unique index on `(org_id, kind) WHERE kind <> 'normal'` permits exactly one conversion stage and one lost stage.
`Perdido` is the terminal negative stage that requires a reason, and the seed exercises that by giving its one lead a `lost_reason`.

### 4.5 Pessoas

Two groups.

**Identity-bound pessoas.** For EVERY identity in `identities`, and for EVERY org id in that identity's `workspaceIds` that is also in `orgIds`, one pessoa:

- `id` = `deterministicUuid(`org:person:account:accountId`)`
- `displayName` = `identity.name`
- `contactEmail` = `identity.email`
- `hubAccountId` = `identity.accountId`
- `status` `'active'`
- funcoes = `seededFuncaoSlugsFor(identity)`

This is the most important row in the whole seed and the easiest to leave out.
`resolveCallerPersonId` in `apps/api/src/domains/sales-ops/leads/lead-service.ts` resolves the caller's pessoa by `hub_account_id = scope.userId` first, and falls back to an unclaimed pessoa whose `contact_email` matches, refusing when two match.
Without a bound pessoa the seller-scoped lead board answers `seller_person_unmapped`, and `meus-dados/leads` is empty for exactly the identity the feature exists to reach.
Binding EVERY listed workspace and not only `activeWorkspaceId` is deliberate: an identity that switches org in the app must not fall off its own board on arrival.

The partial unique index `sales_ops_people_org_hub_account_idx` is on `(org_id, hub_account_id) WHERE hub_account_id IS NOT NULL`, so one pessoa per account per org, which this rule satisfies by construction.

**The fixed cast.** Three pessoas per org, all with `hubAccountId` NULL, so `cadastros/pessoas` has more than the operator's own row and so the pickers have something to pick.

| displayName | funcoes |
| --- | --- |
| Marina Vendas | vendedor |
| Caio Indica | finder |
| Rita Projeto | designer, desenvolvedor |

The deprecated mirrors `is_seller`, `is_finder` and `is_collaborator` are written EXPLICITLY, consistent with the funcoes, matching what `deriveBooleanMirrors` in the service writes on a real person write.
The web no longer declares them, but the API still returns them, and a seeded row that disagrees with its own funcoes would be a shape the app never produces.

### 4.6 Clientes

Three: `Construtora Ipê`, `Aurora Labs`, `Meridiano Log`.
The accent on `Ipê` is deliberate: `findClientByName` folds case, accents and whitespace, and a seeded accented name keeps that path honest during manual review.

### 4.7 Produtos e servicos

Four rows, two of each `kind`.
`open_price` is a server-written projection of `kind`, held equal by `sales_ops_products_kind_open_price_check`, so every `service` row carries `openPrice: true` and every `product` row carries `false`.
`code_suffix` is unique per org.

| name | kind | area | codeSuffix | setupBrl | hasMonthly | monthlyBrl | entrada | restante | ciclos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Plataforma FXL | product | Desenvolvimento | `1` | 2_000_000 | true | 150_000 | pct `30.00` | 2 | 12 |
| Landing Page | product | Design | `2` | 450_000 | false | 0 | none | 2 | null |
| Consultoria Estratégica | service | Consultoria | `3` | 800_000 | false | 0 | fix 200_000 | 4 | null |
| Suporte Dedicado | service | Consultoria | `4` | 0 | true | 300_000 | none | 1 | null |

`Suporte Dedicado` carries `setupBrl: 0`, which is the whole expression of "no base value": the list prints `Variável` rather than `R$ 0,00`, and there is no separate flag.
`Consultoria Estratégica` carries a base value of 800_000, which is what proves a Servico MAY have one.
`sales_ops_products_default_entrada_mode_check` requires `none` to carry BOTH `defaultEntradaPct` and `defaultEntradaBrl` NULL, `pct` to carry only the pct, and `fix` to carry only the brl.
The literal is `fix`, never `fixed`.
`defaultRecurringCycles: null` on three rows is prazo indeterminado.
Commission columns are `numeric(5,2)` strings: seller `'5.00'`, seller-with-finder `'3.00'`, finder `'3.00'`, with `sellerCommissionType` and friends left at `'pct'`.

`providers` is deprecated and is written as the empty jsonb array the column defaults to.

### 4.8 Custos padrao por funcao

Two rows, both on `Plataforma FXL`:

- `{ funcao: designer, mode: 'pct', valuePct: '5.00', valueBrl: null }`
- `{ funcao: desenvolvedor, mode: 'fix', valueBrl: 400_000, valuePct: null }`

`sales_ops_product_funcao_costs_mode_check` enforces the exclusivity, the unique index is on `(product_id, funcao_id)`, and the composite FK is on `(org_id, funcao_id)`.
Neither row names a system funcao, per CLAUDE.md.
`valueBrl` is integer CENTS and must never be formatted with `formatProductCommission`.

### 4.9 Propostas

Four, `sequence` 1 to 4, `code` = `` `${String(sequence).padStart(4, '0')}-${codeSuffix of the first item's produto}` ``, copying `createSale` exactly.

| # | status | cliente | itens | recorrencia | receivables | payables |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | won | Construtora Ipê | 1 x Plataforma FXL @ 2_000_000 | 150_000 x 12 | 3 installments + 12 recurring | full materialization |
| S2 | open | Aurora Labs | 1 x Landing Page @ 450_000 | none | `1/2`, `2/2` @ 225_000 | none |
| S3 | draft | Meridiano Log | 1 x Consultoria Estratégica @ 800_000 | none | `1/1` @ 800_000 | none |
| S4 | lost | Aurora Labs | 1 x Suporte Dedicado @ 500_000 | none | `1/1` @ 500_000 | none |

Payables exist only on S1 because CLAUDE.md says payables materialize ONLY when a proposta transitions to `won`.
S4 went `open` to `lost` without ever passing `won`, so its receivables stay `open`: voiding happens only when LEAVING `won`, and seeding them `void` would be a state the app cannot produce.

**Seller and finder.**
Define `primarySeller(org)` as the identity-bound pessoa in that org carrying `vendedor`, chosen by lowest `accountId` for determinism, falling back to `Marina Vendas` when the org binds none.
S1 and S3 take `primarySeller`, S2 and S4 take `Marina Vendas`.
S1 and S4 additionally carry `Caio Indica` as finder; S2 and S3 carry none.
At least one won proposta belonging to the operator's own pessoa is what makes `meus-dados/vendedores` and `meus-dados/comissoes` meaningful rather than merely non-empty.

**S1's receivables, spelled out**, because the labels are load-bearing:

- `1/3` at 600_000 (the 30 percent entrada of the 2_000_000 itens total), due on the cutoff, status `paid`
- `2/3` at 700_000, due cutoff plus 1 month, status `open`
- `3/3` at 700_000, due cutoff plus 2 months, status `open`
- `M1/12` through `M12/12` at 150_000 each, due cutoff plus 1 to 12 months, status `open`

`deriveWizardPrefill` parses the `M` prefix to split installment rows from recurring rows when prefilling the edit wizard, so the prefix is not decoration.
The three installments sum to exactly the itens total, which is what `validatePaymentPlan` requires; the last restante row absorbs any floor remainder, matching `splitInstallmentsEqually`.
One `paid` row exists so the paid branch of `operacional/comissoes` is reachable.

**S1's professionals.** One row: `Rita Projeto`, funcao `designer`, `funcaoNameSnapshot` `'Designer'`, deprecated `role` written with the SAME string as the snapshot, `costBrl` 300_000, `costSplitBp` NULL.
NULL means the default, which is `cost_brl` distributed pro rata over the INSTALLMENT receivables only.

**S1's financial columns** are not hand-computed.
`plan.ts` calls `computeSaleFinancials` from `@fxl-sales/shared-utils/sale-financials` with `itemsTotalBrl` 2_000_000, `boundedRecurringBrl` 1_800_000, `receivableAmountsBrl` the 15 non-void amounts in due-date order, `sellerCommissionPct` 5, `finderCommissionPct` 3, `hasFinder` true, `taxPct` 12, `otherCostsBrl` 50_000, `professionalCostsBrl` 300_000, and writes `totalBrl`, `sellerCommissionBrl`, `finderCommissionBrl`, `taxBrl`, `netMarginBrl` and the `netMarginPct` STRING straight out of the result.
That is the one margin implementation, it is the server's algorithm verbatim, and using it is what makes the seeded `net_margin_brl` equal to what the app would have persisted.
Import the `/sale-financials` subpath, not the package root, because the root also re-exports a Node-only hmac module.
The same call is made for S2, S3 and S4 with their own inputs.

**S1's payables**, generated by `plan.ts` with these rules and no others:

- one `seller_commission` per non-void receivable, amount `pctOfCents(row.amountBrl, 5)`, skipped when that is 0
- one `finder_commission` per non-void receivable, amount `pctOfCents(row.amountBrl, 3)`, skipped when that is 0
- one `tax` per non-void receivable, amount `pctOfCents(row.amountBrl, 12)`, skipped when that is 0
- `professional_cost` split across the INSTALLMENT receivables only, never the `M`-prefixed recurring ones, using `defaultSplitBp` and `splitCentsByWeights` from `@fxl-sales/shared-utils`, with `saleProfessionalId` set to the originating `sales_ops_sale_professionals` row id and `receivableId` set to the parcela it is paid out of
- exactly one `other_cost`, `receivableId` NULL, `beneficiaryName` the literal `'Outros custos'`, amount 50_000, due on the won date

`pctOfCents`, `defaultSplitBp` and `splitCentsByWeights` are IMPORTED rather than re-implemented, so the rounding rule cannot drift from the server's.
The three payables derived from the `paid` `1/3` receivable are themselves `paid`; every other payable is `open`.
`beneficiaryName` on a commission payable is the pessoa's display name, matching what the service writes.

### 4.10 Leads

Six per org, so both lead boards, the parked-days badge, the converted-card rule and the admin-only unassigned case are all reachable.

| # | etapa | empresa | seller | estimado | stageChangedAt | notes |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | Novo | Construtora Ipê (clientId set) | primarySeller | 1_200_000 | cutoff minus 2 days | 1 lead produto: Plataforma FXL |
| L2 | Novo | `Padaria Aurora` (clientId NULL) | Marina Vendas | 350_000 | cutoff minus 12 days | 1 free-text lead produto: `Site institucional`, productId NULL |
| L3 | Em negociação | Aurora Labs | primarySeller | 900_000 | cutoff minus 30 days | 1 lead produto: Consultoria Estratégica |
| L4 | Perdido | Meridiano Log | Marina Vendas | 400_000 | cutoff minus 5 days | `lostReason` `'Preço acima do orçamento'` |
| L5 | Proposta | Construtora Ipê | S1's seller | 2_000_000 | cutoff minus 1 day | `saleId` = S1. This is the CONVERTED, read-only card. |
| L6 | Em negociação | `Oficina Norte` (clientId NULL) | NULL | 600_000 | cutoff minus 45 days | unassigned, visible to admins only |

`position` is 1-based within each etapa, in the order listed.
`clientNameSnapshot` is ALWAYS written, including when `clientId` is NULL, because the snapshot is the free-text fallback.
`estimatedValueBrl` is integer cents and is constrained `>= 0`.
`sellerNameSnapshot` is `''` for L6.
The partial unique index `sales_ops_leads_org_sale_idx` permits exactly one lead per venda, which L5 satisfies alone.
`stageChangedAt` moves only when the etapa changes, so seeding it away from `createdAt` is what makes the parked-days badge show a real number instead of zero everywhere.

### 4.11 What is deliberately left out, and why

**No archived rows, in any cadastro.**
An archived produto, area or funcao is hidden from every list and every picker, and the only screen that can restore it is `Histórico de arquivamentos`, which reads `audit_log`.
CLAUDE.md requires every audited write to go through `writeAuditEntry` with the REAL transaction of the REAL service path, in a hash-chained, append-only ledger that is never purged and is protected by a `DEFERRABLE INITIALLY DEFERRED` constraint trigger.
A seed that forged ledger entries would be inserting unverifiable rows into a hash chain, and a seed that archived rows WITHOUT ledger entries would produce rows that appear in no list and in no history, which is a worse dead end than an empty one.
So the seed writes nothing archived and writes nothing to `audit_log`, and the archive and restore flows are exercised by archiving a seeded row by hand through the UI, which is the path that writes the ledger correctly.

**No `hub_bff_sessions` and no `hub_bff_login_txns`.**
Those are global, non-tenant tables with FORCE RLS and only the `app.fxl_admin` policy, reachable exclusively through `getAdminDb()`.
The dev-fake path mints its own token and never completes a Hub BFF login, so no session row is needed.
Because the seed touches neither, it never needs the admin connection at all, which is the argument in section 5.

**No `sales_ops_settings` variation between orgs.**
One settings shape is enough to make every screen render, and per-org variation would be data nobody reads.

**No second conversion or lost etapa, and no extra normal etapas.**
The four the migration seeds are the contract; adding a fifth would make a fake org distinguishable from a migrated one for no benefit.

## 5. Which connection, and why

The seed writes ONLY tenant tables, every one of which carries `org_id` and a tenant-isolation RLS policy of the form `org_id = current_setting('app.current_org_id', true)`, plus an admin-context policy of the form `current_setting('app.fxl_admin', true) = 'true'`.

The seed uses `getDb()` inside `withTenant(db, orgId, ...)`, which is exported from `apps/api/src/domains/sales-ops/service.ts` and which opens one transaction and calls `setTenantContext(tx, orgId)` before any query.
One transaction per org.

`getAdminDb()` is NOT used, and the reason is not stylistic.
The admin connection sets `app.fxl_admin` and therefore satisfies the admin policy on every table, which means it can write rows that the ordinary tenant connection cannot read back.
Seeding through the tenant policy proves, at insert time, that every seeded row is a row the product can actually see.
A seed that only works under the admin connection is a seed that can silently produce an invisible dataset, which is the exact failure the operator would then spend an afternoon debugging in the UI.

One transaction PER ORG rather than one for all of them is also deliberate.
It scopes each org's writes at the database rather than in application code, so a bug in the plan cannot write org A's rows into org B: the RLS `WITH CHECK` refuses it.
The cost is that the seed is not atomic across orgs, and that is acceptable for a development seed whose recovery is to run it again.

`closeDb()` is awaited at the end so the process exits instead of hanging on an open pool.

## 6. The writer

`apps/api/scripts/seed-dev.ts` is a WRITER and not a planner.
Its only database operations are, per org, one delete per `SEED_DELETE_ORDER` entry and one insert per `SEED_WRITE_ORDER` entry, taken straight from `plan.rows`.
No read-back of a generated id, no conditional read, no per-org branching.
That is what makes "the plan is deterministic", asserted with no database at all, equivalent to "the resulting database state is deterministic".

### 6.1 Static imports

`seed-dev.ts` statically imports EXACTLY three things:

```ts
import { API_ROOT_DIR, loadEnvFiles } from '../src/config/env-files.js';
import { assertLocalDatabase } from '../src/db/local-database-guard.js';
import { buildDevSeedPlan, assertFakeOrgIds, SEED_DELETE_ORDER, SEED_WRITE_ORDER } from './seed/plan.js';
```

All three are pure with respect to the database.
Everything else, the roster, `getDb`, `withTenant`, `closeDb`, the schema tables and `drizzle-orm`'s `inArray`, is loaded with `await import(...)` INSIDE `main()`.

This mirrors `server.ts`, and for the same reason recorded in CLAUDE.md: ESM evaluates the ENTIRE static import graph before the first statement of the module body runs, so a static import of anything that reads `DATABASE_URL` or the Hub configuration at module scope would throw BEFORE the guard's lines are ever printed, burying the guard's verdict under an unrelated module-load failure.
This is not untidiness waiting to be cleaned up, and converting it to plain static imports is exactly the change someone will make.

### 6.2 Order of operations in `main()`

1. `const { namedEnvFile } = loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });`
   The ONE shared resolver, never a bare `import 'dotenv/config'`.
   It loads `.env`, then `.env.local` with override, then a named file last, and it THROWS on an unreadable named file rather than falling back to the default environment.
   Its return value is read and then deliberately DISCARDED, see step 3.

2. If `process.env.DATABASE_URL` is unset, print `DATABASE_URL is required` and exit 1.
   Do this AFTER step 1, because dotenv populates `process.env` inside that call.

3. The guard, with `namedEnvFile` hard-coded to `null`:

```ts
const violations = assertLocalDatabase({
  nodeEnv: process.env.NODE_ENV ?? '',
  databaseUrl: process.env.DATABASE_URL,
  namedEnvFile: null,
});
```

   `null` and not the value from step 1, deliberately.
   This entrypoint DELETES rows.
   `SALES_ENV_FILE` is the escape hatch that lets `make back-stg` reach staging on purpose, and seeding a shared database is never the right thing to do, so this door does not accept it: a `SALES_ENV_FILE` that loads a staging `DATABASE_URL` still gets refused here.
   Print every violation line, then an additional line saying this seed has no named-env-file escape hatch because it deletes rows and the only fix is to point `DATABASE_URL` at the local database, then exit 1.

4. `const orgViolations = assertFakeOrgIds(orgIds);` after the roster has been dynamically imported and mapped.
   If non-empty, print and exit 1 before any connection is opened.
   The second rail: the seed only ever touches org ids prefixed `org_fake_`, so a real org id can never match, which is what makes the delete safe even if somebody points a local database at a restored production dump.

5. Print exactly ONE boot line naming HOST and PORT, gated on `NODE_ENV !== 'production'`, using `describeDatabaseTarget`.
   Host and port only, never the user, the password, the database name or the whole URL.
   Its absence is what made the 2026-09-16 staging write invisible.

6. Per org, in `orgIds` order, `withTenant(db, orgId, async (tx) => { deletes; inserts; })`.

7. Print a one-line summary of counts, `await closeDb()`, exit 0.
   On any throw, print `[seed] FAILED: <message>` and exit 1.

### 6.3 Delete order

Children first, every one scoped by `eq(table.orgId, orgId)`, inside the tenant transaction.
This order respects the `restrict` foreign keys, which are the real safety mechanism and must not be worked around:

```
salesOpsPayables
salesOpsReceivables
salesOpsSaleProfessionals
salesOpsSaleItems
salesOpsLeadProducts
salesOpsLeads
salesOpsSales
salesOpsLeadStages
salesOpsProductFuncaoCosts
salesOpsProducts
salesOpsPersonFuncoes
salesOpsPeople
salesOpsFuncoes
salesOpsClients
salesOpsAreas
salesOpsSettings
```

`salesOpsLeads` must precede `salesOpsLeadStages`, `salesOpsClients`, `salesOpsPeople` and `salesOpsSales`, because all four of those FKs are `restrict`.
`salesOpsPersonFuncoes` must precede `salesOpsFuncoes` for the same reason, even though it cascades from `salesOpsPeople`.
`salesOpsPayables` goes first because its FK to `sales_ops_sale_professionals` is `restrict`.

### 6.4 Write order

Parents first:

```
salesOpsSettings
salesOpsAreas
salesOpsFuncoes
salesOpsPeople
salesOpsPersonFuncoes
salesOpsClients
salesOpsProducts
salesOpsProductFuncaoCosts
salesOpsLeadStages
salesOpsSales
salesOpsSaleItems
salesOpsSaleProfessionals
salesOpsReceivables
salesOpsPayables
salesOpsLeads
salesOpsLeadProducts
```

`salesOpsLeads` comes after `salesOpsSales` because L5 names S1.

### 6.5 Idempotency strategy

Delete the fake orgs' rows, then insert the plan.
Combined with deterministic ids and an explicit cutoff, a second run produces byte-identical state, which is a stronger property than "does not crash on a second run".

`ON CONFLICT DO NOTHING` was considered and rejected: it makes the seed's output depend on what was already there, so an edit to the plan would silently not apply and the operator would debug the UI instead of the seed.
Delete-then-insert is safe here precisely because of the `org_fake_` rail and the FK `restrict` edges, which together mean the seed can only ever destroy its own data and will fail loudly rather than cascade into anything else.

## 7. Wiring

### 7.1 `apps/api/package.json`

Add one script:

```json
"db:seed:dev": "tsx scripts/seed-dev.ts"
```

The name carries `dev` for the same reason the guard carries a boot line: a script named `db:seed` sitting next to `db:migrate` is one tab-completion away from being run somewhere it should not be.

Change `type-check` to cover the new directory:

```json
"type-check": "tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json"
```

Change `lint` to cover it too:

```json
"lint": "eslint src/ scripts/"
```

`apps/api/eslint.config.js` applies its rules to every file it is given and ignores only `dist/` and `node_modules/`, so no config change is needed; if the executor finds otherwise, add the glob rather than exempting the directory.

PLAN-CHECK RULING, 2026-09-21: do NOT touch the `devDependencies` block at all.
Slice 02 owns that line, this slice depends on 02, so `@fxl-sales/auth-fake` is already there under
`devDependencies` when this slice runs.
Two slices claiming one key in one file is how a wave merge loses one of them, and the check costs
nothing: `grep -n 'auth-fake' apps/api/package.json` before touching the file, and if it is somehow
absent, add it under `devDependencies` and record that in the slice notes.

### 7.2 `apps/api/tsconfig.scripts.json` (new)

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["scripts/**/*"]
}
```

`noEmit` is the point: `scripts/` is type-checked and never compiled.
`apps/api/tsconfig.json` is NOT edited, so `pnpm --filter @fxl-sales/api build` keeps emitting `src/` and only `src/`.

### 7.3 `apps/api/vitest.config.ts`

In the NON-integration branch only, widen `include`:

```ts
include: ['src/**/__tests__/**/*.test.ts', 'scripts/**/__tests__/**/*.test.ts'],
```

Leave `exclude`, `setupFiles`, `passWithNoTests` and the entire integration branch untouched.
`test/unit-setup.ts` blanks `SALES_ENV_FILE` alongside the six Hub credential names, which is exactly what keeps the new pure test independent of the developer's shell.

### 7.4 The Makefile, which this slice does NOT touch

Slice 06 owns `Makefile` and adds the wrapper.
For its benefit, the intended shape is recorded here and nowhere else:

PLAN-CHECK RULING, 2026-09-21: slice 06 owns the Makefile and names the target `db-seed`, in the
existing `# --- Database ---` section rather than inside the dev-fake block.
That name wins, and the sketch below is corrected to it.
The pnpm SCRIPT name `db:seed:dev` is this slice's and is unchanged.

```make
db-seed: ## Seed the local database with the deterministic development dataset
	pnpm --filter @fxl-sales/api db:seed:dev
```

and a `dev-fake-setup` that runs `db-up`, then `migrate`, then `db-seed`, in that order, because the seed writes rows into tables the migrations create.
There is deliberately no staging variant of any of these, for the same reason `make migrate-stg` does not exist.

## 8. The guard test, extended to three paths

This is obligation 2 from section 1, and it is the half that is easy to omit.

Edit `scripts/__tests__/local-database-guard.test.mjs`.
Preserve BOTH of its self-proving properties exactly:

- Each negative case runs THIS FILE as a child `node --test` process against a mutated fixture tree and reads the child's EXIT CODE. The message text is never the oracle, and the real sources are never written to.
- `runAgainst` strips every `NODE_TEST_`-prefixed key from the child env. `node --test` sets `NODE_TEST_CONTEXT` in each test file's process, and inheriting it makes the grandchild warn `run() is being called recursively within a test file`, run ZERO tests and exit 0, so every negative case would read as green while proving nothing. The positive control cannot catch that, because a vacuous child also exits 0. The four existing negatives are what catch it, and the new ones must inherit the same protection by going through the same `runAgainst`.

### 8.1 Changes

1. Add `const SEED_REL = 'apps/api/scripts/seed-dev.ts';`

2. Read it at MODULE SCOPE, inside the existing `try` that already reads the other two, into `seedSource`, sharing the same `loadError`.
   Module scope is load-bearing: a throw inside a test callback can end the run with zero tests executed and exit 0.

3. Add `const seedCode = stripComments(seedSource);`

4. Widen the existing readability test from two files to three.
   Its title becomes `every inspected file exists and is readable`.
   That is the ONLY title change in the file, it is a strengthening rather than a loosening, and it is recorded here so the Verify agent does not read it as an accommodation.

5. Widen the existing `the inspected files are the real entrypoints, not empty or substituted` test with plausibility assertions on the seed, keeping every existing assertion byte-unchanged:
   - `seedSource.length > 500`
   - it matches the dev-fake package specifier
   - it matches `/buildDevSeedPlan/`

6. NEW test, `` `${SEED_REL}` invokes ${GUARD_SYMBOL}` ``: assert `seedCode` matches `NAMED_IMPORT` and `CALL`.

7. NEW test, `` `${SEED_REL}` has no raw dotenv/config import` ``: assert `seedCode` does not match `RAW_DOTENV`.
   The reference implementation in `fxl-finance` DOES use a raw `config({ path })`, and this repository deliberately does not: `loadEnvFiles` is the one resolver and the reason it is the one resolver is that two loaders are how the entrypoint that applies DDL ended up with the weaker one.

8. NEW test, `` `${SEED_REL}` refuses the named-env-file escape hatch` ``: assert `seedCode` matches `/namedEnvFile:\s*null/`, and assert `seedCode` does NOT contain the token `SALES_ENV_FILE`.
   Comment stripping is what makes the second half possible: the seed legitimately EXPLAINS in prose why the hatch does not exist there, and a raw substring check would false-positive on its own explanation.

9. Every `makeFixture` call, existing and new, now writes ALL THREE sources unless the case is specifically about a missing file.
   Skipping this turns `FAILS when an inspected file is missing` into a test that passes for the wrong reason for every other case.

10. NEW negative cases, each asserting a NON-ZERO exit:
    - `FAILS when seed-dev.ts stops invoking the guard` - fixture built with `withoutCall(seedSource)`.
    - `FAILS when seed-dev.ts regains a raw dotenv/config import` - fixture prefixed with `import 'dotenv/config';\n`.
    - `FAILS when seed-dev.ts admits the named-env-file escape hatch` - fixture built by replacing `namedEnvFile: null` with `namedEnvFile: loadedNamedEnvFile`, asserting the replacement CHANGED the source, the same non-vacuity check `withoutCall` already performs.
    - `FAILS when the seed is missing` - fixture containing only `SERVER_REL` and `MIGRATE_REL`.

11. Update the file's header comment: it currently says the file answers three questions about two exact files.
    It now answers six questions about three, and the comment must say which, and must keep the paragraph explaining why this file reads named paths instead of shelling out to `git grep`.

### 8.2 The pass-count tripwire

CLAUDE.md records that a real run reports `# pass 10` and a fixture-mode run reports 5, and that the count is itself a tripwire.
Extending the file changes both numbers, so the numbers must be updated in the SAME change or the tripwire starts lying.

With the additions above the expected counts are 8 always-run tests, giving a fixture-mode run of 8, and 11 spawn tests on top, giving a real run of 19.

The executor MEASURES rather than trusts those figures: run `node --test scripts/__tests__/local-database-guard.test.mjs`, read `# pass`, and record the MEASURED numbers in two places:

- a line in the file's own header comment
- the single sentence in CLAUDE.md's "Local database guard" section that currently reads `A real run reports `# pass 10` and a fixture-mode run reports 5, so the count is itself a tripwire.`

That one sentence, plus the bullet naming the two guarded entrypoints, are the ONLY CLAUDE.md edits this slice makes.
That bullet becomes three entrypoints, naming `apps/api/scripts/seed-dev.ts` as the third and stating that the seed does not accept `SALES_ENV_FILE` because it deletes rows.
Everything else CLAUDE.md says about the guard stays byte-unchanged, and the slice that reconciles the parked `05-dev-identity-fixtures.md` prohibition must not revert these two edits.

PLAN-CHECK NOTE, 2026-09-21: `CLAUDE.md` is claimed by BOTH this slice and slice 07, in different
waves, so there is no textual merge conflict but there IS a silent-revert risk.
The ownership split is exact and is repeated in slice 07's `must_not_break`.
THIS slice owns exactly two lines, both inside `## Local database guard`: the bullet naming the
guarded entrypoints, and the sentence carrying the two `# pass` counts.
Slice 07 owns the new `## Development identity mode` section, the three lines appended to the
ONE-gate bullet in `## Auth Model`, and the two fenced `dotenv` blocks in `## Environments`.
Neither may edit the other's lines, and slice 07 runs later, so slice 07 is the one that must
verify both of this slice's edits are still present before it commits.

## 9. The pure oracle

`apps/api/scripts/__tests__/seed-plan.test.ts`, vitest, no database, no dotenv, no roster import.
Its input is two literal fixtures: `orgIds = ['org_fake_alpha', 'org_fake_beta']` and a hand-written `SeedIdentity[]` covering an owner, a seller-only, a finder-only, an admin+seller and a zero-role identity, with one identity listing BOTH orgs.

Named assertions:

**Determinism**
- `buildDevSeedPlan(INPUT)` deep-equals a second build.
- `JSON.stringify` of the two builds is byte-identical, which also pins row ORDER.
- No id repeats anywhere in the plan.
- With `vi.useFakeTimers()` set to two wildly different system times, the stringified plan is identical. This is the "does not read the wall clock" pin.
- Every ISO timestamp in the plan starts with the cutoff's year.

**Idempotence, structurally**
- Every `SEED_WRITE_ORDER` entry appears in `SEED_DELETE_ORDER`.
- `SEED_DELETE_ORDER` is the reverse-dependency order: assert explicitly that `salesOpsLeads` precedes `salesOpsLeadStages`, `salesOpsClients`, `salesOpsPeople` and `salesOpsSales`, that `salesOpsPersonFuncoes` precedes `salesOpsFuncoes`, and that `salesOpsPayables` precedes `salesOpsSaleProfessionals` and `salesOpsReceivables`.

**Tenancy**
- Every row in every table carries an `orgId` that is a member of `orgIds`.
- No row references an id belonging to another org: for every FK-shaped field, the referenced row exists in the SAME org's slice of the plan.

**The `org_fake_` rail**
- `assertFakeOrgIds(['org_fake_alpha'])` returns `[]`.
- `assertFakeOrgIds(['org_real_acme'])` returns a non-empty array naming the offender.
- `assertFakeOrgIds([])` returns `[]`.

**Funcoes**
- Every org has exactly two `isSystem: true` funcoes, with slugs `vendedor` and `finder`.
- No non-system funcao carries `isSystem: true`, which is what the database CHECK would refuse.
- Every pessoa in the plan has at least one `sales_ops_person_funcoes` row, and the test names the reason: a person write is a full set replacement and the API answers `funcao_required` to an empty set.

**Identity binding**
- For every identity and every org in its `workspaceIds`, the plan contains exactly one pessoa with `hubAccountId === identity.accountId` in that org.
- The identity listing two orgs has one bound pessoa in each.
- `seededFuncaoSlugsFor` is table-tested: owner yields both slugs, admin yields both, `productRoles: ['admin']` yields both, `['seller']` yields `['vendedor']`, `['finder']` yields `['finder']`, `[]` yields `['vendedor']`.

**Money**
- Every money field is an integer, asserted by sweeping the plan for the known money keys and checking `Number.isInteger`.
- The three S1 installment receivable amounts sum to exactly the S1 itens total.
- `S1.totalBrl` equals itens total plus bounded recorrencia.
- `S1.netMarginPct` is a `toFixed(2)` string.
- The plan's S1 financial columns equal a direct call to `computeSaleFinancials` with the same inputs, which is what proves the plan did not re-implement the arithmetic.

**Receivable labels**
- S1's installment labels are exactly `['1/3', '2/3', '3/3']`.
- S1's recurring labels are exactly `M1/12` through `M12/12`, every one carrying the `M` prefix.
- No recurring label is missing the prefix, named in the test as the `deriveWizardPrefill` pin.

**Payables**
- Only S1 has payables, named as the "payables materialize only at won" pin.
- `Σ professional_cost amounts === the professional's costBrl`, exactly.
- Every `professional_cost` payable points at an INSTALLMENT receivable, never at an `M`-prefixed one.
- Exactly one `other_cost` payable exists, with `receivableId === null` and `beneficiaryName === 'Outros custos'`.
- Every `seller_commission` amount equals `pctOfCents(its receivable amount, 5)`, imported from shared-utils rather than recomputed inline.

**Leads**
- Exactly one lead per org carries a non-null `saleId`, which is the converted card and what the partial unique index permits.
- Exactly one lead sits in the `lost` etapa and it carries a non-empty `lostReason`.
- Exactly one lead carries `sellerPersonId === null`.
- Every lead's `clientNameSnapshot` is non-empty, including the two with `clientId === null`.
- Every lead's `stageChangedAt` differs from its `createdAt`, named as the parked-days pin.

**Lead etapas**
- Exactly one `conversion` and exactly one `lost` etapa per org, and `isSystem === (kind !== 'normal')` on every row, which is what the database CHECK enforces.

## 10. Oracles

Named explicitly, and both must be run:

1. `scripts/__tests__/local-database-guard.test.mjs` - the EXTENDED structural guard, three named paths, run by `node --test` inside the root `pnpm run test`. This is the oracle for obligation 2 in section 1, and a slice that leaves it at two paths is not done.
2. `apps/api/scripts/__tests__/seed-plan.test.ts` - the pure plan oracle, run by `pnpm --filter @fxl-sales/api test` once `vitest.config.ts` includes the directory.

Supporting commands: `pnpm run lint`, `pnpm run type-check`, `pnpm test`, `pnpm run build`.

## 11. Manual check, once

Not a gate, but the thing the slice exists for.
With the local Docker database up and migrated, `pnpm --filter @fxl-sales/api db:seed:dev` prints one host and port line, one count line, and exits 0.
Running it a second time prints the same counts.
Pointing `DATABASE_URL` at any non-local host makes it print the three `[local-database-guard]` lines plus the no-escape-hatch line and exit 1, with `SALES_ENV_FILE` set or unset, identically.
