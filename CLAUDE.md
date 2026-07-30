# CLAUDE.md

## Product

FXL Sales is the affiliate and referral product for FXL.
The product audience is `product.fxl-sales`.
Keep the repository folder name unchanged until the editor session can safely move.

## Stack

- API: Hono, Drizzle ORM, PostgreSQL, Zod, and `@fxl-business/hub-sdk`.
- Web: React, Vite, TypeScript, Tailwind, TanStack Query, React Router, and react-i18next.
- Auth and commerce: FXL Hub only.

## Auth Model

- The API mounts the Hub BFF at `/auth/*`.
- Local browser auth enters through same-origin web `/auth/*` routes.
- Vite proxies those routes to the API BFF, and the local registered callback is `http://localhost:8006/auth/callback`.
- Protected API routes use Hub bearer tokens through `appAuthMiddleware`.
- `requireHubAuth` verifies access tokens and exposes `c.get('hubAuth')`.
- `userId` is the Hub account id.
- `orgId` is the active Hub workspace id.
- Feature gates check `auth.claims.entitlements.modules`.
- The core module for this product is `sales.core`.
- Browser Hub access tokens are memory-only, cached until JWT `exp` minus 30 seconds, and concurrent `getToken()` calls share one in-flight refresh per provider; logout and workspace generation guards reject late responses.

## Tenancy

- Database tenancy remains keyed by `org_id`.
- Hub workspace ids must be provisioned to match existing org ids.
- Every tenant query must filter by `eq(table.orgId, c.get('orgId'))`.
- Never trust `user_id`, `org_id`, `account_id`, or `workspace_id` from request bodies.

## UI Identifiers

- Never render raw account or workspace ids in user-facing UI.
- Use display helpers such as `userLabel` and `orgLabel`.
- When a raw fallback is unavoidable for an operator screen, style it as muted monospace text.

## UI Controls

- Native `<select>`, `<option>` and `<datalist>` are banned everywhere in `apps/web/src`, and `no-restricted-syntax` in `apps/web/eslint.config.js` fails lint if one comes back.
  A browser picker cannot be searched and cannot offer to create the item the operator just typed, which is why this is an enforced rule and not a preference.
- Every single-select picker in `apps/web/src/sales-ops/**`, plus the workspace switcher in `apps/web/src/auth/react.tsx` and every data-driven picker in the legacy `admin/**` and `finder/**` trees, uses `Combobox` from `@/components/ui/combobox`.
  It is the only searchable picker in the app.
- Documented exception, and the only one: `apps/web/src/admin/products/ProductDialog.tsx` (product status) and `apps/web/src/admin/products/CommissionRuleForm.tsx` (commission basis) keep the shadcn `Select`.
  Both are two-option closed enums that never grow, so search buys nothing, and a Radix `Select` is not a browser-native picker, so both already satisfy the ban above.
  Convert them to `Combobox` whenever those two screens are next worked on, and do not add a third such site.
- Numeric fields use `<Input type="number">` from `@/components/ui/input`; the OS spin buttons are suppressed by a base-layer rule in `apps/web/src/index.css`.
  A raw `<input type="number">` is banned by the same ESLint rule.
- `<input type="date">` is the one browser-native picker still allowed, by explicit decision.
- Picker geometry has exactly two canonical sizes in sales-ops: `formSelectClass` (44px, matching `formInputClass` so a picker and the `Input` beside it line up) and `comboboxTriggerClass` (40px, the compact `Filtros` bar only).
  Call sites pass only non-geometry extras.
- `onCreate` is wired only where an inline create yields a complete, valid record: cliente, área and função create through the API, and profissional accepts the typed name verbatim.
  Produto opens `ProductDialog` prefilled instead, because a produto is invalid without an área.
  The `Custos padrão por função` picker inside `ProductDialog` gets no create row, because creating a função is admin-gated and belongs to `cadastros/funcoes`; its empty state points there.
  The vendedor and finder pickers get no create row, because a pessoa is invalid without a função; the função picker inside the Pessoa dialog does have one, because a função needs only a name.

## Sales Ops Routing

- Canonical Sales Ops routes are `tatico/dashboard`, `operacional/vendas|comissoes`, `cadastros/produtos|areas|clientes|pessoas|funcoes|geral`, and `meus-dados/vendedores|comissoes|finders|vendas`.
- `cadastros/vendedores` and `cadastros/finders` no longer exist; `resolveSalesOpsRoute` aliases both legacy views to `pessoas` and returns `redirect: true` so the URL is rewritten to `/cadastros/pessoas`.
- `aliasLegacyView` returns the view unchanged unless the resolved workspace is `cadastros`, so the alias can only ever fire there. The `meus-dados/vendedores` and `meus-dados/finders` views keep those exact ids and must never be aliased.
- The URL is the single source of truth for the active Sales Ops workspace and page.
- Workspace visibility is driven purely by the Hub role set `profile.roles: AppRole[]` (`AppRole = 'admin' | 'seller' | 'finder'`) via `getVisibleWorkspaces` in `apps/web/src/sales-ops/navigation.ts`. There is no viewing-level switcher; the old "Nível de visualização" selector was removed.
- Visibility rule: `admin` (team) sees `tatico` + `operacional` + `cadastros`; holding `seller` or `finder` adds the `meus-dados` workspace. So seller-only or finder-only sees only `meus-dados` and defaults there; team-only sees the three team workspaces and no `meus-dados`; team + seller/finder sees all four. Zero recognized roles keeps `/no-role`.
- "Team" is not a Hub product role. `admin` is synthesized in-app from the Hub workspace `owner`/`admin` flag (see `getRolesFromHubClaims` in `apps/web/src/auth/claims.ts`); the Hub product config defines only `seller` and `finder`.
- `meus-dados` reuses existing panels and view components (seller: `vendedores` "Meu painel" + `comissoes`; finder: `finders` "Meu painel" + `vendas` "Indicações"); it is not a new page. Data scoping stays backend/RLS-authoritative.
- `MeuPainelView` (formerly `PeopleView`) in `apps/web/src/sales-ops/SalesOpsApp.tsx` is the read-only `meus-dados` performance panel behind the `vendedores` and `finders` views and takes no `onEdit` prop at all. People cadastro editing lives only in `PessoasView` under `cadastros/pessoas`.
- Pessoa and função create or edit controls are admin-only and live under Cadastros (`cadastros/pessoas` and `cadastros/funcoes`). No `meus-dados` route exposes a pessoa or função create or edit affordance.
- Open-price sale item labels use the existing `items[].productName` to `productNameSnapshot` path while preserving the original `productId`, so do not add a parallel description field or migration.
- Keep the static legacy route trees `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` unchanged.

## Pessoas e Funções

- A Pessoa is the single people cadastro; a Função is an org-scoped role assigned to a pessoa. They are separate entities with separate Cadastros screens.
- `vendedor` and `finder` are the only system funções (`isSystem: true`), seeded per org. They cannot be renamed or archived, the API answers `409 funcao_is_system`, and the UI therefore exposes no edit affordance for them at all.
- Every other função is org-created and dynamic (designer, desenvolvedor, tester, P.O.) and is what the proposta professional-cost rows draw from. `Prestador` is one of these, not a system função, so never special-case its slug.
- A função is never deleted, only archived via `status`, exactly like an área. `salesOpsRouter` has no DELETE verb. An archived função stays visible on the people who already carry it but disappears from the assignment picker.
- The `sales_ops_people` columns `is_seller`, `is_finder` and `is_collaborator` are deprecated derived mirrors that the API still returns but the web type no longer declares. Web code goes through `hasFuncao` and `isCollaboratorPerson` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, never through a per-call-site slug comparison and never through a mirror.
- `isCollaboratorPerson` is "carries at least one non-system função" and nothing else. That is character for character how the API derives `is_collaborator` in `deriveBooleanMirrors`, and in particular neither side considers `status`.
- `isCollaboratorPerson` has exactly one call site left, the proposta wizard's Profissional picker, which additionally requires `status === 'active'`. The produto Prestador picker that used to be the second call site is gone: a produto default cost now keys on a `funcaoId` rather than on a free-text person name.
- Person writes send `funcaoIds` as a full set replacement; the API rejects an empty set with `funcao_required`. There are no assignment sub-resource endpoints.
- Hub `AppRole` values (`admin`, `seller`, `finder`) and `roleSummaryLabel` are unrelated to funções. Workspace visibility keeps deriving purely from `profile.roles`, never from a função assignment.

## Produtos & Serviços

- `cadastros/produtos` is one screen labelled "Produtos & Serviços". The route segment stays `produtos`; what changed is the nav label, the page title and its subtitle. The wizard's missing-área hint points at `Cadastros > Produtos & Serviços` to match.
- Every catalog row carries `kind: 'product' | 'service'` (pt-BR labels Produto/Serviço). A Serviço has no own value: `setupBrl` and `monthlyBrl` are forced to 0 on write and the list prints `Variável` rather than a money figure.
- `openPrice` survives only as a server-written projection of `kind`, enforced by a DB CHECK. The product dialog no longer has a `Preço em aberto` switch and never sends `openPrice`; the `Produto | Serviço` segmented control is the single way to express the same fact.
- `isServiceProduct` in `apps/web/src/sales-ops/calculations.ts` is the one place any branch on the discriminator happens; `productForm` reads `product.kind` directly only to seed the dialog's own state. A row without `kind` reads as a Produto.
- The list is one table filtered by a `Produto | Serviço` segmented bar that renders inside the card and above the empty state, so an empty bucket is never a dead end. Serviço trades the `Setup | Mensalidade | Recorrente` columns for `Valor | Plano padrão | Custos padrão`.
- The kind filter is component state in `SalesOpsApp`, not URL state: the URL is the source of truth for the workspace and the page, and this is neither. The header action reads it, so it cannot live inside `ProductsView`.
- Every value in the product dialog is a DEFAULT that a proposta may override. The dialog says so once, at the top, and the commission section is titled `Comissionamento padrão`.
- The default payment plan is six flat columns, not a nested object: `defaultPaymentMethod`, `defaultEntradaMode` (`'none' | 'pct' | 'fix'` - the literal is `fix`, never `fixed`), `defaultEntradaPct`, `defaultEntradaBrl` (cents), `defaultRemainingInstallments`, `defaultRecurringCycles`. `'none'` plus `1` IS the app default and reproduces a single cash parcela, so there is no "no plan" state. The recurring amount is deliberately absent: it is `monthlyBrl`, and `hasMonthly` already means "recurs".
- A blank `Número de ciclos` is the only way to express prazo indeterminado, and it submits `defaultRecurringCycles: null`. There is no `Prazo indeterminado` checkbox in the product dialog.
- The entrada row sits on top of `defaultRemainingInstallments` when the plan is materialized, and the sale write endpoints cap `installments` at 120. The editor therefore caps the pair: 120 remaining parcelas with no entrada, 119 with one.
- Default costs per função live in `sales_ops_product_funcao_costs` and reach the web FLAT under `bootstrap.productFuncaoCosts`, never nested on a product, so every consumer scopes them by `productId`. A row is `{funcaoId, mode: 'pct', valuePct}` or `{funcaoId, mode: 'fix', valueBrl}` where `valueBrl` is integer CENTS. Never format one with `formatProductCommission`, whose `fix` branch formats reais; use `formatFuncaoCost`.
- A NEW função cost row draws from active, non-system funções only. `vendedor` and `finder` are already paid by `Comissionamento padrão`, so offering them here would create two competing ways to pay one role. A função already used by another row is filtered out, so the client can never trip `duplicate_funcao_cost`.
- A row's OWN stored função always stays selectable on that row, resolved against the unfiltered `funcoes` and labelled `<nome> (arquivada)` when archived. Funções are never deleted, only archived, so a cost row pointing at an archived função is the expected end state of archiving one that carries money; hiding it would make the row read as money owed to nobody and would let a stray edit silently retarget the cost. A `funcaoId` that resolves to nothing at all reads `Função não encontrada`, never a raw id.
- That is the same principle the Pessoa dialog follows, reached differently because the two dialogs are shaped differently. A pessoa splits the job across two controls, so `assignedFuncoes` resolves the chips from the unfiltered list while `selectableFuncoes` offers only active ones - which is why an archived função really does vanish from *that* picker. A cost row is one control doing both jobs, so the stored value has to be admitted into the row's own options; the direct precedent is `selectableAreas` in this same product dialog, which prepends an archived-but-current área into the picker it belongs to.
- `sales_ops_products.providers` is deprecated and has no editor. Product writes OMIT the key rather than sending `[]`, so a PATCH leaves the column untouched, and the dialog surfaces the legacy names read-only inside the função cost section for manual re-entry. There is no backfill from `providers` to `productFuncaoCosts` and there cannot be one: a provider row keys on a free-text `personName` with no deterministic mapping to a `funcaoId`.

## Propostas domain

- Every deal is a Proposta with statuses `draft|open|won|lost|cancelled` (pt-BR labels Rascunho/Aberta/Ganha/Perdida/Cancelada).
- Payables (`seller_commission`, `finder_commission`, `tax`) materialize only when a proposta transitions to `won`, generated per receivable row and linked via `payables.receivable_id`; `professional_cost` and `other_cost` stay one-shot at win.
- Leaving `won` (revert, lose, cancel) voids only `open` payables and receivables; `paid` rows are never touched.
- Payment plans are explicit installments `[{dueDate, amountBrl, method}]` plus an optional recurring block `{monthlyBrl, startDate, cycles|null}` (`cycles: null` means indefinite, no bounded rows generated beyond any setup parcela).
- Receivable label conventions `"N/M"` (installment N of M) and `"MN/M"` (recurring cycle N of M, `M` prefix) are load-bearing: `deriveWizardPrefill` in `apps/web/src/sales-ops/SalesOpsApp.tsx` parses the `M` prefix to split installment rows from recurring rows when prefilling the edit wizard.
- Wizard step 2 is a DECLARATIVE builder, not a manual editor: `Entrada (nenhuma | % | R$ fixo)` plus `Restante em N x` plus `Recorrência (nenhuma | mensal)` regenerate the `Parcelas a receber` table live, and every generated row stays individually editable.
  The `Dividir em` / `Número de parcelas` / `+ parcela` / `Remover parcela N` / `Adicionar recorrência` controls are gone, and `not.toContain` guards in `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` fail if any of those strings comes back.
- The generation rules are pure exported functions in `apps/web/src/sales-ops/calculations.ts` - `PaymentPlanShape`, `entradaCentsFor`, `generateInstallmentPlan`, `inferPaymentPlanShape`, `defaultPlanShapeForProduct` - and the wizard holds only state and calls them.
  `PaymentPlanShape.entradaMode` reuses the produto cadastro's literals `'none' | 'pct' | 'fix'`, so `fix` is the one spelling in the codebase for both the stored template and the per-proposta builder.
- The restante split delegates to `splitInstallmentsEqually`, whose LAST row absorbs the whole floor remainder, so `entrada + Σ restante === total` exactly for every input and `Soma das parcelas` can only disagree with the total after a manual row edit.
  The API's `materializeDefaultPaymentPlan` puts that remainder on the FIRST restante row instead, so the two disagree on placement; that is inert today because the function has no production caller.
  Were it wired up, `inferPaymentPlanShape` would read an API plan whose restante does not divide evenly and that HAS an entrada as hand-edited, which is the safe outcome, but one with NO entrada as a `R$ fixo` entrada plus n-1 parcelas.
  That second reading is arithmetically exact and loses nothing - it reproduces the stored rows to the cent - but it labels as an entrada what the API meant as an ordinary first parcela.
  Both cases are pinned in `apps/web/src/sales-ops/__tests__/payment-plan-generation.test.ts`, so this paragraph cannot drift away from the code again.
- `addMonthsToIsoDate` clamps to the last valid day of the target month, matching the API's `addMonths` in `apps/api/src/domains/sales-ops/service.ts`; before this it rolled `2026-01-31` over to `2026-03-03` while the API persisted `2026-02-28`.
  Every due date is recomputed from the anchor with an absolute month offset, never stepped one month at a time, so a clamped February cannot drift the months after it.
- Manual plan edits are governed by one whole-plan `planDirty` flag, never per-row pinning, because recomputing an entrada or a restante redistributes value across every row to hold the exact-sum invariant.
  A row date or amount edit sets it and freezes the rows; a `Forma` edit does NOT, because methods are carried positionally through a regeneration.
  Changing a header control while dirty raises an amber confirm bar (`Aplicar` / `Manter parcelas`) instead of regenerating, and both `Aplicar` and the header's `Regerar plano` clear the flag AND `appliedPlanKey`, because a row edit alone leaves the key untouched and the guard would otherwise find nothing to do.
- `inferPaymentPlanShape` reads a shape back out of stored rows by regenerate-and-compare over three ordered candidates (`none`, a clean percentage, a fixed value), comparing `dueDate` and `amountBrl` but not `method`.
  `matchesFormula: false` means the rows are hand-tuned: they are kept verbatim, the header only describes them, and nothing but an explicit `Aplicar` or `Regerar plano` click overwrites them.
  A false negative costs one extra `Plano ajustado manualmente` line; a false positive is impossible, because `matchesFormula` is only true after a full regenerate-and-compare.
- A blank `Número de ciclos` is the only way to express prazo indeterminado in the wizard too, exactly as in the product dialog; there is no `Prazo indeterminado` checkbox anywhere.
- `defaultPlanShapeForProduct` is the single seam by which a produto's `defaultEntradaMode` / `defaultEntradaPct` / `defaultEntradaBrl` / `defaultRemainingInstallments` reach a proposta, applied through a render-phase guard keyed on the product ID and its template and skipped while `planDirty` is true.
  `defaultPaymentMethod` and `defaultRecurringCycles` are persisted and editable in the cadastro but are not read by the wizard yet.
- Áreas are org-configurable (`cadastros/areas`) and required on every product and every proposal item; the old free-text product `Tipo` is gone from both the UI and the schema, and classification is Área plus the `kind` discriminator described under "Produtos & Serviços".
- Free-form proposal items are `productId`-null rows using `productName` as the description (same `productNameSnapshot` path as the open-price convention above) and require an `areaId` picked directly on the item.
- Every commercial number a produto supplies is a per-proposta DEFAULT, never a constraint: `sellerCommissionPct`, `finderCommissionPct`, `taxPct`, `otherCostsBrl` and each profissional's `costBrl` are editable inside one proposta and already have their own columns.
  A hand-typed value is PINNED by the per-field `manualOverrides` registry in `apps/web/src/sales-ops/SalesOpsApp.tsx`, so the render-phase `commissionDefaultsSource` guard re-applies a produto default only to fields nobody touched; the source key still advances unconditionally, so the guard cannot loop.
  On the edit path the registry is SEEDED by comparing each stored value against the default it would have inherited, which is what makes a mid-edit produto change unable to clobber a stored override; a stored value that equals its default is deliberately not pinned.
  `Alterado manualmente` renders only when a field is pinned AND diverges from the current default, and `Restaurar padrão` clears the pin and rewrites the default in one handler so the field rejoins the re-apply path.
- `sales_ops_sale_professionals` carries `funcao_id` plus `funcao_name_snapshot` behind a composite `(org_id, funcao_id)` FK to `sales_ops_funcoes` (migration `0014_sale_professional_funcoes`); the old free-text `role` is a DEPRECATED mirror written with the same string as the snapshot on every insert, never independently.
  `funcao_id` is nullable and MATCH SIMPLE skips the FK lookup when it is NULL, which is what lets a legacy row whose `role` matched no cadastro função keep its label; the backfill matches on `lower(btrim(...))` and invents no função from historical text.
  The wizard's `PROFISSIONAL` picker offers every ACTIVE pessoa (not only `isCollaborator` ones) and `FUNÇÃO NO PROJETO` is a Combobox over active funções; both free-text escape hatches (`Digite manualmente`, the seeded `role: 'Operacional'`) are gone and `sale-wizard-ui-contract.test.ts` fails if either string returns.
- A profissional's `CUSTO ALOCADO` prefills from `sales_ops_product_funcao_costs` through `buildFuncaoCostBasis` in `apps/web/src/sales-ops/calculations.ts`, whose base is the ITEM SUBTOTAL of the proposta items whose produto declares that função, summed.
  The recurring mensalidade is excluded on purpose: a `professional_cost` payable is one-shot at win with `receivableId: null`, so pricing it off a monthly stream would charge a pay-once cost against every cycle. Free-form items contribute nothing.
  The derivation is rendered under the input (`5% de FXL Custom (R$ 20.000,00)`) by `describeFuncaoCostBasis`, which reads the same entry the cents came from; a row goes `costManual` on the first keystroke and is never recomputed again, and a prefilled row is `costManual` unconditionally.
- `computeSaleFinancials` in `packages/shared-utils/src/sale-financials.ts` is the ONE margin implementation: `buildSaleLedger` delegates its money block to it and the wizard drives its step-3 and step-4 panels from it, so the `Margem líquida` on screen equals the persisted `net_margin_brl`.
  Its semantics are the server's prior algorithm verbatim - `totalBrl = items + bounded recorrência`, `Σ floor` per receivable row, `netMarginPct` as `toFixed(2)` - so adopting it moved no persisted number. `apps/web` imports the `/sale-financials` subpath because the package root also re-exports the Node-only hmac module.
  The Revisão card's `Total` line reads `financials.totalBrl` for the same reason, so it states the basis `total_brl` persists rather than the itens total; rendering the itens total there let the card show a margin larger than its own total once a bounded recorrência existed. Step 2's `Soma das parcelas / total` keeps the ITENS total, because the API's `validatePaymentPlan` requires the parcelas to equal exactly that.
- `resolvePartyContexts` validates `sellerPersonId`, `finderPersonId` and every `professionals[].personId` / `.funcaoId` in-org inside the caller's `withTenant` transaction, throwing `SaleInputError` with `seller_not_found` / `finder_not_found` (`itemIndex: -1`) or `person_not_found` / `funcao_not_found` (the row index), which `routes.ts` already maps to `400 validation_error`.
  Its snapshots are server-authoritative: `personNameSnapshot` and `funcaoNameSnapshot` come from the resolved cadastro row and a disagreeing body label loses. Cross-org rejection is proven over an `app.fxl_admin` connection in `apps/api/test/rls/sale-professional-funcoes.test.ts`, because over the ordinary app connection RLS satisfies the assertion even with the `orgId` filter deleted.
- `sales_ops_settings.commission_on_recurring` is a DEAD setting: it is stored and editable but read by nothing that computes anything. Commissions are generated for every non-void receivable, bounded recurring rows included, and the wizard's payables preview no longer gates on it.
- Transition endpoints are `POST /sales/:id/transition` (`{status}` for open/won/lost/cancelled/reopen) and `POST /sales/:id/cancel-contract` (mid-contract cancellation on a won recurring sale); there is no free status write.
- Integration tests are pinned to the local Docker test database: `apps/api/.env` carries `TEST_DATABASE_URL`/`TEST_MIGRATE_DATABASE_URL`/`ADMIN_DATABASE_URL`, the app connects as the non-superuser `fxl_sales_test` role so RLS is genuinely enforced, and `apps/api/test/rls/setup-env.ts` hard-overrides `DATABASE_URL` so the suite can never fall back to whatever `.env` points the dev server at (staging, in this repo).

## Environments

| Level | Hub Client | Postgres | Secrets |
| --- | --- | --- | --- |
| local | `product.fxl-sales` local client | Local Docker | `.env.dev.example` copied to `.env` |
| staging | `product.fxl-sales` staging client | Coolify staging DB | Infisical `staging` env |
| production | `product.fxl-sales` production client | Coolify prod DB | Infisical `prod` env |

Required API vars:

```dotenv
FXL_HUB_API_URL=http://localhost:9016
FXL_HUB_PUBLISHABLE_KEY=pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2
FXL_HUB_SECRET_KEY=<operator-issued-secret>
FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback
PUBLIC_LINK_BASE_URL=http://localhost:3006
```

Required web vars:

```dotenv
VITE_API_URL=http://localhost:3006
VITE_AUTH_PROXY_TARGET=http://localhost:3006
VITE_AUTH_BFF_BASE_PATH=
VITE_FXL_HUB_API_URL=http://localhost:9016
VITE_FXL_HUB_PUBLISHABLE_KEY=pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2
```

The API owns public referral redirects at `/r/:code`.
Keep `PUBLIC_LINK_BASE_URL` pointed at the API public origin.

## Commands

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
pnpm --filter @fxl-sales/api test:integration
```

`pnpm test` includes a tracked-file guard that fails when the removed auth provider is reintroduced.

## Shipping

Follow the Nexo flow in `AGENTS.md`.
Keep changes atomic, verify locally, capture the run under `nexo/`, commit with a Conventional Commit message, and push `master` after Gate 2 passes.
