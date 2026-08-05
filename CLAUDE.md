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
- A missing access token is never defaulted.
  `requireToken(getToken)` in `apps/web/src/lib/require-token.ts` throws `AuthTokenUnavailableError`, and `apiFetch` / `apiFetchBlob` take a REQUIRED non-empty `token` and assert it before calling `fetch`, so a null token can never become an anonymous request that reads as a server outage.
  `no-restricted-syntax` in `apps/web/eslint.config.js` fails lint if `(await getToken()) ?? ...` comes back.
  The sales-ops error panel routes `isAuthFailure` (an unavailable token, or an `ApiError` with `status: 401`) to `Sessão expirada` rather than to the generic API-fault copy.
- The Hub BFF session store is DURABLE, in Postgres, and `createAppAuthBff` must always pass it.
  Omitting `sessionStore` makes `createHubBff` fall back to the SDK's `InMemoryHubSessionStore`, which puts the Hub refresh token in one process's memory: every restart or redeploy then logs every user out, and a second replica cannot see a session the first created.
  `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` asserts the exact store instance reaches `createHubBff`, so deleting the option fails a test rather than silently regressing.
- `HubSessionStore` is a SYNCHRONOUS interface, so the store hydrates around the handler instead of awaiting inside it.
  `createHubSessionScopeMiddleware` on `/auth/*` reads the session and login cookies, awaits a load of just those rows into an `AsyncLocalStorage`-scoped working set, runs the BFF handler where every store method is a pure `Map` operation, then awaits a one-transaction flush.
  The working set is per-request, NOT a cache, which is what makes replicas correct: the Hub rotates the refresh token on every `/auth/refresh`, so a cached token would be stale the moment another replica rotated it.
  A hydrate failure answers `503`, never an empty working set, because a false "no session" makes the SDK delete the session cookie and log every user out over a brief database blip.
- `hub_bff_sessions` and `hub_bff_login_txns` are global, non-tenant tables and cannot be otherwise: a session row is written at `/auth/callback`, before any workspace is known, so there is no `org_id` to key a tenant policy on.
  Both carry FORCE RLS with only the `app.fxl_admin` policy, so the ordinary `getDb()` connection sees zero rows; the store goes through `getAdminDb()`.
  Refresh tokens and PKCE verifiers are AES-256-GCM sealed with the row id as AEAD additional data, keyed by HKDF-SHA256 from `FXL_HUB_SECRET_KEY` unless `HUB_SESSION_ENCRYPTION_KEY` overrides it, so rotating either one logs every user out.
  Read that override through the validated `env` object, never `process.env`: `.env.dev.example` ships it blank and `??` does not catch `''`, which fails the 32-char floor and stops the API booting.
- A null token read does NOT immediately sign the user out.
  `HubClient.getToken()` collapses a network throw, a non-200 and an unparseable body into one `null`, so the provider runs a bounded revalidation ladder (`SESSION_REVALIDATE_DELAYS_MS`) and gives up only after four CONSECUTIVE failures.
  The counter resets on every recovery; making it a lifetime total signs the operator out on roughly the fourth unrelated blip, which is the original destroyed-form bug, and `apps/web/src/auth/__tests__/react.test.tsx` pins the reset.
- `sanitizeReturnTo` in `apps/web/src/auth/session-recovery.ts` re-asserts its structural checks on the NORMALIZED value it returns, not only on the raw input.
  Validating only the raw string let dot-segment normalization through, so `/..//evil.example` returned `//evil.example` and resolved off-origin.
  The stored path is destroyed BEFORE it is validated, so a hostile value is consumed exactly once and cannot be retried on a later mount.

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
- Any component that opens an inline layer inside a dialog - `Combobox`'s panel, `InfoHint`'s disclosure - MUST call `useInlineLayer(open)` from `@/components/ui/inline-layer`.
  Radix registers `useEscapeKeydown` on `document` with `{capture: true}`, so it runs before the event reaches React's root container and **no** handler inside the React tree can pre-empt it - `stopPropagation` and `stopImmediatePropagation` are both inert against it.
  Without the registry, Escape aimed at an open picker closes the whole wizard and discards the operator's typed work.
  `DialogContent` owns the registry and `preventDefault`s `onEscapeKeyDown` while any layer is open; the open count is a ref, so a picker opening does not re-render the dialog, and release is idempotent so a StrictMode double cleanup cannot strand the count negative and silently disarm the guard.
  A regression test for this must render the component inside a REAL `Dialog` and assert `onOpenChange` was not called. A spy on a React sibling's `onKeyDown` passes even with the protection deleted - that exact false positive already shipped once.
- Picker geometry has exactly two canonical sizes in sales-ops: `formSelectClass` (44px, matching `formInputClass` so a picker and the `Input` beside it line up) and `comboboxTriggerClass` (40px, the compact `Filtros` bar only).
  Call sites pass only non-geometry extras.
- `onCreate` is wired only where an inline create yields a complete, valid record: cliente, área and função create through the API, and profissional accepts the typed name verbatim.
  Produto opens `ProductDialog` prefilled instead, because a produto is invalid without an área.
  The `Custos padrão por função` picker inside `ProductDialog` gets no create row, because creating a função is admin-gated and belongs to `cadastros/funcoes`; its empty state points there.
  The vendedor and finder pickers get no create row, because a pessoa is invalid without a função; the função picker inside the Pessoa dialog does have one, because a função needs only a name.
  The proposta wizard's `FUNÇÃO NO PROJETO` picker has one too, for the same reason as the Pessoa dialog's; the two deliberate exclusions above are unchanged.
- A wizard's primary button carries `type="button"` on EVERY step, and the final step saves through `onClick`.
  Never derive that attribute from the step (`type={step < 4 ? 'button' : 'submit'}`), because the click that advances the step would then also be the click that changes the element's own activation behaviour.
  A click runs in two phases - the event dispatch, then the browser's activation behaviour for the element - and React 18 flushes a discrete event's state update synchronously, so the re-render lands BETWEEN them.
  The browser then asks "is this a submit button?" of an element React has already rewritten to `submit`, submits the form, and persists a record the operator never reviewed.
  That was the produto dialog's step 3 to 4 autosave; the proposta wizard never had it because its primary button was always `type="button"`.
- A DOM-level click test CANNOT catch that regression: happy-dom's `dispatchEvent` never runs activation behaviour, so `advances from step 3 to step 4 without saving` passes with the bug fully present.
  The oracle is the invariant `keeps one activation behaviour on every step` in `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`, which was the only one of 537 web tests to go red on the mutation.
  Anything of this class has to be proven in a real browser; assert the invariant that makes the race impossible rather than trying to observe the race in jsdom or happy-dom.

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
- The `sales_ops_people` columns `is_seller`, `is_finder` and `is_collaborator` are deprecated derived mirrors that the API still returns but the web type no longer declares. Web code goes through `hasFuncao` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, never through a per-call-site slug comparison and never through a mirror.
- `isCollaboratorPerson` is GONE from `apps/web`; a tombstone comment sits where it was declared in `apps/web/src/sales-ops/SalesOpsApp.tsx`. It meant "carries at least one non-system função", character for character how the API still derives `is_collaborator` in `deriveBooleanMirrors`, neither side considering `status`. Both call sites are retired: the produto Prestador picker (a produto default cost keys on a `funcaoId` now) and the proposta wizard's Profissional picker, which partitions on the ROW's `funcaoId` instead - see the Propostas domain entry. Do not reintroduce it. "Carries at least one non-system função" is not a question this app asks any more; `person.funcaoIds.includes(rowFuncaoId)` is.
- Person writes send `funcaoIds` as a full set replacement; the API rejects an empty set with `funcao_required`. There are no assignment sub-resource endpoints.
- Hub `AppRole` values (`admin`, `seller`, `finder`) and `roleSummaryLabel` are unrelated to funções. Workspace visibility keeps deriving purely from `profile.roles`, never from a função assignment.

## Produtos & Serviços

- `cadastros/produtos` is one screen labelled "Produtos & Serviços". The route segment stays `produtos`; what changed is the nav label, the page title and its subtitle. The wizard's missing-área hint points at `Cadastros > Produtos & Serviços` to match.
- Every catalog row carries `kind: 'product' | 'service'` (pt-BR labels Produto/Serviço). BOTH kinds may carry an own value in `setupBrl`/`monthlyBrl`. For a Produto it is a catalog price; for a Serviço it is a BASE VALUE - a suggestion the proposta prefills and the operator negotiates, exactly like every other number in that dialog. `0` is the whole expression of "no base value": there is no separate flag, the list prints `Variável` instead of `R$ 0,00`, the product dialog seeds the field BLANK with a `Definido na venda` placeholder rather than a literal `0` (`centsToOptionalInput`), the wizard prefills `"0"` into an item's `Valor negociado`, and the step-1 negotiated-value gate still blocks. That is what every pre-0015 Serviço stores, so nothing about an existing Serviço changed.
- The old "a Serviço has no own value" invariant is gone, and with it all four of its enforcement points: `sales_ops_products_service_no_fixed_value_check` (dropped by `0015_servico_base_value`), the `service_cannot_have_fixed_value` zod refine, the `INVALID_PRODUCT_KIND_VALUE` sentinel with its `updateProduct` merged-row guard and its `routes.ts` 400 branch, and the dialog's `isService ? 0 :` submit coercion. `DefinedOnSaleNotice` (`Definido na venda`) and the `Serviços têm valor variável, definido em cada proposta.` banner are deleted too - the dialog already says once, at the top, that everything in it is a default.
- `openPrice` survives only as a server-written projection of `kind`, enforced by `sales_ops_products_kind_open_price_check` (`(kind = 'service') = open_price`), which slice 07 deliberately did NOT relax: that CHECK asserts "this row is a Serviço", and a Serviço carrying a base value is still a Serviço. `openPrice` never meant "has no own value" - that was only ever the constraint above, and slice 07 rewrote every web reader that conflated the two. What survives in `apps/web` is exactly two CLASSIFICATION reads, both fallbacks for a row whose `kind` never arrived: `productRowRequirements` and the wizard's edit-path `customLabel` prefill. Deliberately not folded into `isServiceProduct`, because an unclassifiable row must keep its negotiated-value gate rather than pass as a fixed-price Produto and let an item through at R$ 0. No MONEY read consults it any more; that question goes through `productBaseValueBrl`. The product dialog has no `Preço em aberto` switch and never sends `openPrice`; the `Produto | Serviço` segmented control is the single way to express the same fact.
- `isServiceProduct` in `apps/web/src/sales-ops/calculations.ts` is the one place any branch on the discriminator happens, and `productBaseValueBrl` beside it is the one place a catalog own value is read (`setupBrl || monthlyBrl`, integer CENTS, `0` = none; the `||` is why a row with no setup that recurs suggests its mensalidade). Every unit-price prefill and the Serviço `Valor` column go through it, so "does this row suggest a price" is never re-derived per call site. `productForm` reads `product.kind` directly only to seed the dialog's own state. A row without `kind` reads as a Produto.
- The list is one table filtered by a `Produto | Serviço` segmented bar that renders inside the card and above the empty state, so an empty bucket is never a dead end. Serviço trades the `Setup | Mensalidade | Recorrente` columns for `Valor | Plano padrão | Custos padrão`, and the `Valor` cell prints `productBaseValueBrl` when it is non-zero, `Variável` when it is `0`. The dialog names that same number `Valor base (R$)` for a Serviço and `Setup (R$)` for a Produto.
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
- `code_suffix` is UNIQUE per org (`sales_ops_products_org_code_suffix_idx`, no `WHERE` clause), so an archived produto permanently occupies its slot.
  A NEW produto seeds the field from the pure `nextProductCodeSuffix` in `apps/web/src/sales-ops/calculations.ts`: max+1 over every produto in the org, both `kind`s and both statuses, gaps deliberately left unfilled, non-numeric values ignored, numeric rather than lexicographic ordering, and a lowest-free fallback past 99.
  The EDIT path is guarded by the `??` short-circuit on `modal?.product`, the same shape as the `name` seed, so an existing produto always renders its stored suffix and can never be silently renumbered.
  The API still has no 23505 handling, so a genuine collision surfaces as a bare 500 - see `nexo/ROADMAP.md`.

## Propostas domain

- Every deal is a Proposta with statuses `draft|open|won|lost|cancelled` (pt-BR labels Rascunho/Aberta/Ganha/Perdida/Cancelada).
- Payables materialize only when a proposta transitions to `won`.
  `seller_commission`, `finder_commission` and `tax` are generated per receivable row and linked via `payables.receivable_id`; `professional_cost` is now ALSO per receivable, split across the INSTALLMENT rows only by `resolveProfessionalSplit`; `other_cost` alone stays one-shot with `receivableId: null`, because it names no beneficiary - its `beneficiaryName` is the literal `'Outros custos'` - and has no wizard row to hang a schedule on.
- The split deliberately skips every `M`-prefixed recurring receivable.
  An indefinite recorrência generates no bounded rows at all, so any design that included them would need this branch anyway; spreading a pay-once cost over 24 cycles delays a professional's pay years past delivery; and the installment rows are the only ones the wizard can preview, since step 2 holds `installmentRows` and the recorrência as separate state.
- A proposta with NO eligible installment receivable at win - every row `M`-labelled or void - falls back to the legacy one-shot `professional_cost` at the won date with `receivableId: null`.
  That branch is what keeps `cancelContract` on a pure-recurring sale behaving exactly as before.
- `sales_ops_sale_professionals.cost_split_bp` (`jsonb`, nullable, migration `0017_professional_payment_split`) is the per-professional payment schedule: 1..120 non-negative integers in BASIS POINTS summing to exactly `10000`.
  `NULL` means the default, which is `cost_brl` distributed pro rata over the installment receivable amounts.
  Basis points and not cents, deliberately: `cost_brl` is edited one control away in the same wizard row, so a cents array would go stale on every cost edit and would need a cross-field refine plus a rewrite inside `Restaurar padrão` and inside every cost keystroke, whereas bp keep `cost_brl` (how much) and the schedule (when) ORTHOGONAL.
  It is a column and not a child table for the mirror image of the reason `sales_ops_product_funcao_costs` is a table: that one holds a `funcao_id` which must not dangle inside jsonb, while a split part holds no id at all, only a number.
  The `Σ === 10000` rule is enforced in `SaleProfessionalSchema`, not in SQL, because a `jsonb` array sum needs a subquery a CHECK cannot contain.
- The part count is INDEPENDENT of the parcela count, because "this one receives in 1 time" on a three-parcela plan is the whole feature.
  Parts bind POSITIONALLY and FRONT-ALIGNED to the installment receivables in due-date order: part `i` pays out of parcela `i`.
  Fewer parts than parcelas means the later parcelas carry no `professional_cost` at all; more parts than parcelas folds the tail weights into the last available parcela.
  Front-aligned rather than back-aligned so that adding a part never renumbers the ones already there.
  The rule is total for every stored value against every plan, which matters because step 2 can be revisited after step 3.
- `splitCentsByWeights` in `packages/shared-utils/src/professional-split.ts` is the ONE distribution primitive, following the `computeSaleFinancials` precedent of a single shared implementation rather than two copies: every part but the last is `floor(total × w / Σw)` and the LAST absorbs the whole remainder, so `Σ parts === total` exactly for every input, and for equal weights the output is byte-identical to `splitInstallmentsEqually`'s amounts - pinned by a direct test so the two rounding rules cannot drift.
  Every caller normalizes to basis points through `defaultSplitBp` first, which is also what keeps `total × w` inside `Number.MAX_SAFE_INTEGER` given that both `cost_brl` and a receivable amount are Postgres `integer`s.
- Newly materialized `professional_cost` payables persist `sale_professional_id` from the originating `sales_ops_sale_professionals` row.
  Current split-row idempotency matches durable professional ID plus receivable ID, never display name.
  Migration `0018_professional_payable_identity` backfills only one unambiguous same-organization, same-sale, same-beneficiary match and leaves ambiguous identities null.
  Null-ID split rows use a consumable `(beneficiary_name, receivable_id, amount_brl)` multiset, so one historical row suppresses at most one candidate.
  A surviving v2.3.1 full-cost one-shot has a null receivable and covers exactly one professional before per-receivable parts are considered.
  An identified full-cost one-shot covers its durable professional ID, while an ambiguous null-ID one-shot is consumed once by beneficiary snapshot plus full cost.
- Migration `0018_professional_payable_identity` is applied in phases by the shared repository migration runner.
  Its indexes are built concurrently, its foreign key is added as not valid and then validated, and its conservative backfill runs in bounded transactions.
  Production and integration startup must use the shared runner instead of the stock all-migrations Drizzle transaction.
- `Detalhe de pagamento` is an IN-FLOW disclosure inside the step-3 professionals table, spanning the row with `col-span-full`, and it deliberately does NOT call `useInlineLayer`.
  That hook guards ABSOLUTELY POSITIONED layers - `Combobox`'s panel, `InfoHint`'s panel - where an Escape aimed at the layer would otherwise close the whole wizard.
  An expander that pushes content in flow is not such a layer, and the existing precedent is `SaleItemForm.descriptionOpen`, which does the same thing the same way.
  It lives in its own `apps/web/src/sales-ops/ProfessionalSplitPanel.tsx`, and its trigger sits inside the existing `CUSTO ALOCADO` cell as that cell's last child, so the slice edits no grid template and adds no column.
- Each part is entered as a PERCENTAGE and prints its resolved reais beside it; there is no `R$` input mode per part and there must not be one.
  A reais-denominated part would have to be reconverted on every `CUSTO ALOCADO` keystroke, one control away in the same row, and would be stale in between - which is the same reason `cost_split_bp` stores basis points rather than cents.
  The wizard's preview calls the SAME `defaultSplitBp` / `splitCentsByWeights` the server calls, over `installmentRows` and nothing else, so the parcela amounts on screen are the payables that will be written at win.
  `ProfessionalForm.costSplitBp` and `.splitOpen` are REQUIRED and non-optional so TypeScript catches every one of the three row constructors; an optional field would let a forgotten seed send `undefined` and silently mean "no override".
- `canAdvanceStepThree` gates on `professionalSplitsValid` as well as `professionalsValid`: an override must have between 1 and `installmentRows.length` parts and must sum to exactly 10000 bp.
  Adding or removing a part deliberately does NOT renormalize - the `Soma` line goes red and the operator fixes it, exactly as step 2's `Soma das parcelas` behaves.
  Only `Distribuir igualmente` and `Personalizar divisão` write a guaranteed-100% vector, and both go through `splitCentsByWeights`, so the editor obeys the same last-part-absorbs-the-remainder rule as everything else.
  The panel's no-parcela branch is a guard, not a reachable screen: `canSaveBasics` requires `totalCents > 0` and step 2's `planRowsValid` requires every parcela amount `> 0`, so the operator cannot reach step 3 with an empty plan; it is asserted by rendering the panel directly.
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
  `FUNÇÃO NO PROJETO` is the FIRST column of `Profissionais alocados` and `PROFISSIONAL` the second, because the função is what partitions the person list.
  The person picker is DISABLED, placeholdered `Selecione a função primeiro`, until the row names a função; it then lists every ACTIVE pessoa who already carries that função in the headingless bucket and every other ACTIVE pessoa under the `Adicionar a esta função` group heading, which is `ComboboxOption.group` and needs nothing new in the primitive.
  Selecting a flagged pessoa GRANTS her that função through the `onAssignFuncao` prop, which `SalesOpsApp` wires to the ordinary `useSaveSalesOpsPerson` - so the bootstrap invalidation and the optimistic patch come for free and the flag disappears at once.
  The payload is her EXISTING `funcaoIds` PLUS the new one and must also carry `contactEmail`: person writes are a full set replacement and a PATCH that omits `contactEmail` clears it.
  Listing everyone unflagged before a função is chosen was rejected: it re-creates the unchecked pick this rule exists to stop, and leaves the grant with no moment to happen.
  The ONE exception is a legacy row carrying a free-text `funcaoName` with no `funcaoId` - it keeps the picker enabled and groups nobody, because there is no id to partition on and locking it would make a stored proposta uneditable.
  `FUNÇÃO NO PROJETO` is a Combobox over active funções; both free-text escape hatches (`Digite manualmente`, the seeded `role: 'Operacional'`) are gone and `sale-wizard-ui-contract.test.tsx` fails if either string returns.
  A fresh `+ profissional` row seeds NO pessoa - the old `allocatablePeople[0]` seed silently allocated whoever sorted first - so step 3 also refuses to advance with `Selecione a pessoa de cada profissional alocado.`, and `createPayload` drops a row whose `personName` is blank rather than sending one the API's `personName: z.string().min(1)` answers with a 400.
  `draftValid` deliberately does NOT gate on professionals, so `Salvar rascunho` stays reachable mid-edit.
- A profissional's `CUSTO ALOCADO` prefills from `sales_ops_product_funcao_costs` through `buildFuncaoCostBasis` in `apps/web/src/sales-ops/calculations.ts`, whose base is the ITEM SUBTOTAL of the proposta items whose produto declares that função, summed.
  The recurring mensalidade is excluded on purpose, and the per-receivable split did NOT weaken that: a `professional_cost` is still a PAY-ONCE TOTAL, so pricing it off a monthly stream would charge it against every cycle.
  The split re-prices nothing - it takes an already-computed `cost_brl` and decides only WHEN it is paid, under a `Σ parts === cost_brl` contract - and it skips the `M`-labelled rows too, so the money the cost is measured against and the money it is paid out of are the same non-recurring stream.
  That is a tighter invariant than before, not a looser one.
  Free-form items contribute nothing.
  The derivation is rendered under the input (`5% de FXL Custom (R$ 20.000,00)`) by `describeFuncaoCostBasis`, which reads the same entry the cents came from; a row goes `costManual` on the first keystroke and is never recomputed again, and a row prefilled from a STORED proposta by `deriveWizardPrefill` is `costManual` unconditionally, because a persisted cost is a saved decision.
  A row SEEDED from a produto on the create path is the opposite object and is deliberately NOT `costManual`: a produto number is a default that must keep following the item value, and a Serviço seeds at 75% of the `"0"` its `Valor negociado` prefills with, so pinning it would freeze the cost at R$ 0,00 for the whole session.
  The guard cannot clobber such a row either way, because it writes exactly the expression the seed used, and leaving it unpinned also keeps `Alterado manualmente` off a row nobody touched.
- A NEW proposta AUTO-SEEDS one `Profissionais alocados` row per função declared by the produtos on its itens, função filled from the cadastro and PROFISSIONAL left empty for the operator, through the pure `planFuncaoCostSeeds` in `apps/web/src/sales-ops/calculations.ts` driven by a fifth render-phase guard beside the `funcaoCostKey` one.
  The seed fires once per `(produto, função)` declaration, tracked by `funcaoCostSeedKey` in a session key set that only ever GROWS, which is what makes deleting a seeded row permanent, re-adding the produto inert, and a re-render a no-op; the ROW is deduped per função instead, so two produtos declaring `Mentor` produce two keys and one row carrying the summed basis.
  Only `editSale === null` seeds, so reopening a saved proposta can never add a row on top of its stored `sales_ops_sale_professionals`: the absence of a row there is itself a saved decision. Only funções that are currently allocatable seed, because a seeded row is a new assignment and an archived função disappears from assignment pickers; `buildFuncaoCostBasis` still reads the unfiltered declarations, so a hand-picked função still prefills.
  A seeded row needs no new gate: it arrives with a função, so the person picker is already unlocked, and the existing `professionalPeopleValid` bar (`Selecione a pessoa de cada profissional alocado.`) is what stops step 3 until every row names one or is removed via `Remover profissional N`.
  `draftValid` is deliberately still not gated on professionals, so `Salvar rascunho` stays reachable from step 1, and a personless row is dropped on the way out - the API declares `personName: z.string().min(1)`.
  That drop is expressed ONCE, by `professionalRowWillPersist` in `apps/web/src/sales-ops/calculations.ts`, which `createPayload`, the step-3 `professionalCents` sum and the `professionalPeopleValid` gate all reference: a personless row is excluded from BOTH the payload and the DISPLAYED cost, which is what keeps the `Margem líquida` on screen equal to the persisted `net_margin_brl`.
  Spelling `personName.trim() !== ''` at each call site instead is exactly how those two once disagreed - every seeded row is personless by definition, so a new proposta showed `Margem líquida R$ 15.500 / Custos profissionais R$ 1.300` while the `Salvar rascunho` in that same footer persisted R$ 16.800.
  The remaining limitation is deliberate and filed in `nexo/ROADMAP.md`: a rascunho saved before the pessoas are picked loses the produto's seeded funções permanently, because `if (!editSale)` correctly refuses to re-seed on reopen. It is made VISIBLE rather than prevented, by a muted `#6a6a72` line in `Profissionais alocados` shown only while some row has a função and no pessoa.
- The wizard's `CUSTO ALOCADO` accepts `%` or `R$` through the same `UnitToggle`/`UnitInput` pair the produto dialog uses.
  The unit is an INPUT MODE and is NOT persisted, because `sales_ops_sale_professionals.cost_brl` is a single integer-cents column and nothing ever re-evaluates a stored percentage against a later item edit; a saved proposta therefore always reopens in `R$` with the resolved cents, which is the decision that was saved.
  `cost_split_bp` is the deliberate opposite - persisted as a RULE rather than as cents - precisely because it MUST survive a later `cost_brl` edit unchanged.
  A `%` resolves through `resolveProfessionalCostCents` against `professionalCostBaseCents`, which is the função-scoped item subtotal, falling back to the total of all product-item subtotals when no produto declares the função (the inline-created função case), and never includes the recorrência in either branch.
  With no product item at all the base is zero and the row states so explicitly rather than writing a silent `0`.
  Toggling the unit pins the row (`costManual: true`) in both directions and never un-pins it, so the render-phase produto-default guard cannot resurrect a stale default over a derived number; only `Restaurar padrão` un-pins, and it also resets the unit to `fix` because restoring the produto default means restoring its cents.
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
