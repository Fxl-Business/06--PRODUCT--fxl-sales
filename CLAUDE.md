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

## Sales Ops Routing

- Canonical Sales Ops routes are `tatico/dashboard`, `operacional/vendas|comissoes`, `cadastros/produtos|areas|clientes|vendedores|finders|geral`, and `meus-dados/vendedores|comissoes|finders|vendas`.
- The URL is the single source of truth for the active Sales Ops workspace and page.
- Workspace visibility is driven purely by the Hub role set `profile.roles: AppRole[]` (`AppRole = 'admin' | 'seller' | 'finder'`) via `getVisibleWorkspaces` in `apps/web/src/sales-ops/navigation.ts`. There is no viewing-level switcher; the old "Nível de visualização" selector was removed.
- Visibility rule: `admin` (team) sees `tatico` + `operacional` + `cadastros`; holding `seller` or `finder` adds the `meus-dados` workspace. So seller-only or finder-only sees only `meus-dados` and defaults there; team-only sees the three team workspaces and no `meus-dados`; team + seller/finder sees all four. Zero recognized roles keeps `/no-role`.
- "Team" is not a Hub product role. `admin` is synthesized in-app from the Hub workspace `owner`/`admin` flag (see `getRolesFromHubClaims` in `apps/web/src/auth/claims.ts`); the Hub product config defines only `seller` and `finder`.
- `meus-dados` reuses existing panels and view components (seller: `vendedores` "Meu painel" + `comissoes`; finder: `finders` "Meu painel" + `vendas` "Indicações"); it is not a new page. Data scoping stays backend/RLS-authoritative.
- Seller and finder create or edit controls are admin-only and live under Cadastros; Meus dados reuses the same people panels in read-only mode.
- Open-price sale item labels use the existing `items[].productName` to `productNameSnapshot` path while preserving the original `productId`, so do not add a parallel description field or migration.
- Keep the static legacy route trees `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` unchanged.

## Propostas domain

- Every deal is a Proposta with statuses `draft|open|won|lost|cancelled` (pt-BR labels Rascunho/Aberta/Ganha/Perdida/Cancelada).
- Payables (`seller_commission`, `finder_commission`, `tax`) materialize only when a proposta transitions to `won`, generated per receivable row and linked via `payables.receivable_id`; `professional_cost` and `other_cost` stay one-shot at win.
- Leaving `won` (revert, lose, cancel) voids only `open` payables and receivables; `paid` rows are never touched.
- Payment plans are explicit installments `[{dueDate, amountBrl, method}]` plus an optional recurring block `{monthlyBrl, startDate, cycles|null}` (`cycles: null` means indefinite, no bounded rows generated beyond any setup parcela).
- Receivable label conventions `"N/M"` (installment N of M) and `"MN/M"` (recurring cycle N of M, `M` prefix) are load-bearing: `deriveWizardPrefill` in `apps/web/src/sales-ops/SalesOpsApp.tsx` parses the `M` prefix to split installment rows from recurring rows when prefilling the edit wizard.
- Áreas are org-configurable (`cadastros/areas`) and required on every product and every proposal item; product `Tipo` was removed from the UI, classification is dynamic via Área plus the existing pricing flags (openPrice, setup, mensalidade).
- Free-form proposal items are `productId`-null rows using `productName` as the description (same `productNameSnapshot` path as the open-price convention above) and require an `areaId` picked directly on the item.
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
