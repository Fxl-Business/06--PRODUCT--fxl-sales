---
id: 08-dev-identity-and-playbook
milestone: v4.3.0
status: done
depends_on: [01-edition-contract, 02-api-edition-gate, 03-lead-contact-columns, 05-web-edition-navigation]
files_modified:
  - packages/auth-fake/src/index.ts
  - packages/auth-fake/src/__tests__/roster.test.ts
  - apps/api/scripts/seed/plan.ts
  - apps/api/scripts/seed-dev.ts
  - apps/api/scripts/__tests__/seed-plan.test.ts
  - apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts
  - apps/web/src/dev/__tests__/dev-identity-roles.test.tsx
  - nexo/playbooks/ativar-edicao-leads.md
  - nexo/knowledge/reference/development-identity-mode.md
acceptance: "packages/auth-fake exports FIXTURE_LEADS_EDITION_ORGANIZATION_ID = 'org_fake_leads' and LEADS_EDITION_MODULE = 'sales.edition.leads', and IDENTITIES ends with leads-owner (workspace owner, no productRoles) and leads-seller (workspace member, productRoles ['seller']), both active and only member of org_fake_leads named 'Leads Simples (fake)', both with modules exactly ['sales.edition.leads'], while every other identity keeps modules [] and DEFAULT_IDENTITY_ID stays team-owner; toHubClaims for both emits entitlements {access: true, modules: ['sales.edition.leads']}; the web cross-check proves through the REAL AppAuthProvider, getRolesFromHubClaims and getVisibleWorkspaces(roles, edition) that leads-owner sees operacional,cadastros and leads-seller sees meus-dados, and that LEADS_EDITION_MODULE equals SALES_EDITION_LEADS_MODULE; the API dev adapter exposes salesEdition 'leads' for both leads identities and 'full' for team-owner; buildDevSeedPlan with leadsEditionOrgIds ['org_fake_leads'] gives that org zero etapas, zero leads, zero propostas or ledger rows, zero catalog rows, no settings row, exactly the system funcoes vendedor and finder, and exactly one active unbound (hubAccountId null) vendedor pessoa whose contactEmail is the leads seller's email, while every other org's rows are byte-identical to a plan built without the flag; seed-dev.ts passes the fixture org through that flag; and nexo/playbooks/ativar-edicao-leads.md documents the production Hub activation (SKU, access grant, idempotent SQL with a resolveModules-mirroring check, verification, rollback, Sales-side onboarding) in pt-BR."
goal: "Make AC6 and AC7 reachable: `make dev-fake` offers a leads-edition gestor and vendedor on their own fixture org with no etapas, through the REAL claim translation, and a playbook tells the operator exactly how to switch Construbom to the leads edition in the production Hub."
must_not_break:
  - "pnpm --filter @fxl-sales/auth-fake test"
  - "pnpm --filter @fxl-sales/auth-fake type-check"
  - "pnpm --filter @fxl-sales/api test (whole unit suite, scripts/**/__tests__ included)"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/web test"
  - "pnpm --filter @fxl-sales/web type-check"
  - "pnpm --filter @fxl-sales/web lint"
  - scripts/__tests__/auth-fake-isolation.test.mjs
  - scripts/__tests__/local-database-guard.test.mjs
  - scripts/__tests__/dev-identity-docs-reconciliation.test.mjs
  - scripts/__tests__/fxl-contracts-pin.test.mjs
  - scripts/__tests__/api-dockerfile-workspace-deps.test.mjs
  - scripts/assert-web-bundle-clean.mjs
oracle:
  - packages/auth-fake/src/__tests__/roster.test.ts
  - apps/web/src/dev/__tests__/dev-identity-roles.test.tsx
  - apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts
  - apps/api/scripts/__tests__/seed-plan.test.ts
rules:
  - "Names from SEAM-CONTRACT section 5 are EXACT: FIXTURE_LEADS_EDITION_ORGANIZATION_ID = 'org_fake_leads', org name 'Leads Simples (fake)', identity ids leads-owner and leads-seller, module 'sales.edition.leads'."
  - "packages/auth-fake gains NO new dependency. It hardcodes the module string as the exported constant LEADS_EDITION_MODULE, and equality with SALES_EDITION_LEADS_MODULE is pinned by apps/web/src/dev/__tests__/dev-identity-roles.test.tsx (an app test may import both). Do not add @fxl-sales/shared-utils to packages/auth-fake/package.json and do not touch pnpm-lock.yaml."
  - "The two identities are APPENDED after integrated-owner. IDENTITIES[0] and DEFAULT_IDENTITY_ID stay team-owner."
  - "apps/api/scripts/seed/plan.ts stays pure: no I/O, no process.env, no clock, no import of @fxl-sales/auth-fake (not even a type). It learns which org is the leads edition only through the new optional input leadsEditionOrgIds."
  - "apps/api/scripts/seed-dev.ts keeps ONLY its three static runtime imports plus the type-only import; the fixture id comes from the existing dynamic `await import('@fxl-sales/auth-fake')`. Do not touch its guard steps (loadEnvFiles, assertLocalDatabase with namedEnvFile null, assertFakeOrgIds)."
  - "Tests reach @fxl-sales/auth-fake only through `await import(...)`, never a static import (auth-fake-isolation rule A)."
  - "Never edit apps/api/scripts/seed-dev.ts.bak2 (unrelated tracked file)."
  - "No em dash (U+2014) in any file; use '-'. Markdown: one sentence per line. The playbook is pt-BR."
  - "Run tests once (`vitest run`, `node --test`); never a watcher. Any dev server started for the browser check is stopped by its process-group id before the slice ends."
verifier_focus: "That the module is per-identity and only on the two leads identities (every other identity still emits modules []); that leads identities cannot switch into a full-edition org (their workspaces list only org_fake_leads); that the web cross-check passes the edition from the REAL profile into getVisibleWorkspaces rather than a hand-typed table; that the seed plan's leads org has no stage, no settings row and an UNBOUND vendedor so the first access exercises the real email self-claim; that other orgs' rows are byte-identical with and without the flag; that the playbook SQL supplies every NOT NULL column without a database default (subscriptions.id, subscription_items.id), reuses an existing active subscription the way the Hub's own grant logic does, is idempotent, and that its check query mirrors resolveModules exactly (status active|trialing, current_period_end, removed_at), including the fact that modules are emitted only when access is true."
---

# Slice 08 - Dev identity and Hub activation playbook

## Objective

Three deliverables.
First, the development roster gains a leads-edition gestor and vendedor on their own fixture org, emitting the edition module through the real Hub claim shape, so `make dev-fake` reaches the leads edition with no Hub.
Second, the local seed gives that fixture org exactly what a freshly activated Construbom looks like: no etapas, the system funções and one unbound vendedor pessoa.
Third, a pt-BR playbook tells the operator how to activate the edition for Construbom in the PRODUCTION Hub.

## Code facts (verified while planning)

- `packages/auth-fake/package.json` has exactly one dependency, `@fxl-business/fxl-contracts` pinned `0.1.0`, and is consumed from source (no build).
  `scripts/__tests__/auth-fake-isolation.test.mjs` does NOT scan `packages/auth-fake/src`, so an import there would not trip it, but it would add a workspace dependency, a lockfile change and a Dockerfile-deps closure change (`api-dockerfile-workspace-deps.test.mjs` follows workspace deps transitively).
  Decision: hardcode the string in auth-fake and pin equality in the web test, which already imports both worlds.
- `packages/auth-fake/src/index.ts` today: four orgs (`NORTE`, `SUL`, `SEM`, `INTEGRADO`), ten identities, a docblock F5 saying modules are empty for every identity, and `FakeIdentity.modules` documented as "Empty for every fixture today".
  `toHubClaims` already copies `identity.modules` into `entitlements.modules`, and `toHubAuthContext` projects the same object, so no claim code changes.
- `packages/auth-fake/src/__tests__/roster.test.ts` pins: `allFakeOrgIds()` length 4 and the exact set; every identity `modules` equal `[]` (test `carries Effective Access explicitly and never derives it from modules`); the painel-set set `{'tatico|operacional|cadastros|meus-dados', 'meus-dados', ''}`.
- `apps/web/src/dev/__tests__/dev-identity-roles.test.tsx` iterates every `hasAccess` identity of the REAL roster and asserts `Probe` renders `identity.expectedPaineis`, where `Probe` today calls `getVisibleWorkspaces(roles)` with no edition.
  Without this slice's change, `leads-owner` would render all four painéis and fail.
  Slice 05 adds `edition: SalesEdition` to the profile returned by `useAuthProfile()` (an alias of `useHubProfile`) and the trailing `edition` parameter to `getVisibleWorkspaces`.
- `apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts` mounts `appAuthMiddleware` on `/probe` and returns context values; the dev adapter ends in `applyHubAuthContext`, where slice 02 sets `c.set('salesEdition', resolveSalesEdition(auth.entitlements?.modules))`.
- `apps/web/src/dev/install-dev-identity.ts`, `dev-identity-switcher.ts` and `apps/api/src/auth/select.ts` consume `IDENTITIES` generically (structural types with `id`, `label`, `exercises`, `activeWorkspaceId`); they need no change.
  `apps/web/src/dev/__tests__/dev-identity-switcher.test.ts` uses its own literal list and needs no change.
  The `Makefile` lists no identity and needs no change.
- `apps/api/scripts/seed-dev.ts` maps `IDENTITIES` onto `SeedIdentity[]`, takes org ids from `allFakeOrgIds()`, runs `assertFakeOrgIds` (prefix `org_fake_`), builds `buildDevSeedPlan({ orgIds, identities, cutoff })`, then per org deletes every table in `SEED_DELETE_ORDER` and inserts `plan.rows` filtered by org, skipping empty arrays.
  It is therefore already idempotent for any org, including one with empty tables.
- `apps/api/scripts/seed/plan.ts` builds the SAME full catalog for every org in `buildOrgRows` (settings, 3 áreas, 4 funções, identity pessoas plus Marina/Caio/Rita, 3 clientes, 4 produtos, 4 etapas, propostas, ledger, 3 leads).
  `seededFuncaoSlugsFor` holds the admin-like rule inline (`owner` or `admin` workspace role, or productRoles `admin`).
- Etapas are never auto-seeded on a read: only the import routes call `ensureLeadStages`; an org with no `sales_ops_lead_stages` rows stays empty.
- `getSettings` returns `null` when the org has no settings row (a real freshly activated org has none), so the leads fixture org deliberately gets no settings row, to model Construbom exactly.
  Decision (PLAN-CHECK C12): NO default settings row is seeded, because every consumer already handles `null` and a real Construbom has none: `GET /settings` answers `{ settings: null }`, `/bootstrap` projects `settings: settings[0] ?? null`, the web type is `SalesOpsSettings | null`, `useSalesOpsBootstrap` keeps `data.settings ?? null`, and `SalesOpsApp` reads it through `activeSettings()` defaults or optional chaining.
  The leads edition never writes settings (`PUT /settings` is gated by `history`), never reads them on its three screens, and slice 05's shell test renders the leads edition with `settings: null`.
- The seller self-claim (`resolveCallerPersonId` in `apps/api/src/domains/sales-ops/leads/lead-service.ts`) binds an ACTIVE pessoa with `hub_account_id IS NULL` whose lowercased trimmed `contact_email` equals the caller's verified email, exactly one candidate.
  Seeding the vendedor UNBOUND makes the first `leads-seller` access exercise that real path, which is what Construbom's vendedores go through.
- Hub facts for the playbook (read-only from `16--INTERNAL--fxl-hub/packages/hub-db/src/schema.ts` and `repo.ts`):
  - `skus`: `id text PK` (no DB default; the admin API generates one when omitted), `product_id` NOT NULL FK `application.id`, `kind sku_kind` NOT NULL (`recurring_subscription | one_time | recurring_addon`), `name` NOT NULL, `price_brl integer` NOT NULL (cents, `nonnegative`), `interval billing_interval` (`month | year`, required for recurring kinds, null for `one_time`), `grants jsonb` default `{}`, `constraints jsonb` default `{}`, `active boolean` default true, `created_at` default now.
  - `subscriptions`: `id text PK` with an APP-side default only (`$defaultFn(createId)`), so raw SQL MUST supply it; `workspace_id` NOT NULL; `product_id` NOT NULL; `status subscription_status` NOT NULL (`active | past_due | cancelled | trialing`); `source text` default `'manual'`; `granted_by_account_id`, `grant_reason`, `access_grant_id`, `asaas_*`, `current_period_start`, `current_period_end`, `overdue_since`, `last_dunning_at` nullable; `created_at`, `updated_at` default now.
  - `subscription_items`: `id text PK` app-side default only (MUST be supplied); `subscription_id` NOT NULL; `sku_id` NOT NULL FK `skus.id`; `price_brl` NOT NULL; `grants jsonb` default `{}`; `activated_at` default now; `removed_at` nullable.
  - `access_grant`: `organization_id`, `application_id`, `source access_source` (`subscription | one_time | internal | admin_grant | trial`), `source_reference`, `starts_at` default now, `ends_at`, `revoked_at`.
  - `resolveModules`: distinct `grants.module` over items joined to subscriptions with `workspace_id`, `product_id`, `status IN ('active','trialing')`, `current_period_end IS NULL OR > now()`, `removed_at IS NULL OR > now()`.
    It does NOT read `skus.active`.
  - The authz projection emits `modules: access ? await resolveModules(...) : []`, so the module reaches the token ONLY when the org has live access.
  - The Hub's own grant path reuses an existing `active|trialing` subscription for `(workspace, product)` before creating one; the playbook SQL does the same.
  - Admin UI: `/admin/applications/:appId/modules` (tab "Módulos"), form "Novo SKU/módulo" with "Tipo" (`Módulos (add-on)` = `recurring_addon`), "Nome", "Preço (R$)", "Intervalo" (`Mensal`), "Módulo (entitlement)"; SKU toggle "Desativar" hides it from the storefront and rejects it at checkout without touching existing items.
    Org detail `/admin/orgs/:id` has "Conceder acesso" (AccessGrantModal: "Aplicativo", "Origem" with `Concessão administrativa`, "Término", "Motivo").
    Members are invited from the organization page ("Convidar membro", "Papel na organização", "Papéis do app").

## Step 1 - Red: roster oracle

Edit `packages/auth-fake/src/__tests__/roster.test.ts`.

1. Extend the import list with `FIXTURE_LEADS_EDITION_ORGANIZATION_ID` and `LEADS_EDITION_MODULE`.
2. In `branch coverage`, `covers every painel set the real visibility rule can produce`, add `'operacional|cadastros'` to the expected set and a one-line comment: `// operacional|cadastros is the leads-edition gestor (modules: ['sales.edition.leads']).`
3. Replace the test `carries Effective Access explicitly and never derives it from modules` with these two tests:

```ts
  it('carries Effective Access explicitly and never derives it from modules', () => {
    for (const identity of IDENTITIES) {
      expect(toHubClaims(identity).entitlements).toEqual({
        access: identity.hasAccess,
        modules: [...identity.modules],
      });
    }
    expect(IDENTITIES.some((identity) => identity.hasAccess && identity.modules.length === 0)).toBe(
      true,
    );
  });

  it('carries add-on modules only on the two leads-edition identities, and exactly the edition module', () => {
    expect(LEADS_EDITION_MODULE).toBe('sales.edition.leads');
    const withModules = IDENTITIES.filter((identity) => identity.modules.length > 0);
    expect(withModules.map((identity) => identity.id)).toEqual(['leads-owner', 'leads-seller']);
    for (const identity of withModules) {
      expect(identity.modules).toEqual([LEADS_EDITION_MODULE]);
    }
  });
```

4. In `allFakeOrgIds`, change `lists every org id the roster references, deduplicated` to expect length `5` and the set `['org_fake_norte', 'org_fake_sul', 'org_fake_sem_acesso', 'org_fake_integrado', 'org_fake_leads']`.
5. Append a new `describe('the leads edition fixture', ...)` at the end of the file:

```ts
describe('the leads edition fixture', () => {
  it('names the fixture org org_fake_leads and lists it among the seeded orgs', () => {
    expect(FIXTURE_LEADS_EDITION_ORGANIZATION_ID).toBe('org_fake_leads');
    expect(allFakeOrgIds()).toContain(FIXTURE_LEADS_EDITION_ORGANIZATION_ID);
  });

  it('appends the two identities after the existing roster and keeps the default identity', () => {
    expect(IDENTITIES.map((identity) => identity.id).slice(-2)).toEqual(['leads-owner', 'leads-seller']);
    expect(IDENTITIES.length).toBe(12);
    expect(DEFAULT_IDENTITY_ID).toBe('team-owner');
  });

  it('gives the gestor the Hub owner claim shape with the edition module', () => {
    const identity = findIdentity('leads-owner')!;
    const claims = toHubClaims(identity, { nowSeconds: FIXED_NOW }) as {
      workspaceId: string;
      workspaceName: string;
      entitlements: unknown;
      roles: unknown;
    };
    expect(claims.workspaceId).toBe(FIXTURE_LEADS_EDITION_ORGANIZATION_ID);
    expect(claims.workspaceName).toBe('Leads Simples (fake)');
    expect(claims.entitlements).toEqual({ access: true, modules: ['sales.edition.leads'] });
    expect(claims.roles).toEqual({ workspace: 'owner' });
    expect(identity.expectedRoles).toEqual(['admin', 'seller', 'finder']);
    expect(identity.expectedPaineis).toEqual(['operacional', 'cadastros']);
  });

  it('gives the vendedor the Hub member plus seller Seat claim shape with the edition module', () => {
    const identity = findIdentity('leads-seller')!;
    const claims = toHubClaims(identity, { nowSeconds: FIXED_NOW }) as {
      workspaceId: string;
      entitlements: unknown;
      roles: unknown;
      email: string;
    };
    expect(claims.workspaceId).toBe(FIXTURE_LEADS_EDITION_ORGANIZATION_ID);
    expect(claims.entitlements).toEqual({ access: true, modules: ['sales.edition.leads'] });
    expect(claims.roles).toEqual({ workspace: 'member', productRoles: ['seller'] });
    expect(claims.email).toBe(identity.profile.email);
    expect(identity.expectedRoles).toEqual(['seller']);
    expect(identity.expectedPaineis).toEqual(['meus-dados']);
  });

  it('keeps every module-bearing identity inside the fixture org, so the module never rides into a full-edition org', () => {
    for (const identity of IDENTITIES.filter((entry) => entry.modules.length > 0)) {
      expect(identity.workspaces.map((workspace) => workspace.workspaceId)).toEqual([
        FIXTURE_LEADS_EDITION_ORGANIZATION_ID,
      ]);
      const claims = toHubClaims(identity, { organizationId: 'org_fake_norte' }) as {
        workspaceId: string;
      };
      expect(claims.workspaceId).toBe(FIXTURE_LEADS_EDITION_ORGANIZATION_ID);
    }
  });

  it('projects the same modules into the API auth context', () => {
    for (const id of ['leads-owner', 'leads-seller']) {
      const identity = findIdentity(id)!;
      expect(toHubAuthContext(identity, { nowSeconds: FIXED_NOW }).entitlements).toEqual({
        access: true,
        modules: ['sales.edition.leads'],
      });
    }
  });
});
```

Run `pnpm --filter @fxl-sales/auth-fake test` and confirm it FAILS (missing exports and identities).

## Step 2 - Green: the roster

Edit `packages/auth-fake/src/index.ts`.

1. Docblock F5: replace its paragraph with:

```ts
 * F5 - `entitlements.modules` is empty for every identity EXCEPT the two leads-edition fixtures
 * (`leads-owner`, `leads-seller`), which carry exactly `LEADS_EDITION_MODULE`. Modules carry
 * ADD-ON products only and must never be read for baseline access, so every other fixture
 * still proves Effective Access is readable with an empty `modules` array. The module string
 * is hardcoded here on purpose (this package depends on nothing in the workspace); its
 * equality with `SALES_EDITION_LEADS_MODULE` in `@fxl-sales/shared-utils/sales-edition` is
 * pinned by `apps/web/src/dev/__tests__/dev-identity-roles.test.tsx`.
```

2. `FakeIdentity.modules` comment becomes: `/** ADD-ON module ids only. Empty except on the leads-edition fixtures - see the docblock F5. */`
3. `FakeIdentity.expectedPaineis` comment becomes: `/** What \`getVisibleWorkspaces(expectedRoles, edition)\` MUST return, in that exact order, where the edition is the one \`modules\` resolves to ('leads' only for the edition module, otherwise 'full'). */`
4. After `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL`, add:

```ts
/** The Sales leads-edition module id, as the Hub puts it in `entitlements.modules`. Hardcoded:
 *  this package depends on nothing in the workspace. Pinned equal to the shared-utils constant
 *  by apps/web/src/dev/__tests__/dev-identity-roles.test.tsx. */
export const LEADS_EDITION_MODULE = 'sales.edition.leads';

/** The leads-edition fixture Organization. Seeded with no etapas by apps/api/scripts/seed-dev.ts. */
export const FIXTURE_LEADS_EDITION_ORGANIZATION_ID = 'org_fake_leads';
```

5. Change the comment `// Four Organizations, and exactly four.` to `// Five Organizations, and exactly five.` and add after `INTEGRADO`:

```ts
// The leads-edition fixture: only the two module-bearing identities belong to it.
const LEADS = workspace(FIXTURE_LEADS_EDITION_ORGANIZATION_ID, 'Leads Simples (fake)'); // entitled
```

6. Change `// Ten identities, in this exact order.` to `// Twelve identities, in this exact order.` and append after the `integrated-owner` entry, before the closing `];`:

```ts
  // 11. leads-owner - the gestor of the leads edition: workspace owner (so getRolesFromHubClaims
  //     yields the full-access role set) whose token carries the edition module, so the
  //     navigation narrows to operacional (Prospeccao) and cadastros (Vendedores, Etapas).
  {
    id: 'leads-owner',
    label: 'Lara (gestora, edicao leads)',
    exercises: 'dona da organizacao na edicao leads: Prospeccao, Vendedores e Etapas do funil, sem propostas',
    accountId: 'user_fake_lara',
    activeWorkspaceId: LEADS.workspaceId,
    hasAccess: true,
    modules: [LEADS_EDITION_MODULE],
    workspaceRole: 'owner',
    profile: { name: 'Lara Gestora', email: 'lara@fake.local' },
    workspaces: [LEADS],
    expectedRoles: ['admin', 'seller', 'finder'],
    expectedPaineis: ['operacional', 'cadastros'],
  },
  // 12. leads-seller - a vendedor of the leads edition: workspace member with the seller Seat.
  //     The seed gives org_fake_leads one UNBOUND vendedor pessoa with this email, so the first
  //     access exercises the real email self-claim, exactly like a Construbom vendedor.
  {
    id: 'leads-seller',
    label: 'Leo (vendedor, edicao leads)',
    exercises: 'somente Seat vendedor na edicao leads: ve apenas Minha prospeccao',
    accountId: 'user_fake_leo',
    activeWorkspaceId: LEADS.workspaceId,
    hasAccess: true,
    modules: [LEADS_EDITION_MODULE],
    workspaceRole: 'member',
    productRoles: ['seller'],
    profile: { name: 'Leo Vendedor', email: 'leo@fake.local' },
    workspaces: [asRole(LEADS, 'member')],
    expectedRoles: ['seller'],
    expectedPaineis: ['meus-dados'],
  },
```

Labels, org names and `exercises` stay ASCII, like every existing entry.
Run `pnpm --filter @fxl-sales/auth-fake test` and `pnpm --filter @fxl-sales/auth-fake type-check`; both green.

## Step 3 - Web cross-check (real translation with the edition)

Edit `apps/web/src/dev/__tests__/dev-identity-roles.test.tsx`.

1. Add the static import (shared-utils is a normal dependency, not the fake package): `import { resolveSalesEdition, SALES_EDITION_LEADS_MODULE } from '@fxl-sales/shared-utils/sales-edition';`
2. `Probe` already passes the REAL profile edition (slice 05 step 7d changed it to `getVisibleWorkspaces(roles, edition)`); confirm it and do not edit it again.

3. In the `it.each(REACHABLE_IDENTITIES)` body, after the `getRolesFromHubClaims` assertion, add:

```ts
      const claimedModules = (claims as { entitlements?: { modules?: unknown[] } }).entitlements?.modules;
      expect(resolveSalesEdition(claimedModules)).toBe(
        identity.modules.includes(SALES_EDITION_LEADS_MODULE) ? 'leads' : 'full',
      );
```

   Keep the test title; extend the docblock above `REACHABLE_IDENTITIES` with one sentence: `The edition the Probe passes comes from the REAL profile (slice 05), so leads-owner proves the leads-edition gestor narrowing end to end.`
4. Append inside the `describe('dev identity roles', ...)` block:

```ts
  it('pins the roster module string to the shared edition contract', () => {
    expect(fakeRoster.LEADS_EDITION_MODULE).toBe(SALES_EDITION_LEADS_MODULE);
  });

  it('adopts the leads-edition gestor and narrows the painéis to Prospecção and Cadastros', async () => {
    vi.stubEnv('VITE_AUTH_FAKE', '1');
    localStorage.setItem(STORAGE_KEY, 'leads-owner');

    const adopted = await installDevIdentityIfEnabled();
    expect(adopted).toBe('leads-owner');

    const { host, root } = renderProbe();
    await flush();

    expect(workspacesText(host)).toBe('operacional,cadastros');

    teardown(host, root);
  });
```

5. Leave `no roster identity reaches the team painéis without meus-dados` unchanged (it calls `getVisibleWorkspaces(roles)` in the full edition and stays true).

Run `pnpm run build:packages` then `pnpm --filter @fxl-sales/web exec vitest run src/dev`; green.

## Step 4 - API dev adapter oracle

Edit `apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts`.

1. The `/probe` handler JSON already returns `salesEdition` (slice 02 step 5d added `salesEdition: c.get('salesEdition'),`); do not add a second key (a duplicate property is a TypeScript error).
2. Append inside the describe (slice 02's roster loop test already covers every identity generically; these two pin the leads identities by name):

```ts
  it('resolves the leads edition from a leads identity token and full from every other', async () => {
    const expectations: Array<[string, string]> = [
      ['leads-owner', 'leads'],
      ['leads-seller', 'leads'],
      ['team-owner', 'full'],
      ['seller', 'full'],
    ];
    for (const [identityId, edition] of expectations) {
      const res = await app.request('http://localhost/probe', {
        headers: { 'x-fake-identity': identityId },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.salesEdition).toBe(edition);
    }
  });

  it('serves the leads identities on the leads fixture org', async () => {
    const fake = await import('@fxl-sales/auth-fake');
    for (const identityId of ['leads-owner', 'leads-seller']) {
      const res = await app.request('http://localhost/probe', {
        headers: { 'x-fake-identity': identityId },
      });
      const body = await res.json();
      expect(body.orgId).toBe(fake.FIXTURE_LEADS_EDITION_ORGANIZATION_ID);
    }
  });
```

Run `pnpm --filter @fxl-sales/api exec vitest run src/auth/__tests__/dev-identity-no-hub.test.ts`; green (requires slice 02).

## Step 5 - Red: seed plan oracle

Append to `apps/api/scripts/__tests__/seed-plan.test.ts`:

```ts
describe('buildDevSeedPlan - the leads edition fixture org', () => {
  // Literal on purpose: this file never imports the roster. The id equals the package's
  // FIXTURE_LEADS_EDITION_ORGANIZATION_ID, which the auth-fake roster test pins.
  const ORG_LEADS = 'org_fake_leads';
  const LEADS_IDENTITIES: SeedIdentity[] = [
    ...IDENTITIES,
    {
      accountId: 'acct_leads_owner',
      workspaceIds: [ORG_LEADS],
      workspaceRole: 'owner',
      productRoles: [],
      name: 'Leads Owner Test',
      email: 'leads-owner@test.local',
    },
    {
      accountId: 'acct_leads_seller',
      workspaceIds: [ORG_LEADS],
      workspaceRole: 'member',
      productRoles: ['seller'],
      name: 'Leads Seller Test',
      email: 'Leads-Seller@test.local',
    },
  ];
  const LEADS_INPUT = {
    orgIds: [ORG_ALPHA, ORG_LEADS],
    identities: LEADS_IDENTITIES,
    cutoff: CUTOFF,
    leadsEditionOrgIds: [ORG_LEADS],
  };
  const plan = buildDevSeedPlan(LEADS_INPUT);
  const inLeads = <T extends { orgId: string }>(rows: readonly T[]): T[] =>
    rows.filter((row) => row.orgId === ORG_LEADS);

  it('seeds no etapa, no lead, no proposta, no ledger, no catalog and no settings row', () => {
    expect(inLeads(plan.rows.salesOpsLeadStages)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsLeads)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsLeadProducts)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsSales)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsSaleItems)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsSaleProfessionals)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsReceivables)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsPayables)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsSettlements)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsAreas)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsClients)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsProducts)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsProductFuncaoCosts)).toEqual([]);
    expect(inLeads(plan.rows.salesOpsSettings)).toEqual([]);
  });

  it('seeds exactly the two system funcoes', () => {
    const funcoes = inLeads(plan.rows.salesOpsFuncoes);
    expect(funcoes.map((row) => row.slug).sort()).toEqual(['finder', 'vendedor']);
    for (const row of funcoes) {
      expect(row.isSystem).toBe(true);
      expect(row.status).toBe('active');
    }
  });

  it('seeds exactly one active, UNBOUND vendedor pessoa carrying the seller identity email', () => {
    const people = inLeads(plan.rows.salesOpsPeople);
    expect(people.length).toBe(1);
    const person = people[0]!;
    expect(person.contactEmail).toBe('Leads-Seller@test.local');
    expect(person.displayName).toBe('Leads Seller Test');
    expect(person.hubAccountId).toBeNull();
    expect(person.status).toBe('active');
    expect(person.archivedAt).toBeNull();
    expect([person.isSeller, person.isFinder, person.isCollaborator]).toEqual([true, false, false]);

    const vendedor = inLeads(plan.rows.salesOpsFuncoes).find((row) => row.slug === 'vendedor')!;
    const links = inLeads(plan.rows.salesOpsPersonFuncoes);
    expect(links.map((row) => [row.personId, row.funcaoId])).toEqual([[person.id, vendedor.id]]);
  });

  it('leaves every other org byte-identical to a plan built without the flag', () => {
    const baseline = buildDevSeedPlan({ orgIds: [ORG_ALPHA], identities: IDENTITIES, cutoff: CUTOFF });
    for (const [table, rows] of Object.entries(plan.rows)) {
      const alphaRows = (rows as readonly { orgId: string }[]).filter((row) => row.orgId === ORG_ALPHA);
      const baselineRows = (
        baseline.rows[table as keyof DevSeedPlan['rows']] as readonly { orgId: string }[]
      ).filter((row) => row.orgId === ORG_ALPHA);
      expect(JSON.stringify(alphaRows), table).toBe(JSON.stringify(baselineRows));
    }
  });

  it('seeds the full catalog for the same org when it is not flagged, so the flag alone drives the shape', () => {
    const unflagged = buildDevSeedPlan({ orgIds: [ORG_LEADS], identities: LEADS_IDENTITIES, cutoff: CUTOFF });
    expect(inLeads(unflagged.rows.salesOpsLeadStages).length).toBeGreaterThan(0);
  });

  it('is deterministic and never repeats an id', () => {
    expect(JSON.stringify(buildDevSeedPlan(LEADS_INPUT))).toBe(JSON.stringify(plan));
    const ids = collectIds(plan);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('refuses a leads edition org that is not one of the seeded orgs', () => {
    expect(() =>
      buildDevSeedPlan({ ...LEADS_INPUT, orgIds: [ORG_ALPHA], leadsEditionOrgIds: [ORG_LEADS] }),
    ).toThrow(/org_fake_leads/);
  });
});
```

Run `pnpm --filter @fxl-sales/api exec vitest run scripts/__tests__/seed-plan.test.ts`; the new describe FAILS.

## Step 6 - Green: seed plan

Edit `apps/api/scripts/seed/plan.ts`.

1. Extract the admin-like rule without changing behaviour:

```ts
/** getRolesFromHubClaims' full-access branches: workspace owner/admin, or the admin Seat. */
function isAdminLikeIdentity(identity: SeedIdentity): boolean {
  return (
    identity.workspaceRole === 'owner' ||
    identity.workspaceRole === 'admin' ||
    identity.productRoles.includes('admin')
  );
}
```

   and make `seededFuncaoSlugsFor` start with `if (isAdminLikeIdentity(identity)) return ['vendedor', 'finder'];` (remove the inline `isAdminLike` const).
2. Change `OrgRows.settings` to `settings: SettingsRow | null;`.
3. Add, after `buildOrgRows`:

```ts
// ─────────────────────────────────────────────────────────────────────────────
// The LEADS-edition org shape. Models a freshly activated leads-edition org
// (Construbom): no settings row, no área, cliente, produto, etapa, lead or
// proposta; only the two system funcoes, and one pessoa per non-admin seller
// identity of the org carrying exactly the vendedor funcao. The pessoa is
// UNBOUND (hubAccountId null) on purpose, so the identity's first access goes
// through the real email self-claim in lead-service.ts.
// ─────────────────────────────────────────────────────────────────────────────
function buildLeadsEditionOrgRows(
  orgId: string,
  identities: readonly SeedIdentity[],
  cutoff: SeedCutoff,
): OrgRows {
  const nowIso = isoDateTime(cutoff.iso);

  const systemDefs = FUNCAO_DEFS.filter((def) => def.isSystem);
  const funcoes: FuncaoRow[] = systemDefs.map((def) => ({
    id: deterministicUuid(`${orgId}:funcao:${def.slug}`),
    orgId,
    name: def.name,
    slug: def.slug,
    isSystem: true,
    status: 'active',
    archivedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const vendedorId = funcoes.find((row) => row.slug === 'vendedor')!.id;

  const sellers = identities.filter(
    (identity) =>
      identity.workspaceIds.includes(orgId) &&
      !isAdminLikeIdentity(identity) &&
      identity.productRoles.includes('seller'),
  );
  const mirrors = booleanMirrorsFor(['vendedor']);

  const people: PersonRow[] = sellers.map((identity) => ({
    id: deterministicUuid(`${orgId}:person:account:${identity.accountId}`),
    orgId,
    displayName: identity.name,
    contactEmail: identity.email,
    hubAccountId: null,
    status: 'active',
    archivedAt: null,
    isSeller: mirrors.isSeller,
    isFinder: mirrors.isFinder,
    isCollaborator: mirrors.isCollaborator,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  const personFuncoes: PersonFuncaoRow[] = sellers.map((identity, index) => ({
    id: deterministicUuid(`${orgId}:person-funcao:${identity.accountId}:vendedor`),
    orgId,
    personId: people[index]!.id,
    funcaoId: vendedorId,
    createdAt: nowIso,
  }));

  return {
    settings: null,
    areas: [],
    funcoes,
    people,
    personFuncoes,
    clients: [],
    products: [],
    productFuncaoCosts: [],
    leadStages: [],
    sales: [],
    saleItems: [],
    saleProfessionals: [],
    receivables: [],
    payables: [],
    leads: [],
    leadProducts: [],
  };
}
```

   If `FUNCAO_DEFS` typing makes `isSystem: true` vs `def.isSystem` matter, keep `isSystem: true` (the filter guarantees it).
4. Change `buildDevSeedPlan`:

```ts
export function buildDevSeedPlan(input: {
  orgIds: string[];
  identities: SeedIdentity[];
  cutoff: SeedCutoff;
  /** Orgs seeded in the leads-edition shape (buildLeadsEditionOrgRows). Each MUST be in orgIds. */
  leadsEditionOrgIds?: readonly string[];
}): DevSeedPlan {
  const leadsEditionOrgIds = new Set(input.leadsEditionOrgIds ?? []);
  for (const orgId of leadsEditionOrgIds) {
    if (!input.orgIds.includes(orgId)) {
      throw new Error(`[dev-seed] leads edition org "${orgId}" is not one of the seeded org ids.`);
    }
  }
  // ... arrays unchanged ...
  for (const orgId of input.orgIds) {
    const org = leadsEditionOrgIds.has(orgId)
      ? buildLeadsEditionOrgRows(orgId, input.identities, input.cutoff)
      : buildOrgRows(orgId, input.identities, input.cutoff);
    if (org.settings) settings.push(org.settings);
    // ... every other push unchanged ...
  }
  // ... rest unchanged ...
}
```

5. Update the module docblock's last paragraph with one sentence: `An org listed in \`leadsEditionOrgIds\` gets the leads-edition shape instead of the full catalog.`

Run the seed-plan test again: green, and every pre-existing seed-plan test still green.

## Step 7 - seed-dev.ts wiring

Edit `apps/api/scripts/seed-dev.ts`, Step 4 and the plan call only:

```ts
  const { allFakeOrgIds, IDENTITIES, FIXTURE_LEADS_EDITION_ORGANIZATION_ID } = await import(
    '@fxl-sales/auth-fake'
  );
```

```ts
  const plan: DevSeedPlan = buildDevSeedPlan({
    orgIds,
    identities,
    cutoff,
    // The leads-edition fixture org gets zero etapas and one unbound vendedor.
    leadsEditionOrgIds: [FIXTURE_LEADS_EDITION_ORGANIZATION_ID],
  });
```

Nothing else in the file changes; the delete and insert loops already handle empty tables and the missing settings row.

## Step 8 - Docs

1. `CLAUDE.md` is NOT edited in this slice: slice 07 (last in serial order) writes the dev-identity bullet together with the rest of the feature's rule lines (PLAN-CHECK C10).

2. `nexo/knowledge/reference/development-identity-mode.md`, append a section:

```markdown
## Leads edition fixture (v4.3.0)

- The roster carries two leads-edition identities, `leads-owner` (Hub workspace `owner`) and `leads-seller` (workspace `member` with the `seller` Seat), both only members of `org_fake_leads`, named `Leads Simples (fake)`.
- They are the only identities whose token carries `entitlements.modules`, exactly `['sales.edition.leads']`, so the edition travels the REAL path: `applyHubAuthContext` resolves `salesEdition` on the API and `profileFromToken` resolves `profile.edition` on the web.
- The module string is hardcoded in `packages/auth-fake` as `LEADS_EDITION_MODULE` because the package depends on nothing in the workspace; `apps/web/src/dev/__tests__/dev-identity-roles.test.tsx` pins it equal to `SALES_EDITION_LEADS_MODULE`.
- Their `expectedPaineis` are what `getVisibleWorkspaces(roles, edition)` returns: `operacional,cadastros` for the gestor and `meus-dados` for the vendedor.
- Both identities belong only to the fixture org, so switching Organization can never carry the module into a full-edition org.
- `buildDevSeedPlan` takes `leadsEditionOrgIds`; `seed-dev.ts` passes the fixture org, which then gets no settings row, no etapa, no catalog and no proposta, only the two system funcoes and one active vendedor pessoa with `contact_email` equal to `leads-seller`'s email and `hub_account_id` NULL.
- The pessoa is unbound on purpose: the first `leads-seller` request goes through the real email self-claim (`resolveCallerPersonId`), the same path a Construbom vendedor takes. Re-running the seed resets the claim.
- The production activation of the edition is documented in `nexo/playbooks/ativar-edicao-leads.md`.
```

## Step 9 - Playbook

Create `nexo/playbooks/ativar-edicao-leads.md` with EXACTLY this content (placeholders stay as written):

````markdown
# Ativar a edição Leads para a Construbom (Hub de produção)

Este playbook liga a edição Leads do FXL Sales para UMA organização, a Construbom, no Hub de PRODUÇÃO.
O Sales só LÊ o módulo `sales.edition.leads` em `entitlements.modules` do token; toda a ativação acontece no Hub.
Nenhuma mudança de código, de banco do Sales ou de variável de ambiente é necessária.
A FXL e qualquer outra organização sem o módulo continuam exatamente como hoje (edição completa).

## O que muda para a Construbom

- O gestor (dono ou admin da organização no Hub) vê apenas Operacional > Prospecção, Cadastros > Vendedores e Cadastros > Etapas do funil.
- O vendedor (Seat `seller` no FXL Sales) vê apenas Meus dados > Minha prospecção.
- Não existem propostas, comissões, catálogo, importação nem etapas pré-definidas: o quadro começa vazio e o gestor cria cada coluna.
- O lead tem só Nome, Data de aniversário, Número, Email, Descrição e Vendedor.

## Pré-requisitos

- Conta de super admin no Hub de produção.
- Acesso SQL (psql) ao banco do Hub de produção, com permissão de escrita em `subscriptions` e `subscription_items`.
- O deploy do Sales com a edição Leads (v4.3.0, com a migração `0027_lead_contact_fields`) já está em produção.
- O e-mail de login do gestor da Construbom e de cada vendedor.

## Passo 0 - Descobrir os ids

Rode no banco do Hub e anote os valores.

```sql
-- Organização da Construbom (o id é o workspace_id; no Sales ele é o org_id).
SELECT id, name FROM workspaces WHERE name ILIKE '%construbom%';

-- Sua conta de operador, para registrar quem concedeu.
SELECT id, email FROM accounts WHERE email = 'seu-email@fxl.com.br';
```

Se a primeira consulta devolver mais de uma linha, confirme a organização certa antes de seguir.

## Passo 1 - Criar o SKU do módulo (Admin UI)

1. Abra `/admin/applications/app.fxl-sales/modules` (Admin > Aplicativos > FXL Sales > aba Módulos).
2. Clique em "Adicionar SKU/módulo".
3. Preencha "Tipo" = `Módulos (add-on)`.
4. Preencha "Nome" = `Edição Leads`.
5. Preencha "Preço (R$)" = `0,00`.
6. Preencha "Intervalo" = `Mensal`.
7. Preencha "Módulo (entitlement)" = `sales.edition.leads` (exatamente assim, minúsculo, sem espaços).
8. Clique em "Criar".
9. Na linha do SKU criado, clique em "Desativar".

Desativar não remove o módulo de quem já o tem: o Hub calcula os módulos a partir de `subscription_items` e nunca lê `skus.active`.
Desativar só esconde o SKU do marketplace e do checkout, para que nenhuma outra organização compre a edição Leads por conta própria a R$ 0.

Confira que existe exatamente um SKU com esse módulo:

```sql
SELECT id, kind, name, price_brl, interval, grants, active
FROM skus
WHERE product_id = 'app.fxl-sales' AND grants->>'module' = 'sales.edition.leads';
```

O resultado esperado é UMA linha com `kind = recurring_addon`, `price_brl = 0`, `interval = month`, `grants = {"module": "sales.edition.leads"}` e `active = false`.
Se houver mais de uma linha, desative ou exclua as sobras pela Admin UI antes de seguir; o SQL do passo 3 recusa continuar com duas.

## Passo 2 - Garantir o acesso da organização (Admin UI)

O Hub só coloca módulos no token quando a organização TEM acesso ao aplicativo (`entitlements.access = true`).
Sem acesso, `entitlements.modules` sai vazio mesmo com o item ativo.

1. Abra `/admin/orgs/<workspace_id>` (Admin > Organizações > Construbom).
2. Na seção "Acesso", veja se o FXL Sales aparece "Com acesso" com uma concessão "Ativa".
3. Se não aparecer, clique em "Conceder acesso".
4. "Aplicativo" = FXL Sales.
5. "Origem" = `Concessão administrativa`.
6. "Término" em branco (nunca expira).
7. "Motivo" = `Construbom - edição Leads do FXL Sales`.
8. Clique em "Conceder acesso".

Confira por SQL:

```sql
SELECT id, source, starts_at, ends_at, revoked_at
FROM access_grant
WHERE organization_id = '<workspace_id>'
  AND application_id = 'app.fxl-sales'
  AND revoked_at IS NULL
  AND starts_at <= now()
  AND (ends_at IS NULL OR ends_at > now());
```

O resultado esperado é pelo menos uma linha.

## Passo 3 - Ligar o módulo (SQL)

A Admin UI ainda não tem a ação "conceder módulo" (está no roadmap do Hub), por isso o item é inserido por SQL.
O script reaproveita uma assinatura `active` ou `trialing` que a Construbom já tenha no FXL Sales, exatamente como o Hub faz nas próprias concessões, e só cria uma assinatura `manual` se não houver nenhuma.
O script é idempotente: rodar duas vezes não cria um segundo item.
`subscriptions.id` e `subscription_items.id` não têm valor padrão no banco (o Hub os gera na aplicação), então o script os gera com `gen_random_uuid()`.

Rode no psql, trocando os três valores do `\set`.

```sql
\set workspace_id 'COLE_AQUI_O_WORKSPACE_ID'
\set operator_account_id 'COLE_AQUI_O_ID_DA_SUA_CONTA'
\set grant_reason 'Construbom - edição Leads do FXL Sales (R$ 0)'

BEGIN;

-- Trava: exatamente um SKU com o módulo.
SELECT count(*) AS skus_com_o_modulo
FROM skus
WHERE product_id = 'app.fxl-sales' AND grants->>'module' = 'sales.edition.leads';

WITH sku AS (
  SELECT id, grants
  FROM skus
  WHERE product_id = 'app.fxl-sales' AND grants->>'module' = 'sales.edition.leads'
),
sku_unico AS (
  SELECT * FROM sku WHERE (SELECT count(*) FROM sku) = 1
),
existente AS (
  SELECT id
  FROM subscriptions
  WHERE workspace_id = :'workspace_id'
    AND product_id = 'app.fxl-sales'
    AND status IN ('active', 'trialing')
    AND (current_period_end IS NULL OR current_period_end > now())
  ORDER BY created_at
  LIMIT 1
),
criada AS (
  INSERT INTO subscriptions (
    id, workspace_id, product_id, status, source,
    granted_by_account_id, grant_reason, current_period_end
  )
  SELECT
    gen_random_uuid()::text, :'workspace_id', 'app.fxl-sales', 'active', 'manual',
    :'operator_account_id', :'grant_reason', NULL
  WHERE NOT EXISTS (SELECT 1 FROM existente)
    AND EXISTS (SELECT 1 FROM sku_unico)
  RETURNING id
),
alvo AS (
  SELECT id FROM existente
  UNION ALL
  SELECT id FROM criada
)
INSERT INTO subscription_items (id, subscription_id, sku_id, price_brl, grants, removed_at)
SELECT gen_random_uuid()::text, alvo.id, sku_unico.id, 0, sku_unico.grants, NULL
FROM alvo CROSS JOIN sku_unico
WHERE NOT EXISTS (
  SELECT 1
  FROM subscription_items si
  JOIN subscriptions s ON s.id = si.subscription_id
  WHERE s.workspace_id = :'workspace_id'
    AND s.product_id = 'app.fxl-sales'
    AND s.status IN ('active', 'trialing')
    AND (s.current_period_end IS NULL OR s.current_period_end > now())
    AND (si.removed_at IS NULL OR si.removed_at > now())
    AND si.grants->>'module' = 'sales.edition.leads'
)
RETURNING id, subscription_id, sku_id, price_brl, grants, activated_at;

-- Conferência: a MESMA consulta que o Hub usa para montar entitlements.modules (resolveModules).
SELECT DISTINCT si.grants->>'module' AS modulo
FROM subscription_items si
JOIN subscriptions s ON s.id = si.subscription_id
WHERE s.workspace_id = :'workspace_id'
  AND s.product_id = 'app.fxl-sales'
  AND s.status IN ('active', 'trialing')
  AND (s.current_period_end IS NULL OR s.current_period_end > now())
  AND (si.removed_at IS NULL OR si.removed_at > now());
```

Leia os resultados antes de decidir.

- `skus_com_o_modulo` precisa ser `1`.
- O `INSERT ... RETURNING` devolve uma linha na primeira execução e zero linhas se o módulo já estava ligado.
- A conferência precisa listar `sales.edition.leads` (e só os módulos que a Construbom já tinha antes).

Se tudo bate, rode `COMMIT;`.
Se qualquer coisa estiver diferente, rode `ROLLBACK;` e nada foi gravado.

Se você usa um cliente SQL gráfico em vez do psql, troque cada `:'workspace_id'`, `:'operator_account_id'` e `:'grant_reason'` pelo valor entre aspas simples e remova as linhas `\set`.

Anote o `id` do item devolvido pelo `RETURNING`; ele é o que o rollback desliga.

## Passo 4 - Verificar

1. Peça ao gestor da Construbom para clicar em "Sair" no FXL Sales e entrar de novo (o token atual não tem o módulo; o próximo token tem).
2. Opcional: no navegador do gestor, decodifique o token de acesso e confira `entitlements.access = true` e `entitlements.modules` contendo `sales.edition.leads`.
3. O gestor deve ver apenas Prospecção (Operacional), Vendedores e Etapas do funil (Cadastros).
4. Qualquer outra URL do Sales (por exemplo `/operacional/vendas` ou `/tatico/dashboard`) deve voltar para a tela padrão do papel.
5. O quadro de Prospecção deve abrir vazio, pedindo para criar etapas.
6. Entre com uma conta da FXL e confirme que nada mudou (Tático, propostas e comissões continuam lá).

## Passo 5 - Rollback

Desligar a edição Leads devolve a Construbom à edição completa no próximo token.
Os dados (leads, pessoas, etapas) continuam válidos nas duas edições.

```sql
BEGIN;

UPDATE subscription_items si
SET removed_at = now()
FROM subscriptions s
WHERE s.id = si.subscription_id
  AND s.workspace_id = 'COLE_AQUI_O_WORKSPACE_ID'
  AND s.product_id = 'app.fxl-sales'
  AND si.grants->>'module' = 'sales.edition.leads'
  AND si.removed_at IS NULL
RETURNING si.id, si.removed_at;

COMMIT;
```

Depois do rollback, peça ao gestor para sair e entrar de novo.
Se a assinatura tinha sido criada pelo passo 3 (`source = 'manual'`, sem outros itens ativos), ela pode ficar como está: sem itens ativos, ela não concede nenhum módulo.

## Passo 6 - Lado do Sales (onboarding da Construbom)

1. O gestor entra no FXL Sales e abre Cadastros > Etapas do funil.
2. Ele cria as colunas do quadro, na ordem desejada (por exemplo `Novo contato`, `Em conversa`, `Fechado`).
3. Ele abre Cadastros > Vendedores e cadastra cada vendedor com o MESMO e-mail que o vendedor usa para entrar no Hub.
4. A FXL adiciona cada vendedor como membro da organização Construbom no Hub: na página da organização, "Convidar membro", "Papel na organização" = membro, "Papéis do app" = `seller` no FXL Sales.
5. No primeiro acesso, o Sales liga o vendedor ao cadastro pelo e-mail verificado do token; e-mails diferentes, ou dois cadastros com o mesmo e-mail, deixam o vendedor sem quadro.
6. O vendedor entra e vê Meus dados > Minha prospecção, apenas com os próprios leads.

## Observações

- A edição é derivada do token a cada requisição e nunca é gravada no banco do Sales.
- Se o Hub parar de mandar o módulo (item removido, assinatura cancelada, acesso revogado), a Construbom volta a ver a edição completa; essa direção foi aceita no planejamento.
- Uma ação auditada de "conceder módulo" na Admin UI do Hub está no roadmap do Hub e substitui o passo 3 quando existir.
````

## Step 10 - Verify locally (run-once)

```bash
cd /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales
pnpm run build:packages
pnpm --filter @fxl-sales/auth-fake test
pnpm --filter @fxl-sales/auth-fake type-check
pnpm --filter @fxl-sales/api exec vitest run scripts/__tests__/seed-plan.test.ts src/auth/__tests__/dev-identity-no-hub.test.ts
pnpm --filter @fxl-sales/web exec vitest run src/dev
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/web lint
node --test scripts/__tests__/auth-fake-isolation.test.mjs scripts/__tests__/local-database-guard.test.mjs scripts/__tests__/dev-identity-docs-reconciliation.test.mjs scripts/__tests__/fxl-contracts-pin.test.mjs scripts/__tests__/api-dockerfile-workspace-deps.test.mjs
node scripts/assert-web-bundle-clean.mjs
grep -rn "$(printf '\342\200\224')" packages/auth-fake/src apps/api/scripts apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts apps/web/src/dev/__tests__/dev-identity-roles.test.tsx nexo/playbooks/ativar-edicao-leads.md nexo/knowledge/reference/development-identity-mode.md CLAUDE.md && echo "EM DASH FOUND" || echo "no em dash"
```

Note on `node --test`: confirm each named file EXISTS before trusting a green exit (a missing file exits 0).

Seed check against LOCAL Postgres (no automated seed integration test exists; this is the manual oracle):

```bash
make db-up
pnpm --filter @fxl-sales/api db:migrate
pnpm --filter @fxl-sales/api db:seed:dev
pnpm --filter @fxl-sales/api db:seed:dev
docker compose exec -T db psql -U postgres -d fxl_sales -c "
SELECT
  (SELECT count(*) FROM sales_ops_lead_stages WHERE org_id = 'org_fake_leads') AS etapas,
  (SELECT count(*) FROM sales_ops_settings   WHERE org_id = 'org_fake_leads') AS settings,
  (SELECT string_agg(slug, ',' ORDER BY slug) FROM sales_ops_funcoes WHERE org_id = 'org_fake_leads') AS funcoes,
  (SELECT string_agg(contact_email || ':' || coalesce(hub_account_id, 'NULL'), ',') FROM sales_ops_people WHERE org_id = 'org_fake_leads') AS pessoas,
  (SELECT count(*) FROM sales_ops_lead_stages WHERE org_id = 'org_fake_norte') AS etapas_norte;"
```

Expected after the SECOND seed run (idempotence): `etapas = 0`, `settings = 0`, `funcoes = finder,vendedor`, `pessoas = leo@fake.local:NULL`, `etapas_norte = 4`.
Leave the database container as it was found (`make db-up` on an already-running container is a no-op; do not stop a container this slice did not start).

Browser check (AC6), only once slices 04 to 07 are merged into the branch under test; otherwise record it as deferred to the wave Verify:

1. Start `make dev-fake` in the background, record its process-group id.
2. In the dev identity switcher pick `Lara (gestora, edicao leads)`: the sidebar shows only Prospecção, Vendedores, Etapas do funil; the board is empty with the create-etapas empty state.
3. Create one etapa, register nothing else, pick `Leo (vendedor, edicao leads)`: only Minha prospecção; the vendedor can create a lead (the self-claim bound him to the seeded pessoa).
4. Pick `Ana (dona da organizacao)`: all four painéis exactly as before.
5. Stop the dev server with `kill -- -<pgid>`.

## Done when

- Every command in Step 10 is green and the seed check prints the expected row.
- `nexo/runs/20261005T221616Z-edicao-leads/` gets the slice exec notes (not committed with product code if the run's convention excludes them).
