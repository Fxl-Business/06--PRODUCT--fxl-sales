---
id: 03-auth-terminal-states
milestone: v2.8.0
status: todo
depends_on: [01-auth-boot-indicator, 02-refresh-403-permanent]
files_modified: [apps/web/src/auth/claims.ts, apps/web/src/auth/react.tsx, apps/web/src/auth/AccessPanels.tsx, apps/web/src/auth/__tests__/claims.test.ts, apps/web/src/auth/__tests__/react.test.tsx, CLAUDE.md, nexo/ROADMAP.md]
acceptance: A signed-in operator whose Hub token omits the product core module sees `Este workspace não tem acesso ao FXL Sales`, with a `Combobox` listing only their other workspaces whose claim `products` carry the token audience, and `client.setActive` is called only after the operator commits a row.
---

# 03 - Auth terminal states

## Context

`HubProtected` in `apps/web/src/auth/react.tsx` collapses every non-transient auth outcome onto two panels.
`SignedOutPanel` fires only after an explicit `Sair`, and `SessionRecoveryPanel` says `Não foi possível restabelecer sua sessão` for everything else.
On 2026-08-10 that panel was what an entitled `admin` operator saw while the real cause was a CSRF origin refusal at the BFF (`nexo/milestones/v2.7.1/SUMMARY.md`).

This slice adds the states that can be told apart honestly, and refuses to add the one that cannot.

## The central research question, answered

### Question 1 - does `claims.workspaces[].products` carry the entitlement?

**Yes, and it is verifiable, not inferred.**

The Hub is `/Users/cauetpinciara/Documents/fxl/projects/16--INTERNAL--fxl-hub` and the claim is declared there in three agreeing places.

`packages/shared-types/src/hub/claims.ts` declares the canonical token:

```ts
workspaces?: Array<{
  workspaceId: string;
  name: string;
  role: HubWorkspaceRole;
  /** Slice 03: product ids this workspace has a LIVE active|trialing sub for
   *  (distinct, sorted asc; `[]` when none). Display-only. */
  products: string[];
}>;
```

`packages/hub-db/src/repo.ts` (`listCompanyWorkspacesForClaim`) computes `products` with, in its own words, the "SAME status+period predicate as `resolveEntitlements` so a switcher's 'entitled' matches the gate's 'entitled'".
`apps/auth/src/mint.ts` copies the array into the JWT verbatim: `claims.workspaces = input.workspaces`.

So `products` is the entitlement signal, and it was built for exactly this screen.

**Three limits, all load-bearing.**

1. The claim lists **COMPANY-kind memberships only**, capped at `WORKSPACES_CLAIM_MAX = 40` (`packages/shared-types/src/hub/constants.ts`), and is **omitted entirely when empty**.
   A personal-kind workspace is never in it, and neither is membership 41.
2. `products` is **subscription-level** (a live `active|trialing` sub for the product id), while the gate this app enforces is **module-level** (`entitlements.modules` contains `sales.core`).
   A sub whose items grant no module would appear entitled here and still be refused after the switch.
3. Every entry key is **`workspaceId`, never `id`**.

Limit 3 is a live bug in this repo.
`readWorkspaces` at `apps/web/src/auth/react.tsx:91` reads `readString(workspace.id)` and `return acc` when it is missing, so **every real Hub claim entry is dropped and `workspaces` is always `[]`**.
That is why the `UserControls` switcher (`workspaces.length > 1`) has never rendered against a real token, and why `react.test.tsx:103` builds fixtures with `id` and still passes.
Fixing `readWorkspaces` is a precondition of this slice, not a nicety.

### Question 2 - is `entitlements.modules` visible in the BROWSER token?

**Yes. It is the same JWT the API verifies, and `parseJwtPayload` can read it today.**

`entitlements: { modules: string[] }` is a **required, validated** claim (`packages/hub-auth/src/verify.ts` throws `entitlements.modules missing or not string[]`), minted unconditionally in `apps/auth/src/mint.ts`.
The browser holds that exact token: `requestHubAccessToken` returns the BFF's `accessToken`, and `apps/api/src/middleware/app-auth.ts` verifies the same string as a bearer.

The module id is derivable with no new env var.
`apps/api/src/config/auth-provider.ts` computes `coreModule` as the audience minus the `product.` prefix, minus a leading `fxl-`, plus `.core`, giving `product.fxl-sales` -> `sales.core`.
The token's own `aud` claim **is** the product id (`shared-types/hub/claims.ts`: `aud: string; // productId`), so the browser derives the same module from the very token it is judging.
`aud` is also what `products[]` holds, so one claim anchors both predicates.

So the browser can evaluate `hasHubCoreEntitlement` for the **active** workspace with certainty, using the API's own predicate.

### Question 3 - how does `/no-role` relate, and what happens to it?

**Leave it exactly as it is. It answers a different question and it already sits behind this gate.**

`getRolesFromHubClaims` reads `roles.workspace` and `roles.productRoles`, which is "does this person have a seat".
`entitlements.modules` is "does this workspace have the product".
An entitled workspace can hold a `member` with no product role (`/no-role`), and an unentitled workspace can hold an `owner` who gets `['admin','seller','finder']` from the workspace flag alone, which is precisely the operator in the v2.7.1 incident.

Ordering falls out for free: `/no-role` is itself wrapped in `<Protected>` (`apps/web/src/router.tsx:145-152`), so the new entitlement branch inside `HubProtected` is evaluated before `NoRolePage` can render.
No route change, no navigation, no redirect.

### Question 4 - can the browser tell a CSRF `403` from an entitlement `403`?

**No, and it does not have to, because an entitlement refusal cannot produce a `403` on this endpoint at all.**

Read the installed BFF: `node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/node_modules/@fxl-business/hub-sdk/dist/server.js`.
`POST /auth/refresh` (line 416) returns exactly `401 no_session`, `401 session_expired`, `502 invalid_refresh_response`, `503 refresh_unavailable`, or `200`.
An upstream Hub `403` is not 401, not in `[408, 425, 429]`, not `>= 500`, so it falls through `isRefreshSuccess` and is re-emitted as **`502`**.
The only `403` the refresh route can emit is the CSRF guard at line 338, which runs before every POST handler.

Entitlement is never checked at the BFF.
The product's entitlement gate is `apps/api/src/middleware/app-auth.ts`, which answers **`402 missing_entitlement`** on `/api/v1/*`, and the Hub mints a token for an unentitled workspace happily, just with an empty `modules`.

Therefore a `403` at `/auth/refresh` means one of exactly two things: the SDK's origin guard refused this browser origin, or an intermediate proxy or WAF refused the request before it reached the app.
Both are environment or deployment faults.
Neither is about the operator's account.
The copy below says exactly that and asserts nothing more.

### What is NOT reliably detectable, stated plainly

**"This ACCOUNT is not entitled anywhere" cannot be proven from the browser token, and this slice does not claim it.**

An empty entitled-workspace list is consistent with all of: a personal workspace that has the product (never in the claim), a 41st company membership (past the cap), a Hub older than the `products` field, and a genuinely unentitled account.
Asserting "your account has no access" from that evidence is the confidently-wrong screen the Frame forbids, and it would be shown to the operator from the v2.7.1 incident under a different failure.

The honest design is one component with two shapes, differing only in whether a list is offered, and copy scoped to what was actually inspected:
"não encontramos nenhum outro workspace seu com acesso", not "sua conta não tem acesso".
This satisfies feature AC6's testable half (no workspace list implying a way in that does not exist) while refusing its unprovable half.

### The fail-open rule

The entitlement branch fires **only** when `aud` is a non-empty string **and** `entitlements.modules` is a `string[]` **and** that array does not contain the derived core module.
Any other shape resolves to `unknown` and renders the app.
A false negative costs one `402` from the API on the next read, which is the authority anyway.
A false positive locks an entitled operator out of a working product, which is strictly worse than the panel being replaced.

## Dependency contract on slice 02

Slice 02's plan file was still a skeleton when this was written, so the contract it must satisfy is stated here and **must be re-read before execution**.

- `HubRefreshFailure` in `apps/web/src/auth/refresh.ts` gains a third member for a permanent `403`.
- `requestHubAccessToken` returns `{ token: null, failure: <that member> }` when `res.status === 403`, ahead of the `res.status !== 200` transient fallback.
- `503`, `502`, a network throw and an unparseable body still resolve to `TRANSIENT_TOKEN_RESULT`.

This plan writes that member as **`'forbidden'`**.
If slice 02 shipped a different literal, the executor swaps that one string.
It appears in exactly three places: the `observeToken` branch in `react.tsx`, the `accessRefused` predicate in `react.tsx`, and the tests that name it.
`claims.ts` never sees it.
Nothing else in this slice depends on slice 02.

Slice 01 owns whatever replaces `<Skeleton className="h-screen w-full" />` at the `!isLoaded || !isSignedIn` branch.
This slice does not touch that branch; it inserts a new branch strictly **after** it.
If slice 01 changed the branch's shape, keep its version and add ours below it.

## Design

### A. `apps/web/src/auth/claims.ts` becomes the whole token-reading surface

Everything below is pure over a claims object, so it is unit-testable without React.
`readWorkspaces` moves here from `react.tsx` because its bug wants a direct test, not a render.

```ts
export type ProductAccess = 'entitled' | 'not_entitled' | 'unknown';

export type HubWorkspacePreview = {
  /** The claim's `workspaceId`, stored under `id` so `orgLabel` reads it unchanged. */
  id: string;
  name?: string;
  products?: string[];
};

export function readString(value: unknown): string | undefined;

/**
 * Parity with `coreModuleFromAudience` in `apps/api/src/config/auth-provider.ts`.
 * `product.fxl-sales` -> `sales.core`. Same two substitutions, same order.
 */
export function coreModuleForAudience(audience: string): string;

/**
 * FAILS OPEN. `'unknown'` whenever `aud` is not a non-empty string or
 * `entitlements.modules` is not a `string[]`, because the API's own `402` is the
 * authority and a wrong `not_entitled` locks an entitled operator out.
 */
export function getProductAccessFromHubClaims(claims: Record<string, unknown>): ProductAccess;

/**
 * Reads `claims.workspaces`. Each entry is keyed `workspaceId`, NOT `id` - see
 * `apps/auth/src/mint.ts` and `packages/shared-types/src/hub/claims.ts` in the Hub repo.
 */
export function readWorkspaces(value: unknown): HubWorkspacePreview[];

/**
 * The operator's OTHER workspaces that the token says hold this product.
 * Entitlement is `products` containing the token audience; an absent `products`
 * selects nothing rather than guessing. The active workspace is always excluded.
 * Order is the claim's own (Hub sorts name-then-id), so the list is deterministic.
 */
export function selectEntitledWorkspaces(
  workspaces: HubWorkspacePreview[],
  audience: string | undefined,
  activeWorkspaceId: string | undefined,
): HubWorkspacePreview[];
```

`getRolesFromHubClaims`, `getRoleFromHubClaims`, `AppRole` and `parseJwtPayload` are unchanged.
The `HubClaims` type in this file stays as-is; the two new readers take `Record<string, unknown>` because they inspect keys `HubClaims` does not declare.

### B. `apps/web/src/auth/react.tsx`

**`profileFromToken`** additionally returns `workspaceId`, `audience` and `productAccess`, and imports `readWorkspaces` / `readString` rather than declaring them.
For a null or unparseable token it returns `{ roles: [], workspaces: [], productAccess: 'unknown' }`.

**`AuthProfile`** gains `workspaceId?: string`, `audience?: string`, `productAccess: ProductAccess`.
`applyToken` copies all three into `setProfile`.
`useHubProfile` returns them along with the rest; that hook already spreads the profile fields one by one, so add the three.

**`sessionFailure`** is a new `useState<HubRefreshFailure | null>(null)` in the provider, exposed on `HubAuthState` only, **not** on `AuthProfile`.
It lives outside `profile` deliberately: `applyToken` early-returns on an unchanged token, so a reason carried inside it could be swallowed on a second `null` apply.

`failSession` takes a **required** `reason: HubRefreshFailure | null` so TypeScript enumerates every call site, the same argument as `costSplitBp` being non-optional.

| call site | reason |
| --- | --- |
| `observeToken`, `result.failure === 'session_expired'` | `'session_expired'` |
| `observeToken`, `result.failure === 'forbidden'` (new branch, above the transient fallback) | `'forbidden'` |
| `scheduleRevalidate`, ladder exhausted | `'transient'` |
| `logout()` | `null` |

`observeToken`'s success branch calls `setSessionFailure(null)` next to `clearLogoutIntent()`, for the same reason and with the same backstop argument: a token in hand proves nothing is refusing us.

**`HubProtected`** reads `productAccess`, `workspaceId`, `workspaceName`, `workspaces`, `audience`, `setActive`, `logout`, `getToken` and `sessionFailure` from the context, and gains:

```ts
const accessRefused = isLoaded && !isSignedIn && sessionFailure === 'forbidden';
```

The login effect's bail-out becomes `if (!isLoaded || isSignedIn || loginBlocked || logoutIntent || accessRefused) return;`.
Without that, a `403` redirects to the Hub, the GET login and GET callback both succeed (the CSRF guard is POST-only, per v2.7.1), the next refresh `403`s again, and the loop that burned a minute is back.
The URL-reset effect stays keyed on `logoutIntent` alone: a refusal should preserve the operator's route so recovery lands on the right screen.

**`UserControls`** gets one correctness fix riding along in the same file and the same data.
`value={workspaces.find((w) => w.name === workspaceName)?.id ?? ''}` matches by NAME and mis-selects between two same-named workspaces.
With `workspaceId` now on the profile it becomes `value={workspaceId ?? ''}`.

### C. `apps/web/src/auth/AccessPanels.tsx` (new)

Its own file rather than more of `react.tsx`, which is already 664 lines, because these two panels hold real behaviour (an async switch, a retry, error state) rather than being static markup like `SignedOutPanel`.
Precedent: `ProfessionalSplitPanel.tsx`.

Both reuse the existing panel shell verbatim: `flex h-screen flex-col items-center justify-center gap-4 px-6 text-center`, `<h1 className="text-2xl font-semibold">`, `<p className="max-w-md text-muted-foreground">`.
Copy is hardcoded pt-BR to match `Sair` / `Entrar` / `Buscar workspace...`; `src/i18n/**` is outside this slice.

#### `WorkspaceNotEntitledPanel`

```ts
export function WorkspaceNotEntitledPanel(props: {
  workspaceName?: string;
  /** Already filtered by `selectEntitledWorkspaces`. Never contains the active workspace. */
  options: HubWorkspacePreview[];
  onSwitch: (workspaceId: string) => Promise<void>;
  onSignOut: () => void;
}): JSX.Element;
```

Local state: `switching: boolean`, `failed: boolean`.

The active workspace is named through `workspaceName` **directly**, never through `orgLabel`.
`orgLabel` falls back to the raw id, and CLAUDE.md forbids a raw workspace id in primary copy.
When `workspaceName` is absent the sentence simply drops the name.

**With `options.length > 0`:**

- `h1`: `Este workspace não tem acesso ao FXL Sales`
- `p`: `O workspace ${workspaceName} não tem uma assinatura ativa do FXL Sales. Escolha abaixo um workspace que tenha.`
- `p` when `workspaceName` is absent: `O workspace ativo não tem uma assinatura ativa do FXL Sales. Escolha abaixo um workspace que tenha.`
- A `<div className="w-72">` holding `Combobox`:
  - `aria-label="Workspace com acesso"`
  - `value={''}` **always**, never a preselection
  - `placeholder="Selecione um workspace"`
  - `searchPlaceholder="Buscar workspace..."`
  - `disabled={switching}`
  - `options` mapped exactly as `UserControls` maps them: `{ value: w.id, label: orgLabel(w), description: isOrgLabelFallback(w) ? w.id : undefined }`, so a nameless workspace drops its id to the muted secondary line
  - `onChange={(id) => { setFailed(false); setSwitching(true); props.onSwitch(id).catch(() => setFailed(true)).finally(() => setSwitching(false)); }}`
  - no `onCreate`
- While `switching`, a muted line: `Trocando de workspace...`
- While `failed`, `<p className="text-sm text-destructive">Não foi possível trocar de workspace. Tente novamente.</p>`
- Secondary `<Button variant="outline" onClick={props.onSignOut}>Sair</Button>`

The `Combobox` commit **is** the explicit choice the decision demands.
Do **not** add a second confirm button.
What the decision forbids is the app choosing for the operator, which is why `value` is empty even when `options.length === 1` and why nothing fires on mount or on open.
The `Combobox` never calls `onChange` outside `commitOption`, so this is structural rather than a convention.

**With `options.length === 0`:**

- `h1`: `Sem acesso ao FXL Sales`
- `p`: `O workspace ${workspaceName} não tem uma assinatura ativa do FXL Sales, e não encontramos nenhum outro workspace seu com acesso.` (name dropped when absent)
- `<p className="max-w-md text-sm text-muted-foreground">Se você espera ter acesso, fale com quem administra a assinatura da sua empresa.</p>`
- `<Button onClick={props.onSignOut}>Sair</Button>` as the single primary action
- **No `Combobox` is rendered at all**, not a disabled one.

#### `AuthRefusedPanel`

```ts
export function AuthRefusedPanel(props: { onRetry: () => Promise<unknown> }): JSX.Element;
```

- `h1`: `Não foi possível autenticar neste endereço`
- `p`: `O serviço de login recusou a solicitação vinda deste endereço. Isso costuma ser uma configuração do ambiente, e não um problema com a sua conta.`
- `<p className="max-w-md text-sm text-muted-foreground">Se continuar, avise o suporte informando o endereço desta página.</p>`
- `<Button variant="outline" disabled={retrying} onClick={...}>Tentar novamente</Button>`

Local `retrying: boolean`.
The retry calls the provider's `getToken()` once, which goes through `tokenCache.getToken()` and `observeToken`, so a recovered origin clears `sessionFailure` and the app renders, while a still-refused one re-sets the same value and React bails on the identical state.

**This panel deliberately offers no `Entrar`.**
The v2.7.1 evidence is that GET `/auth/login` and GET `/auth/callback` both succeed under the guard and only the POST refresh is refused, so a sign-in button here cannot succeed and re-enters the exact loop this state exists to stop.
It also offers no `Sair`: the operator is already signed out.

### D. Render precedence, in full

`HubProtected`'s chain, top to bottom, with what each wins over and why:

| # | guard | renders | why here |
| --- | --- | --- | --- |
| 1 | `logoutIntent` | `SignedOutPanel` | An explicit `Sair` is the operator's own decision and outranks every diagnosis. Unchanged from today. |
| 2 | `accessRefused` (`sessionFailure === 'forbidden'`) | `AuthRefusedPanel` | Strictly more specific than the loop guard, and often the CAUSE of it, since four refused refreshes are what trip `loginBlocked`. |
| 3 | `loginBlocked` | `SessionRecoveryPanel` | **Survives untouched.** Repeated *transient* failure is still its case and still says "Tentamos entrar novamente algumas vezes". |
| 4 | `!isLoaded \|\| !isSignedIn` | slice 01's authenticating indicator | Owned by slice 01. Not edited here. |
| 5 | `productAccess === 'not_entitled'` | `WorkspaceNotEntitledPanel` | Only reachable with a live token, so it must sit below 4. Above `children`, so `RoleGuard` and `/no-role` are behind it. |
| 6 | - | `children` | Includes `productAccess === 'unknown'`, the fail-open case. |

Branch 5 wiring:

```tsx
if (productAccess === 'not_entitled') {
  return (
    <WorkspaceNotEntitledPanel
      workspaceName={workspaceName}
      options={selectEntitledWorkspaces(workspaces, audience, workspaceId)}
      onSwitch={setActive}
      onSignOut={() => void logout()}
    />
  );
}
```

`onSwitch` is the context's `setActive` **directly**, with no wrapper.
That is design point 5: `setActive` already does `await client.setActive` -> generation check -> `queryClient.clear()` -> `tokenCache.seed` -> `observeToken`, in that exact order and for the reasons documented above it.
The new token's claims flow through `applyToken`, `productAccess` re-evaluates, and branch 5 stops matching.
No reload, no navigation, no second flush, and the v2.7.0 cross-tenant cache fix is on the path rather than beside it.

`setActive` can reject (`403 not_a_member`, `502 switch_failed`), which today is swallowed by `void setActive(id)` in `UserControls`.
The panel catches it into `failed` rather than letting it become an unhandled rejection on a terminal screen.

## RED tests

### `apps/web/src/auth/__tests__/claims.test.ts`, new describe `product access from Hub claims`

1. `derives the core module from the token audience` - `product.fxl-sales` -> `sales.core`, pinned against `coreModuleFromAudience` in `apps/api/src/config/auth-provider.ts`.
2. `reports entitled when the modules array carries the product core module`
3. `reports not entitled when the modules array omits it`
4. `reports unknown when the entitlements claim is absent, leaving the API as the authority`
5. `reports unknown when the modules value is not an array of strings`
6. `reports unknown when the audience claim is absent`
7. `parses workspace claim entries keyed by workspaceId, the way the Hub mints them` - fixture is a real claim shape `{workspaceId, name, role, products}`; this is the one that goes red against today's `workspace.id`.
8. `drops a workspace claim entry with no workspaceId`
9. `selects only the workspaces whose products carry the token audience`
10. `never offers the active workspace as a destination`
11. `selects nothing when a workspace entry has no products key, rather than guessing`

### `apps/web/src/auth/__tests__/react.test.tsx`, new describe `auth terminal states`

Uses the existing `renderProtected`, `profileToken`, `ok`, `expired`, `transient`, `switchWorkspace` and `flushReact` helpers.
`profileToken` must gain optional `entitlements` and `aud` parameters and must emit workspace fixtures under **`workspaceId`**; the existing call sites keep working because the new parameters default to an entitled token.

12. `shows the workspace state to a signed-in operator whose token omits the core module` - asserts `Este workspace não tem acesso ao FXL Sales` and that `SessionRecoveryPanel`'s and `SignedOutPanel`'s headings are absent.
13. `renders the app when the token carries the core module` - the negative for 12.
14. `renders the app when the entitlements claim is unreadable, so the API stays the authority` - the fail-open oracle. This is the test that must not be weakened; deleting the `'unknown'` arm turns it red.
15. `lists only the operator's other entitled workspaces` - three workspaces in the claim: active-entitled, other-entitled, other-unentitled. Opens the picker and asserts exactly one row, by its `orgLabel`, and that neither the active nor the unentitled name appears.
16. `does not switch workspace until the operator picks one` - **exactly one** entitled option. Renders, then opens the picker, then asserts `mocks.client.setActive` was never called. This is the always-asks decision's oracle.
17. `switches through setActive when the operator picks a workspace` - commits the row, asserts `setActive` called once with that id, and that the panel is gone once the seeded token applies.
18. `offers no workspace list when no other workspace is entitled` - asserts `Sem acesso ao FXL Sales`, asserts no `button[role="combobox"]` inside the protected subtree, and asserts a `Sair` button is present.
19. `shows the refusal state and schedules no revalidation when the BFF refuses the origin` - `{token: null, failure: 'forbidden'}`, then `advance(SESSION_REVALIDATE_DELAYS_MS.reduce(...))` and assert `mocks.cache.getToken` was called exactly once.
20. `does not auto-login while the BFF is refusing the origin` - asserts `mocks.client.login` not called and `sessionStorage[LOGIN_ATTEMPTS_KEY]` untouched.
21. `keeps the explicit sign-out state ahead of the refusal state` - logout intent set **and** a `'forbidden'` result; asserts `Você saiu da sua conta`. Design point 4.
22. `keeps the refusal state ahead of the recovery panel` - `loginBlocked` set **and** a `'forbidden'` result; asserts the refusal heading.
23. `keeps the recovery panel for repeated transient failure` - four `transient` results with the loop guard tripped; asserts `Não foi possível restabelecer sua sessão` and that the refusal heading is absent. Design point 3.
24. `keeps the no-role page behind the entitlement gate` - renders `/no-role` with an unentitled token and asserts the entitlement heading, not `errors.noRole.title`.

Each of 12, 19 and 21 through 24 is a "renders for its own condition and not for the others" pair, which is the brief's minimum.

### Mutation checks the executor must run once each

- Delete the `'unknown'` arm of `getProductAccessFromHubClaims` (make an unreadable claim mean `not_entitled`): test 14 must go red.
- Change `readWorkspaces` back to `workspace.id`: tests 7 and 15 must go red.
- Preselect the single option in the panel's `Combobox` `value`: test 16 must go red.
- Move branch 2 below branch 3: test 22 must go red.

If any of these stays green, the corresponding test is not an oracle and must be rewritten before the slice is called done.

## Documentation

Add to `CLAUDE.md`, under **Auth Model**, after the `sanitizeReturnTo` bullet:

- The terminal states and their precedence chain, in the table's order.
- That `entitlements.modules` is in the BROWSER token, is derived from the token's own `aud`, and that the predicate **fails open** to `unknown`.
- That `claims.workspaces[]` entries are keyed `workspaceId`, are COMPANY-kind only, are capped at 40 and are omitted when empty, so an empty entitled list is never proof that an account has no access.
- That a `403` on `/auth/refresh` can only be an origin or proxy refusal, since the BFF re-emits an upstream `403` as `502` and never checks entitlement, and that this is why `AuthRefusedPanel` offers no `Entrar`.
- That the switcher always asks and never auto-switches, and that this is why `value` is empty even for a single option.

Add to `nexo/ROADMAP.md`:

- `feat`: the entitled-workspace list is blind to personal-kind workspaces, to membership 41 and beyond, and to a Hub that predates the `products` field, because it reads the capped `workspaces` token claim. The uncapped source is the Hub's `GET /me/workspaces`, designed in the parked `nexo/plans/20260713-hub-sdk-1-2-reconciliation/02-browser-resume-and-workspaces.md`. Until then the panel under-promises, which is the safe direction.
- `fix`: the claim's `products` is subscription-level while the gate is module-level, so a workspace with a live subscription whose items grant no `sales.core` is offered and then refused after the switch. The operator lands back on the same panel naming the new workspace, which reads correctly, but the row should not have been offered.
- `fix`: the API answers `402 missing_entitlement` on `/api/v1/*` and no web path maps it to this panel. A workspace that loses its subscription mid-session shows a generic API fault until the token refreshes.

## Verification, run once

```sh
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/claims.test.ts src/auth/__tests__/react.test.tsx
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
git diff --check
```

Never a bare `vitest`, never a watcher.

### Manual, in a real browser

happy-dom cannot prove the panel looks right, and this is a screen an operator only ever sees on a bad day.
Use the standalone-harness pattern from memory (`fxl-sales-standalone-component-harness`) or a temporary claim override, and check:

1. The entitled variant at 1280px and at 375px: the `Combobox` panel is not clipped, the trigger keeps its height, and the page does not scroll horizontally.
2. Keyboard only: Tab to the trigger, Enter to open, type to filter, Enter to commit.
3. A nameless workspace renders its ordinal-free `orgLabel` fallback with the id on the muted second line, never in the heading.
4. The no-options variant shows no picker and no empty dropdown.
5. `AuthRefusedPanel` reads as an environment fault, not an account fault.

Kill every process started for this by its own process-group id before finishing.

## Risks

**A wrongly shown `not_entitled` is the worst outcome in this slice.**
It is the mirror of the outage being fixed.
Three guards: the predicate is the API's own, it derives the module from the token's own `aud` rather than from env, and every unreadable shape resolves to `unknown` and renders the app.
Test 14 is the oracle and must never be weakened.

**A wrongly shown "no other workspace has access".**
Real and accepted.
The claim omits personal workspaces and caps at 40.
Mitigated entirely in the copy: the panel states what it inspected, never what the account is.

**`readWorkspaces` reads `workspaceId` with no `id` fallback.**
Verified against four independent Hub sources.
If a deployed Hub still emitted `id`, the list would be empty and the panel would degrade to its no-options variant, which asserts nothing false.
That is the correct failure direction, and adding a fallback would keep a phantom shape alive.

**A row offered and then refused** (subscription-level versus module-level `products`).
The gate re-evaluates on the new token, so the operator lands on the same panel naming the new workspace and can pick again.
Annoying, never wrong. Filed to `nexo/ROADMAP.md`.

**Slice 02's literal.**
`'forbidden'` is assumed. Re-read `02-refresh-403-permanent.md` before starting; it is one string in `react.tsx` and two tests.

**Scope creep into `UserControls`.**
Exactly one line changes there (`value`), it is in the same file over the same data, and it is a correctness fix that `workspaceId` makes possible. Nothing else in that component moves.
