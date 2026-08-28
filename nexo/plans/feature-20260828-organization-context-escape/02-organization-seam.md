---
id: 02-organization-seam
milestone: v2.8.0
status: todo
depends_on: []
files_modified: [apps/web/src/auth/react.tsx, apps/web/src/auth/__tests__/react.test.tsx]
acceptance: "given a Hub access token whose claims carry workspaceId, workspaceName and a workspaces preview in which two entries share the name Alpha, when a consumer reads the exported useOrganizations seam and when HubUserControls renders its picker, then the seam reports the active Organization as the entry whose id equals the workspaceId claim, reports the account's Organizations and the others, exposes setActive and the Hub client, and the picker marks that same entry as selected rather than the first entry that happens to share the name"
goal: Expose one exported useOrganizations seam over the existing auth context for the active Hub Organization, the account's Organizations and setActive, and refactor HubUserControls onto it.
must_not_break:
  - the queryClient.clear() ordering inside setActive and its two dedicated oracles, "keeps the current tenant's cache while a workspace switch is still in flight" and "does not flush when a superseded workspace switch resolves late"
  - the single-flush rule, so a workspace switch still clears the cache exactly once
  - the ladder timer oracles that read vi.getTimerCount() while tokenCache.expiresAt() is pinned to null
  - the proactive renewal block's arming assertions around applyToken and scheduleRenewal
  - HubUserControls rendering the Combobox only when the account has more than one Organization
  - HubUserControls styling, its aria-label "Workspace", its searchPlaceholder "Buscar workspace...", and its Sair button
  - the memoized identity of the auth context value, so "does not re-render auth consumers when a refresh returns the same token" stays green
rules:
  - Combobox from @/components/ui/combobox is the only searchable picker; native select, option and datalist are lint-banned in apps/web/src
  - never render a raw workspace id as a primary user-facing label; use orgLabel and isOrgLabelFallback from @/lib/displayNames and keep a raw fallback on the muted secondary line
  - the seam is a thin projection over the existing context; it holds no state of its own, never reimplements setActive, and never adds a second queryClient.clear()
  - no API change, no SDK upgrade, no ?organization= deep link
  - do not edit apps/web/src/lib/* or apps/web/src/sales-ops/SalesOpsApp.tsx in this slice; other slices own those
  - no em dash and no en dash on any added line
verifier_focus: that the picker's active-entry match is genuinely id-based (the two-Organizations-sharing-a-name oracle must fail against the old name match) and that the switch still flushes the query cache exactly once, after the await and after the generation check
---

# 02 - The Organization seam

## Context

This slice belongs to `nexo/plans/feature-20260828-organization-context-escape/00-OVERVIEW.md`, wave 1.
It is independent of slice `01-entitlement-classifier`, which owns `apps/web/src/lib/api-client.ts` and its tests. The two slices share no file.

The feature needs the same three facts in three different places:

1. `HubUserControls` in `apps/web/src/auth/react.tsx` already draws an Organization picker in the TopBar.
2. Slice `03-missing-entitlement-panel` has to NAME the currently active Organization, list the OTHERS, and offer a Hub checkout link for the active one.
3. Slice `05-shell-organization-switcher` has to put the same switching affordance inside the sales-ops account dropdown, beside `Sair`.

Without a seam, 2 and 3 each grow their own copy of "read the context, work out which entry is active, call `setActive`". That is exactly the duplication the feature acceptance forbids: "driven by the SAME `setActive` + `workspaces` seam from the auth context (no duplicated switching logic)".

So this slice does two things and nothing else: it teaches the provider the ACTIVE Organization's id, and it exports ONE hook that projects the context into the shape those callers need. `HubUserControls` is then refactored onto that hook in the same file, so there is exactly one implementation of "which Organization am I in" in the whole web app.

### Vocabulary, because two concepts share one word

The Hub's tenant is an ORGANIZATION. On the wire, in the token claims and in the SDK, it is spelled `workspace` / `workspaceId` / `workspaces`. In the API it lands as `orgId` (CLAUDE.md, Auth Model: "`orgId` is the active Hub workspace id").

The sales-ops sidebar ALSO says "Workspace", and that is a SALES-INTERNAL view group (`apps/web/src/sales-ops/navigation.ts`), not a Hub tenant at all. Slice 05 renames that chrome.

This slice therefore names its new public surface with the USER-FACING word, `Organization`, and keeps the wire word only where it is genuinely the wire: `workspaceId` on the profile (it is a claim name), `HubWorkspacePreview` (it is the token's preview entry), and `setActive(workspaceId)` (it is the SDK's own parameter name). Do not rename `HubWorkspacePreview` and do not rename the Combobox's `aria-label="Workspace"` in this slice; both are pinned by existing tests and both belong to other slices' scope.

### What is correct today and must stay correct

`apps/web/src/auth/react.tsx` is the most invariant-dense file in the web app. CLAUDE.md's Auth Model section documents, among others:

- `setActive` flushes the TanStack cache with `queryClient.clear()`, AFTER `await client.setActive(...)`, AFTER the `operationGeneration` check, and BEFORE `tokenCache.seed` and `observeToken`. Two dedicated tests exist for those two orderings and nothing else in the suite catches either one.
- `observeToken` flushes only on a signed-out to signed-in transition (`typeof lastAppliedToken.current === 'string'` is false), so a workspace switch never double flushes.
- `applyToken` early-returns on an unchanged token, which is what makes the `profile` object and the `workspaces` array stable across the roughly forty token reads per screen. That stability is itself pinned by "does not re-render auth consumers when a refresh returns the same token".
- The renewal timer is the SECOND timer source in the file, so `vi.getTimerCount()` is only a ladder oracle while `tokenCache.expiresAt()` is pinned to `null`. The suite pins that in `beforeEach`.

This slice touches NONE of that machinery. It adds one claim read inside `profileFromToken`, one field to the state object `applyToken` already builds, one pure hook, and a projection change inside `HubUserControls`. It adds no timer, no effect, no state, and no cache operation.

### What is broken

Two defects, and the second is caused by the first.

**Defect A. The provider never reads the active Organization's id.**

`profileFromToken` reads `claims.workspaceName` but not the active workspace id, even though the Hub access token carries `workspaceId` at the TOP LEVEL of the claims. `apps/api/src/middleware/app-auth.ts` reads exactly that claim: `MinimalHubAuthContext.workspaceId`, which `getHubLegacyAuthContext` maps to `orgId`. The whole API tenancy layer is keyed on it. The web simply throws it away.

**Defect B. `HubUserControls` matches the active entry by NAME.**

`apps/web/src/auth/react.tsx:896`:

```tsx
value={workspaces.find((workspace) => workspace.name === workspaceName)?.id ?? ''}
```

This is a real, pre-existing weakness and not a cosmetic one:

- It cannot disambiguate two Organizations that share a name. An account with two tenants both called `Alpha` gets the FIRST one marked as active, whichever one is actually active. The operator then looks at a picker that is confidently wrong about where they are, which is precisely the confusion this whole feature exists to remove.
- It yields `''` whenever the `workspaceName` claim is absent, so the picker shows its placeholder and claims no Organization is active while one plainly is.
- It yields `''` whenever the active Organization is not present in the `workspaces` preview. That list is a CAPPED display-only preview (00-OVERVIEW, acceptance), so this is not hypothetical.
- It compares a display string across a `find`, which means a Hub-side rename between the two claims silently breaks the match.

The `workspaceId` claim fixes all four at once, because it is an identity rather than a label.

Nothing caught Defect B because the test fixtures never carried a `workspaceId` claim, so name matching was the only thing under test. This is the second time this file's fixtures have agreed with a bug: CLAUDE.md and the comment inside `readWorkspaces` record the first, where fixtures were written against the WEB type (`id`) instead of the TOKEN (`workspaceId`), which hid the fact that `readWorkspaces` dropped every real entry and the switcher had never appeared in production at all. The lesson is written into this slice's test plan: new fixtures are TOKEN-shaped.

## Design

### The exported name

`useOrganizations`.

The file's public surface today is `useAccessToken`, `useAuthProfile`, `useLogout`, plus the components `AppAuthProvider`, `Protected` and `UserControls`. `useHubAuthContext` is deliberately private, and it must stay private: it is the only handle on the raw client and the raw `sessionLost` flag, and widening it is how the duplication comes back.

`useOrganizations` matches that surface (verb-less, plural noun, no `Hub` prefix on the export). It is deliberately NOT `useWorkspaces`, because in this repository "workspace" already names the sales-ops view group and a hook by that name would be read as the wrong thing by every future reader and by slice 05 in particular.

Follow the file's own two-step convention: a private implementation named `useHubOrganizations`, re-exported at the bottom next to the others.

### The returned shape

```ts
{
  active: Organization | null;
  activeName: string | undefined;
  organizations: Organization[];
  others: Organization[];
  setActive: (organizationId: string) => Promise<void>;
  client: HubClient;
}
```

Justification, member by member. The bar each one has to clear is that a caller can NAME the active Organization, LIST the others, MARK which one is active, and SWITCH, without any caller ever re-deriving identity.

- **`active`**. The whole point of part 1. Built from the `workspaceId` claim, so it is an identity and not a label. `null` only when no id is knowable at all, which after this slice means a token with no `workspaceId` claim AND no name match in the preview. Callers get `{id, name}` so `orgLabel(active)` works directly and CLAUDE.md's "never a raw id as a primary label" rule is respected with no extra work.
- **`activeName`**. The `workspaceName` claim verbatim. It earns its place because it is the ONLY signal that survives when `active` is `null`, and slice 03's copy is required to name the active Organization. Without it, the degenerate token forces slice 03 to reach back into `useAuthProfile()` for `workspaceName`, which is the duplication this seam exists to prevent. It is documented as a strict fallback: whenever `active` is non-null, callers use `orgLabel(active)` and ignore this field.
- **`organizations`**. The account's Organizations, in token order, exactly the `workspaces` array the context already holds. `HubUserControls` needs the FULL list, because it renders every Organization and marks one.
- **`others`**. `organizations` minus `active`. It is a one-line derivation, and that is precisely the line that a second and a third caller would each write slightly differently. Slice 03's panel offers "switch to another Organization" and slice 05's dropdown offers the same; both need the complement, and neither should have to know that when `active` is `null` the honest complement is the whole list. Computing it once here also removes the only place a caller could reintroduce name matching.
- **`setActive`**. Handed straight through from the context by reference. NOT wrapped, NOT re-created, so the flush ordering and the `operationGeneration` guard stay in exactly one place. The parameter is renamed to `organizationId` in the seam's TYPE only, for readers; the value passed is still the Hub workspace id and reaches `client.setActive(workspaceId)` untouched.
- **`client`**. The raw `HubClient`, not a wrapper. Decided deliberately:
  - Slice 03 needs `client.checkoutUrl(sku?: string): Promise<string>` to build the Hub checkout deep link for the active Organization. A wrapper would have to be async, which means the wrapper would need its own loading and error state, and the seam is required to hold NO state.
  - A wrapper would also have to decide the `sku` and the open-in-new-tab policy. Both are presentation decisions that belong to slice 03's panel, not to an auth-layer projection.
  - `manageUrl(): Promise<string>` is the obvious next thing a later slice wants. A narrowed `Pick<HubClient, 'checkoutUrl'>` would force an edit to THIS file every time another method is needed, which reintroduces exactly the coupling the seam removes. `HubClient` is the SDK's own type, so passing it through can never drift from the SDK.
  - The one real hazard is that `client.logout()` and `client.login()` are now reachable from a caller, and calling either directly would bypass the durable logout intent, the token cache clear and the cache flush that `logout()` in this provider performs in a documented order. That hazard is answered by a comment on the field and by a rule in this plan, not by narrowing the type. It is the same hazard `useHubAuthContext` already carries.

Explicitly NOT in the shape:

- No `isLoading`. `useAuthProfile().isLoaded` already exists and is what slice 03 gates its skeleton on. A second loading flag would be a second source of truth.
- No `activeId` alongside `active`. `active?.id` says it, and two spellings of one fact is how they drift.
- No entitlement or `products` filtering. 00-OVERVIEW scopes the entitlement gate out entirely. `Organization` keeps the optional `products` field the preview already carries, and no caller in this feature reads it.

### Resolving `active`

The resolution order, and the reason for each step:

1. `workspaceId` claim present. `active = { id: workspaceId, name: workspaceName ?? matchingEntry?.name, products: matchingEntry?.products }`, where `matchingEntry` is `organizations.find(o => o.id === workspaceId)`. The name comes from the TOP LEVEL claim first, because that is the claim the Hub mints to describe the ACTIVE Organization and it is present even when the capped preview does not contain the active entry at all.
2. No `workspaceId` claim, but `workspaceName` matches an entry by name. `active` is that entry. This is the documented FALLBACK: it is exactly today's behaviour, and it is kept so that a token minted without the claim, or any of the existing test fixtures, keeps working precisely as before rather than regressing to "no Organization is active".
3. Neither. `active = null`, and `activeName` still carries whatever the name claim said.

`others` is `organizations.filter(o => o.id !== active?.id)`. When `active` is `null` that filter removes nothing, which is the honest answer: if we do not know where the operator is, every Organization is somewhere else they could go.

### Why the seam cannot hold state

`setActive` already owns a four-statement critical section whose ordering CLAUDE.md spells out and whose two orderings have dedicated oracles. Any state in the seam would be a fourth thing to keep in step with `client.setActive`, the generation counter, the cache flush and the token seed. The seam is therefore three `useMemo` calls over context values and nothing else. In particular it must not:

- call `queryClient.clear()`, `useQueryClient()` or anything cache-shaped;
- wrap `setActive` in a callback that tracks pending state (a caller that wants a spinner awaits the returned promise itself);
- mirror `active` into `useState`;
- schedule anything.

## Implementation

All edits are in `apps/web/src/auth/react.tsx` unless stated. Comment density in this file is very high and deliberately explains WHY; the exact comment text to write is given below and should be used verbatim.

### Step 1. `AuthProfile` gains `workspaceId`

In the `AuthProfile` type, add the field directly under `workspaceName`:

```ts
  /**
   * The ACTIVE Hub Organization's id, read from the token's top level `workspaceId`
   * claim. This is the same claim `apps/api/src/middleware/app-auth.ts` reads as
   * `MinimalHubAuthContext.workspaceId` and maps to `orgId`, so the browser and the API
   * now agree on one identity for "which tenant is this request in" instead of the
   * browser guessing from a display name.
   *
   * Optional because a token minted without it must still produce a usable profile; the
   * name based fallback in `useHubOrganizations` covers that case and is the only reason
   * the old matching survives at all.
   */
  workspaceId?: string;
```

Keep `workspaceName` exactly as it is.

### Step 2. `profileFromToken` reads the claim

Inside the returned object, immediately above `workspaceName`, add:

```ts
    // Top LEVEL, not inside `workspaces`. The Hub mints the active Organization's id
    // beside its name, which is why `readString` is enough and no lookup is needed here.
    workspaceId: readString(claims.workspaceId),
```

`readString` already rejects a non-string and an empty string, which is the behaviour we want: an empty id must read as absent so the name fallback can run rather than producing an `active` with an unusable id.

Do not touch `readWorkspaces`. Its `workspaceId ?? id` fallback is about the entries INSIDE the preview array and is unrelated to this claim, despite the shared spelling. A comment is worth adding above the new line only if it does not duplicate the one already inside `readWorkspaces`; the sentence above is sufficient.

### Step 3. `applyToken` carries the field into state

In the `setProfile({...})` call, add `workspaceId: next.workspaceId,` immediately above `workspaceName: next.workspaceName,`.

No other change in `applyToken`. In particular the unchanged-token early return stays exactly where it is: it is what keeps the profile object stable, and adding a field to the object does not change how often the object is built.

### Step 4. `useHubProfile` passes it through

`useHubProfile(): AuthProfile` destructures its fields explicitly, so TypeScript will fail the build until `workspaceId` is added to both the destructuring and the returned object literal. Add it in both places, beside `workspaceName`.

This is deliberate and not merely mechanical: it means any existing consumer of `useAuthProfile()` can read the active Organization id without the seam, which is the right escape hatch for a component that needs the id and nothing else. The seam remains the way to get the LIST and the SWITCH.

### Step 5. The public `Organization` type

Immediately below the `HubWorkspacePreview` type declaration, add:

```ts
/**
 * The user facing name for a Hub tenant, and the seam's public shape.
 *
 * Structurally identical to `HubWorkspacePreview` on purpose: aliasing rather than
 * redeclaring means the seam never allocates a mapped copy of the preview array, so the
 * array identity that `applyToken`'s unchanged-token early return works so hard to keep
 * stable survives all the way out to the caller.
 *
 * The wire spells this "workspace" everywhere - the claim, the SDK parameter, the API's
 * `orgId` mapping - but "Workspace" already names a SALES INTERNAL view group in
 * `apps/web/src/sales-ops/navigation.ts`, and one word for two concepts is how the
 * sidebar came to read as an Organization picker in the first place.
 */
export type Organization = HubWorkspacePreview;
```

`HubWorkspacePreview` itself stays private and unrenamed; renaming it would churn `readWorkspaces`, the state, the context type and their comments for no behavioural gain.

### Step 6. The seam

Place `useHubOrganizations` immediately after `useHubLogout` and immediately BEFORE `HubUserControls`, so the hook reads directly above its first consumer.

```tsx
/**
 * The ONE seam for "which Hub Organization am I in, which others could I switch to, and
 * how do I switch".
 *
 * A THIN PROJECTION over `useHubAuthContext` and nothing more. It holds no state, starts
 * no request, schedules no timer, and above all it does NOT reimplement `setActive`:
 * that function owns a four statement critical section whose ordering CLAUDE.md spells
 * out (await the switch, check the generation, flush the query cache, seed the token,
 * observe it) and whose two orderings have dedicated oracles in
 * `apps/web/src/auth/__tests__/react.test.tsx`. It is handed through by reference so
 * there is exactly one copy of that ordering in the app.
 *
 * For the same reason this hook must never call `queryClient.clear()`. The switch
 * already flushes exactly once; a second flush here would be a flush on the WRONG side
 * of the `await`, which is the failure the in flight oracle exists to catch.
 */
function useHubOrganizations(): {
  active: Organization | null;
  activeName: string | undefined;
  organizations: Organization[];
  others: Organization[];
  setActive: (organizationId: string) => Promise<void>;
  client: HubClient;
} {
  const { client, setActive, workspaceId, workspaceName, workspaces } = useHubAuthContext();

  /**
   * Resolved by ID first, which is the whole point of reading the `workspaceId` claim.
   *
   * The name match below is a documented FALLBACK for a token that carries no
   * `workspaceId` claim, and only that. It is kept because it is exactly the previous
   * behaviour, so a token minted without the claim degrades to what it did yesterday
   * rather than reporting that no Organization is active. It must never be promoted back
   * to the primary path: a name cannot tell two Organizations called `Alpha` apart, it
   * is empty whenever the name claim is absent, and it misses entirely whenever the
   * active Organization is outside the capped `workspaces` preview.
   *
   * The name on the resolved entry prefers the TOP LEVEL `workspaceName` claim, because
   * that claim describes the ACTIVE Organization and is present even when the preview
   * does not contain it at all.
   */
  const active = useMemo<Organization | null>(() => {
    if (workspaceId) {
      const match = workspaces.find((workspace) => workspace.id === workspaceId);
      return {
        id: workspaceId,
        name: workspaceName ?? match?.name,
        products: match?.products,
      };
    }
    return workspaces.find((workspace) => workspace.name === workspaceName) ?? null;
  }, [workspaceId, workspaceName, workspaces]);

  /**
   * The account's Organizations minus the active one, derived HERE rather than at each
   * call site. Two callers need it - the missing entitlement panel and the sales ops
   * account dropdown - and a per caller `filter` is where the name matching would creep
   * back in.
   *
   * When `active` is null this removes nothing, which is the honest answer: if we cannot
   * tell where the operator is, every Organization is somewhere else they could go.
   */
  const others = useMemo(
    () => workspaces.filter((workspace) => workspace.id !== active?.id),
    [active, workspaces],
  );

  return useMemo(
    () => ({
      active,
      /*
        The `workspaceName` claim verbatim, and a strict FALLBACK. Whenever `active` is
        non null, callers name the Organization with `orgLabel(active)` instead; this
        field exists only for the degenerate token that yields no id at all, where naming
        the Organization is still better copy than admitting nothing.
      */
      activeName: workspaceName,
      organizations: workspaces,
      others,
      setActive,
      /*
        The RAW SDK client, deliberately not wrapped. A later slice builds the Hub
        checkout deep link with `client.checkoutUrl(sku?)`, which is async: wrapping it
        would force this hook to own loading and error state, and a stateless projection
        is the property that keeps it safe to call from anywhere. Narrowing the type to
        the one or two methods in use would mean editing this file again for the next
        method, which is the coupling the seam exists to remove.

        Do NOT call `client.logout()` or `client.login()` through this. `useLogout()` is
        the only supported sign out: it writes the durable logout intent before its first
        `await`, clears the token cache, tears the session down and flushes the query
        cache in an order CLAUDE.md documents at length, and none of that happens if the
        SDK method is called directly.
      */
      client,
    }),
    [active, client, others, setActive, workspaceName, workspaces],
  );
}
```

Notes for the executor:

- `HubClient` is already imported at the top of the file as a type. No new import is needed.
- `useMemo` is already imported.
- Every dependency here is stable across a re-render that did not change the token, because `applyToken` early-returns on an unchanged token and the context `value` is itself memoized. The seam therefore adds no re-render pressure, and the existing "does not re-render auth consumers when a refresh returns the same token" oracle keeps its meaning.
- Do NOT add the hook to `useHubAuthContext`'s return, and do NOT export `useHubAuthContext`.

### Step 7. Refactor `HubUserControls` onto the seam

The component must read the seam and `useHubLogout()` instead of `useHubAuthContext()`, so that after this slice `useHubAuthContext` has exactly one Organization-shaped consumer, which is the seam itself.

```tsx
function HubUserControls() {
  const logout = useHubLogout();
  /*
    The SAME seam the missing entitlement panel and the sales ops account dropdown read.
    Before this slice this component resolved the active entry itself, by NAME, which is
    the implementation the seam replaces rather than joins.
  */
  const { active, organizations, setActive } = useHubOrganizations();
  ...
}
```

Inside the JSX, exactly three things change and nothing else:

1. `workspaces.length > 1` becomes `organizations.length > 1`. Same array, same rule: a picker with one row is a control that cannot do anything, so it is not rendered. The `Sair` button is outside the conditional and stays outside it.
2. `options={workspaces.map(...)}` becomes `options={organizations.map(...)}`. The mapping body is UNCHANGED, including the `orgLabel(workspace)` primary label and the `isOrgLabelFallback(workspace) ? workspace.id : undefined` description, and including its existing comment. Rename the map parameter from `workspace` to `organization` for consistency with the surrounding names, and keep the comment text as it is.
3. The `value` prop becomes:

```tsx
            /*
              The ACTIVE Organization by ID. This used to be
              `workspaces.find((w) => w.name === workspaceName)?.id ?? ''`, which marked
              the first entry that merely SHARED the active Organization's name and
              marked nothing at all whenever the name claim was absent. The seam resolves
              it from the token's `workspaceId` claim and keeps the name match only as a
              fallback for a token that carries no such claim.

              `''` is still the empty selection the Combobox expects when nothing is
              active, and it is now reachable only when the token yields no id at all.
            */
            value={active?.id ?? ''}
```

Explicitly UNCHANGED, and each for a reason:

- `aria-label="Workspace"`. Pinned by `workspaceTrigger` in the test file and by the switching helper. Renaming it to "Organização" is a real improvement and it belongs to a later slice that can move the helper with it.
- `searchPlaceholder="Buscar workspace..."`.
- `className="h-9 rounded-md border-input bg-background px-3 text-sm"` and the `w-56` wrapper.
- The whole `Sair` button, including its class list, its `title`, its `aria-label` and its `LogOut` icon.
- No `valueLabel` prop is added. It would make the trigger name an active Organization that is outside the capped preview, which is a genuine improvement over today's placeholder, but it is a RENDERED behaviour change and this slice's contract is that rendered behaviour changes only in the active-entry match. File it for slice 05 if it is still wanted there.

After the refactor, `workspaceName` is no longer referenced by `HubUserControls`. Make sure no unused binding is left behind; `pnpm --filter @fxl-sales/web lint` fails on one.

### Step 8. Export the seam

At the bottom of the file, in the export block, add between `useLogout` and `UserControls`:

```ts
export const useOrganizations = useHubOrganizations;
```

The file already carries `/* eslint-disable react-refresh/only-export-components */` on line 1, so an additional non-component export is fine and needs no new suppression.

`Organization` is exported at its declaration in step 5 rather than in this block, matching how the file exports `SESSION_REVALIDATE_DELAYS_MS` and `SESSION_RENEWAL_LEAD_MS` inline.

## Test contract

The locked oracle is the EXISTING file, `apps/web/src/auth/__tests__/react.test.tsx`. Do not create a sibling file.

Reasons this is the right home rather than a new one: the whole mock rig lives here (`vi.hoisted` client, the token cache mock, the `refresh` partial mock, the `beforeEach` that pins `mocks.cache.expiresAt` to `null`), and duplicating that rig into a sibling is how two rigs drift apart. The seam is also part of the same public surface this file already imports (`UserControls`, `useAuthProfile`, `useAccessToken`), and the picker assertions have to run against the same `switchWorkspace` and `workspaceTrigger` helpers that the cache oracles use.

### Fixture changes

`profileToken(workspaceName, workspaces)` gains an OPTIONAL THIRD parameter. Appending keeps all existing call sites compiling and unchanged.

The existing multi-line comment above the `workspaces` parameter is KEPT VERBATIM. It records the `id`-versus-`workspaceId` fixture bug against the parameter that bug was about, which is where it belongs; the new third parameter's comment restates the lesson for its own case rather than replacing it. Do not delete either one.

```ts
function profileToken(
  workspaceName: string,
  /*
    Keyed `workspaceId`, which is what the Hub actually mints - see
    `packages/shared-types/src/hub/claims.ts` in the Hub repo. The earlier
    fixtures used `id`, matching the web type rather than the token, so they
    agreed with the bug that made `readWorkspaces` drop every entry and left the
    workspace switcher invisible in production. A fixture written against our own
    shape instead of the wire shape can only ever confirm our own assumption.
  */
  workspaces: Array<{ workspaceId?: string; id?: string; name: string }> = [
    { workspaceId: 'workspace-alpha', name: 'Alpha' },
    { workspaceId: 'workspace-beta', name: 'Beta' },
  ],
  /*
    The ACTIVE Organization's id, minted at the token's TOP LEVEL exactly as the Hub
    mints it and exactly as `apps/api/src/middleware/app-auth.ts` reads it. Optional and
    UNSET by default on purpose: every pre-existing test in this file then keeps
    exercising the name based fallback, which is the behaviour that must not regress,
    while the new tests below opt in to the id.

    CLAUDE.md records that this file's fixtures once used `id` rather than `workspaceId`
    because they were written against the WEB type instead of the TOKEN, and thereby
    agreed with a bug that hid a whole feature in production. This parameter is
    token shaped for that reason: a fixture written against our own shape can only ever
    confirm our own assumption.
  */
  workspaceId?: string,
): string {
  return jwt({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    workspaceId,
    workspaceName,
    roles: { workspace: 'admin' },
    workspaces,
  });
}
```

`JSON.stringify` drops an `undefined` value, so an unset `workspaceId` produces a token with NO such claim, which is exactly the fallback case. Do not write it as `''`; `readString` would reject that anyway, but a claim that is present and empty is not the state under test.

Two named fixture constants for the sharpest test, declared next to `profileToken`:

```ts
/**
 * Two Organizations that genuinely share a display name, which is the case name matching
 * cannot represent at all. The ACTIVE one is deliberately the SECOND, so a `find` by name
 * lands on the wrong entry rather than accidentally on the right one.
 */
const SAME_NAME_ORGS = [
  { workspaceId: 'workspace-alpha-1', name: 'Alpha' },
  { workspaceId: 'workspace-alpha-2', name: 'Alpha' },
];
```

### New helpers

Add beside `workspaceTrigger` and `switchWorkspace`:

```ts
/**
 * Opens the picker WITHOUT committing a row. `switchWorkspace` cannot be reused for the
 * selection assertions: it finds its row by visible label, and the case under test is
 * precisely two rows that share one label.
 */
async function openWorkspacePicker(host: HTMLElement) {
  const trigger = workspaceTrigger(host);
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** Every option row in render order. `Combobox` renders them in the order it is given. */
function workspaceOptions(host: HTMLElement): HTMLElement[] {
  return [...host.querySelectorAll('[role="option"]')].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}
```

`Combobox` sets `aria-selected={option.value === value}` on every row and preserves the caller's order for an empty query (`buildComboboxFilter` returns `options` unchanged when the needle is empty and no option carries a `group`). So the INDEX of the row whose `aria-selected` is `"true"` is a faithful and discriminating oracle.

### The probe and its host

A new probe, declared next to `Probe`:

```tsx
/**
 * Reads the seam the way slices 03 and 05 will. It renders ids rather than labels on
 * purpose: these assertions are about IDENTITY, and a label based assertion is exactly
 * the confusion the seam removes. The rendered UI keeps using `orgLabel`, and
 * `switchWorkspace` still asserts on the visible pt-BR name.
 */
function OrganizationProbe() {
  const { active, activeName, organizations, others, setActive, client } = useOrganizations();
  const profile = useAuthProfile();

  return (
    <div>
      <output data-testid="profile-workspace-id">{profile.workspaceId ?? ''}</output>
      <output data-testid="active-org">{`${active?.id ?? ''}|${active?.name ?? ''}`}</output>
      <output data-testid="active-org-name">{activeName ?? ''}</output>
      <output data-testid="all-orgs">{organizations.map((org) => org.id).join(',')}</output>
      <output data-testid="other-orgs">{others.map((org) => org.id).join(',')}</output>
      <button
        data-testid="seam-switch"
        onClick={() => {
          void setActive('workspace-beta');
        }}
        type="button"
      >
        trocar
      </button>
      <button
        data-testid="seam-checkout"
        onClick={() => {
          void client.checkoutUrl('sales.core');
        }}
        type="button"
      >
        assinar
      </button>
    </div>
  );
}
```

Import `useOrganizations` by adding it to the existing named import from `'../react'`.

A dedicated host, next to `renderProvider`, so the widely used `renderProvider` signature is not disturbed:

```tsx
/**
 * Mounts the seam probe beside `UserControls`, with no `MemoryRouter` and no `Protected`:
 * neither the seam nor `UserControls` reads a router hook, and keeping the tree flat
 * means the picker is reachable in every auth state.
 */
function renderOrganizations() {
  const host = document.createElement('div');
  document.body.append(host);
  const nextRoot = createRoot(host);

  act(() => {
    nextRoot.render(
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>
          <OrganizationProbe />
          <UserControls />
        </AppAuthProvider>
      </QueryClientProvider>,
    );
  });

  return { container: host, root: nextRoot };
}
```

Every new test assigns `({ container, root } = renderOrganizations())` so the shared `afterEach` unmounts it.

### The tests

Append ONE new `describe` at the END of the file, after `describe('identity-scoped query cache', ...)`. Appending means no existing line moves and no existing oracle is touched.

```
describe('active organization and the useOrganizations seam', () => {
```

**1. `it('surfaces the active organization id from the token claims')`**

Token: `profileToken('Alpha', undefined, 'workspace-alpha')`. Assert `profile-workspace-id` is `workspace-alpha`, `active-org` is `workspace-alpha|Alpha`, `active-org-name` is `Alpha`.
This is the part 1 oracle: it fails outright before step 2, because `profileFromToken` never reads the claim.

**2. `it('resolves the active organization by id when two organizations share a name')`**

Token: `profileToken('Alpha', SAME_NAME_ORGS, 'workspace-alpha-2')`. Assert `active-org` is `workspace-alpha-2|Alpha`.
Non-vacuity note to write into the test: a name based resolution answers `workspace-alpha-1` here, so this assertion discriminates.

**3. `it('falls back to the name claim when the token carries no workspaceId')`**

Token: `profileToken('Beta')`, the default two entry preview and NO third argument. Assert `profile-workspace-id` is `''` and `active-org` is `workspace-beta|Beta`.
This pins the documented fallback, which is what keeps every pre-existing test in this file meaningful.

**4. `it('reports no active organization when the token yields neither an id nor a name match')`**

Token: `profileToken('Gamma')` with the default preview, whose entries are `Alpha` and `Beta`. Assert `active-org` is `|`, `active-org-name` is `Gamma`, and `other-orgs` is `workspace-alpha,workspace-beta`.
This is the oracle for the two judgement calls in the shape: that `activeName` survives a null `active`, and that `others` degrades to the whole list rather than to nothing.

**5. `it('lists the account organizations and excludes the active one from the others')`**

Token: `profileToken('Alpha', undefined, 'workspace-alpha')`. Assert `all-orgs` is `workspace-alpha,workspace-beta` and `other-orgs` is `workspace-beta`.

**6. `it('reaches client.setActive through the seam and flushes the query cache exactly once')`**

Setup: token `profileToken('Alpha', undefined, 'workspace-alpha')`; `mocks.client.setActive` resolves `{ accessToken: profileToken('Beta', undefined, 'workspace-beta'), expiresIn: 120, workspaceId: 'workspace-beta' }`.
Mount, `await flushReact()`, THEN `const clearSpy = vi.spyOn(queryClient, 'clear')`. The spy must be installed after the mount flush, because the cold start signed-out to signed-in transition legitimately flushes once inside `observeToken` and would otherwise be counted.
Click `seam-switch`, `await flushReact()`.
Assert `mocks.client.setActive` was called with `workspace-beta`, that `active-org` is now `workspace-beta|Beta`, and that `clearSpy` was called exactly once.
The "exactly once" half is the guard against the seam growing its own flush, which is the single most likely wrong turn in this slice and which no existing test would catch.

**7. `it('hands back the Hub client so a later slice can build the checkout link')`**

Click `seam-checkout`, assert `mocks.client.checkoutUrl` was called with `'sales.core'`. `beforeEach` already stubs `mocks.client.checkoutUrl` to resolve `http://hub.test/checkout`, so nothing new is needed in the rig.
This pins the decision to expose the raw client rather than a wrapper, and it is what slice 03 will build on.

**8. `it('marks the active organization in the picker by id when two organizations share a name')`**

Token: `profileToken('Alpha', SAME_NAME_ORGS, 'workspace-alpha-2')`. Mount, flush, `await openWorkspacePicker(container)`.
Assert:
- `workspaceOptions(container)` has length 2 and both rows read `Alpha`, which is the non-vacuity check that the ambiguity really is on screen;
- exactly one row has `aria-selected="true"`;
- it is `workspaceOptions(container)[1]`, the SECOND row.
This is the assertion that fails against the pre-existing name matching implementation, which selects index 0. Write that sentence into the test as a comment.
Also assert the trigger's `textContent` contains `Alpha`, so the rendered label is still the name and never the raw id.

**9. `it('renders the organization picker only when the account has more than one organization')`**

Two mounts in one test is awkward with the shared `container`/`root` bindings, so write two tests:
- `it('renders no organization picker for an account with a single organization')`: token `profileToken('Alpha', [{ workspaceId: 'workspace-alpha', name: 'Alpha' }], 'workspace-alpha')`. Assert `container.querySelector('button[role="combobox"][aria-label="Workspace"]')` is `null`, and that `container.querySelector('button[aria-label="Sair"]')` is NOT null, which proves the component rendered at all rather than the query being wrong.
- `it('renders the organization picker for an account with more than one organization')`: the default two entry preview with `workspace-alpha` active. Assert the trigger exists and its text is `Alpha`.

**10. `it('renders a raw organization id on the muted secondary line')`**

Token: `profileToken('Alpha', [{ workspaceId: 'workspace-alpha', name: 'Alpha' }, { workspaceId: 'workspace-nameless', name: '' }], 'workspace-alpha')`.
Note the second entry's `name` is `''`, which `readString` rejects, so `readWorkspaces` yields `{ id: 'workspace-nameless', name: undefined }` and `isOrgLabelFallback` is true for it. Open the picker and assert that the row for `workspace-nameless` contains a node carrying the `text-muted-foreground` class whose text is `workspace-nameless`, i.e. the `description` line is populated. Do NOT assert the id is absent from the `font-medium` primary line: `orgLabel` falls back to the id by design, so a nameless Organization legitimately shows the id on both lines, and the rule this pins is that the muted secondary line is PRESENT, which is what `isOrgLabelFallback` drives and what the refactor could silently drop.
If the fixture typing makes `name: ''` awkward against the `Array<{ workspaceId?: string; id?: string; name: string }>` parameter type, keep the parameter type as it is and pass `''`; it is a valid `string`.

### What must NOT change in the test file

- Do not add a `workspaceId` argument to any EXISTING `profileToken` call. Every current test then keeps exercising the name fallback, which is what proves the fallback still works and what keeps the four cache oracles and the whole ladder block byte-identical in behaviour.
- Do not touch `renderProvider`, `renderProtected`, `Probe`, `switchWorkspace`, `workspaceTrigger`, `beforeEach` or `afterEach` beyond the additive helpers described above.
- Do not touch `mocks.cache.expiresAt.mockReturnValue(null)` in `beforeEach`. It is what keeps `vi.getTimerCount()` a ladder-only count everywhere outside the renewal block, and nothing in this slice arms or reads a timer.
- The new describe block must not call `vi.useFakeTimers()`. Nothing in it is time dependent, and introducing fake timers into a block that also mounts the provider is how the renewal invariants get perturbed by accident.

## Verification

Named oracle, RUN ONCE, never a watcher:

```
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx
```

`apps/web`'s own `test` script is already `vitest run`, so `pnpm --filter @fxl-sales/web test -- src/auth/__tests__/react.test.tsx` is equally run-once; prefer the `exec vitest run` form above because it names the runner explicitly. Do not invoke a bare `vitest`.

Slice gate, in this order:

```
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web test
```

The last one is the whole web suite, which is what proves the four cache oracles, the ladder block, the renewal block and the sales-ops suites are all untouched.

### Mutation checks the Verify agent should run by hand

Each of these must turn at least one NAMED test red. If any leaves the suite green, the oracle is not doing its job and the slice is not done.

1. Revert `value={active?.id ?? ''}` in `HubUserControls` to the old `organizations.find((o) => o.name === activeName)?.id ?? ''`. Expected red: `marks the active organization in the picker by id when two organizations share a name`.
2. Delete the `workspaceId: readString(claims.workspaceId)` line from `profileFromToken`. Expected red: `surfaces the active organization id from the token claims` and `resolves the active organization by id when two organizations share a name`.
3. Delete the name fallback branch from `useHubOrganizations`, returning `null` when there is no `workspaceId`. Expected red: `falls back to the name claim when the token carries no workspaceId`, plus several pre-existing picker driven tests.
4. Add a `queryClient.clear()` inside the seam's `setActive` path. Expected red: `reaches client.setActive through the seam and flushes the query cache exactly once`.
5. Change `others` to return `[]` when `active` is null. Expected red: `reports no active organization when the token yields neither an id nor a name match`.

## Risks and how they are answered

- **Perturbing the cache oracles.** Answered structurally: this slice adds no cache call anywhere, the new tests are appended after those oracles, and no existing fixture gains a `workspaceId`. Mutation check 4 pins the one way it could go wrong.
- **Perturbing the timer invariants.** Answered by not going near `applyToken`'s control flow, `scheduleRenewal`, `observeToken` or `scheduleRevalidate`. The only edit inside `applyToken` is one additional property on an object literal it already builds.
- **Extra re-renders.** Answered by the alias type (no mapped copy of the preview array) and by three `useMemo` calls whose dependencies are all stable while the token is unchanged.
- **The seam growing.** Answered by the rules block: no state, no flush, no wrapper around `setActive`. If slice 03 or 05 finds it needs something more, the right move is to add a MEMBER to this seam in that slice, not to reach past it into `useHubAuthContext`.
- **Renaming pressure.** `aria-label="Workspace"` and `searchPlaceholder="Buscar workspace..."` are wrong words for a Hub Organization and this slice knowingly leaves them wrong, because changing them is a rendered change that would move an oracle helper. Slice 05 owns that rename.

## Scope limits restated

- No API change. The active Organization id is already in the token.
- No `@fxl-business/hub-sdk` upgrade. The floor stays `^1.3.1`.
- No `?organization=` deep link.
- No edits to `apps/web/src/lib/*`, `apps/web/src/sales-ops/*`, `apps/web/src/components/layout/TopBar.tsx` or anything under `apps/api`.
- No i18n extraction. Strings in this file are hardcoded pt-BR by an existing documented decision, and none are added or changed here.
