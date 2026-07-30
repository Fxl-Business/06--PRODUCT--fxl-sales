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
- `onCreate` is wired only where an inline create yields a complete, valid record: cliente, área and função create through the API, prestador and profissional accept the typed name verbatim.
  Produto opens `ProductDialog` prefilled instead, because a produto is invalid without an área.
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
- A call site that wants only active prestadores filters for that itself, and the two existing ones deliberately differ: the produto Prestador picker offers every prestador including inactive ones, because that field stores a name snapshot and an already-linked pessoa must stay selectable; the proposta wizard's Profissional picker additionally requires `status === 'active'`. Do not "unify" them without deciding which behaviour is wanted, and pin whatever you decide.
- Person writes send `funcaoIds` as a full set replacement; the API rejects an empty set with `funcao_required`. There are no assignment sub-resource endpoints.
- Hub `AppRole` values (`admin`, `seller`, `finder`) and `roleSummaryLabel` are unrelated to funções. Workspace visibility keeps deriving purely from `profile.roles`, never from a função assignment.

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
