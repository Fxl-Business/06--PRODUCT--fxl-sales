# CLAUDE.md

This file holds the RULES.
The reasoning, incident history and oracle names behind each section live in `nexo/knowledge/reference/<section>.md`.
Read the matching reference file before changing code in that area, and update it in the same change when a rule moves.

## Product

FXL Sales is the affiliate and referral product for FXL.
The product audience is `app.fxl-sales`.
Keep the repository folder name unchanged until the editor session can safely move.

## Stack

- API: Hono, Drizzle ORM, PostgreSQL, Zod, and `@fxl-business/hub-sdk`.
- Web: React, Vite, TypeScript, Tailwind, TanStack Query, React Router, and react-i18next.
- Auth and commerce: FXL Hub only.

## Auth Model

Full reference: `nexo/knowledge/reference/auth-model.md`.

Wiring:
- The API mounts the Hub BFF at `/auth/*`; the browser enters through same-origin web `/auth/*`, proxied by Vite to the API. The local callback is `http://localhost:8006/auth/callback`.
- Protected routes use Hub bearer tokens through `appAuthMiddleware`; `requireHubAuth` exposes `c.get('hubAuth')`. `userId` is the Hub account id, `orgId` the active Hub workspace id.
- The SDK is pinned EXACTLY at `@fxl-business/hub-sdk@2.5.0` in both apps (no caret). `hono` is pinned to `4.12.28` by a `pnpm-workspace.yaml` override so only one Hono copy resolves.

Access gate:
- Baseline access is the boolean `auth.claims.entitlements.access` and nothing else. Never read `entitlements.modules` for baseline access (the old `sales.core` module gate answered 402 to everyone). `modules` is for paid add-ons via `requireHubAuth`'s `requiredModule`, plus the Sales edition, resolved ONLY in `applyHubAuthContext` into `c.get('salesEdition')`.
- `requireHubAuth` is the ONE access gate, fails closed, with `allowWithoutAccess` at its default `false`. Do not reintroduce `classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule` or `requireHubModule`.
- `MinimalHubAuthContext` is an alias of the SDK's `HubAuthContext`.
- Deny taxonomy (bodies are byte-identical to the SDK's):
  - `401 {"error":"unauthorized"}` (any code, `contract_version_mismatch` and a token with no `access` key included) goes to the login screen.
  - `402 {"error":"payment_required","code":"no_org_access"}` MUST render the buy screen (`MissingEntitlementPanel`).
  - `403 {"error":"forbidden"}` (`missing_module`, `missing_role`, `origin_not_trusted`) MUST render the ask-an-administrator panel (`ForbiddenPanel`), which names no module, role or raw id.
  - `503 {"error":"unavailable","code":"hub_auth_not_configured"}` means no Hub configuration at all. The seller invitation routes also answer it while the development identity adapter is installed.
- `isAuthFailure` (401), `isEntitlementFailure` (402) and `isForbiddenFailure` (403) in `apps/web/src/lib/require-token.ts` key on the STATUS alone, never on the body `code`. `require-token.ts` imports nothing.
- `SalesOpsApp` classifies in the order entitlement, forbidden, auth, generic. The generic `Verifique o servidor local` copy is reachable ONLY for an unclassified error. Oracle: `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`.
- That classification is for the bootstrap READ only. A 403 on a mutation is `MutationErrorBanner` (`salesOpsMutationErrorMessage` in `apps/web/src/sales-ops/mutation-error-copy.ts`), keyed on the status like `isForbiddenFailure`.
- `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts` drives the REAL verifier with an in-process keypair; keep it that way.
- `requireCapability` (`apps/api/src/middleware/require-capability.ts`) is a CAPABILITY gate behind the access gate, never an access gate: `403 {"error":"forbidden","code":"edition_capability"}`, a missing edition is `full`, and gates are registered above every route of their router. Oracle: `apps/api/src/middleware/__tests__/edition-gate-map.test.ts`.

Hub configuration:
- Hub config is the SDK's (`loadHubConfig`), read only through `hubEnvBag` in `apps/api/src/config/auth-provider.ts`, never raw `process.env`. The only local addition is `hubConfigIsAbsent`, which reads `FXL_HUB_CONFIG` plus the five identity names.
- Identity five: `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE`. All or none: none answers `503`, a partial set is a boot failure. `FXL_HUB_CONFIG` (JSON) may carry only these five and must not coexist with the discrete ones.
- Operational four, always discrete: `FXL_HUB_REDIRECT_URI`, `FXL_HUB_HEALTH_TOKEN` (operator-generated, required outside development), `FXL_HUB_TRUSTED_ORIGINS`, `FXL_HUB_SESSION_ENCRYPTION_KEY` (unused here, it keys the SDK store this repo does not use).
- The Audience is `app.<slug>` matching the Client id; the environment must match the `pk_<slug>_<environment>_<random>` segment and is NEVER inferred from `NODE_ENV`.
- `FXL_HUB_REDIRECT_URI` is judged by ORIGIN, not presence: the SDK defaults it to the Hub's own origin, which refuses outside development. Never write a presence check. Locally it must be the web origin `http://localhost:8006/auth/callback`.
- `FXL_HUB_TRUSTED_ORIGINS` is REQUIRED in staging and production (web and API are on different origins, empty means every BFF POST is `403`). Locally it is unnecessary; never tell a developer to set it.
- A bad Hub config is a BOOT failure, not a 503. `createHubBff` runs `assertBootConfiguration` exactly once; do not call it separately. `healthToken`, `redirectUri` and `trustedOrigins` travel on the CONFIG, not as `createHubBff` options.
- Deleted and must not come back: `resolveHubRedirectUri`, `parseAudienceFromPublishableKey`, `nameDiscreteVar`, `hub-config.ts`, `hub-rotated-cookie.ts`, `hub-bff-origin.ts`, `hub-session-scope.ts`, `POST /auth/switch` (switching rides `POST /auth/refresh` with `{organizationId}`).
- `secureCookies` is derived once from the HUB environment and inverted into the SDK's `insecureCookies`; `hubSessionCookieName(secureCookies)` must agree with the SDK.

BFF session store:
- The store is DURABLE in Postgres and `createAppAuthBff` must always pass it (`app-auth-bff-wiring.test.ts` asserts the instance).
- `withSession` holds one `db.transaction` with `SELECT ... FOR UPDATE` on the row until commit. `read()` is three-state `found | expired | absent`; never collapse `expired` and `absent`. An unopenable seal is `absent` and leaves the row.
- `expires_at` slides (30 days); `absolute_expires_at` is written once (90 days) and never by `update`. Both reach the SDK as ISO strings through `toSessionRecord`.
- Any throw inside `withSession` becomes `HubSessionStoreUnavailableError`, answered `503` by `hubBffErrorHandler` (the router's `onError`, not a middleware). Never let a store outage read as "no session". `createHubBff` gets `timeoutMs: 5_000`.
- `hub_bff_sessions` and `hub_bff_login_txns` are global tables with FORCE RLS and only the admin policy; the store uses `getAdminDb()`.
- Seals are AES-256-GCM with the row id as AAD, keyed by HKDF from `env.SALES_SESSION_ENCRYPTION_IKM ?? hubAuthConfig.clientSecret`, read through the validated `env`, never `process.env`.
- Post-login redirects are `SALES_POST_LOGIN_REDIRECT` and `SALES_POST_LOGIN_ERROR_REDIRECT`, resolved in `app-auth.ts`, falling back to `CORS_ORIGIN`.
- A login supersedes the PRIOR SESSION ID presented at `/auth/callback` in the same transaction, never by account id. The login-context middleware is mounted only when `session.kind === 'durable'`.

Browser session:
- Access tokens are memory-only, cached until `exp - 30s`, with one shared in-flight refresh. Logout and workspace generation guards reject late responses.
- A missing token is never defaulted: `requireToken` throws `AuthTokenUnavailableError`, and `apiFetch` / `apiFetchBlob` require a non-empty token. Lint forbids `(await getToken()) ?? ...`.
- The browser reads `/auth/refresh` itself via `requestHubAccessToken` in `apps/web/src/auth/refresh.ts`, not `HubClient.getToken()`. `createHubClient` gets `autoRenew: false`; `start()` is never called.
- A `401` from refresh fails the session at once; anything else enters the bounded ladder (`SESSION_REVALIDATE_DELAYS_MS`, four consecutive failures). The counter resets on every recovery.
- A LIVE session loss never navigates: `HubProtected` renders `SignedOutPanel` as an overlay with `children` still mounted. Cold entry still redirects to login.
- `SalesOpsApp` gates both `<Navigate>` early returns on `profile.isSignedIn`. Never return `null` or a Skeleton while signed out; that unmounts the operator's work.
- While visible, the token renews at `exp - SESSION_RENEWAL_LEAD_MS` (60s) through `HubAccessTokenCache.renew()`. Nothing is scheduled while hidden; a non-positive delay never schedules.
- `sanitizeReturnTo` re-validates the NORMALIZED value and refuses terminal auth routes (`/no-role`) matched the way React Router matches.
- `Sair` writes the durable `fxl-sales.auth.logoutIntent` in `sessionStorage` synchronously before the first `await`. It blocks auto-login and is cleared only by the panel's `Entrar` and by `observeToken`'s live-token branch.
- `queryClient.clear()` runs on logout, on an in-page signed-out to signed-in transition, and after a completed workspace switch (after the `await` and generation check, before `tokenCache.seed`). A ladder recovery must NOT flush. `QueryClientProvider` stays outside `AppAuthProvider`.

## Development identity mode

Full reference: `nexo/knowledge/reference/development-identity-mode.md`.

- `SALES_AUTH_FAKE` (API) plus `VITE_AUTH_FAKE` (web) let the product run with no Hub. Both are commented out in every `.env` example; `make dev-fake`, `make back-fake` and `make front-fake` set them.
- With both absent the app behaves exactly as without the mode. The substitution happens ONCE at boot and REPLACES the Hub middleware; never add a per-request branch on the flag.
- `packages/auth-fake` is a devDependency only, reached only by dynamic import from `apps/api/src/auth/select.ts` and `apps/web/src/dev/install-dev-identity.ts`. `scripts/__tests__/auth-fake-isolation.test.mjs` enforces this.
- The web half sits behind `import.meta.env.DEV`; `scripts/assert-web-bundle-clean.mjs` proves it is absent from the build.
- KNOWN GAP: the production API image still contains `packages/auth-fake`. What holds it closed is `NODE_ENV=production` baked into `apps/api/Dockerfile` plus the boot refusal. Fixing the Dockerfile (`--prod`, scoped `packages` copy, artifact test) is filed on `nexo/ROADMAP.md`.
- Fake identities emit Hub-shaped CLAIMS that go through `getRolesFromHubClaims` and `getVisibleWorkspaces`; never write `profile.roles` directly.
- The roster is `team-owner`, `team-admin`, `product-admin` in `packages/auth-fake/src/index.ts`. An admin-only identity without `meus-dados` is impossible today (see Sales Ops Routing).
- `leads-owner` and `leads-seller` (on `org_fake_leads`, `FIXTURE_LEADS_EDITION_ORGANIZATION_ID`) are the ONLY identities with `modules`, exactly `['sales.edition.leads']`; `LEADS_EDITION_MODULE` is pinned equal to `SALES_EDITION_LEADS_MODULE` by `dev-identity-roles.test.tsx`.
  The seed gives that org no etapas, no settings row and one UNBOUND vendedor pessoa with `leads-seller`'s email.
- `apps/api/scripts/seed-dev.ts` seeds the roster's orgs against LOCAL Postgres only.

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

Full reference: `nexo/knowledge/reference/ui-controls.md`.

- Native `<select>`, `<option>`, `<datalist>` and raw `<input type="number">` are banned in `apps/web/src` by `no-restricted-syntax`.
- Every picker uses `Combobox` from `@/components/ui/combobox`. The only exceptions are the shadcn `Select`s in `ProductDialog.tsx` (status) and `CommissionRuleForm.tsx` (basis); convert them when touched and add no third.
- Numeric fields use `<Input type="number">` from `@/components/ui/input`. `<input type="date">` is allowed.
- Any inline layer inside a dialog (`Combobox` panel, `InfoHint`) MUST call `useInlineLayer(open)` from `@/components/ui/inline-layer`, or Escape closes the whole dialog. Test it inside a REAL `Dialog`.
- Picker sizes: `formSelectClass` (44px) and `comboboxTriggerClass` (40px, `Filtros` bar only).
- `onCreate` is wired only where an inline create yields a complete valid record (cliente, área, função, profissional). Produto opens `ProductDialog` prefilled; vendedor and finder pickers get no create row.
- A wizard's primary button is `type="button"` on EVERY step and the final step saves via `onClick`. Never derive `type` from the step. happy-dom cannot catch this; the oracle is `keeps one activation behaviour on every step`.

## Sales Ops Routing

Full reference: `nexo/knowledge/reference/sales-ops-routing.md`.

- Routes: `tatico/dashboard`, `operacional/vendas|comissoes|leads`, `cadastros/produtos|areas|clientes|pessoas|funcoes|etapas|importacao|geral`, `meus-dados/vendedores|comissoes|leads|finders|vendas`, plus the proposta detail `operacional/vendas/:saleId` (and `meus-dados/vendas/:saleId`).
- The URL is the single source of truth for the active workspace and page.
- The open proposta detail is URL state too: one route `SALES_OPS_ROUTE_PATTERN` (`/:workspace/:view/:saleId?`) and `saleId` is honoured only on the `vendas` view; never hold the open detail in component state.
- `buildSaleDetailPath` builds `/operacional/vendas/<id>`, the Finance `deepLinkPath`; an invisible workspace drops the id through the ordinary role default.
- An unknown or other-org id renders `Proposta não encontrada` without the id; closing pops history when opened in-app (`SALE_DETAIL_OPENED_IN_APP`) and otherwise replaces the URL with the list.
- `cadastros/vendedores` and `cadastros/finders` redirect to `/cadastros/pessoas`; `aliasLegacyView` only fires in `cadastros`.
- Visibility comes only from `profile.roles` via `getVisibleWorkspaces`: `admin` sees `tatico`, `operacional`, `cadastros`; `seller` or `finder` adds `meus-dados`; no roles keeps `/no-role`. `admin` is synthesized from the Hub workspace `owner`/`admin` flag in `getRolesFromHubClaims`.
- In the leads edition (`profile.edition === 'leads'`, from `entitlements.modules`) every navigation function takes a trailing `edition`: `admin` sees only `operacional` [`leads`] and `cadastros` [`pessoas` labelled Vendedores, `etapas`], a non-admin `seller` only `meus-dados` [`leads`], and `NoRoleGuard` keys on `getVisibleWorkspaces(roles, edition)`.
  Oracle: `navigation-edition.test.ts`.
- OPEN PRODUCT QUESTION: every admin-bearing claim shape also returns `seller` and `finder`, so "team-only without `meus-dados`" is unreachable. Do not resolve it by changing `claims.ts` without a product decision.
- `meus-dados` reuses existing panels; `MeuPainelView` is read-only. Pessoa and função editing live only under Cadastros.
- Keep the legacy trees `/admin/*`, `/finder/*`, `/seller/*`, `/no-role` unchanged. `/no-role` is wrapped in `NoRoleGuard` (inside `<Protected>`), keyed on `getVisibleWorkspaces(roles).length > 0`, never `roles.length > 0`.
- Open-price item labels use `items[].productName` to `productNameSnapshot`; add no parallel field.

## Organization context

Full reference: `nexo/knowledge/reference/organization-context.md`.

- A Hub ORGANIZATION (tenant) and a Sales WORKSPACE (`tatico`, `operacional`, `cadastros`, `meus-dados`) are different things. The sidebar chrome says `Painel`; code names (`SalesOpsWorkspace`, URL segments, `navigation.ts` functions) stay unchanged.
- A `402` renders `MissingEntitlementPanel`: active Organization, then switch to another, then Hub checkout. It passes no `onRetry` and never reloads the page.
- `useOrganizations()` in `apps/web/src/auth/react.tsx` is a thin projection that hands `setActive` through by reference and derives `others`. It never calls `queryClient.clear()` itself.
- Match the active Organization by the `workspaceId` claim, never by name (name is only a fallback when the claim is missing).
- The sales-ops account dropdown shows an Organization section guarded by `others.length === 0`, never `organizations.length > 1`.
- `?organization=` deep linking is not used; a switch is always an in-app `setActive`.

## Trocar conta e convites de vendedor

Full reference: `nexo/knowledge/decisions/2026-10-01-sales-owns-seller-invitation-delivery.md`.

Trocar conta:
- `switchAccount(options?)` reaches the UI only through the provider seam in `apps/web/src/auth/react.tsx`, handed through `useOrganizations()` by reference. It passes `{ organization }` only for a non-empty id, navigates the page, and never flushes the query cache or seeds the token cache.
- Never hand-build a `prompt=` URL; `apps/web/src/auth/__tests__/no-hand-built-prompt.test.ts` scans both apps. The BFF relays `prompt=select_account` itself.
- "Trocar conta" lives in the account menu, `MissingEntitlementPanel` and `NoRolePage`; each ignores a second click with a ref guard plus `disabled`. The panel still passes no `onRetry`.
- The three surfaces render the account through the one `AccountAvatar` (`apps/web/src/sales-ops/AccountAvatar.tsx`), never a raw id.

Convites de vendedor:
- Sales sends the Hub invitation; Hub ACCOUNT provisioning stays with the Hub (`sellers.account_id` nullable).
- The actor token is the raw `Authorization` bearer read in the route handler, never a body and never `hubAuth`. `appRoles` is exactly `['seller']`; no `organizationId` is ever sent. `invited_org_id` is `c.get('orgId')`.
- Exactly one place builds the Hub create call: `inviteSellerRow` in `apps/api/src/domains/sellers/admin-service.ts`, used by `POST /` and `POST /:id/invite`.
- An invite failure never rolls back the seller: `POST /` answers `201` and the outcome rides in the body (`inviteError` or the delivery fields). The web reads `body.inviteError`, never the HTTP status.
- `HubInvitationError` is mapped by `code` only through `mapInvitationError`; `acceptUrl` and the bearer are never logged; `retryAfterSeconds` rides in the body (CORS hides `Retry-After`).
- `getInvitationsClient()` is null with no Hub config OR while `isAppAuthAdapterInstalled()`; never read `SALES_AUTH_FAKE` there.
- Resend, revoke and invite validate the uuid and answer the unknown-seller `404` when a stored `invited_org_id` differs from the admin's org, before the Hub is called. Routes inherit `requireAdmin` from `admin/index.ts`; `seller-routes-admin-gate.test.ts` proves it on the real router.

## Arquivamento e histórico

Full reference: `nexo/knowledge/reference/arquivamento-e-historico.md`.

- `salesOpsRouter` has no DELETE verb. "Arquivar" is a status-only PATCH (body carries `status` only), reversible from `cadastros/geral`. Produto, área, função go to `archived`; pessoa goes to `inactive`.
- The only hard delete is the nightly `runArchivedCadastroPurge()`: archived, older than 30 days, not a system função, unreferenced. It relies on Postgres `23503` to skip referenced rows; never hand-write a reference check and never add `ON DELETE CASCADE` to the history FKs.
- Each purge is one transaction writing the `cadastro.purged` ledger entry first (`actor_user_id = 'system'`, `actor_org_id` = the row's org).
- Archived rows are hidden from lists and pickers only; they still render where referenced. Restore lives only in `Histórico de arquivamentos`.
- A cliente cannot be archived (no `status` column); do not add the control before the column.
- Archive and restore write a hash-chained `audit_log` entry with the SAME transaction `tx`, never the pooled `db`. Ordinary edits write nothing.
- The actor name is snapshotted from the token (`name`, `email`, `null`).
- `GET /api/v1/sales-ops/history` is org-scoped by `eq(auditLog.actorOrgId, orgId)` (no RLS on `audit_log`) and must never use `getAdminDb`. Project `audit_log.id` as `String(row.id)`.
- A restore is a new ledger entry, never an undo.

## Pessoas e Funções

Full reference: `nexo/knowledge/reference/pessoas-e-funcoes.md`.

- A Pessoa is the single people cadastro; a Função is an org-scoped role assigned to a pessoa.
- `vendedor` and `finder` are the only system funções: not renamable or archivable (`409 funcao_is_system`), no edit affordance. Everything else, `Prestador` included, is org-created.
- Funções are archived, never deleted.
- Web code checks funções through `hasFuncao` (in `apps/web/src/sales-ops/calculations.ts`), never through the deprecated `is_seller` / `is_finder` / `is_collaborator` mirrors. Do not reintroduce `isCollaboratorPerson`.
- Person writes send `funcaoIds` as a full set replacement; empty is `funcao_required`.
- Hub `AppRole` values are unrelated to funções.

## Produtos & Serviços

Full reference: `nexo/knowledge/reference/produtos-e-servicos.md`.

- `cadastros/produtos` is labelled "Produtos & Serviços". Rows carry `kind: 'product' | 'service'`.
- Both kinds may carry `setupBrl`/`monthlyBrl`; for a Serviço it is a negotiable base value and `0` means none (`Variável`).
- Branch on kind only through `isServiceProduct`; read an own value only through `productBaseValueBrl` (cents). `openPrice` is a server projection of `kind`, not a money signal.
- The kind filter is component state, not URL state.
- Every value in the product dialog is a DEFAULT that a proposta may override.
- The default payment plan is six flat columns (`defaultEntradaMode` is `'none' | 'pct' | 'fix'`, never `fixed`). A blank `Número de ciclos` means indefinite (`null`). Installments cap at 120 (119 with an entrada).
- Default costs per função arrive flat in `bootstrap.productFuncaoCosts`; `valueBrl` is CENTS, formatted with `formatFuncaoCost`, never `formatProductCommission`. New rows offer only active, non-system, unused funções; a row's own stored função stays selectable, labelled `(arquivada)` if archived.
- `providers` is deprecated; writes omit the key.
- `code_suffix` is unique per org including archived rows; new produtos seed it via `nextProductCodeSuffix`; edits never renumber.

## Propostas domain

Full reference: `nexo/knowledge/reference/propostas.md`.

Statuses and payables:
- Statuses `draft|open|won|lost|cancelled` (Rascunho, Aberta, Ganha, Perdida, Cancelada). Transitions only via `POST /sales/:id/transition` and `POST /sales/:id/cancel-contract`; `PUT /sales/:id` may only move between `draft` and `open` and keeps a `won` proposta `won` (`409 invalid_status_change`).
- Payables materialize only on `won`. Commissions and tax are per receivable; `professional_cost` is split over INSTALLMENT receivables only (never `M`-prefixed recurring ones) by `resolveProfessionalSplit`, falling back to one-shot when none exist; `other_cost` is one-shot.
- Leaving `won` is refused with `409 sale_has_active_settlements` (naming the rows) while any row of the proposta has an active baixa; the operator reverses first, manually.
  Without one, the revert voids the `open` payables and leaves the receivables.
- `cancel-contract` refuses with the same 409 when any non-void row it would void has an active baixa.
- Receivable labels `N/M` and `MN/M` are load-bearing (`deriveWizardPrefill` parses the `M`) but are NEVER row identity: they renumber when a parcela is zeroed.
- `sales_ops_settings.commission_on_recurring` is dead; commissions are generated for every non-void receivable.
- `reduzirLiquidacao` in `packages/shared-utils/src/liquidacao.ts` is the ONE settlement rule and mirrors the Finance reducer: a baixa is active while no estorno cites it, paid is the sum of active baixas, and the displayed date is the GREATEST active date.
- `validarNovaBaixa` and `validarEstorno` in the same file are the only pre-write settlement checks; they take today as an argument and never read the clock. Web imports the `/liquidacao` subpath, never the root.
- `liquidacao.ts` imports nothing; its parity table in `liquidacao.test.ts` must change in the same change as any Finance rule change.

Baixas (settlements):
- A baixa or estorno is an immutable fact in `sales_ops_settlements`, written only by `apps/api/src/domains/sales-ops/settlements.ts` behind `requireAdmin` (`POST /settlements`, `POST /settlements/:id/reverse`, `GET /sales/:id/settlements`).
- A baixa is allowed only on a non-void row of a `won` proposta, its amount is always the whole open amount (never from the body), and `paidOn` defaults to `todayInSaoPaulo()` and is never in the future.
- Row `status` `paid` is a cache of `reduzirLiquidacao` written with `revision + 1` only when it changes; `void` stays a Sales decision the cache never overwrites.
- Settlement writes lock the sale `FOR SHARE` and then the row `FOR UPDATE`, the same order (sale first) as every sale write; the rules come only from `validarNovaBaixa` / `validarEstorno` / `statusCacheDaLinha`.
- The history projects `actorName` only, never `actor_user_id`.

Editing a proposta (PC2):
- `updateSale` never deletes and recreates. Rows are reconciled by the ids the payload carries (`items[].id`, `professionals[].id`, `installments[].id`, `recurring.receivableIds[i]` for cycle i+1); a row without an id is new and gets a server uuid.
- An id that is not a live row of this sale answers `400` (`item_not_found`, `professional_not_found`, `installment_not_found`, `recurring_row_not_found`) and is never used as an insert id.
- A receivable or payable that left the plan becomes `void` and stays. An item or professional that left gets `removed_at`; every reader filters `removed_at IS NULL`.
- `draft`, `open` and `won` share one path. On `won` payables are reconciled in place by `payableIdentityKey`, never by beneficiary name; a one-shot payable keeps its stored due date.
- A settled row (active baixa or `status = 'paid'`) whose amount or due date would change, or that would be voided, fails the whole edit with `409 row_has_active_settlement` naming every blocking row; nothing is written.
- The reconcile is the pure `planSaleEdit` in `apps/api/src/domains/sales-ops/ledger-reconcile.ts`; `service.ts` only wires it and `sale-edit-writes.ts` holds the writes.
- Every UPDATE that changes a receivable or payable column spreads `receivableRevisionBump()` / `payableRevisionBump()` from `ledger-revision.ts`; an unchanged row gets no UPDATE.

Settlements (schema):
- `sales_ops_settlements` (migration `0024_sales_ops_settlements`) holds immutable `baixa`/`estorno` facts for one receivable or payable each. A trigger refuses every UPDATE and DELETE with SQLSTATE `FXS01`; an estorno that does not mirror its baixa (org, sale, kind, row, amount) fails with `FXS02`.
- At most one estorno per baixa (`sales_ops_settlements_one_estorno_per_baixa_idx`, `23505`). Every FK is composite, leads with `org_id`, carries `sale_id` for the row FKs, and is `ON DELETE RESTRICT`: a settled row, its sale and a reversed baixa are never deleted.
- `sales_ops_receivables` and `sales_ops_payables` carry `revision` (starts at 1, CHECK `>= 1`) and `updated_at`.
- `sales_ops_sale_items` and `sales_ops_sale_professionals` carry a nullable `removed_at` (soft removal on edit; slice 04 writes the rules for it).
- Product code has no DELETE path and no trigger bypass for settlements. Tests remove them only through `deleteSettlementsForOrgs` (`apps/api/src/db/__tests__/settlement-test-cleanup.ts`) and the dev seed only in replica mode as the local superuser, both before any ledger or sale delete.
- Migrated paid rows got one synthetic baixa (`actor_user_id = 'system'`, `actor_name = 'Migração'`, `paid_on` = the UTC civil due day clamped to today in São Paulo); the dev seed writes the same shape with `actor_name = 'Seed de desenvolvimento'`.

Professional split:
- `cost_split_bp` is 1..120 basis points summing to exactly 10000 (enforced in `SaleProfessionalSchema`); `NULL` means pro rata. Parts bind front-aligned to installments in due-date order.
- `splitCentsByWeights` in `packages/shared-utils/src/professional-split.ts` is the one distribution primitive (last part absorbs the remainder).
- `professional_cost` payables persist `sale_professional_id`; idempotency matches that id plus receivable id, never display name. Migrations use the shared phased runner, not the stock Drizzle one.
- `Detalhe de pagamento` is an in-flow disclosure (no `useInlineLayer`) in `ProfessionalSplitPanel.tsx`. Parts are entered as percentages only. Step 3 gates on `professionalSplitsValid`; adding or removing a part never renormalizes.

Settlement UI:
- Baixa, estorno and history UI live in `apps/web/src/sales-ops/settlements/`; `SalesOpsApp.tsx` only mounts `PaidOnNote`, `SettlementRowActions` and `SettlementHistorySection`, and feeds `lockedRowLines` to the existing `MutationErrorBanner`.
- Settlement actions render only for `admin` in the `operacional` workspace (`canSettleInWorkspace` in `navigation.ts`, the one predicate); `meus-dados` stays read-only for everyone and shows only `Pago em`.
- `Marcar como pago` defaults to `todayInSaoPaulo()`, sets it as `max`, refuses a future day before the request, and never sends an amount.
- `paidOn` is a civil day formatted by string (`formatCivilDay`), never through `new Date`.
- `Estornar` reverses the latest active baixa read from `GET /sales/:id/settlements`; the bootstrap carries no settlement id.
- History renders `actor_name` (fallback `Autor não identificado`) and never `actor_user_id` or any row id.
- A `409 sale_has_active_settlements` from a transition or `cancel-contract` renders `MutationErrorBanner` with one line per blocking row (`lockedRowLines`, from `ApiError.rows`); there is no second page-level error component.
- Every ledger table sorts through `compareReceivables` / `comparePayables` in `apps/web/src/sales-ops/ledger-order.ts`; never render the bootstrap order verbatim, because a settlement UPDATE moves the row to the end of the unordered read.
- A payable is described with its linked parcela (`Comissão do vendedor · Ana · Parcela 1/3`) or, without one, its due day, so two rows for the same beneficiary never read the same.

Payment plan builder (step 2):
- Declarative: entrada, restante and recorrência regenerate the table; rows stay editable. Pure generators live in `apps/web/src/sales-ops/calculations.ts`.
- `splitInstallmentsEqually` puts the remainder on the LAST row. `addMonthsToIsoDate` clamps to month end and computes from the anchor.
- A row date or amount edit sets the whole-plan `planDirty`; header changes while dirty ask `Aplicar` / `Manter parcelas`.
- `inferPaymentPlanShape` regenerates and compares; `matchesFormula: false` keeps rows verbatim.
- `defaultPlanShapeForProduct` is the only seam from produto template to proposta.

Row identity in the wizard:
- The wizard carries the persisted `id` of every loaded item, professional and installment row, and the recurring `receivableIds` in cycle order, through every edit and sends them on `PUT /sales/:id`; a new row carries none.
- A regenerated plan keeps ids by ROW INDEX through `carryRowIdsPositionally` in `apps/web/src/sales-ops/row-identity.ts`, never by label, date or amount; surplus old ids are omitted so the API voids those rows.
- `buildSalePayload` never filters by amount, so a zero-amount row keeps its id.
- A `won` proposta opens in the wizard (`isSaleEditableStatus`) and saves with `status: 'won'`; `lost` and `cancelled` never open.
- A failed edit save renders `describeSaleSaveError` inside the still-open wizard; a `409 row_has_active_settlement` names each blocking row by its label and never by id.

Items and defaults:
- Áreas are required on every product and item. Free-form items are `productId: null` with `productName` and an `areaId`.
- Produto commercial numbers are per-proposta DEFAULTS; hand-typed values are pinned in `manualOverrides`, and `Restaurar padrão` unpins.

Professionals (step 3):
- Rows carry `funcao_id` plus `funcao_name_snapshot` (legacy `role` is a mirror). `FUNÇÃO NO PROJETO` comes first; the person picker is disabled until a função is chosen, then groups people with and without it. Choosing a person without it grants it via `useSaveSalesOpsPerson` (full `funcaoIds` plus `contactEmail`).
- New rows seed no person. `professionalRowWillPersist` is the single rule for dropping personless rows from payload, displayed cost and gating.
- `CUSTO ALOCADO` prefills from `buildFuncaoCostBasis` (função-scoped item subtotal, never the recorrência). New propostas auto-seed one row per declared função via `planFuncaoCostSeeds`, create path only. `%`/`R$` is an input mode; only cents persist.
- `computeSaleFinancials` in `packages/shared-utils/src/sale-financials.ts` is the ONE margin implementation (web imports the `/sale-financials` subpath).
- `resolvePartyContexts` validates every person and função in-org inside `withTenant`; server snapshots win.

Civil days:
- `due_date` stores a civil day `D` as `D T00:00:00Z` and is read back with the UTC slice (`asDateOnly` in the API, `displayDate` / `civilDayOf` in `apps/web/src/sales-ops/civil-day.ts`); never format it through `new Date(...)` in the browser timezone.
- Every "today" decision is the `America/Sao_Paulo` day from `@fxl-sales/shared-utils/sao-paulo-day` (`todayInSaoPaulo`, `saoPauloDayOf`, `isAfterTodayInSaoPaulo`), never `new Date().toISOString().slice(0, 10)`. The won date and the `cancel-contract` default cut-off follow it.
- Day inputs are validated with `isIsoDay` (a real calendar day), never a bare regex. The web imports the subpath, never the package root.
- A "no mês" figure is the São Paulo month of today: payments by `paidOn` (`sumPaidInSaoPauloMonth`), won revenue by `saoPauloDayOf(wonAt)` (`buildDashboardModel(bootstrap, today)`), never by `dueDate`.
  The helpers take `today` and never read the clock; callers pass `todayInSaoPaulo()`.

Financial role gate (PC23):
- `requireAdmin` guards `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id`, `PUT /settings` and every settlement route; a new route that moves ledger money or org-wide financial defaults gets it too.
- `POST /sales` stays open because a seller's lead conversion on `meus-dados/leads` creates the proposta, but a raw body with `status: 'won'` from a non-admin answers the `requireAdmin` body before validation.
- `hasAdminRole` and `ADMIN_ROLE_REQUIRED_BODY` in `apps/api/src/middleware/require-admin.ts` are the one predicate and the one body; never spell an admin check inline.
- A 403 from a mutation renders `MutationErrorBanner` on the current screen and never `ForbiddenPanel`, which stays the app gate for reads.
- Settings `currency` is `z.literal('BRL')`; the UI shows `Real (BRL)` read-only and always sends `BRL`. Legacy stored values are tolerated on read and rewritten by the next save; there is no data migration.

Testing:
- Integration tests use the local Docker test DB via the `fxl_sales_test` non-superuser role; `apps/api/test/rls/setup-env.ts` hard-overrides `DATABASE_URL`.
- `TEST_DATABASE_URL` and `ADMIN_DATABASE_URL` are REQUIRED and must be local hosts; nothing falls back to `DATABASE_URL` or a `postgres` default. `apps/api/test/rls/assert-test-role.ts` refuses a missing or non-local URL and a `SUPERUSER`/`BYPASSRLS` app role before any test runs.

## Kanban de leads

Full reference: `nexo/knowledge/reference/kanban-de-leads.md`.

- A lead lives in `sales_ops_leads`, never in `sales_ops_sales`, and creating one consumes no proposta code. Leads never enter `/bootstrap`, summaries, the dashboard or `computeSaleFinancials`.
- Estimated value is integer cents. Creating a lead never creates a cliente; that happens at conversion.
- Lead produtos are a child table (nullable `product_id` plus name snapshot), not `jsonb`.
- The vendedor is resolved via the `vendedor` system função (`hasFuncao`, `FUNCAO_SLUG_VENDEDOR`).
- Etapas follow the funções precedent: org-scoped, `is_system`, ordered, archived never deleted. `Perdido` requires a reason, enforced in both UI and API.
- `stage_changed_at` moves only when the etapa changes, never on edits or reorders.
- The `Mover para` dialog is the single emitter of `MoveLeadPayload`; drag calls it. Moves are optimistic and revert exactly; board read and mutation share one memoized `filters` object. Since the Prospecção redesign the per-card `Mover para…`/`Editar` buttons are GONE: in the Quadro a card has no buttons (clicking it opens edit via `onEdit`, dragging moves it, told apart by a 6px pointer-movement guard in `LeadCard`), and the non-drag move entry point is the `Mover` action in the Lista view (plus drag-to-`Perdido`, which still hands back to the dialog). `MoveLeadDialog` stays the one emitter; `data-move-trigger`/`data-edit-lead` now live on the Lista rows, not the card.
- The board has a `Quadro`/`Lista` toggle (`leadView`, default `board`) and a Lista phase filter (`leadStageFilter`), both component state (NOT in the URL). The Quadro column header shows the stage total in R$, `% do total` and a proportion bar; the Lista has phase chips with per-stage totals and a footer total. Totals derive from the `leads` prop (already seller-scoped server-side), never a client filter. Stage colours come from `stageColors()` in `board-ui.ts` by OBJECT-LOOKUP (`KIND_COLORS[stage.kind]` with only `conversion`/`lost` keys, a cycling palette for `normal`) and `stageIsNormal()` is `!KIND_COLORS[stage.kind]` - never an inline `kind === …`, so the write-surface scan stays green. The day-in-stage badge has three colour tiers (`dayBadgeTone`: ≤7, 8-14, >14) and shows only on `normal` stages for non-converted leads.
- Moving into the conversion etapa opens the proposta wizard via `leadPrefill` (never a synthetic `editSale`). The card moves only after `POST /sales` answers `201`; cancel changes nothing. `requestLeadConversion` never calls a lead mutation. The prefill relaxes no wizard gate; the vendedor seeds only if valid, never `firstSeller`.
- `convertedSales` prevents a second proposta for the same lead within a session.
- Read-only is a property of the CONVERTED CARD (`lead.saleId !== null`), never of a column.
- No board code may call `POST /sales/:id/transition`. `board-write-surface.test.ts` scans the `BOARD-WRITE-FENCE:START/END` regions in `SalesOpsApp.tsx`; those sentinels are load-bearing.
- Stage moves write nothing to `audit_log`.
- Seller scoping is server-side inside `withTenant`, never a client filter.
- Routes: `operacional/leads` (team), `meus-dados/leads` (seller), `cadastros/etapas`. Nav entries are appended, never prepended, because the first entry is the landing route.
- Lead screens live in `apps/web/src/sales-ops/leads/`, never inside `SalesOpsApp.tsx`, mounted through `LeadStagesContainer` / `LeadsBoardContainer`, and use `mutateAsync`.

## Edição Leads

Full reference: `nexo/knowledge/reference/kanban-de-leads.md` (section Edição Leads), `pessoas-e-funcoes.md`, `sales-ops-routing.md`, `auth-model.md`.

- The edition is DERIVED per request from the verified token: `resolveSalesEdition(entitlements.modules)` from `@fxl-sales/shared-utils/sales-edition` (subpath only).
  Only the exact module `sales.edition.leads` selects `leads`; absent, empty or unknown modules are `full`, which is FXL byte-for-byte.
  It is never stored and never read from a body.
- API: `c.get('salesEdition')` is set only in `applyHubAuthContext`; services take the edition as an explicit argument from the route (`c.get('salesEdition') ?? 'full'`) and never read the Hono context.
- Web: the shell reads `profile.edition`; leaf components read `useSalesEdition()`.
  Every `vi.mock('@/auth/react')` factory exports `useSalesEdition` (`auth-mock-edition-export.test.ts`).
  The sidebar payables card, the sidebar `Nova proposta` and the period chip render only when the edition has the capability (`hasCapability`); never show full-product chrome in the leads edition.
- Leads writes use `ContactLeadFieldsSchema` (strict, `null` or `''` clears an optional) through `createContactLead` / `updateContactLead`, chosen by `leadFieldSet`; the full schemas stay byte-identical and still reject the contact keys.
  A leads-edition lead stores `client_id NULL`, `''`, `0` and no produtos.
- No etapa is ever seeded in the leads edition.
  Creating a lead with no active `normal` etapa answers the existing `400` `reason: 'no_open_stage'`; the web keys on status 400 plus `ApiError.reason`.
  The board shows `[data-no-stages]` and never receives `onRequestConversion` / `onOpenSale`.
- In the leads edition `POST/PATCH /people` force exactly `[vendedor]` (seeding the system funções in the same transaction) before `planPersonFuncoes`; a status-only PATCH leaves funções untouched.
  The Vendedores screen (`apps/web/src/sales-ops/people/VendedoresView.tsx`) lists inactive vendedores with `Reativar`, because Geral and `GET /history` are gated.
  Oracle: `vendedores-routing.test.tsx`.
- A non-admin vendedor creating a lead in the leads edition sends no `sellerPersonId`: `createContactLead` (only) assigns the caller's own pessoa, the Vendedor picker is hidden for non-admins, and an explicit other id is still `403 seller_scope`.
- The contact lead dialog stays open with the typed values and an inline error when a save is refused; the `Mover para` dialog shows no refusal before the operator interacts.
- An admin in the leads edition never sees `meus-dados` (product decision); a finder-only operator stays on `/no-role`.

## Integração Sales-Finance (plano de controle)

Full reference: `nexo/knowledge/reference/integracao-sales-finance.md`.

- The Hub is the CONTROL PLANE and Sales a DATA PLANE: the Hub stores only event-type/Contract/Activation metadata and never a business payload. Sales writes its own outbox in the SAME transaction as the business act, exposes a cursor feed, and pulls the peer's feed directly.
- `@fxl-business/fxl-contracts` is pinned EXACTLY `0.1.0` (no caret/tilde) in `apps/api` and `packages/auth-fake`, in the same commit as the lockfile. It has zero deps and reads no env (it takes a config). The fake authority is ONLY under the `@fxl-business/fxl-contracts/testing` subpath; never import it from the root barrel. A 404 on install is Gate G5: STOP, never vendor.
- All integration code lives in `apps/api/src/domains/integration/`. All adapters are in `outbox-adapter.ts`: `createIntegrationTxAdapter(tx)` (wraps the in-progress business tx), `createIntegrationPooledAdapter()` (over `getAdminDb()`, carries the Drizzle tx for `drizzleTxOf`/`hasDrizzleTx`).
- Migration `0025_integration_transport` owns the four transport tables. `integration_outbox.position` is NULL until the single elected publisher assigns it AFTER commit; never assign a position at INSERT. The three org-scoped tables get the two-policy RLS (`tenant_isolation` on `app.current_org_id` + `admin_context` on `app.fxl_admin`); the global counter is admin-only.
- Event builders in `events.ts` are pure and carry NO origin logic. `recordedBy.app` is `app.fxl-sales` (with the `app.` prefix); `obligationRef` is `fxl-sales:<row uuid>`, never a label/parcela; `source.deepLinkPath` is `/operacional/vendas/<saleId>` (required by the v1 schema). `syncedObligationSubset` runs on the producer and excludes tax.
- `producer-gate.ts` is the ONE gate: `isProducerFlowLive(orgId)` (default false) + `registerProducerFlowGate(fn)`; the boot registers it once. Every emission is inside the business tx and gated on it, so an unconnected org emits nothing and behaves exactly as today.
- Anti-echo is ONE choke point, inside `applyBaixaTx`/`applyEstornoTx` in `sales-ops/settlements.ts`, guarded by `policy.mode === 'manual' && isProducerFlowLive(orgId)`; the finance path never emits. `sales_ops_settlements` still has exactly ONE writer (those two functions); the consumer applies remote facts through them with `policy.mode:'finance'`, `origin='finance'`, reusing the remote settlement uuid as the local id.
- The consumer (`consumer.ts` `createFinanceConsumer`) accepts only `recordedBy.app === 'app.fxl-finance'`, versions N and N-1, and lets the cursor advance past a permanently-rejected event (counted in `rejectedCount`); only a reversal citing a not-yet-landed baixa retries. `deriveSettlementAnomaly` derives `disputed` / "registrada em duplicidade" with no new enum/column.
- The feed route `GET /integration/v1/feed` (`feed-routes.ts`, mounted at base `/integration/v1`) takes the org ONLY from `organizationForFeedRead`, is S2S via ticket introspection (never `appAuthMiddleware`/`requireHubAuth`), 401s an inactive/absent ticket with no reason, and never logs the ticket.
- Boot wiring is `start-integration.ts`, reached from `server.ts` via `await import(...)` (keep the static-import discipline). The fake authority is selected ONLY through `getIntegrationAuthority()` in `apps/api/src/auth/select.ts` (the one file `auth-fake-isolation` allows to import `@fxl-sales/auth-fake`). The puller auto-starts only in real mode; no loop starts under `NODE_ENV=test`. The nightly prune uses a fail-closed `null` low-water and never drops below `OUTBOX_MIN_RETENTION_DAYS`.
- Fake-dev: the fixture org `org_fake_integrado` is `FIXTURE_INTEGRATED_ORGANIZATION_ID` (imported, never hand-typed) with the `integrated-owner` identity; `getFakeIntegrationAuthority()` is a memoized singleton (`environment:'development'`). No new `FXL_HUB_*` var is introduced for this integration.
- NOT built (non-goals): `fxl-sales.ledger.checkpoint` emission, backfill, the cold-entry deep-link route, and any real cross-process/real-Hub path (the Finance side of the layer does not exist here yet).

## Importação por planilha

Full reference: `nexo/knowledge/reference/importacao-por-planilha.md`.

- `cadastros/importacao` is an admin-only screen; the three routes (`GET /import/template`, `POST /import/preview`, `POST /import/commit` under `/api/v1/sales-ops`) all sit behind `requireAdmin`, and the org is only `c.get('orgId')`, never anything from the file.
- ONE definition: `apps/api/src/domains/import/workbook-schema.ts` drives the template, the parser and the planners. Never hand-type a header, tab name or column key elsewhere.
- Create-only. An import never updates. An existing ACTIVE área, função, produto or etapa with the same name is an error (`duplicate_existing`), a reference to an archived record is an error (`archived_ref`), a same-name cliente or pessoa is only a warning (`possible_duplicate`).
- Writes reuse the domain services (`createSale`, `createProduct`, `applyBaixaTx` and so on) inside one `withTenant` transaction. Never a raw INSERT into a business table, and never a second implementation of a rule.
- Preview writes nothing: it plans inside a transaction that is always rolled back. Commit NEVER trusts the preview: it re-parses, re-reads the catalog inside its transaction, re-plans and executes only at zero errors, all or nothing.
- Both routes seed the default etapas (`ensureLeadStages`) and the system funções (`ensureSystemFuncoes`) inside their transaction before `readImportCatalog`. `readImportCatalog` and the executor never seed.
- Finance connected: when `isProducerFlowLive(orgId)`, `Ganha` propostas and every `Pagamentos` row are errors (`producer_flow_live`) in the plan and are re-checked by the executor. Never import history into a connected org.
- A historical won day goes through `createSale(..., now = <wonOn>T15:00:00Z)`; a won day after `todayInSaoPaulo` is an error. A payment is a baixa through `applyBaixaTx` with the `manual` policy, never a direct write to `sales_ops_settlements`.
- A lead cannot be imported into the conversion etapa; one in the lost etapa needs `Motivo da perda`.
- Limits: 5 MB upload, 5000 data rows, 500 issues returned (`truncated`). No migration; `import.completed` is an `AuditActionSchema` addition, written once, last, in the same transaction.
- The web classifies the import errors by HTTP status only; a 403 renders inline on the screen, never `ForbiddenPanel`; a 409 shows `body.message`. The web never parses xlsx.
- Oracles: `import-routes.integration.test.ts` (round trip of the example template, all-or-nothing, producer-live, admin gate), `executor.integration.test.ts`, `template-example.test.ts`, `workbook-schema.test.ts`, `import-view.test.tsx`, `import-copy.test.ts`.
- `exceljs` is pinned EXACTLY in `apps/api` (`exceljs-pin.test.ts`); run `pnpm install` after pulling.

## Environments

| Level | Hub Client | Postgres | Secrets |
| --- | --- | --- | --- |
| local | `app.fxl-sales` local client | Local Docker | `.env.dev.example` copied to `.env` |
| staging | `app.fxl-sales` staging client | Coolify staging DB | Infisical `staging` env |
| production | `app.fxl-sales` production client | Coolify prod DB | Infisical `prod` env |

Required API vars.
The five identity variables are all set or all blank; the block ships them blank with the local values as comments.
`apps/api/src/config/__tests__/env-example-contract.test.ts` reads this block, so keep it copyable and valid.

```dotenv
# FXL_HUB_API_URL=http://localhost:9016
FXL_HUB_API_URL=
# FXL_HUB_ENVIRONMENT=development
FXL_HUB_ENVIRONMENT=
FXL_HUB_CLIENT_ID=
FXL_HUB_CLIENT_SECRET=
# FXL_HUB_AUDIENCE=app.fxl-sales
FXL_HUB_AUDIENCE=

# Operational values, always discrete variables. FXL_HUB_SESSION_ENCRYPTION_KEY
# has no line on purpose: it keys an SDK store this repo does not use.
FXL_HUB_HEALTH_TOKEN=
FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback
FXL_HUB_TRUSTED_ORIGINS=http://localhost:8006

PUBLIC_LINK_BASE_URL=http://localhost:3006

# Development identity mode. Use `make dev-fake` instead of setting it by hand.
# SALES_AUTH_FAKE=1
```

Required web vars:

```dotenv
VITE_API_URL=http://localhost:3006
VITE_AUTH_PROXY_TARGET=http://localhost:3006
VITE_AUTH_BFF_BASE_PATH=
VITE_FXL_HUB_API_URL=http://localhost:9016
VITE_FXL_HUB_ENVIRONMENT=development
VITE_FXL_HUB_AUDIENCE=app.fxl-sales

# Development identity mode. Use `make dev-fake`.
# VITE_AUTH_FAKE=1
```

The API owns public referral redirects at `/r/:code`.
Keep `PUBLIC_LINK_BASE_URL` pointed at the API public origin.

## Local database guard

Full reference: `nexo/knowledge/reference/local-database-guard.md`.
It exists because `make db-reset` once applied DDL to STAGING through an active `DATABASE_URL` in `apps/api/.env`.

- Three guarded entrypoints: `apps/api/src/server.ts`, `apps/api/src/db/migrate.ts`, `apps/api/scripts/seed-dev.ts`. A new one needs its assertion in `scripts/__tests__/local-database-guard.test.mjs` in the same change. `drizzle.config.ts` is a known unguarded door.
- `apps/api/src/db/local-database-guard.ts` is pure: no imports, no I/O, no `process.env`.
- Local hosts are exactly `localhost`, `127.0.0.1`, `::1`, `db`. An unparseable URL is not a violation.
- `SALES_ENV_FILE` is the only escape hatch (set only by `make back-stg`; `seed-dev.ts` ignores it). An unreadable named file throws and never falls back.
- `env.ts` and `migrate.ts` share `loadEnvFiles` in `apps/api/src/config/env-files.ts`. `migrate.ts` must never regain `import 'dotenv/config'`.
- `server.ts` statically imports only `./env.js` and `./db/local-database-guard.js` and loads the rest with `await import(...)`. Do not convert them back to static imports.
- Each entrypoint prints one boot line with host and port only.
- `make migrate-stg` deliberately does not exist; staging DDL is a deploy step.

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

<!-- nexo:managed:start version=4 sha256=02fd055249adb37ac71ec0db87e5e313c575eadc762d972ac81c07a1a398a84b -->
## Nexo workflow contract

Nexo owns the delivery workflow while a Nexo flow is active.
Work moves through Frame, Plan, Execute, Verify, and Capture.
Feature and batch flows plan the complete initial slice set before execution, then adapt only within the finite runtime policy.

The human owns WHAT and why.
The agent owns HOW.
Gate 1 is human approval of WHAT and is skipped only by explicit autopilot.
Gate 2 is local verification and is never skipped.
Gate 3 is the human-approved release cut and is never automatic.

Verification is tiered.
Each slice runs its named locked oracle tests plus lint on changed files.
Each integrated wave runs the full suite, full lint, and security checks once.
Each feature runs mutation testing once after all waves are green.
Execute and Verify use separate agents whenever the host supports them and the user has not explicitly required single-agent execution.

Delivery is local trunk flow.
Verified short-lived branches merge serially to `main` with no pull request and no hosted CI requirement.
Promotion to `staging` and `production` exists only when `nexo/state.json` opts into it, and every promotion is fast-forward-only.
The user never commits by hand because Nexo owns branch, commit, verification, merge, and cleanup.

Autopilot never waits for a human and never expands a budget.
A blocker or exhausted budget is recorded in `AUDIT.md`, unfinished work is parked, owned worktrees and processes are cleaned up, and the run returns a partial completion report.
<!-- nexo:managed:end -->
