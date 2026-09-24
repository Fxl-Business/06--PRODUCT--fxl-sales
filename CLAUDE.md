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
- The SDK is pinned EXACTLY at `@fxl-business/hub-sdk@2.3.0` in both apps (no caret). `hono` is pinned to `4.12.28` by a `pnpm-workspace.yaml` override so only one Hono copy resolves.

Access gate:
- Baseline access is the boolean `auth.claims.entitlements.access` and nothing else. Never read `entitlements.modules` for baseline access (the old `sales.core` module gate answered 402 to everyone). `modules` is for paid add-ons only, via `requireHubAuth`'s `requiredModule`.
- `requireHubAuth` is the ONE access gate, fails closed, with `allowWithoutAccess` at its default `false`. Do not reintroduce `classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule` or `requireHubModule`.
- `MinimalHubAuthContext` is an alias of the SDK's `HubAuthContext`.
- Deny taxonomy (bodies are byte-identical to the SDK's):
  - `401 {"error":"unauthorized"}` (any code, `contract_version_mismatch` and a token with no `access` key included) goes to the login screen.
  - `402 {"error":"payment_required","code":"no_org_access"}` MUST render the buy screen (`MissingEntitlementPanel`).
  - `403 {"error":"forbidden"}` (`missing_module`, `missing_role`, `origin_not_trusted`) MUST render the ask-an-administrator panel (`ForbiddenPanel`), which names no module, role or raw id.
  - `503 {"error":"unavailable","code":"hub_auth_not_configured"}` means no Hub configuration at all.
- `isAuthFailure` (401), `isEntitlementFailure` (402) and `isForbiddenFailure` (403) in `apps/web/src/lib/require-token.ts` key on the STATUS alone, never on the body `code`. `require-token.ts` imports nothing.
- `SalesOpsApp` classifies in the order entitlement, forbidden, auth, generic. The generic `Verifique o servidor local` copy is reachable ONLY for an unclassified error. Oracle: `apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx`.
- `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts` drives the REAL verifier with an in-process keypair; keep it that way.

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

- Routes: `tatico/dashboard`, `operacional/vendas|comissoes|leads`, `cadastros/produtos|areas|clientes|pessoas|funcoes|etapas|geral`, `meus-dados/vendedores|comissoes|leads|finders|vendas`.
- The URL is the single source of truth for the active workspace and page.
- `cadastros/vendedores` and `cadastros/finders` redirect to `/cadastros/pessoas`; `aliasLegacyView` only fires in `cadastros`.
- Visibility comes only from `profile.roles` via `getVisibleWorkspaces`: `admin` sees `tatico`, `operacional`, `cadastros`; `seller` or `finder` adds `meus-dados`; no roles keeps `/no-role`. `admin` is synthesized from the Hub workspace `owner`/`admin` flag in `getRolesFromHubClaims`.
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
- Statuses `draft|open|won|lost|cancelled` (Rascunho, Aberta, Ganha, Perdida, Cancelada). Transitions only via `POST /sales/:id/transition` and `POST /sales/:id/cancel-contract`.
- Payables materialize only on `won`. Commissions and tax are per receivable; `professional_cost` is split over INSTALLMENT receivables only (never `M`-prefixed recurring ones) by `resolveProfessionalSplit`, falling back to one-shot when none exist; `other_cost` is one-shot.
- Leaving `won` voids only `open` payables and receivables, never `paid` ones.
- Receivable labels `N/M` and `MN/M` are load-bearing (`deriveWizardPrefill` parses the `M`).
- `sales_ops_settings.commission_on_recurring` is dead; commissions are generated for every non-void receivable.

Professional split:
- `cost_split_bp` is 1..120 basis points summing to exactly 10000 (enforced in `SaleProfessionalSchema`); `NULL` means pro rata. Parts bind front-aligned to installments in due-date order.
- `splitCentsByWeights` in `packages/shared-utils/src/professional-split.ts` is the one distribution primitive (last part absorbs the remainder).
- `professional_cost` payables persist `sale_professional_id`; idempotency matches that id plus receivable id, never display name. Migrations use the shared phased runner, not the stock Drizzle one.
- `Detalhe de pagamento` is an in-flow disclosure (no `useInlineLayer`) in `ProfessionalSplitPanel.tsx`. Parts are entered as percentages only. Step 3 gates on `professionalSplitsValid`; adding or removing a part never renormalizes.

Payment plan builder (step 2):
- Declarative: entrada, restante and recorrência regenerate the table; rows stay editable. Pure generators live in `apps/web/src/sales-ops/calculations.ts`.
- `splitInstallmentsEqually` puts the remainder on the LAST row. `addMonthsToIsoDate` clamps to month end and computes from the anchor.
- A row date or amount edit sets the whole-plan `planDirty`; header changes while dirty ask `Aplicar` / `Manter parcelas`.
- `inferPaymentPlanShape` regenerates and compares; `matchesFormula: false` keeps rows verbatim.
- `defaultPlanShapeForProduct` is the only seam from produto template to proposta.

Items and defaults:
- Áreas are required on every product and item. Free-form items are `productId: null` with `productName` and an `areaId`.
- Produto commercial numbers are per-proposta DEFAULTS; hand-typed values are pinned in `manualOverrides`, and `Restaurar padrão` unpins.

Professionals (step 3):
- Rows carry `funcao_id` plus `funcao_name_snapshot` (legacy `role` is a mirror). `FUNÇÃO NO PROJETO` comes first; the person picker is disabled until a função is chosen, then groups people with and without it. Choosing a person without it grants it via `useSaveSalesOpsPerson` (full `funcaoIds` plus `contactEmail`).
- New rows seed no person. `professionalRowWillPersist` is the single rule for dropping personless rows from payload, displayed cost and gating.
- `CUSTO ALOCADO` prefills from `buildFuncaoCostBasis` (função-scoped item subtotal, never the recorrência). New propostas auto-seed one row per declared função via `planFuncaoCostSeeds`, create path only. `%`/`R$` is an input mode; only cents persist.
- `computeSaleFinancials` in `packages/shared-utils/src/sale-financials.ts` is the ONE margin implementation (web imports the `/sale-financials` subpath).
- `resolvePartyContexts` validates every person and função in-org inside `withTenant`; server snapshots win.

Testing:
- Integration tests use the local Docker test DB via the `fxl_sales_test` non-superuser role; `apps/api/test/rls/setup-env.ts` hard-overrides `DATABASE_URL`.

## Kanban de leads

Full reference: `nexo/knowledge/reference/kanban-de-leads.md`.

- A lead lives in `sales_ops_leads`, never in `sales_ops_sales`, and creating one consumes no proposta code. Leads never enter `/bootstrap`, summaries, the dashboard or `computeSaleFinancials`.
- Estimated value is integer cents. Creating a lead never creates a cliente; that happens at conversion.
- Lead produtos are a child table (nullable `product_id` plus name snapshot), not `jsonb`.
- The vendedor is resolved via the `vendedor` system função (`hasFuncao`, `FUNCAO_SLUG_VENDEDOR`).
- Etapas follow the funções precedent: org-scoped, `is_system`, ordered, archived never deleted. `Perdido` requires a reason, enforced in both UI and API.
- `stage_changed_at` moves only when the etapa changes, never on edits or reorders.
- The `Mover para` dialog is the single emitter of `MoveLeadPayload`; drag calls it. Moves are optimistic and revert exactly; board read and mutation share one memoized `filters` object.
- Moving into the conversion etapa opens the proposta wizard via `leadPrefill` (never a synthetic `editSale`). The card moves only after `POST /sales` answers `201`; cancel changes nothing. `requestLeadConversion` never calls a lead mutation. The prefill relaxes no wizard gate; the vendedor seeds only if valid, never `firstSeller`.
- `convertedSales` prevents a second proposta for the same lead within a session.
- Read-only is a property of the CONVERTED CARD (`lead.saleId !== null`), never of a column.
- No board code may call `POST /sales/:id/transition`. `board-write-surface.test.ts` scans the `BOARD-WRITE-FENCE:START/END` regions in `SalesOpsApp.tsx`; those sentinels are load-bearing.
- Stage moves write nothing to `audit_log`.
- Seller scoping is server-side inside `withTenant`, never a client filter.
- Routes: `operacional/leads` (team), `meus-dados/leads` (seller), `cadastros/etapas`. Nav entries are appended, never prepended, because the first entry is the landing route.
- Lead screens live in `apps/web/src/sales-ops/leads/`, never inside `SalesOpsApp.tsx`, mounted through `LeadStagesContainer` / `LeadsBoardContainer`, and use `mutateAsync`.

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
