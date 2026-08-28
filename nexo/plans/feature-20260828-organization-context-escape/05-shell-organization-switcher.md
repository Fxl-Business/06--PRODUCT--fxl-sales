---
id: 05-shell-organization-switcher
milestone: v2.8.0
status: done
depends_on: [04-shell-entitlement-branch]
files_modified: [apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx, apps/web/src/sales-ops/__tests__/routing.test.tsx]
acceptance: "given an operator signed into the sales-ops shell whose account carries more than one Hub Organization, when the sidebar account menu is opened, then it lists the other Organizations beside Sair and choosing one calls the auth context setActive with that Organization's id, with no page reload"
goal: Put the Organization switcher in the sales-ops account dropdown on the slice 02 seam, and rename the sidebar's user-facing "Workspace" strings so the word stops meaning two things in one chrome.
must_not_break:
  - Sair still logs out from the same dropdown, still reads exactly `Sair`, and is still the only destructive item
  - the account dropdown renders unchanged when the account has no other Organization
  - the sidebar Sales view-group menu still switches tatico / operacional / cadastros / meus-dados and still drives the URL
  - every existing test in apps/web, in particular routing.test.tsx, blank-bearer-token.test.tsx, cadastros-refresh.test.tsx, optimistic-row-guard.test.tsx and src/__tests__/no-role-redirect.test.tsx, all of which mock `@/auth/react` with a closed factory
  - sale-wizard-ui-contract.test.tsx, which reads SalesOpsApp.tsx as SOURCE TEXT and asserts `not.toContain` on `<select`, `<option`, `<datalist`, `list="` and `NativeSelect`
  - navigation.test.tsx, which pins `salesOpsWorkspaces` and `getVisibleWorkspaces` by their code identifiers
rules:
  - no em dash and no en dash on any added line, plain hyphen only
  - never a `window.location.reload()` and never a full page reload
  - no `client.setActive` call and no query-cache flush is written in this slice; both belong to the auth provider behind the slice 02 seam
  - never render a raw workspace id as a primary label; use `orgLabel` / `isOrgLabelFallback` from `@/lib/displayNames`, raw id only as muted monospace secondary text
  - display strings only in part B; do NOT rename `SalesOpsWorkspace`, the `workspace` URL segment, `getVisibleWorkspaces`, `salesOpsWorkspaces`, `workspaceForView`, `resolveSalesOpsRoute`, `buildSalesOpsPath`, `workspaceVisuals`, `availableWorkspaces`, `activeWorkspaceMeta`, or any route path
  - do not touch apps/web/src/auth/react.tsx, apps/web/src/lib/*, apps/web/src/sales-ops/navigation.ts or apps/web/src/sales-ops/MissingEntitlementPanel.tsx
  - no API change, no SDK upgrade, no `?organization=` deep link, no entitlement-gate change, no change to /admin/* /finder/* /seller/* /no-role
verifier_focus: that the new oracle genuinely goes red when the Organization section is deleted from the dropdown, and that `setActive` is called with the Organization ID and not with its name or its index
---

# 05 - The Organization switcher in the sales-ops shell, and the "workspace" word collision

## Context

The reported defect is not that Sales cannot switch Organization. It is that the SALES-OPS SHELL cannot. `HubUserControls` (`apps/web/src/auth/react.tsx:875`, exported as `UserControls`) already holds a working switcher, but its ONLY render site is `apps/web/src/components/layout/TopBar.tsx`, which the sales-ops shell never mounts. The sales-ops shell draws its own chrome, and its account dropdown (`SalesOpsApp.tsx:1517-1557`) holds exactly one item, `Sair`.

Nothing in the suite catches this. `routing.test.tsx` opens that dropdown and asserts identity and logout, and passes with the switcher absent, because no test has ever asserted it present. That absent assertion is what this slice exists to add.

Second, smaller, and in the same chrome: the sidebar calls a SALES-INTERNAL view group a `Workspace` (`SalesOpsApp.tsx:1353`, menu heading `Workspaces` at 1385, `title="Trocar workspace"` at 1339, `aria-label={`Workspace: ...`}` at 1363). That is `SalesOpsWorkspace = 'tatico' | 'operacional' | 'cadastros' | 'meus-dados'`, not a Hub Organization. The moment an Organization switcher lands in the same sidebar, the shell shows two different things under one word, and the more prominent of the two, the one with a chevron and a menu, is the one that is NOT the Organization picker.

### Verified facts this plan is built on

- The account dropdown today is `DropdownMenuLabel` (avatar, `userName`, `profile.email`, `roleLabel`), then `DropdownMenuSeparator`, then a `DropdownMenuGroup` holding one `DropdownMenuItem asChild` whose child is a `<button aria-label="Sair">`. Content is `align="start" side="top" sideOffset={10} portalled={false}` with `className="w-[220px] rounded-2xl border-[#e5e5ea] bg-white p-2 text-[#201f24] ..."`. Verified by reading `SalesOpsApp.tsx:1517-1557`.
- The base `DropdownMenuContent` already carries `max-h-[var(--radix-dropdown-menu-content-available-height)] ... overflow-y-auto`. Verified in `apps/web/src/components/ui/dropdown-menu.tsx`.
- `Check`, `ChevronUp`, `Loader2` and `LogOut` are ALREADY imported from `lucide-react` in `SalesOpsApp.tsx`. `Building2` is not, and is the one new icon import.
- `SalesOpsApp.tsx` imports only `{ useAuthProfile, useLogout }` from `@/auth/react` (line 36). It does not import `orgLabel` or `isOrgLabelFallback` today.
- FIVE test files mock `@/auth/react` with a CLOSED `vi.mock` factory (no `importOriginal`) and mount the real `SalesOpsApp`: `sales-ops/__tests__/routing.test.tsx`, `blank-bearer-token.test.tsx`, `cadastros-refresh.test.tsx`, `optimistic-row-guard.test.tsx`, and `src/__tests__/no-role-redirect.test.tsx`. Any hook called from `@/auth/react` at the SalesOpsApp top level is `undefined` in all five and throws on the first render. Only `routing.test.tsx` ever opens the account menu (`button[aria-label="Abrir menu da conta"]`, line 382). This single fact drives the component boundary chosen below.
- `sale-wizard-ui-contract.test.tsx` reads `SalesOpsApp.tsx` with `readFileSync` into `source` and asserts `not.toContain` on `'<select'`, `'<option'`, `'<datalist'`, `'list="'` and `'NativeSelect'`. It asserts NOTHING about the strings `Workspace`, `Workspaces` or `Trocar workspace`. Verified by grepping every `toContain` in that file.
- The ONLY test literal coupled to part B is `routing.test.tsx:251`, `container.querySelector('button[title="Trocar workspace"]')`. Verified with `grep -rn "Trocar workspace\|Workspace:\|Workspaces" apps/web/src`, whose only other hits are code identifiers (`getVisibleWorkspaces`, `salesOpsWorkspaces`, `readWorkspaces`), the `aria-label="Workspace"` on the auth Combobox in the OTHER shell, and prose in comments.

### The seam this slice codes against

Slice 02 exports one hook from `@/auth/react`. This slice consumes exactly this shape and NOTHING else:

```ts
const { active, organizations, others, setActive } = useOrganizations();
// active: { id: string; name?: string; products?: string[] } | null
// organizations: Organization[]  - the account's Organizations, token order
// others: Organization[]         - organizations minus active, derived ONCE in the seam
// setActive: (organizationId: string) => Promise<void>
```

`organizations` is the same capped, display-only `workspaces` preview claim the auth context already reads in `readWorkspaces`. `active` is resolved from the `workspaceId` top-level token claim that slice 02 adds to the profile, which is why matching is by ID and never by name; it is `null` only when the token yields neither an id nor a name match. `others` is the seam's own `organizations.filter((o) => o.id !== active?.id)`, so this slice does NOT re-derive it. `setActive` is the auth context's existing `setActive`, which already owns the SDK call, the token re-mint and the cache decision.

If slice 02 lands the hook under a different exported name, the executor renames the import at the single call site and changes nothing else. No other adaptation is permitted: if the returned shape differs, the slice STOPS and reports, rather than reconstructing the missing part locally.

## Part A - the design decision: bespoke markup, not `UserControls`

**Chosen: option (ii). Bespoke `DropdownMenuItem` markup inside the sales-ops dropdown, on the slice 02 seam, with no switching logic of its own.**

I read both. `HubUserControls` is rejected on four independent grounds, any one of which is sufficient:

1. **It carries its own `Sair`.** It returns a fragment of a `Combobox` AND a `<button aria-label="Sair" title="Sair">`. Rendering it inside this dropdown puts two logout controls in a 220px menu, one of them an icon-only button with no visible label. It also breaks `routing.test.tsx:390`, `expect(container.querySelector('button[aria-label="Sair"]')).toBeNull()` before the menu is opened and the `buttonByText('Sair')` lookup after, which resolves by unique trimmed text content.
2. **Its styling belongs to the other shell.** `border-input bg-background text-muted-foreground hover:bg-accent focus-visible:ring-ring` are shadcn light-theme tokens tuned for `TopBar`'s `bg-background` header row. This dropdown is hand-painted with literal hex (`bg-white`, `text-[#201f24]`, `border-[#e5e5ea]`, `hover:bg-[#f5f5f7]`), hanging off a `#18181b` sidebar.
3. **Its geometry does not fit.** A `w-56` wrapper around an `h-9` Combobox inside a `w-[220px]` menu with `p-2` overflows by design.
4. **It is a flex row, not menu items.** Two siblings meant to sit in a `flex items-center gap-4` header. Dropped into `DropdownMenuContent` they are unreachable by Radix's roving focus and keyboard typeahead, so the menu would contain a control the keyboard cannot get to.

A fifth, process reason: slice 02 REFACTORS `HubUserControls` onto the new hook. Embedding it here would couple this slice's rendered output to another slice's styling decisions in a file this slice may not touch.

What option (ii) explicitly does NOT mean: no `client.setActive`, no `queryClient.clear()` or `invalidateQueries`, no token re-mint, no re-read of the `workspaces` claim, no name-to-id matching. Every one of those lives behind `useOrganizations`. This slice renders rows and calls `setActive(id)`.

## Part A - the picker: a list of `DropdownMenuItem`s, not a `Combobox`

**Chosen: `DropdownMenuItem` rows.**

The CLAUDE.md rule reads: native `<select>`, `<option>` and `<datalist>` are banned, and "every single-select PICKER in `apps/web/src/sales-ops/**` ... uses `Combobox`", because "a browser picker cannot be searched and cannot offer to create the item the operator just typed".

Applying it honestly to this control:

- The ban is on browser-native picker ELEMENTS. A `DropdownMenuItem` is a Radix `menuitem`; it is not `<select>`, `<option>` or `<datalist>`, and it does not trip the `no-restricted-syntax` lint rule or the `sale-wizard-ui-contract.test.tsx` source guards. The ban is satisfied outright.
- The Combobox mandate governs single-select PICKERS: a form control that reads a value, commits it to state, and can offer to create a missing one. This is not one. It is a menu of ACTIONS ("switch this session to that Organization"), each of which is an async side effect on the session, in a surface that is already a menu. It writes no form field and can never offer an `onCreate` row, because creating a Hub Organization is not something this app can do.
- The rule's own stated reason is searchability. Radix's `DropdownMenu` has built-in typeahead: typing characters moves focus to the first matching item. So the list is keyboard-searchable at any length, without a text input.
- The LOCAL PRECEDENT in this exact chrome is the sidebar's own Sales view-group menu (`SalesOpsApp.tsx:1385-1410`): a heading plus one `<button>` per entry with a `Check` on the active one. Making the Organization switcher look like a Combobox and the view-group switcher look like a menu, in the same sidebar, would make the LESS important control the more prominent one.
- The decisive practical argument against a `Combobox` here: Radix `DropdownMenu` installs keydown typeahead and roving focus on its content. A text input nested inside it has its keystrokes consumed by the menu's typeahead and its focus stolen by item navigation. A Combobox in this position is not a styling compromise, it is a broken control.

**Threshold, and what happens above it: 6.** Six rows at roughly 40px is 240px, which is as tall as this section may grow before it pushes `Sair` toward the viewport edge. So the rows are wrapped in a scroll container with `max-h-[240px] overflow-y-auto`: at 6 or fewer nothing scrolls, above 6 the Organization section alone scrolls while the heading, the separator and `Sair` stay fixed and always reachable. Search above the threshold is Radix typeahead, which is unaffected by scrolling. **No row is ever truncated away**: every entry in `organizations` is rendered. Truncating a capped list to a "first N" would recreate, inside the escape hatch, exactly the unreachable-Organization dead end this feature exists to remove.

If the Hub's cap on the `workspaces` claim ever grows past roughly a dozen, the correct response is a dedicated screen, not a text input inside a menu. That is a future decision and is out of scope here; it is recorded in the code comment below so the next reader inherits the reasoning rather than the conclusion.

## Part A - zero, one, and many

`others` comes straight from the seam. This slice computes no complement of its own; slice 02 derives it once so no caller can reintroduce name matching.

The render condition is `others.length > 0`, NOT `organizations.length > 1`.

- **Zero entries in `organizations`** (the claim is absent, or the token carries none): the section renders NOTHING. No heading, no separator, no placeholder, no "nenhuma organização" line. The dropdown is byte-identical to today's. `organizations` is a display-only preview that can legitimately be empty against an older token, and a heading over an empty list would assert that the account has no other Organization, which this claim cannot prove.
- **One entry, which is the active one**: `others` is empty, so again NOTHING renders. A disabled row naming the Organization the operator is already in is not information they can act on, and it is the "empty or pointless picker" the feature acceptance forbids. This also keeps the sales-ops shell consistent with `HubUserControls`, which renders nothing at `length <= 1`.
- **One entry that is NOT the active one**: `others.length === 1`, so the section DOES render, with one switch target. This is why the condition is on `others` and not on `organizations.length > 1`. It is the shape an operator hits when the preview claim lists a single other Organization, and it is the single most important case in the whole feature, because it is the one that gets a stranded operator out.
- **Many**: heading, the active row when it is present, one row per entry in `others`, a separator, then the existing `Sair` group.

**`active` is `null`** (an older token, or the claim is missing): `others` is then the whole list, no row is marked active, and every entry is offered as a switch target. That is the correct failure direction: it offers one redundant switch rather than hiding the one row the operator needed.

## Part A - what goes where, and the exact copy

Order inside `DropdownMenuContent`, top to bottom:

1. `DropdownMenuLabel` with avatar, `userName`, `profile.email`, `roleLabel`. UNCHANGED.
2. The existing `DropdownMenuSeparator className="my-1.5 bg-[#e5e5ea]"`. UNCHANGED.
3. **NEW**: `<AccountOrganizationSection />`. Renders `null` unless `others.length > 0`. When it renders it emits, in order: a heading, the active row (if any), the switch rows, an optional error line, and a trailing `DropdownMenuSeparator className="my-1.5 bg-[#e5e5ea]"`. That trailing separator lives INSIDE the section, so when the section is `null` there is exactly one separator in the menu, as today.
4. The existing `DropdownMenuGroup` holding `Sair`. UNCHANGED, and it stays LAST because it is the destructive action.

Locked copy. These strings are test assertions and must be written exactly:

| Element | String |
|---|---|
| Section heading | `Organização` |
| Active row accessible name | `` `Organização atual: ${orgLabel(organization)}` `` |
| Switch row accessible name | `` `Trocar para ${orgLabel(organization)}` `` |
| Switch failure line | `Não foi possível trocar de organização. Tente novamente.` |

The heading is `Organização`, singular, and it is deliberately NOT the same word as anything part B introduces. Nothing renders the word `Workspace` in this section.

`` `Trocar para ${orgLabel(organization)}` `` is the AGREED SHARED SPELLING for a switch row's accessible name across this slice and slice `03-missing-entitlement-panel`, which states the same agreement in its own "identifier law". The reason it interpolates the label rather than staying a fixed string: `orgLabel` falls back to the raw id BY DESIGN, and an `aria-label` that names the row the operator is about to activate is worth more to a screen reader than one that refuses to name it. A fixed `Trocar de Organização` on every row would make a list of switch targets read as several identical controls. The raw id reaching an `aria-label` in the nameless case is the accepted cost, and the CLAUDE.md UI Identifiers rule is still honoured on screen by the muted monospace secondary line described below.

The active row renders from the seam's `active` when it is non-null; it is never re-derived from a name.

Markup, spelled out so no styling decision is left open:

- Heading: a `<div className="px-2.5 pb-[5px] pt-[7px] text-[10px] font-bold uppercase tracking-[0.1em] text-[#9b9ba3]">Organização</div>`, character-identical in class to the sidebar view-group menu heading at line 1383, so the two menus in this chrome are visibly siblings.
- Scroll container: `<div className="max-h-[240px] overflow-y-auto">` wrapping the rows only.
- Every row is `<DropdownMenuItem asChild>` around a `<button type="button">`, matching how `Sair` is already built in this menu.
- Active row: `disabled` on the `DropdownMenuItem`, `aria-current="true"` and `aria-label={`Organização atual: ${orgLabel(organization)}`}` on the button, a `Check` icon in the leading slot, and `bg-[#eaa81a] font-bold text-[#18181b]` on the label, mirroring the active styling of the view-group menu. `disabled` is what removes it as a switch target: Radix sets `data-disabled` and `pointer-events-none` and will not fire `onSelect`. It is present, marked, and inert.
- Switch rows: leading `Building2` icon at `size-4 text-[#84848c]`, label class `min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[#201f24]`, row class `flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-left outline-none transition hover:bg-[#f5f5f7] focus:bg-[#f5f5f7]`. Neutral, not the red `Sair` palette.
- Primary label is always `orgLabel(organization)`. When `isOrgLabelFallback(organization)` is true, the row gains a SECOND line, `<span className="mt-0.5 block truncate font-mono text-[10.5px] text-[#8b8b92]">{organization.id}</span>`, and the primary line still shows `orgLabel(...)`. That is the CLAUDE.md UI Identifiers rule: a raw id may appear only as muted monospace secondary text, never as the primary label.
- Failure line, rendered below the scroll container when `switchFailed` is true: `<div role="alert" className="px-2.5 pb-1 pt-1.5 text-[11.5px] font-semibold text-[#c93d32]">Não foi possível trocar de organização. Tente novamente.</div>`.

Add `Building2` to the existing `lucide-react` import. Add `orgLabel, isOrgLabelFallback` from `@/lib/displayNames` (import only; that file is not modified). Extend the `@/auth/react` import on line 36 to `{ useAuthProfile, useLogout, useOrganizations }`.

## Part A - in-flight and failure

State lives in `AccountOrganizationSection`, not in `SalesOpsApp`:

```ts
const [switchingTo, setSwitchingTo] = useState<string | null>(null);
const [switchFailed, setSwitchFailed] = useState(false);
const latestSwitch = useRef<string | null>(null);
```

On a switch row's `onSelect`:

1. `event.preventDefault()` FIRST. Radix closes the menu on select by default; preventing it keeps the menu open so the in-flight spinner, and any failure line, are visible where the operator clicked instead of vanishing with the menu.
2. `latestSwitch.current = organization.id; setSwitchingTo(organization.id); setSwitchFailed(false);`
3. `void setActive(organization.id).then(...).catch(...)`.
4. On resolve, and only if `latestSwitch.current === organization.id`: `setSwitchingTo(null)` then close the menu through the `onSwitched` prop, which `SalesOpsApp` wires to `() => setAccountMenuOpen(false)`. The shell's own token-driven refetch does the rest.
5. On reject, and only if `latestSwitch.current === organization.id`: `setSwitchingTo(null); setSwitchFailed(true);`. The menu stays open, every row is re-enabled, the operator can retry or pick a different Organization.

While `switchingTo !== null`, EVERY row in the section is `disabled` and the in-flight row swaps its `Building2` for `<Loader2 className="size-4 animate-spin" />` and carries `aria-busy="true"`. Disabling all of them is what makes a double click, or a second pick during the first switch, impossible: two overlapping `setActive` calls would race to define the session's Organization, and the loser would silently win or lose depending on network timing.

The `latestSwitch` ref is the same discipline CLAUDE.md already documents for the auth provider's own superseded-switch guard. It is why a stale rejection from a switch the operator abandoned cannot paint a failure line about an Organization they are no longer trying to reach.

There is NEVER a `window.location.reload()`, a `location.assign`, a `location.href =`, or any other full document navigation in this slice. `setActive` re-mints the token and the shell re-renders through React state. A reload would throw away the operator's in-progress screen and would hide, behind a white flash, whether the switch actually worked.

## Part A - the component boundary, and why it is load-bearing

`useOrganizations()` MUST be called inside `AccountOrganizationSection`, which is rendered inside `DropdownMenuContent`, and MUST NOT be called at the `SalesOpsApp` top level. Radix does not mount `DropdownMenuContent` while the menu is closed and no `forceMount` is used here, so the hook runs only once the operator opens the account menu.

That is not an optimization. Five existing test files mock `@/auth/react` with a closed factory and mount `SalesOpsApp`; a top-level call turns `useOrganizations` into `undefined()` and reddens all five on the first render. With the hook inside the section, only `routing.test.tsx`, the one file that actually opens the account menu, needs its mock extended, and it is in `files_modified`.

It is also right on its own merits: switch state re-renders a menu section instead of the whole sales-ops shell.

Write this comment verbatim above the component:

```tsx
/**
 * The Organization switcher for the sales-ops shell.
 *
 * The Hub gives each Application its OWN Organization context, so switching in the
 * Hub web does not move this session. Sales anchors on the account's PRIMARY
 * Organization at session mint, and this dropdown was the only account surface the
 * shell has - so an operator whose active Organization does not carry Sales had no
 * way out of the 402 from inside the app. This is that way out.
 *
 * It owns NO switching logic. `useOrganizations` is the single seam: the SDK call,
 * the token re-mint and the cache decision all live in the auth provider behind it.
 * Nothing here may call `client.setActive`, flush a query cache, or reload the page.
 *
 * The hook is called HERE and not in `SalesOpsApp`, because Radix mounts
 * `DropdownMenuContent` only while the menu is open. Hoisting it to the shell would
 * run it on every render of every test that mocks `@/auth/react` with a closed
 * factory and never opens this menu, and there are five of those.
 *
 * Rows are `DropdownMenuItem`s rather than a `Combobox` on purpose. This is a menu of
 * session actions, not a single-select form picker, and it already sits inside a menu:
 * a text input nested in Radix's `DropdownMenu` has its keystrokes eaten by the menu's
 * own typeahead and its focus stolen by roving item navigation. Typeahead is the search
 * affordance, and it works at any list length. Every entry is rendered and the section
 * scrolls past six; nothing is truncated away, because an Organization the operator
 * cannot reach is the exact dead end this whole feature exists to remove. If the Hub's
 * cap on the `workspaces` claim ever grows past roughly a dozen, the answer is a
 * dedicated screen, not an input in a menu.
 */
```

And this one on the render guard:

```tsx
  // `others`, not `organizations.length > 1`. A preview that lists exactly one entry
  // which is NOT the active Organization still has a switch target, and that lone
  // target is the case that unstrands the operator. Zero targets renders nothing at
  // all: `workspaces` is a capped, display-only claim, so an empty list proves the
  // account has no other Organization no better than it proves the claim was absent.
```

## Part B - the "workspace" word collision

### The term: `Painel`

`Área` is rejected, and the suspicion in the brief is confirmed by grep. `Área` is a first-class Sales cadastro ENTITY: `{ id: 'areas', label: 'Áreas' }` in `navigation.ts:67`, the `Áreas` screen title at `SalesOpsApp.tsx:387`, `Área` table headers at 2354 and 2809, the required `Área` field and `aria-label="Área do produto"` in the product dialog, `Sem área`, `selectableAreas`, and `area: 'Área'` in `cadastro-history.ts`. Labelling the shell group `ÁREA` would put that word in the sidebar header three rows above a nav item called `Áreas` that means something entirely different. That is a worse collision than the one being fixed.

`Módulo` is also rejected, and this needs saying because it is not obvious. `Módulos` is already a USER-FACING Sales domain noun in this product: the product dialog composes a produto out of `Módulos` (`title="Módulos"` at 4466, `placeholder="Nome do módulo"`, `aria-label={`Tipo do módulo ${index + 1}`}`, an option literally spelled `'Módulo'` at 4501, `Nenhum módulo adicionado`, and the placeholder `Ex.: Módulo Vendas`). It is ALSO the entitlement vocabulary this very milestone is surfacing: `auth.claims.entitlements.modules`, `sales.core`. Reusing it for app chrome would hang a third meaning on a word that already carries two, one of which this feature is actively putting in front of operators.

`Painel` is chosen. It is not a domain entity anywhere in Sales: no cadastro, no table, no picker, no API field. Its only overlap is the view label `Meu painel`, the `meus-dados` personal dashboard page. That overlap is inside ONE vocabulary, navigation, and it is a containment relation (`PAINEL / Meus dados` above a page called `Meu painel`), not two unrelated entities fighting over a noun. It reads slightly repetitive in the `meus-dados` group; it is never misleading about what anything IS, which is precisely the failure mode `Workspace` has today.

Two decisions that come with the choice, and are not left open:

1. The sidebar group label is SINGULAR (`Painel`) and the menu heading is PLURAL (`Painéis`), so the two levels are visibly different words on screen.
2. `Meu painel` is NOT renamed. It is a `navigation.ts` label, and `navigation.ts` is fenced out of this run.

### Exactly which strings change

Display strings only, all in `SalesOpsApp.tsx`, all inside the sidebar view-group chrome:

| Line | Today | After |
|---|---|---|
| 1339 | `title="Trocar workspace"` | `title="Trocar painel"` |
| 1353 | `Workspace` (the uppercase eyebrow) | `Painel` |
| 1363 | `` aria-label={`Workspace: ${...}`} `` | `` aria-label={`Painel: ${...}`} `` |
| 1376 | `aria-label="Fechar workspaces"` | `aria-label="Fechar painéis"` |
| 1385 | `Workspaces` (the menu heading) | `Painéis` |

Add this comment directly above the eyebrow span:

```tsx
                {/*
                  `Painel`, not `Workspace`. This is a SALES-INTERNAL view group
                  (`SalesOpsWorkspace` in navigation.ts), and the account menu below now
                  holds a real Hub Organization switcher. Two concepts under one word in
                  one sidebar made the bigger, chevroned control read as the Organization
                  picker while being the one that is not. Only the DISPLAY string moved:
                  the type, the `workspace` URL segment and every `navigation.ts` export
                  keep their names, because CLAUDE.md makes the URL the single source of
                  truth for the active Sales workspace and page.
                */}
```

### CRITICAL SCOPE FENCE

**Display strings only.** Do NOT rename, in this slice or any other in this run: the type `SalesOpsWorkspace`, the `workspace` URL segment or any route path, `getVisibleWorkspaces`, `salesOpsWorkspaces`, `getSalesOpsNavigation`, `buildSalesOpsPath`, `getDefaultSalesOpsRoute`, `resolveSalesOpsRoute`, `workspaceForView`, `SalesOpsRoute.workspace`, or the local identifiers `workspace`, `setWorkspace`, `workspaceMenuOpen`, `availableWorkspaces`, `visibleWorkspaceIds`, `activeWorkspaceMeta`, `activeWorkspaceVisual`, `ActiveWorkspaceIcon`, `workspaceVisuals`. `navigation.ts` is owned by no slice in this run and is not in `files_modified`. `navigation.test.ts` pins those identifiers and must stay untouched and green.

### Test files the rename touches

Grep result for `Trocar workspace`, `Workspace:` and `Workspaces` across `apps/web/src`:

- `apps/web/src/sales-ops/__tests__/routing.test.tsx:251` - `container.querySelector('button[title="Trocar workspace"]')` inside `workspaceButton()`. **This is the only test literal that breaks.** Change the selector to `button[title="Trocar painel"]`. Do NOT rename the `workspaceButton` or `expectWorkspace` helper functions; they are code identifiers and renaming them enlarges the diff for nothing.
- `apps/web/src/sales-ops/__tests__/navigation.test.ts` - hits are `getVisibleWorkspaces` and `salesOpsWorkspaces`, code identifiers only. NOT touched.
- `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx:143` - the word appears in a code comment about the `workspaceId` claim shape. NOT touched.
- `apps/web/src/auth/__tests__/react.test.tsx:282` - `button[role="combobox"][aria-label="Workspace"]`, which is the OTHER shell's `HubUserControls`. That label belongs to slice 02 and to `auth/react.tsx`, which this slice may not touch. NOT touched.
- `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx` - asserts nothing about any of these three strings. Its `not.toContain` guards are `<select`, `<option`, `<datalist`, `list="`, `NativeSelect`, `Digite manualmente`, `role: 'Operacional'` and a set of layout classes. **None of the markup added by this slice contains any of them.** The executor must re-check this after writing part A, because that file reads `SalesOpsApp.tsx` as raw text and a stray `list="` attribute anywhere in the file reddens it.

`routing.test.tsx` is therefore IN `files_modified`, for two independent reasons: this selector, and the auth mock extension in step 4 below.

## Implementation

### Step 1 - imports in `SalesOpsApp.tsx`

- Add `Building2` to the `lucide-react` import, alphabetically (it sorts before `Check`).
- Extend line 36 to `import { useAuthProfile, useLogout, useOrganizations } from '@/auth/react';`.
- Add `import { isOrgLabelFallback, orgLabel } from '@/lib/displayNames';` next to the other `@/lib` imports.

### Step 2 - the `AccountOrganizationSection` component

Define it in `SalesOpsApp.tsx` next to the other local shell components, NOT exported. Props: `{ onSwitched: () => void }`. Body exactly as specified in the three Part A sections above, with the two verbatim comments. It returns `null` when `others.length === 0`.

### Step 3 - wire it into the dropdown

Between the existing `DropdownMenuSeparator` (currently `SalesOpsApp.tsx:1542`) and the existing `DropdownMenuGroup` holding `Sair`, insert:

```tsx
              <AccountOrganizationSection onSwitched={() => setAccountMenuOpen(false)} />
```

Change nothing else in `DropdownMenuContent`. `portalled={false}`, `side="top"`, `align="start"`, `sideOffset={10}` and the `w-[220px]` class all stay, because `routing.test.tsx` reaches the menu contents through `container` and `sidebar?.textContent`, which only works while the content is not portalled out of the sidebar.

### Step 4 - `routing.test.tsx`

Two edits, no more:

4a. Line 251, the selector inside `workspaceButton()`: `'button[title="Trocar workspace"]'` becomes `'button[title="Trocar painel"]'`.

4b. Extend the `vi.mock('@/auth/react', ...)` factory with the seam, so opening the account menu does not throw. Add to the existing `authMocks` hoisted block a `setActive: vi.fn(async () => undefined)`, and add to the factory:

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

Single-Organization on purpose: this file's `keeps account identity and logout inside the sidebar account menu` test must keep asserting the unchanged dropdown, and it becomes a free regression pin that the empty case renders nothing.

### Step 5 - part B string edits

The five substitutions in the table above, plus the verbatim comment. Nothing else.

## The test contract - the locked oracle

**New file: `apps/web/src/sales-ops/__tests__/shell-organization-switcher.test.tsx`.** A new file rather than an extension of `routing.test.tsx`, because it needs a per-test `organizations` fixture and a `setActive` spy that `routing.test.tsx`'s module-level closed factory cannot vary without disturbing every routing assertion in it.

Harness: copy `routing.test.tsx`'s. `// @vitest-environment happy-dom` on line 1, `createRoot` into a `container`, the `React.act` shim, `MemoryRouter` with `<Route element={<SalesOpsApp />} path="/:workspace/:view" />`, the same `vi.mock('../hooks', ...)` bootstrap fixture, the same `vi.mock('@/components/ui/dialog', ...)`, roles `['admin']`, and the same `click()` helper that dispatches a bubbling `MouseEvent`. Its `vi.mock('@/auth/react', ...)` factory reads from mutable module-level `let` bindings so each test can set the seam's fields before rendering.

Fixture: `active = { id: 'org-a', name: 'Alfa Consultoria' }`; `organizations = [active, { id: 'org-b', name: 'Beta Engenharia' }, { id: 'org-c' }]`; `others = organizations.slice(1)`. The mock's `let` bindings are `active`, `organizations` and `others`, and each test sets all three consistently, exactly as the real seam would. `org-c` carries no `name`, so the fallback path is covered.

`describe('sales-ops account dropdown Organization switcher')` with these test names, locked:

1. `it('lists the account other Organizations beside Sair')`
   Render `/tatico/dashboard`, click `button[aria-label="Abrir menu da conta"]`. Assert the heading text `Organização` is present in the sidebar, `button[aria-label="Trocar para Beta Engenharia"]` is not null, `button[aria-label="Organização atual: Alfa Consultoria"]` is not null, and a button whose trimmed text is `Sair` is still present. **This is the assertion that is red today and the reason the slice exists.**
2. `it('does not offer the active Organization as a switch target')`
   Same open. Assert `container.querySelector('button[aria-label="Trocar para Alfa Consultoria"]')` is null, and that the active row's enclosing `[role="menuitem"]` carries `data-disabled`.
3. `it('calls setActive with the chosen Organization id')`
   Open, click `button[aria-label="Trocar para Beta Engenharia"]`, assert `setActive` was called exactly once with `'org-b'`. Assert on the ID, never on the name or an index; a switcher that passes the label would pass a looser assertion and fail in production.
4. `it('renders no Organization section and still offers Sair when the account has a single Organization')`
   Set `active = { id: 'org-a', name: 'Alfa Consultoria' }`, `organizations = [active]`, `others = []`. Open. Assert `sidebar?.textContent` does not contain `Organização`, no `button[aria-label^="Trocar para"]` exists, and the `Sair` button is present.
5. `it('renders no Organization section when the workspaces preview is empty')`
   `active = { id: 'org-a', name: 'Alfa Consultoria' }`, `organizations = []`, `others = []`. Same three assertions as 4.
6. `it('offers the single other Organization when the preview lists one that is not active')`
   `active = { id: 'org-a', name: 'Alfa Consultoria' }`, `organizations = [{ id: 'org-b', name: 'Beta Engenharia' }]`, `others = organizations`. Assert `button[aria-label="Trocar para Beta Engenharia"]` is not null. This is the case a `organizations.length > 1` guard would silently swallow.
7. `it('still logs out from the same dropdown')`
   The must-not-break. Open, click the button whose trimmed text is `Sair`, assert the `logout` mock was called once.
8. `it('shows the raw id as muted monospace only, never as the primary label')`
   For `org-c` (no name), assert a `button[aria-label="Trocar para org-c"]` exists and that within it a `span.font-mono` contains `org-c`. Pins the CLAUDE.md UI Identifiers rule.
9. `it('disables every row while a switch is in flight and never reloads the page')`
   Make `setActive` return a promise the test controls. Click a switch row, assert every `[role="menuitem"]` in the section carries `data-disabled` and the clicked row has `aria-busy="true"`, then resolve and assert the rows are enabled again. In the same test, `vi.spyOn` on a stubbed `window.location.reload` and assert it was never called.
10. `it('shows a retryable failure line when setActive rejects and keeps the menu open')`
    `setActive` rejects. Assert `container.textContent` contains `Não foi possível trocar de organização. Tente novamente.`, that `button[aria-label="Trocar para Beta Engenharia"]` is still present and no longer `data-disabled`, and that the `Sair` button is still reachable.
11. `it('no longer labels the Sales view group with the word that now means Organization')`
    Part B. Render `/tatico/dashboard`. Assert `container.querySelector('button[title="Trocar painel"]')` is not null, `container.querySelector('button[title="Trocar workspace"]')` IS null, the sidebar text contains `Painel`, and the sidebar text does NOT contain `Workspace`. Then click the group trigger and assert the menu heading `Painéis` is present and `Workspaces` is not, and that clicking `Cadastros` still lands on `/cadastros/produtos`, which is the proof the rename did not touch routing.
12. `it('renders every Organization above the scroll threshold and truncates none away')`
    `active = { id: 'org-a', name: 'Alfa Consultoria' }`; `organizations` is `active` plus eight further entries `org-b` through `org-i` with distinct names; `others = organizations.slice(1)`. Open the account menu and assert `container.querySelectorAll('button[aria-label^="Trocar para"]')` has length 8, that the LAST of them (`Trocar para ...` for `org-i`) is not null by its own selector, and that the row container carries the `overflow-y-auto` class (`container.querySelector('.max-h-\\[240px\\]')?.className` contains `overflow-y-auto`). This is what makes the plan's claim "no row is ever truncated away" load-bearing rather than aspirational: the threshold of 6 rows and the `max-h-[240px]` cap are otherwise asserted nowhere, and a "first N" implementation would recreate the unreachable-Organization dead end inside the escape hatch itself.

Note for test 9: `setActive` rejecting must be awaited with a `.catch` in the mock's own chain or vitest reports an unhandled rejection. Attach the assertion after an `await flushReact()`.

## Sequencing and dependencies

`depends_on: 04-shell-entitlement-branch`, purely for file safety: both slices edit `SalesOpsApp.tsx` and must not build in parallel. There is no logical dependency, and this slice needs nothing that 04 produces. It DOES need slice 02's `useOrganizations` export to exist, which is satisfied transitively since 02 is wave 1 and 04 is wave 3.

Inside the slice: step 1, then step 2, then step 3, then step 4, then step 5. Part B (step 5 plus test 11) is independent of part A and can be done first if the executor prefers a smaller first diff, but both must land in the same commit because both are display changes to the same chrome and splitting them leaves the sidebar reading as an Organization picker next to a real one.

## Anticipated challenges

- **The five closed `@/auth/react` mocks.** Already the reason for the component boundary. If ANY of the four files not in `files_modified` goes red, the hook has been hoisted out of `AccountOrganizationSection` and the fix is to put it back, NOT to edit those four files.
- **`sale-wizard-ui-contract.test.tsx` reads this file as text.** Re-run it after part A. The `not.toContain('list="')` guard is the one to watch: never write an attribute whose name ends in `list`.
- **Radix `onSelect` versus `onClick`.** `DropdownMenuItem asChild` around a `<button>` gives you both. Use `onSelect` on the `DropdownMenuItem` for the switch rows, because that is the event carrying `preventDefault()` for "keep the menu open". `Sair` keeps its existing `onClick` on the child button, unchanged.
- **happy-dom and `data-disabled`.** Radix writes `data-disabled=""` on a disabled item. Assert with `hasAttribute('data-disabled')`, not `getAttribute(...) === 'true'`.
- **Focus after a failed switch.** Not designed for and deliberately not addressed. Radix restores focus to the item; the `role="alert"` line announces the failure. Do not add a focus-management effect in this slice.
- **The temptation to also render `products` on each row** (to show which Organizations actually carry Sales). Out of scope. `products` is part of the preview claim but showing it here duplicates what `MissingEntitlementPanel` from slice 03 exists to say, and a row that reads "does not have Sales" in a menu whose job is escape would need a whole disabled-with-reason state.

## Verification

Named locked oracle, RUN-ONCE, never a watcher:

```
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/shell-organization-switcher.test.tsx src/sales-ops/__tests__/routing.test.tsx
```

Regression guard for the source-text contract and the four unmodified auth mocks:

```
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx src/sales-ops/__tests__/navigation.test.ts src/sales-ops/__tests__/blank-bearer-token.test.tsx src/sales-ops/__tests__/cadastros-refresh.test.tsx src/sales-ops/__tests__/optimistic-row-guard.test.tsx src/__tests__/no-role-redirect.test.tsx
```

Lint on changed files:

```
pnpm --filter @fxl-sales/web exec eslint src/sales-ops/SalesOpsApp.tsx src/sales-ops/__tests__/shell-organization-switcher.test.tsx src/sales-ops/__tests__/routing.test.tsx
```

Type check:

```
pnpm --filter @fxl-sales/web type-check
```

Non-vacuity checks the Verify agent should run by hand:

1. Delete the `<AccountOrganizationSection ... />` line from `DropdownMenuContent` and re-run the oracle. Tests 1, 2, 3, 6, 8, 9 and 10 must go red. If test 1 stays green, the oracle is not testing the shell.
2. Change `setActive(organization.id)` to `setActive(orgLabel(organization))` and re-run. Test 3 must go red on its own.
3. Change the render guard from `others.length > 0` to `organizations.length > 1` and re-run. Test 6 must go red on its own; if it does not, the one-other-Organization case, which is the case that unstrands the operator, is untested.
