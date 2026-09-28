---
id: 06-fake-dev-fixture-authority
milestone: v4.1.0
status: todo
depends_on: [01-pkg-and-transport-ddl]
files_modified: [packages/auth-fake/src/index.ts, packages/auth-fake/src/__tests__/roster.test.ts, packages/auth-fake/src/__tests__/integration-authority.test.ts, apps/api/scripts/__tests__/seed-plan.test.ts]
acceptance:
  - The auth-fake roster gains a FOURTH fixture Organization whose id is imported from `@fxl-business/fxl-contracts/testing` as `FIXTURE_INTEGRATED_ORGANIZATION_ID` (never typed by hand), additional to the existing `org_fake_norte` / `org_fake_sul` / `org_fake_sem_acesso`, and at least one identity is an entitled member of it with a coherent full-access role.
  - `createFakeIntegrationAuthority` is wired ONCE at the auth-fake boot (a memoized module-level singleton, never per request) with `environment: 'development'`, `applicationId: 'app.fxl-sales'`, and `activations` covering BOTH directions over the fixture org (Sales -> Finance and Finance -> Sales); the returned `{ ticketClient, verifier, reporter }` is reachable from the root barrel so slice 08's API boot can inject it in place of the real factories.
  - The fixture org receives coherent seed data (a `won` sale with at least one parcela), produced by the existing per-org generator once the org enters `allFakeOrgIds()`; no bespoke seed rows are hand-written.
  - Nothing from the fake path enters a production bundle - `scripts/assert-web-bundle-clean.mjs` (run after a real `apps/web` build) and `scripts/__tests__/auth-fake-isolation.test.mjs` both stay green.
  - `packages/auth-fake` type-checks and its vitest suite passes, including the new named oracle `packages/auth-fake/src/__tests__/integration-authority.test.ts`.
---

# Slice 06 - Fake-dev fixture Organization + fake integration authority

## Goal (one sentence)

Give this app's `auth-fake` a fourth, SHARED fixture Organization bound to `FIXTURE_INTEGRATED_ORGANIZATION_ID`, coherent seed data for it, and a boot-time fake integration authority (`ticketClient` / `verifier` / `reporter`) exposed on a clean seam - WITHOUT wiring the API boot (that is slice 08) and without letting any of it reach a production bundle.

## What this slice does NOT do

- It does NOT wire the API boot to inject the fake authority in place of the real hub-client / verifier / reporter factories. That is slice 08. This slice only PROVIDES the authority, the seam, the fixture, and the seed.
- It does NOT add any new reference to `@fxl-sales/auth-fake` inside `apps/api/src`, `apps/web/src`, `packages/shared-types/src` or `packages/shared-utils/src`. Those four trees are scanned by `auth-fake-isolation.test.mjs`; leave them untouched so that guard stays green. Slice 08 reaches the authority through the EXISTING sanctioned seam `apps/api/src/auth/select.ts` and the existing `import('@fxl-sales/auth-fake')` root specifier.
- It does NOT change `apps/api/src/auth/select.ts` or `apps/web/src/dev/install-dev-identity.ts`. Both read the roster dynamically (`IDENTITIES`, `findIdentity`, `mintDevToken`, ...); the new identity flows through them with no edit.

## Context the executor must hold before touching code

- `packages/auth-fake/src/index.ts` today "imports NOTHING". This slice deliberately introduces the FIRST imports into that file - from `@fxl-business/fxl-contracts/testing` only. The old docblock line "this package imports NOTHING" (near the `FakeAppRole` declaration) is now stale; update that clause in the same change (see step 2) so the file's own prose stays true.
- The API-boot seam (slice 08) must reach the authority via the EXACT specifier `import('@fxl-sales/auth-fake')`. `auth-fake-isolation.test.mjs` strips only that exact literal (`import\s*\(\s*['"]@fxl-sales/auth-fake['"]\s*\)`) inside the sanctioned seam; a subpath such as `@fxl-sales/auth-fake/integration` would survive stripping and fail rule B. THEREFORE the authority seam MUST be exported from the ROOT barrel `packages/auth-fake/src/index.ts`. Do NOT add a subpath export to `packages/auth-fake/package.json`.
- `node-linker=isolated` (see `.npmrc`): `packages/auth-fake` can only import a package it declares itself. It must declare `@fxl-business/fxl-contracts` in its own `package.json` to import `/testing`.
- The seed is automatic per org. `buildDevSeedPlan` (`apps/api/scripts/seed/plan.ts`) iterates `input.orgIds` and, for EVERY org, builds sale S1 = a `won` "Plataforma FXL" sale with installment receivables labelled `1/3`, `2/3`, `3/3` plus twelve recurring rows. `apps/api/scripts/seed-dev.ts` feeds it `allFakeOrgIds()`. So once the fixture org is a roster member, it is seeded with a coherent won-sale-with-parcelas for free. No change to `seed-dev.ts` or `plan.ts` is needed or wanted (prefer this to hand-written fixture rows that would drift from the real per-org shape).
- `assertFakeOrgIds` (`plan.ts`) accepts any `org_fake_`-prefixed id. `FIXTURE_INTEGRATED_ORGANIZATION_ID === 'org_fake_integrado'` matches the prefix, so the seed guard passes untouched.
- Application ids and event names (verified against the published `dist`): Sales = `app.fxl-sales` (already `SALES_APPLICATION`), Finance = `app.fxl-finance`. Sales produces `fxl-sales.obligation.upserted`, `fxl-sales.settlement.recorded`, `fxl-sales.settlement.reversed`, `fxl-sales.ledger.checkpoint`; Sales consumes `fxl-finance.settlement.recorded`, `fxl-finance.settlement.reversed`.
- The fake authority factory (`dist/testing.d.ts`): `createFakeIntegrationAuthority({ activations, environment, applicationId, now?, ticketTtlSeconds?, cacheMaxAgeSeconds? })` returns `{ ticketClient, verifier, reporter, reports() }`. `environment` is REQUIRED and REQUIRED to be `'development'` - the factory refuses construction otherwise. `FakeActivation = { organizationId, producerApplicationId, consumerApplicationId, eventNames: readonly string[] }`. The returned members implement the SAME `TicketClient` / `IntrospectionVerifier` / `HeartbeatReporter` interfaces the real authority does, so swapping fake for real is swapping which factory is called.

---

## Step 1 - declare the package dependency

Edit `packages/auth-fake/package.json`. Add `@fxl-business/fxl-contracts` at the EXACT pin `0.1.0` (no caret, no tilde - the same pin slice 01 adds to `apps/api`) to `devDependencies`. Rationale: `auth-fake` is a dev-only package (a devDependency of `apps/api` and `apps/web`, never shipped), so the whole package - and everything it imports - is dev-only; the runtime-dependency status of `@fxl-business/fxl-contracts` per prompt section 3 is owned by `apps/api` (slice 01), not by `auth-fake`.

```jsonc
  "devDependencies": {
    "@fxl-business/fxl-contracts": "0.1.0",
    "typescript": "^5.7.3",
    "vitest": "^3.2.7"
  }
```

Then run `pnpm install` from the repo root so `pnpm-lock.yaml` records the link. (`@fxl-business/fxl-contracts@0.1.0` is already in the store from slice 01; if it is NOT, slice 01 has not landed - stop, this slice's `depends_on: [01]` is unmet.)

## Step 2 - the fourth fixture Organization + a dedicated identity

Edit `packages/auth-fake/src/index.ts`.

2a. At the very top of the file, add the ONLY import this file may make - the fixture id and the authority factory, from the `/testing` subpath:

```ts
import {
  createFakeIntegrationAuthority,
  FIXTURE_INTEGRATED_ORGANIZATION_ID,
  type FakeActivation,
  type FakeIntegrationAuthority,
} from '@fxl-business/fxl-contracts/testing';
```

2b. Fix the now-stale prose. The docblock comment above `FakeAppRole` says "this package imports NOTHING". Reword it to the truth, e.g. "this package imports only `@fxl-business/fxl-contracts/testing` (the fixture id and the fake authority factory); apps/web still owns the real `AppRole` type." Do not delete the surrounding rationale.

2c. Add the fourth Organization next to the existing three (keep the NAME ASCII, per the existing comment about the hand-rolled base64 minter):

```ts
// A FOURTH Organization, shared with FXL Finance for the control-plane
// integration. Its id is NEVER typed by hand: it comes from the published
// package so the two apps' rosters cannot diverge. Entitled, owner-role,
// Sales-facing - the local operator's view of the integrated tenant.
const INTEGRADO = workspace(FIXTURE_INTEGRATED_ORGANIZATION_ID, 'Fixture Integrada');
```

2d. Append a TENTH identity to `IDENTITIES` (append only - the first entry is the default landing identity and must stay `team-owner`). It is an entitled owner of the fixture org with the full-access claim shape, so slice 09's admin-only settlement flows over the integrated org have a driver:

```ts
  // 10. integrado - owner of the shared fixture Organization bound to
  //     FIXTURE_INTEGRATED_ORGANIZATION_ID. Full access, so the Sales<->Finance
  //     integration E2E (slice 09) can act as admin over the integrated tenant.
  {
    id: 'integrado',
    label: 'Nina (organizacao integrada)',
    exercises: 'organizacao de fixture compartilhada com o Finance: acesso total sobre o tenant integrado',
    accountId: 'user_fake_nina',
    activeWorkspaceId: INTEGRADO.workspaceId,
    hasAccess: true,
    modules: [],
    workspaceRole: 'owner',
    profile: { name: 'Nina Integrada', email: 'nina@fake.local' },
    workspaces: [INTEGRADO],
    expectedRoles: ['admin', 'seller', 'finder'],
    expectedPaineis: ['tatico', 'operacional', 'cadastros', 'meus-dados'],
  },
```

Notes that keep the existing roster tests green:
- The branch-coverage set-equality tests in `roster.test.ts` compare SETS; `['admin','seller','finder']` and the four-painel set are already present, so adding another full-access identity does not change either set.
- The "exactly one identity whose Organization carries no access" test stays `['no-access']` because this identity has access.
- The "three DIFFERENT claim shapes" and "admin-only unreachable" tests are unaffected (owner shape already covered; this is not `['admin']` alone).
- `accountId` (`user_fake_nina`), `id` (`integrado`) and `label` are new and unique, satisfying the uniqueness tests.
- Do NOT add `INTEGRADO` to any existing identity's `workspaces` (e.g. `multi-org` asserts exactly two orgs) - keep the fixture org on the new identity only.

## Step 3 - the fake integration authority seam (root barrel)

Still in `packages/auth-fake/src/index.ts`, add - near the end of the file, after the roster and helpers - the boot-time authority. Keep it in THIS file (the root barrel) for the isolation reason above.

3a. Application id and event-name constants (Finance id + the directional event-name lists). `SALES_APPLICATION` already exists.

```ts
/** The FXL Finance Application id, the integration counterpart. */
export const FINANCE_APPLICATION = 'app.fxl-finance';

/** The four event types Sales PRODUCES, v1. */
export const SALES_PRODUCED_EVENT_NAMES: readonly string[] = [
  'fxl-sales.obligation.upserted',
  'fxl-sales.settlement.recorded',
  'fxl-sales.settlement.reversed',
  'fxl-sales.ledger.checkpoint',
];

/** The two event types Sales CONSUMES from Finance, v1. */
export const FINANCE_PRODUCED_EVENT_NAMES: readonly string[] = [
  'fxl-finance.settlement.recorded',
  'fxl-finance.settlement.reversed',
];
```

3b. The activation list - BOTH directions over the fixture org:

```ts
/** The fake Activations to simulate live, ONE per (producer, consumer, org).
 *  Both directions of the Sales<->Finance flow over the shared fixture org:
 *  Sales produces to Finance, and Finance produces to Sales. */
export const FAKE_INTEGRATION_ACTIVATIONS: readonly FakeActivation[] = [
  {
    organizationId: FIXTURE_INTEGRATED_ORGANIZATION_ID,
    producerApplicationId: SALES_APPLICATION,
    consumerApplicationId: FINANCE_APPLICATION,
    eventNames: SALES_PRODUCED_EVENT_NAMES,
  },
  {
    organizationId: FIXTURE_INTEGRATED_ORGANIZATION_ID,
    producerApplicationId: FINANCE_APPLICATION,
    consumerApplicationId: SALES_APPLICATION,
    eventNames: FINANCE_PRODUCED_EVENT_NAMES,
  },
];
```

3c. The memoized singleton getter - built ONCE, never per request:

```ts
/** The process-lifetime fake authority, built lazily the first time it is
 *  asked for and cached forever after. Called ONCE at the API boot when
 *  SALES_AUTH_FAKE is set (slice 08); NEVER per request. It returns the same
 *  { ticketClient, verifier, reporter } object shapes the real authority
 *  returns, so slice 08 swaps real for fake by choosing this factory. */
let cachedFakeIntegrationAuthority: FakeIntegrationAuthority | null = null;

export function getFakeIntegrationAuthority(): FakeIntegrationAuthority {
  if (cachedFakeIntegrationAuthority === null) {
    cachedFakeIntegrationAuthority = createFakeIntegrationAuthority({
      activations: FAKE_INTEGRATION_ACTIVATIONS,
      environment: 'development',
      applicationId: SALES_APPLICATION,
    });
  }
  return cachedFakeIntegrationAuthority;
}
```

`environment: 'development'` is a LITERAL, not derived from `NODE_ENV` - the factory refuses any other value, matching the project rule that the environment is never inferred from `NODE_ENV`.

## Step 4 - seed coherence (no code change; make the linkage non-vacuous)

No edit to `apps/api/scripts/seed-dev.ts` or `apps/api/scripts/seed/plan.ts`: the fixture org enters `allFakeOrgIds()` through step 2, and the existing per-org generator gives every org a `won` S1 with parcelas.

To keep the "the fixture org is seeded coherently" claim honest and non-vacuous, add ONE assertion to the existing pure test `apps/api/scripts/__tests__/seed-plan.test.ts` (which needs no DB): feed `buildDevSeedPlan` an org id equal to the fixture id and assert the plan yields a `won` sale with at least one receivable for it.

Use the LITERAL `'org_fake_integrado'` with a comment cross-referencing `FIXTURE_INTEGRATED_ORGANIZATION_ID` (this mirrors how `roster.test.ts` already hard-codes `'org_fake_norte'` etc., and avoids pulling the `/testing` subpath into an `apps/api` test graph). Sketch:

```ts
describe('buildDevSeedPlan - fixture integration org', () => {
  // The literal value of FIXTURE_INTEGRATED_ORGANIZATION_ID from
  // @fxl-business/fxl-contracts/testing; asserted as a literal here to keep the
  // /testing subpath out of the apps/api test graph, exactly as roster.test.ts
  // hard-codes the other org ids.
  const FIXTURE_ORG = 'org_fake_integrado';
  const plan = buildDevSeedPlan({
    orgIds: [FIXTURE_ORG],
    identities: IDENTITIES, // the test's own literal fixture identities
    cutoff: CUTOFF,
  });

  it('seeds a won sale with at least one parcela for the fixture org', () => {
    const wonSales = plan.rows.salesOpsSales.filter(
      (row) => row.orgId === FIXTURE_ORG && row.status === 'won',
    );
    expect(wonSales.length).toBeGreaterThan(0);
    const wonSaleIds = new Set(wonSales.map((row) => row.id));
    const parcelas = plan.rows.salesOpsReceivables.filter(
      (row) => row.orgId === FIXTURE_ORG && wonSaleIds.has(row.saleId),
    );
    expect(parcelas.length).toBeGreaterThan(0);
  });
});
```

(Reuse the file's existing `IDENTITIES` and `CUTOFF` literals; do not import the roster.)

## Step 5 - update the roster test for the fourth org

Edit `packages/auth-fake/src/__tests__/roster.test.ts`, the `describe('allFakeOrgIds', ...)` block only:

- Change `expect(ids.length).toBe(3);` to `expect(ids.length).toBe(4);`.
- Change the expected set to include the fixture org:

```ts
    expect(new Set(ids)).toEqual(
      new Set(['org_fake_norte', 'org_fake_sul', 'org_fake_sem_acesso', 'org_fake_integrado']),
    );
```

The second `allFakeOrgIds` test ("covers every identity's active Organization") needs no edit - it already iterates every identity, including the new one.

## Step 6 - the named oracle

Create `packages/auth-fake/src/__tests__/integration-authority.test.ts`. It is the slice's named oracle and asserts, with `vitest`:

Fixture org present and reachable:
- `allFakeOrgIds()` includes `FIXTURE_INTEGRATED_ORGANIZATION_ID` (imported from `@fxl-business/fxl-contracts/testing`).
- `findIdentity('integrado')` is defined; `identityHasWorkspace(identity, FIXTURE_INTEGRATED_ORGANIZATION_ID)` is true; the fixture workspace's `products` include `SALES_APPLICATION`.
- `toHubClaims(identity)` for that identity carries `entitlements.access === true` and `workspaceId === FIXTURE_INTEGRATED_ORGANIZATION_ID`, and `expectedRoles` is `['admin','seller','finder']` (full access) - proving the fixture org is entitled and admin-driven through the real claim shape.

Authority factory builds and exposes the three members:
- `const authority = getFakeIntegrationAuthority();` and assert `authority.ticketClient`, `authority.verifier`, `authority.reporter` are all defined and `typeof authority.reports === 'function'`.
- `getFakeIntegrationAuthority() === getFakeIntegrationAuthority()` (SAME reference) - the testable form of "built once at boot, never per request".

Config shape / environment gate:
- `FAKE_INTEGRATION_ACTIVATIONS` has exactly two entries, one `producerApplicationId: 'app.fxl-sales'` / `consumerApplicationId: 'app.fxl-finance'` carrying the four `fxl-sales.*` names, and one the reverse carrying the two `fxl-finance.*` names; every entry's `organizationId === FIXTURE_INTEGRATED_ORGANIZATION_ID`.
- Import `createFakeIntegrationAuthority` from `@fxl-business/fxl-contracts/testing` and assert it REFUSES a non-development environment: `expect(() => createFakeIntegrationAuthority({ activations: FAKE_INTEGRATION_ACTIVATIONS, environment: 'production', applicationId: SALES_APPLICATION })).toThrow();` (this pins that the seam's `'development'` literal is load-bearing).

Optional functional proof (recommended, exercises the real interfaces - consult `dist/testing.d.ts` / the `TicketClient` + `IntrospectionVerifier` types in `heartbeat-reporter-*.d.ts` for exact async signatures before writing): obtain a ticket from `authority.ticketClient` for the fixture org's Sales->Finance activation and assert `authority.verifier` introspects it as active over `FIXTURE_INTEGRATED_ORGANIZATION_ID`. If the exact method names/return shapes are not unambiguous from the types, keep the structural assertions above and skip this one rather than guess.

## Step 7 - prove the isolation guards still hold

These two are existing guards; run them as written, do not modify them:

- Build the web app for real, then run the bundle guard:
  - `pnpm --filter @fxl-sales/web build` (delete a stale `apps/web/tsconfig*.tsbuildinfo` first if the build short-circuits, per the deploy-topology memo), then
  - `node scripts/assert-web-bundle-clean.mjs` - must print the "clean" line. The fake path (now importing `/testing`) stays dead-code-eliminated because `install-dev-identity.ts` still gates the dynamic `import('@fxl-sales/auth-fake')` behind `import.meta.env.DEV`, which Vite folds to `false` in prod; the sentinel `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` must remain absent from `apps/web/dist`.
- `node --test scripts/__tests__/auth-fake-isolation.test.mjs` - must stay green (expected `# pass 21`). This slice adds NO `@fxl-sales/auth-fake` reference to the four scanned trees, so nothing here should move.

## Verification (locked oracles + gates for this slice)

Run once (run-once invocations only, never watch mode):

- `pnpm --filter @fxl-sales/auth-fake test` - roster.test.ts (updated) + integration-authority.test.ts (new) green.
- `pnpm --filter @fxl-sales/auth-fake type-check` - proves the `/testing` import resolves and the authority types line up.
- `pnpm --filter @fxl-sales/api test -- seed-plan` (or the repo's run-once form) - the new fixture-org seed assertion green.
- `node --test scripts/__tests__/auth-fake-isolation.test.mjs` - green (`# pass 21`).
- `pnpm --filter @fxl-sales/web build` then `node scripts/assert-web-bundle-clean.mjs` - clean.
- `pnpm run lint` on changed files and `pnpm run type-check` across the workspace.

Named oracles for this slice:
- `packages/auth-fake/src/__tests__/integration-authority.test.ts` (fixture org present + reachable; authority builds with `environment:'development'` and exposes ticketClient/verifier/reporter; singleton identity; activations both directions; non-development refusal).
- `packages/auth-fake/src/__tests__/roster.test.ts` (fourth org in `allFakeOrgIds`).
- `apps/api/scripts/__tests__/seed-plan.test.ts` (fixture org gets a won sale with a parcela).
- `scripts/__tests__/auth-fake-isolation.test.mjs` and `scripts/assert-web-bundle-clean.mjs` (fake path absent from the web/prod bundle).

## Known gap to record (not this slice's fix)

Importing `@fxl-business/fxl-contracts/testing` into `packages/auth-fake` does not, by itself, keep the `/testing` subpath out of the PRODUCTION API image - the same situation CLAUDE.md already records for `packages/auth-fake` itself ("the production API image still contains `packages/auth-fake`... held closed by `NODE_ENV=production` plus the boot refusal"). The `/testing` subpath is reached only through the dev-only `auth-fake` package behind the API's `SALES_AUTH_FAKE` boot refusal, so it inherits exactly that guarantee and no more. The web side IS proven eliminated by `assert-web-bundle-clean.mjs`. Note this in `AUDIT.md`; the Dockerfile hardening remains the pre-existing `nexo/ROADMAP.md` item.

## Cleanup note (opportunistic)

A stray `apps/api/scripts/seed-dev.ts.bak2` exists in the working tree. If it is untracked, remove it (it is a backup of a guarded entrypoint and should not linger); if tracked, leave it and flag it - do not let it ride into this slice's commit.
