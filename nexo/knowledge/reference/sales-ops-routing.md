# Sales Ops Routing - full reference

Moved verbatim from `CLAUDE.md` on 2026-09-22 so the standing context stays short.
`CLAUDE.md` keeps the rules; this file keeps the reasoning, history and oracle names.

- Canonical Sales Ops routes are `tatico/dashboard`, `operacional/vendas|comissoes|leads`, `cadastros/produtos|areas|clientes|pessoas|funcoes|etapas|geral`, and `meus-dados/vendedores|comissoes|leads|finders|vendas`.
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
- Keep the static legacy route trees `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` unchanged, with ONE exception: `/no-role`'s element is wrapped in `NoRoleGuard`, which redirects to `/` as soon as `getVisibleWorkspaces(profile.roles)` is non-empty.
  The rule protects the SHAPE of those trees - their paths, their shells and their role guards - and not the dead end.
  No path is added, removed or renamed, the three shells are untouched, `RoleGuard` is byte-unchanged, and `NoRolePage` still renders unaltered for the operator the screen is actually for.
  `RoleRouter` used to sit in that same file and has been deleted: it read like the `/` root redirect but was referenced from nowhere, while `/` is really `SalesOpsApp` inside `Protected` resolving the default workspace itself.
  What it fixes is that the screen never re-checked on arrival, so an operator who reached it and then signed in successfully stayed on `Acesso não autorizado` holding full roles, and a seller who merely opened an `/admin/*` URL was stranded there by `RoleGuard` with a perfectly good `meus-dados` workspace one hop away.
  The condition is `getVisibleWorkspaces(roles).length > 0` and must NOT be simplified to `roles.length > 0`.
  The two agree for all seven non-empty subsets of today's `AppRole`, so tests do not distinguish them by accident; they stop agreeing the day a role is added that maps to no workspace, and at that moment `SalesOpsApp` wants `/no-role` while the guard wants `/` and the app locks into an infinite redirect loop for that operator, two files from the change that caused it.
  Keyed on visible workspaces the exclusivity is structural rather than arithmetic: the guard fires iff `|V| > 0` and `SalesOpsApp` fires iff `|V| === 0` (and `isSignedIn`), over the same function and the same profile in the same render pass, so at most one can ever navigate for ANY role value.
  `keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong` is the sole oracle separating the two conditions, and neither lint nor type-check catches the difference.
  `NoRoleGuard` lives beside `RoleGuard`, which is what sends operators INTO `/no-role`, and is mounted INSIDE `<Protected>`: outside it would judge an unresolved profile on a cold entry.
  It is inert during a live session loss, because the profile is then loaded with `roles: []`, so the overlay never has the URL pulled out from under it.
