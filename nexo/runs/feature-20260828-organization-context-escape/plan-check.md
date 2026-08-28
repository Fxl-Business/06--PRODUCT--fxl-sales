# Plan check - feature-20260828-organization-context-escape

**Verdict: PASS WITH REQUIRED EDITS**

The set reaches the goal and every acceptance clause is owned. It is not shippable as written: slices 03, 04 and 05 were planned against three DIFFERENT assumed shapes of `useOrganizations()`, and slice 02 has since fixed a fourth. Two of those mismatches are hard stops (a compile error and a plan-mandated escalation), and two named oracles are unsatisfiable against the real `orgLabel` / `Combobox` implementations.

## Per-slice verdicts

| Slice | Verdict | Reason |
|---|---|---|
| `01-entitlement-classifier` | GREEN | Every load-bearing claim re-verified true; oracle is non-vacuous; no house-rule breach. |
| `02-organization-seam` | AMBER | Design is sound and the seam is the right shape, but test 10 asserts an id is absent from the primary label line, which `orgLabel`'s id fallback makes false. |
| `03-missing-entitlement-panel` | AMBER | Consumes a seam subset that mostly reconciles, but re-derives `others`, ignores `activeName`, asserts a `font-mono` class the `Combobox` never renders, and repeats slice 02's primary-label mistake. |
| `04-shell-entitlement-branch` | RED | Renders `<MissingEntitlementPanel />` with no props while slice 03 declares a REQUIRED `onRetry` prop (type-check failure), and its "Assumed interface" for `isEntitlementFailure` contradicts slice 01 under a self-imposed STOP rule. |
| `05-shell-organization-switcher` | RED | Codes against `activeOrganizationId`, which slice 02 does not return, under its own rule "if the returned shape differs, the slice STOPS and reports". |

## Verified facts (checked against the tree, not taken from the plans)

- `apps/web/src/lib/require-token.ts:isAuthFailure` is `isAuthTokenUnavailableError(error) || status === 401`. 401 only. CONFIRMED - false for a 402 today.
- Both `apiFetch` (`api-client.ts:41-47`) and `apiFetchBlob` (`:72-78`) do `const body = await res.json().catch(() => ({}))` and build `{error, message, status}`, dropping `code`. Byte-identical blocks. CONFIRMED.
- `grep -rn "402|payment_required|missing_entitlement" apps/api/src` returns exactly ONE line (`middleware/app-auth.ts:172`). CONFIRMED - keying on status 402 alone loses no precision.
- The Hub access token carries `workspaceId` at the TOP LEVEL of the JWT payload: the SDK's `dist/server.js` reads `payload.workspaceId` and throws `workspaceId claim missing` when absent. CONFIRMED. `MinimalHubAuthContext.workspaceId` is a sibling of `claims`, not a member of it, so the overview's phrasing "`app-auth.ts:19` reads exactly that claim" is loose but the underlying fact holds.
- `setActive` (`auth/react.tsx:543-568`) calls `queryClient.clear()` after `await client.setActive(...)` and after the generation check, before `tokenCache.seed`. CONFIRMED.
- `HubUserControls` (`:875-896`) matches the active entry by NAME and destructures `logout` from `useHubAuthContext`, not `useHubLogout()`. CONFIRMED.
- The auth context DOES expose `client: HubClient` (`:104`), so slice 02 can hand it through. CONFIRMED.
- All FIVE files slice 05 names do mock `@/auth/react` with a closed `vi.mock` factory exporting only `useAuthProfile` / `useLogout` (+ `useAccessToken` in three of them): `sales-ops/__tests__/routing.test.tsx:50`, `blank-bearer-token.test.tsx:16`, `cadastros-refresh.test.tsx:21`, `optimistic-row-guard.test.tsx:24`, `src/__tests__/no-role-redirect.test.tsx:37`. CONFIRMED. Only `routing.test.tsx` opens `button[aria-label="Abrir menu da conta"]` (line ~380). CONFIRMED.
- `routing.test.tsx:251` is `container.querySelector('button[title="Trocar workspace"]')` inside `workspaceButton()`. CONFIRMED, and it is the only test literal part B breaks.
- `DropdownMenuContent` does not `forceMount` (`components/ui/dropdown-menu.tsx:63-79`), so slice 05's component-boundary argument holds. CONFIRMED.
- `Check`, `ChevronUp`, `Loader2`, `LogOut` are already imported from `lucide-react` in `SalesOpsApp.tsx`; `Building2` is not. CONFIRMED.
- `combobox-adoption.test.tsx`'s native-picker source guard reads a FIXED four-file list, so a new `sales-ops/MissingEntitlementPanel.tsx` is not auto-scanned. CONFIRMED - no hidden blast radius there.
- No em dash or en dash appears anywhere in the five plan files. CONFIRMED.

## Acceptance coverage (question 1)

| Acceptance clause | Owner | Status |
|---|---|---|
| 402 classified distinctly | 01 | owned |
| "verifique o servidor" unreachable for it | 04 | owned |
| Honest PT-BR state naming the ACTIVE Organization | 03 | owned, weakened by R6 |
| Offers switch, then Hub checkout, in that order | 03 | owned |
| Switch calls `setActive` then refetches, no reload | 03 + 04 | **DOUBLE-OWNED AND CONTRADICTORY** - see R3 |
| Switcher in the sales-ops account dropdown beside `Sair` | 05 | owned |
| Same `setActive` + `workspaces` seam, no duplicated logic | 02 | owned, partly undercut by R6 |
| Empty / single-entry `workspaces` handled honestly | 03 + 05 | owned (different surfaces, correctly) |
| `isLoading` renders a skeleton | 03 (checkout) + 04 (LoadingPanel) | owned |

Nothing is unowned. The one genuine double-ownership is the refetch, and the two owners actively disagree about whether it should happen at all.

## Interface reconciliation (question 2)

Slice 02 lands:

```ts
{ active: Organization | null; activeName: string | undefined; organizations: Organization[];
  others: Organization[]; setActive: (organizationId: string) => Promise<void>; client: HubClient }
```

| Consumer | Field it uses | Against slice 02 |
|---|---|---|
| 03 | `active` | MATCHES (`Organization` is `{id, name?, products?}`) |
| 03 | `organizations` | MATCHES |
| 03 | `setActive` | MATCHES |
| 03 | `client: {checkoutUrl}` | COMPATIBLE (02 hands the full `HubClient`) |
| 03 | derives `others` itself | MISMATCH of intent - 02 exports `others` precisely so no caller re-derives it |
| 03 | never reads `activeName` | MISMATCH - 02 justifies `activeName`'s existence entirely on slice 03's null-`active` copy; as planned it is dead code and 03's `activeUnknown` fires when the name IS known |
| 04 | `<MissingEntitlementPanel />` no props | MISMATCH vs slice 03's required `onRetry` prop - compile error |
| 04 | `isEntitlementFailure` = status 402 AND `code === 'missing_entitlement'` | MISMATCH vs slice 01's status-only predicate, under 04's own "STOP and escalate" rule |
| 05 | `organizations` | MATCHES |
| 05 | `activeOrganizationId: string \| undefined` | **DOES NOT EXIST**. 02 returns `active: Organization \| null`. Hard break, and 05's rule says the slice STOPS rather than reconstructing it |
| 05 | `setActive` | MATCHES |
| 05 | derives `others` itself | Same intent mismatch as 03 |

## Test-mock blast radius (question 3)

Slice 05's five-file claim is TRUE, verified above. Its component-boundary answer is correct: with `useOrganizations()` called inside `AccountOrganizationSection`, only `routing.test.tsx` needs the mock extended, and it is declared in `files_modified`.

Slice 04 accounts for it correctly and explicitly ("`vi.mock` with a factory REPLACES the module, so a missing export throws at render"). Its own new test file declares the extension. Its `files_modified` is complete: `SalesOpsApp.tsx` importing `MissingEntitlementPanel`, which imports `useOrganizations` from a closed-mocked module, is a module-level BINDING and not a property access, so the four untouched files stay green. Vite's test transform rewrites the reference lazily at the call site, and the panel only renders on a 402, which none of those four produce.

Slice 03 does not need to account for it: its test mocks `@/auth/react` itself and no other file imports the new module until slice 04.

**No slice must edit a file it did not declare.** The only `files_modified` risk is slice 03's own noted escape hatch (moving the copy consts to `missing-entitlement-copy.ts`), which the plan already instructs the executor to record.

## Non-vacuity (question 4)

- Slice 01: all six tests discriminate. Test 3 (a 402 with no `code`) is the pin for the design decision and would go red the day someone makes `code` mandatory. The by-hand mutation (delete `code:` from `apiFetchBlob` only) is a real check. GREEN.
- Slice 02: tests 1, 2, 5, 6, 8 all discriminate; the mutation table is honest. Test 10 CANNOT PASS - see R4. Test 6's "flushes exactly once" is slightly artificial (the seam passes `setActive` by reference so the mutation has to invent a wrapper) but it is still a real guard.
- Slice 03: tests 5, 6, 9, 12, 14 are the load-bearing ones and all discriminate. Test 10 CANNOT PASS - see R5. Test 13's parenthetical "the test itself passing is that assertion" is vacuous framing, but the two real assertions beside it carry the test.
- **Slice 04's `not.toContain('Verifique o servidor local')` CAN pass for the wrong reason**: an empty render, a `null` return, or the shell being replaced by any other panel all satisfy it. The plan's mitigation is a positive assertion on "a stable string slice 03 owns" - but it never names one, and defers to "agree it with slice 03's plan". That is exactly the kind of unresolved hand-off that ships as a weak assertion. See R7. A render-time THROW would fail the test loudly under `act`, so that particular wrong reason is covered.
- Slice 05: test 1 is genuinely red today; tests 3, 6 and the three by-hand mutations are well chosen. Test 6 (one non-active entry) is the sharpest and is exactly the case a `organizations.length > 1` guard swallows.

## House rules (question 5)

No violation found.

- No em dash or en dash in any plan file, and every plan carries the rule.
- No native `<select>` / `<option>` / `<datalist>` anywhere. Slice 05's `DropdownMenuItem` reasoning is correct: Radix `menuitem` is not a banned element, the `no-restricted-syntax` rule targets `JSXOpeningElement[name.name="select"|"option"|"datalist"|"input"]`, and `sale-wizard-ui-contract.test.tsx`'s source guards are `<select`, `<option`, `<datalist`, `list="`, `NativeSelect` - none of which the planned markup contains. The nested-input-inside-a-Radix-menu argument against a `Combobox` here is technically right.
- `isLoading` renders a skeleton: satisfied by 03's three-state checkout and by 04 leaving `LoadingPanel` untouched.
- Raw ids: 02, 03 and 05 all route through `orgLabel` / `isOrgLabelFallback`. Note the app-wide nuance that R4/R5 turn on: `orgLabel` FALLS BACK to the id, so the primary line legitimately shows an id for a nameless Organization; the rule is satisfied by the muted secondary line, not by the id being absent from the primary line.
- No API change, no SDK upgrade, no `?organization=` deep link, no entitlement-gate change: all five plans restate the fence and none breaches it.

## Ordering hazards (question 6)

No conflict. Slice 04 edits the `bootstrapQuery.isError` chain (`SalesOpsApp.tsx:1665-1683`); slice 05 edits the import block, the sidebar chrome (`:1339-1385`) and the account dropdown (`:1517-1557`). Disjoint regions of one file, and 05 correctly declares `depends_on: 04` for file safety alone.

Slice 04's `entitlement-dead-end.test.tsx` asserts nothing about the sidebar, the strings `Workspace` / `Trocar workspace`, or the account menu, so slice 05's part B rename cannot redden it. Slice 05's `AccountOrganizationSection` calls `useOrganizations` only once the account menu is open, and slice 04's test never opens it, so 05 does not redden 04 either.

The one thing to watch, which slice 05 already flags: after part A, re-run `sale-wizard-ui-contract.test.tsx`, because it reads `SalesOpsApp.tsx` as raw text and `not.toContain('list="')` would fire on any attribute name ending in `list`.

## Factual errors about the codebase (question 7)

1. Slice 03, "Test contract": "Vitest reads `apps/web/vite.config.ts`, which declares no test environment". WRONG file. `apps/web/vitest.config.ts` exists and is what Vitest reads; it sets `environment: 'node'`. The CONCLUSION (the `// @vitest-environment happy-dom` pragma is required) is correct, so this is a comment-level error only.
2. Overview fact 7 and slice 02 say the API "reads exactly that claim as `orgId`" at `app-auth.ts:19`. Line 19-20 is `workspaceId: string` on `MinimalHubAuthContext`, a SIBLING of `claims`, not a claim read. The real proof is the SDK's `dist/server.js`, which reads `payload.workspaceId` and errors with `workspaceId claim missing`. The fact is TRUE; the citation is not the evidence for it.
3. Slice 02 asserts `Combobox` "sets `aria-selected={option.value === value}` on every row and preserves the caller's order for an empty query". TRUE, verified at `combobox.tsx:268`.
4. Slice 03 asserts the `Combobox` description line is where the id lands. TRUE, but it renders as `text-xs text-muted-foreground` with NO `font-mono` (`combobox.tsx:283`), which its own test 10 contradicts.
5. Every other load-bearing claim I spot-checked (the 402 grep, `isAuthFailure`, `res.json().catch(() => ({}))`, the `queryClient.clear()` placement, the five closed mocks, `routing.test.tsx:251`, the lucide imports, `mutedPanelClass` / `mutedStateClass` / `restoreButtonClass` in `CadastroHistoryPanel.tsx`, `EmptyPanel`'s `min-h-[154px]` footprint, `Carregando dados comerciais`) is accurate.

---

# REQUIRED EDITS

### R1. Slice 05 codes against a field slice 02 does not return

**File:** `nexo/plans/feature-20260828-organization-context-escape/05-shell-organization-switcher.md`

**Section "The seam this slice codes against"** - replace the code block and the two sentences after it with:

```ts
const { active, organizations, others, setActive } = useOrganizations();
// active: { id: string; name?: string; products?: string[] } | null
// organizations: Organization[]  - the account's Organizations, token order
// others: Organization[]         - organizations minus active, derived ONCE in the seam
// setActive: (organizationId: string) => Promise<void>
```

and:

> `organizations` is the same capped, display-only `workspaces` preview claim the auth context already reads in `readWorkspaces`. `active` is resolved from the `workspaceId` top-level token claim that slice 02 adds to the profile, which is why matching is by ID and never by name; it is `null` only when the token yields neither an id nor a name match. `others` is the seam's own `organizations.filter((o) => o.id !== active?.id)`, so this slice does NOT re-derive it. `setActive` is the auth context's existing `setActive`, which already owns the SDK call, the token re-mint and the cache decision.

**Section "Part A - zero, one, and many"** - delete the `const others = organizations.filter(...)` line and its introductory sentence, replacing them with:

> `others` comes straight from the seam. This slice computes no complement of its own; slice 02 derives it once so no caller can reintroduce name matching.

In the same section, replace every occurrence of `activeOrganizationId` with `active?.id`, and replace the bullet heading **`activeOrganizationId` is `undefined`** with **`active` is `null`** (an older token, or the claim is missing).

**Section "Part A - what goes where, and the exact copy"** - the active row is now selected as `organizations.find((organization) => organization.id === active?.id)`, or more simply rendered from `active` itself when `active` is non-null and present in `organizations`. State it as: "The active row renders from the seam's `active` when it is non-null; it is never re-derived from a name."

**Step 4b** - replace the factory addition with:

```ts
  useOrganizations: () => ({
    // One Organization, so the section renders nothing and this file keeps testing
    // exactly what it tested before. The switcher's own cases live in
    // shell-organization-switcher.test.tsx.
    active: { id: 'org-primary', name: 'FXL Matriz' },
    activeName: 'FXL Matriz',
    organizations: [{ id: 'org-primary', name: 'FXL Matriz' }],
    others: [],
    setActive: authMocks.setActive,
    client: { checkoutUrl: vi.fn(async () => 'https://hub.example/checkout') },
  }),
```

**Test contract, tests 4, 5, 6 and 9** - every fixture that sets `activeOrganizationId` must instead set `active` and `others`. Rewrite the fixture paragraph as:

> Fixture: `active = { id: 'org-a', name: 'Alfa Consultoria' }`; `organizations = [active, { id: 'org-b', name: 'Beta Engenharia' }, { id: 'org-c' }]`; `others = organizations.slice(1)`. The mock's `let` bindings are `active`, `organizations` and `others`, and each test sets all three consistently, exactly as the real seam would.

- test 4: `active = { id: 'org-a', name: 'Alfa Consultoria' }`, `organizations = [active]`, `others = []`.
- test 5: `active = { id: 'org-a', name: 'Alfa Consultoria' }`, `organizations = []`, `others = []`.
- test 6: `active = { id: 'org-a', name: 'Alfa Consultoria' }`, `organizations = [{ id: 'org-b', name: 'Beta Engenharia' }]`, `others = organizations`.

**Non-vacuity check 3** - "Change the render guard from `others.length > 0` to `organizations.length > 1`" stays valid as written.

---

### R2. Slice 04's assumed `isEntitlementFailure` contradicts slice 01

**File:** `04-shell-entitlement-branch.md`, section "Assumed interface", item 1.

Replace:

> It returns `true` for an object carrying `status === 402` and `code === 'missing_entitlement'`, and `false` for everything else, including every auth failure.

with:

> It returns `true` for an object carrying `status === 402`, and `false` for everything else, including every auth failure. It keys on the STATUS ALONE and deliberately does NOT require `code`: slice 01 verified by grep that `app-auth.ts:172` is the only 402 the API emits, and requiring `code` would fail CLOSED back onto the "verifique o servidor local" copy whenever the 402 body does not parse (`apiFetch` does `res.json().catch(() => ({}))`). `ApiError.code` is preserved for reading and logging, not for branching.

Without this edit slice 04's own rule ("If a dependency landed with a different shape, STOP and escalate") halts wave 3 on a difference that is intentional and correct.

---

### R3. `onRetry` - a required prop that slice 04 refuses to pass

Slice 03 declares `export function MissingEntitlementPanel({ onRetry }: { onRetry: () => void })`. Slice 04 renders `<MissingEntitlementPanel />` and argues at length that a refetch is actively harmful. As written, wave 3 fails `type-check` on a missing required prop.

**Edit A - `03-missing-entitlement-panel.md`, "Decision 1"**, replace the signature line with:

```tsx
export function MissingEntitlementPanel({ onRetry }: { onRetry?: () => void }) { ... }
```

and append to that decision:

> `onRetry` is OPTIONAL. The shell (slice 04) passes nothing, because `setActive` already runs `queryClient.clear()` after its await, which DESTROYS the query rather than invalidating it, so the mounted `useSalesOpsBootstrap` observer re-subscribes at `status: 'pending'` and fetches on its own; a `refetch()` would leave `status: 'error'` and keep this panel on screen naming the OLD Organization while the new tenant's request is in flight. The prop stays in the signature because it is the seam any future host needs, and because the test drives the ordering guarantee through it.

**Edit B - "Decision 4"**, step 4, replace with:

> 4. On resolve: call `onRetry?.()`. It is called AFTER the await, never before: firing it against the old token would just reproduce the same 402.

**Edit C - "Test contract", test 6**, rename and restate:

> 6. `it('calls onRetry after a successful switch and never before')` - pass an `onRetry` spy; assert it was called once and that its invocation order is AFTER `setActive` resolved (a shared call-order array, not call counts alone). Add test 6b, `it('switches without an onRetry prop and does not throw')`, rendering the panel with NO `onRetry`, clicking a switch row, and asserting `setActive` was called once and no error was thrown. 6b is the exact shape slice 04 mounts.

**Edit D - `04-shell-entitlement-branch.md`, "Assumed interface" item 4**, replace the final sentence:

> If slice 03 shipped a REQUIRED prop, that is a contract conflict between two slices: escalate, do not invent a value here.

with:

> `onRetry` is OPTIONAL on that component by agreement with slice 03, and this slice deliberately passes nothing. See "Refetch wiring" below for why.

---

### R4. Slice 02 test 10 cannot pass: `orgLabel` returns the id as the primary label

`orgLabel({id: 'workspace-nameless'})` is `'workspace-nameless'` (`apps/web/src/lib/displayNames.ts:17-20`), so the `Combobox`'s `font-medium` primary line DOES contain the raw id for a nameless entry. That is the app's existing, intended behaviour, and the CLAUDE.md rule is satisfied by the muted secondary line rather than by the id's absence from the primary one.

**File:** `02-organization-seam.md`, test 10.

Replace:

> Open the picker and assert that the row for `workspace-nameless` renders `workspace-nameless` in a node carrying the `text-muted-foreground` class and NOT in the `font-medium` primary line.

with:

> Open the picker and assert that the row for `workspace-nameless` contains a node carrying the `text-muted-foreground` class whose text is `workspace-nameless`, i.e. the `description` line is populated. Do NOT assert the id is absent from the `font-medium` primary line: `orgLabel` falls back to the id by design, so a nameless Organization legitimately shows the id on both lines, and the rule this pins is that the muted secondary line is PRESENT, which is what `isOrgLabelFallback` drives and what the refactor could silently drop.

---

### R5. Slice 03 test 10 cannot pass: the `Combobox` description carries no `font-mono`

`combobox.tsx:283` renders the description as `<span className="line-clamp-1 text-xs text-muted-foreground">`. There is no `font-mono`, and the primary line carries the id too, for the same `orgLabel` reason as R4.

**File:** `03-missing-entitlement-panel.md`, test 10.

Replace the whole test-10 body with:

> 10. `it('keeps the raw Organization id on the muted secondary line of every picker row')` - `organizations = [orgAtiva, orgSemNome, orgAlfa]`; open the picker; the row for `org-sem-nome` contains a node with class `text-muted-foreground` whose text is `org-sem-nome`, which is the `description` the `isOrgLabelFallback` branch populates. Do NOT assert `font-mono` on that node: the shared `Combobox` renders its description as `text-xs text-muted-foreground` and adding a `font-mono` there would mean editing `components/ui/combobox.tsx`, which this slice may not touch. `font-mono` applies only to the ACTIVE Organization's span in the panel's own copy, which is this slice's own markup and is asserted separately.

Also, in the "identifier law" section, item 1 already specifies `font-mono text-xs text-muted-foreground` for the panel's own active-Organization span. Add an explicit test for it:

> 10b. `it('styles a fallback active Organization label as muted monospace')` - `active = orgSemNome`; the span rendering the active label carries `font-mono` and `text-muted-foreground`.

---

### R6. Slice 03 must consume the seam's `others` and `activeName`

**File:** `03-missing-entitlement-panel.md`.

**"Assumed interface"** - replace the whole block with slice 02's landed shape and add `activeName` and `others`:

```ts
// exported from apps/web/src/auth/react.tsx by slice 02
export type Organization = { id: string; name?: string; products?: string[] };

function useOrganizations(): {
  active: Organization | null;
  activeName: string | undefined;
  organizations: Organization[];
  others: Organization[];
  setActive: (organizationId: string) => Promise<void>;
  client: HubClient;
};
```

and delete the paragraph beginning "If slice 02 does not expose `client`, ..." - it does.

**"Decision 2 - the short cases"** - delete the `const others = organizations.filter(...)` line and the paragraph after it, replacing with:

> `others` comes from the seam. Slice 02 derives it once, and when `active` is `null` it deliberately removes nothing, which is the honest behaviour: offering one extra row is far less harmful than hiding the operator's only escape. This panel does not re-derive it.

**"Exact copy strings"** - `activeUnknown` must no longer fire whenever `active` is `null`. Add this rule directly under the copy table:

> The active label resolves in two steps. When `active` is non-null, it is `orgLabel(active)`. When `active` is `null` but `activeName` is a non-empty string, the panel STILL names the Organization, using `activeName` verbatim on the `activePrefix` / `activeSuffix` copy - that is the entire reason slice 02 exposes the field, and it is the degenerate-token case the feature acceptance ("names the ACTIVE Organization") still has to serve. `activeUnknown` is reserved for `active === null && !activeName`.

**Test contract, test 2** - split it:

> 2. `it('names the active Organization from the name claim when the token carries no id')` - `active = null`, `activeName = 'Acme Holding'`; the section contains `activePrefix` and `Acme Holding` and does NOT contain `activeUnknown`.
> 2b. `it('says the Organization could not be identified when neither an id nor a name is known')` - `active = null`, `activeName = undefined`; renders `activeUnknown`.

---

### R7. Slice 04 must name the panel marker and the full `useOrganizations` stub

**File:** `04-shell-entitlement-branch.md`, "Test contract".

Replace:

> Assert the panel is on screen by a stable string slice 03 owns (prefer a `data-testid` or a heading that slice 03 pins; agree it with slice 03's plan and reference it here rather than inventing a second name).

with:

> Assert the panel is on screen by BOTH of the markers slice 03 owns: `container.querySelector('[data-missing-entitlement]')` is not null, and `container.textContent` contains `FXL Sales não está ativo nesta Organização` (slice 03's `MISSING_ENTITLEMENT_COPY.title`). Slice 03 explicitly forbids `data-testid` in production markup, so `[data-missing-entitlement]` on its `<section>` is the stable hook. Use `[data-missing-entitlement]` as "the entitlement panel marker" in cases 2, 3 and 4 as well. The positive assertion is what stops case 1's `not.toContain('Verifique o servidor local')` from passing because the shell rendered nothing at all.

Replace:

> Give `useOrganizations` a two-entry stub so the panel renders its switch affordance rather than an empty-list state.

with:

```ts
  useOrganizations: () => ({
    active: { id: 'org-a', name: 'Alfa Consultoria' },
    activeName: 'Alfa Consultoria',
    organizations: [
      { id: 'org-a', name: 'Alfa Consultoria' },
      { id: 'org-b', name: 'Beta Engenharia' },
    ],
    others: [{ id: 'org-b', name: 'Beta Engenharia' }],
    setActive: vi.fn(async () => undefined),
    client: { checkoutUrl: vi.fn(async () => 'https://hub.example/checkout') },
  }),
```

> `client.checkoutUrl` is mandatory here: `MissingEntitlementPanel` calls it from a mount effect, and an undefined `client` throws inside that effect rather than failing an assertion, which would read as the routing change being broken.

---

### R8. Slice 03 names the wrong vitest config file

**File:** `03-missing-entitlement-panel.md`, "Test contract - the locked oracle", first paragraph.

Replace:

> Vitest reads `apps/web/vite.config.ts`, which declares no test environment, so the pragma is what supplies the DOM.

with:

> Vitest reads `apps/web/vitest.config.ts`, which sets `environment: 'node'` (it is kept separate from `vite.config.ts` because `vitest/config` resolves a newer vite types version), so the pragma is what supplies the DOM.

---

# OPTIONAL suggestions (not required)

- **S1.** Slice 02's rewritten `profileToken` signature drops the existing multi-line comment above the `workspaces` parameter (the one recording the `id`-versus-`workspaceId` fixture bug). Keep it; the new third-parameter comment restates it but the original sits where it belongs.
- **S2.** Slice 02's `renderOrganizations` duplicates `renderProvider`, which already mounts `<UserControls />`. Adding `<OrganizationProbe />` behind an optional flag on `renderProvider` would be smaller, but the plan's reason for not disturbing a widely used signature is defensible. Either is fine.
- **S3.** Slice 05's switch-row accessible name is `` `Trocar para ${orgLabel(organization)}` ``, which for a nameless Organization interpolates the raw id into an `aria-label` - exactly what slice 03's "identifier law" item 3 forbids for its own button. The two slices should agree. Slice 05's test 8 depends on the current spelling, so changing it means changing that test too; harmonising toward slice 05's spelling (and relaxing slice 03's item 3) is the smaller move.
- **S4.** Slice 04's ROADMAP line about `CadastroHistoryPanel.tsx` is good practice and the out-of-scope argument is correct; consider also noting there that `MissingEntitlementPanel` deliberately has no `MutedBlock`-shaped variant yet.
- **S5.** Slice 01 could add one more assertion pinning that `ApiError.code` is `undefined` (not absent-key-sensitive) for a 200-shaped error body, purely to document the `exactOptionalPropertyTypes` note it already makes in "Anticipated challenges".
- **S6.** Slice 05's threshold of 6 rows / `max-h-[240px]` is asserted nowhere. A cheap test that 8 Organizations all render and the container carries `overflow-y-auto` would make the "nothing is truncated away" claim load-bearing rather than aspirational.
