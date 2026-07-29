---
id: 03-combobox-primitive
milestone: v2.3.0
status: todo
depends_on: []
files_modified: [apps/web/src/components/ui/combobox-filter.ts, apps/web/src/components/ui/combobox.tsx, apps/web/src/components/ui/__tests__/combobox.test.tsx]
acceptance: "given a Combobox with options Valéria / Vinícius / Bruno, an onCreate handler and entityLabel \"contato\", when the operator opens it with the keyboard and types \"adsad\", then no option row matches, a single visually prominent row reading `+ Criar novo contato \"adsad\"` is rendered inside the listbox as the active descendant, pressing Enter calls onCreate('adsad') and closes the panel, and pressing Escape instead closes the panel without calling onChange or onCreate"
---

# 03 - Searchable Combobox primitive with an explicit create-new row

## Goal

Add one owned, dependency-free `Combobox` primitive under `apps/web/src/components/ui/` that replaces every picker-shaped control in the app with a searchable panel: a trigger that is visually interchangeable with the existing `Input` / `NativeSelect` boxes, an always-focused search field, diacritic-insensitive filtering, optional group headings and optional secondary description lines per option, full keyboard operation with correct ARIA wiring, and an optional explicit `+ Criar novo <entidade> "<texto>"` row that appears only when a create handler is supplied and the typed text matches no existing option label.
This slice ships the primitive plus its tests only; slice 06 (`combobox-adoption`) swaps the 17 `NativeSelect` call sites and the two `datalist` search-and-create fields onto it, which is why this slice touches no application screen.

## Current state

### There is no combobox today

Grep across `apps/web/src` for `role="combobox"`, `Combobox`, `cmdk` and `Popover` returns zero hits.
The app has exactly two picker shapes, and this primitive must subsume both.

**Shape A - "pick from a list", a raw native `<select>`.**
`apps/web/src/sales-ops/SalesOpsApp.tsx:421-448` defines a local `NativeSelect` wrapper whose `<select>` is at `:437`:

```
'h-10 rounded-md border border-[#dcdce2] bg-[#fafafb] px-3 text-sm font-medium text-[#201f24] outline-none transition focus:border-[#eaa81a] disabled:cursor-not-allowed disabled:opacity-60'
```

It has 17 call sites in that file (`:957`, `:975`, `:1003`, `:1006`, `:2319`, `:2329`, `:2381`, `:2750`, `:2971`, `:3348`, `:3446`, `:4221`, `:4246`, `:4350`, `:4440`, and the rest).
Its API is `{ value: string; onChange: (value: string) => void; children; className?; disabled?; 'aria-label'? }`.
It cannot be searched, which is user item 4.
The shadcn `Select` at `apps/web/src/components/ui/select.tsx` is not used by sales-ops at all, and Radix Select has no search capability either, which is why this slice exists rather than a wrapper over `Select`.

**Shape B - "search or type a new one", an `Input` plus a native `<datalist>`.**
`apps/web/src/sales-ops/SalesOpsApp.tsx:4197-4218` is the client field: a shadcn `Input` with `list="sales-ops-client-options"`, a decorative lucide `Search` icon absolutely positioned at `right-3`, placeholder `"Buscar ou digitar um novo cliente..."`, and a `<datalist>` of `client.name` values.
Matching is exact string equality on `client.name`; an unmatched name leaves `clientId === ''` and the API creates the client server-side on save.
There is no explicit create row and no signal at all that the typed value is new, which is user item 3.
A second datalist exists at `:3085-3089` (`sales-ops-collaborators`) for provider names.

### Styling contract to match

- `apps/web/src/components/ui/input.tsx:4-16` is a 17-line plain `forwardRef` over `<input>` with no icon slots. Its box class is the baseline the trigger must reuse verbatim: `flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background ... focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`.
- `apps/web/src/components/ui/select.tsx:22` is the trigger to mirror for the parts a `<button>` needs that an `<input>` does not: `items-center justify-between`, `data-[placeholder]:text-muted-foreground`, `[&>span]:line-clamp-1`, and the trailing `<ChevronDown className="h-4 w-4 opacity-50" />` at `:29`.
- `apps/web/src/components/ui/label.tsx:5-18` is a Radix `Label` passthrough, so `htmlFor` association is available and `<button>` is a labelable element, meaning `Label htmlFor` pointing at the trigger id gives the control its accessible name.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:142` `formInputClass` and `:144` `formSelectClass` are the two override strings slice 06 will pass through `className`:
  - `formInputClass = 'h-11 rounded-[10px] border-[#dcdce2] bg-[#fafafb] px-3 text-sm text-[#201f24] shadow-none outline-none ring-0 transition focus-visible:border-[#eaa81a] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-[#f4f4f6] disabled:text-[#9b9ba3] disabled:opacity-100'`
  - `formSelectClass = 'h-11 appearance-none rounded-[10px] border-[#dcdce2] bg-[#fafafb] px-3 pr-9 text-sm font-medium text-[#201f24] outline-none transition focus:border-[#eaa81a] disabled:cursor-not-allowed disabled:opacity-60'`
  - Because the trigger merges `className` through `cn` (`apps/web/src/lib/utils.ts:4-6`, `twMerge(clsx(...))`), every conflicting utility in those strings wins over the base: `h-11` beats `h-10`, `rounded-[10px]` beats `rounded-md`, `border-[#dcdce2]` beats `border-input`, `bg-[#fafafb]` beats `bg-background`, `pr-9` beats the right half of `px-3`.
  - Known and accepted residual difference: `formSelectClass` does not neutralise the ring, so a trigger given `formSelectClass` keeps the token `focus-visible:ring-2 focus-visible:ring-ring` that `NativeSelect` never had. That is a keyboard-focus affordance the native select was missing, so it is an improvement rather than drift, and `formInputClass` call sites neutralise it anyway via `ring-0`.

### Dead popover tokens - do not propagate

`select.tsx:78` and `dropdown-menu.tsx:48,72` use `bg-popover text-popover-foreground`, but `popover` is **not** defined in `apps/web/tailwind.config.ts` (`theme.extend.colors` has only `border, input, ring, background, foreground, primary, secondary, muted, accent, destructive, card`) and `--popover` is **not** defined in `apps/web/src/index.css:8-54`.
Those classes therefore emit nothing and those panels render with no explicit background.
The new panel must **not** use `bg-popover`.
Use `border border-border bg-background text-foreground shadow-md`, which are all real tokens.
Fixing `select.tsx` / `dropdown-menu.tsx` is out of scope for this slice; flag it to the human as a follow-up (it would change how those two panels render today).

### Colour of the create row

`grep -rn "bg-primary\|text-primary" apps/web/src/sales-ops/` returns zero hits.
The shadcn `--primary` token is blue (`221 83% 53%`, `index.css:15`) and is unused across the whole sales-ops surface; the product's de-facto primary is the amber `#eaa81a` with text `#9c7210` used by every accent in `SalesOpsApp.tsx` (for example the "Essa proposta teve um finder" affordance at `:4285-4288`).
The reference design for the create row is amber.
**Decision:** the create row uses the sales-ops amber accent literally, `bg-[#fdf7e8] text-[#9c7210]` with the active state `bg-[#f4efe2]`, not `bg-primary`.
Using the token would render a blue row inside an amber UI, which is exactly the visual drift this slice must avoid.

### Test harness reality

- `apps/web/vitest.config.ts` sets `environment: 'node'` and `include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx']`.
- There is no `@testing-library/*` anywhere in the repo. Do **not** plan `render` / `screen` / `userEvent`.
- Component tests opt into a DOM with `// @vitest-environment happy-dom` on line 1 (`happy-dom@20.10.6` is a devDependency) and drive React by hand. The exact idiom to copy is `apps/web/src/sales-ops/__tests__/areas-view.test.tsx:1-6` (pragma and imports), `:26-28` (the `React.act` cast), `:84-99` (`createRoot` / `IS_REACT_ACT_ENVIRONMENT` / unmount) and `:101-107` (native value-setter + `input` event to type into a controlled input).
- `areas-view.test.tsx:9-23` shows that Radix-portalled components have to be `vi.mock`ed down to plain divs in this harness because portals do not work here.
- `apps/web/src/components/ui/__tests__/zz-probe.test.tsx` currently exists **untracked**; it belongs to slice 02's investigation. Do not commit it. Stage only the three paths in `files_modified`.

### Dependency inventory and the decision

Present in `apps/web/package.json`: `@radix-ui/react-{alert-dialog,avatar,dialog,dropdown-menu,label,select,slot,tabs}`, `lucide-react@^0.475.0`, `class-variance-authority`, `clsx`, `tailwind-merge`, `react-hook-form@^7.72.0`, `zod@^3.24.2`, `react@^18.3.1`.
Absent: **`cmdk`** and **`@radix-ui/react-popover`**.

**Decision: add no dependency. Build the panel inline with plain React.**
Rationale, in order of weight:

1. Testability is decisive. Every portalled Radix panel is unreachable in this harness, which is why `areas-view.test.tsx:9-23` mocks the whole dialog module away. A `@radix-ui/react-popover` panel would force the combobox's own tests to mock out the popover, which would mean not testing the panel at all. An inline, non-portalled, absolutely positioned panel renders straight into the test container and every assertion in the Red step below is a direct DOM query.
2. `cmdk` brings its own filtering, its own keyboard model and its own `role`/`aria` output, none of which we could shape to the exact create-row and grouping contract this slice specifies, and it peers on a Radix overlay anyway.
3. Adding a Radix package would also require editing the hardcoded `optimizeDeps.include` list at `apps/web/vite.config.ts:35-49` plus a `pnpm-lock.yaml` change, widening what should be a small atomic commit.
4. Every behaviour required here (filter, arrow navigation, active descendant, outside-click close, escape close) is roughly 60 lines of ordinary React and we want full control of the ARIA output.

Accepted cost: the inline panel has no collision detection, so it always opens downward at `top-full`. See Risks.

### Where the native number spinner cleanup lives

`type="number"` inputs exist at `SalesOpsApp.tsx:2276, 2285, 2314, 2344, 2565, 2775, 2807, 2998, 4296, 4467, 4579` and more.
**They are out of scope for this slice.** Removing the native spinners belongs to slice 06 (`combobox-adoption`), which is the slice that owns call-site changes in `SalesOpsApp.tsx`.
The executor must not touch `SalesOpsApp.tsx` here.
Native `<input type="date">` stays app-wide per the batch overview's "Deliberately excluded" section.

## Component API

### `apps/web/src/components/ui/combobox-filter.ts`

Pure module, no JSX, no React import. Exists as its own file so `combobox.tsx` exports only components and keeps `react-refresh/only-export-components` quiet.

```ts
export type ComboboxOption = {
  /** Stable value handed back through onChange. */
  value: string;
  /** Primary line, and the string the exact-match check for the create row uses. */
  label: string;
  /** Optional secondary line rendered under the label in muted text. */
  description?: string;
  /** Optional group heading. Options sharing a group render under one heading. */
  group?: string;
};

export type ComboboxGroup = {
  /** Stable react key. `'__ungrouped__'` for the headingless bucket. */
  key: string;
  /** null for the headingless bucket, otherwise the heading text. */
  label: string | null;
  options: ComboboxOption[];
};

export type ComboboxFilterResult = {
  /** Groups in render order: the headingless bucket first, then each group in first-appearance order. */
  groups: ComboboxGroup[];
  /** Concatenation of groups[].options in exactly the order they render. Index into this array is the navigable index. */
  filtered: ComboboxOption[];
};

/** Trim, lowercase with pt-BR collation, and strip combining diacritics. */
export function normalizeComboboxText(value: string): string;

/** Filter by normalized substring over `label` and `description`, then group in render order. */
export function buildComboboxFilter(options: ComboboxOption[], query: string): ComboboxFilterResult;

/**
 * True when a create row must be offered: a create handler exists, the trimmed query is
 * non-empty, and no option in the FULL option list has a label that case-insensitively
 * (but diacritic-sensitively) equals the trimmed query.
 */
export function shouldShowCreateRow(
  options: ComboboxOption[],
  query: string,
  hasCreateHandler: boolean,
): boolean;

/** `+ Criar novo contato "adsad"` / `+ Criar nova área "Jurídico"`. */
export function createRowLabel(
  entityLabel: string,
  entityGender: 'm' | 'f',
  query: string,
): string;
```

Exact semantics the executor must implement:

- `normalizeComboboxText(v)` = `v.trim()`, then `.toLocaleLowerCase('pt-BR')`, then `.normalize('NFD')`, then `.replace(<combining-marks regex>, '')` where `<combining-marks regex>` is a global character-class regex covering the Unicode combining diacritical marks block, code points U+0300 through U+036F. Write that range with JavaScript unicode escapes inside the character class, never as literal combining characters, so the source file stays ASCII in that spot.
- `buildComboboxFilter`: when `normalizeComboboxText(query) === ''` every option passes. Otherwise an option passes when `normalizeComboboxText(`${option.label} ${option.description ?? ''}`)` contains the normalized query. Filtering is diacritic-insensitive so `valeria` finds `Valéria`.
- Grouping: iterate the surviving options once in input order. Options with no `group` (or `group === ''`) go into the `'__ungrouped__'` bucket. Grouped options go into a bucket keyed by the group string. `groups` is `[ungrouped bucket if non-empty, ...group buckets in first-appearance order]`. `filtered` is `groups.flatMap(g => g.options)`.
- `shouldShowCreateRow`: `hasCreateHandler && query.trim() !== '' && !options.some(o => o.label.trim().toLocaleLowerCase('pt-BR') === query.trim().toLocaleLowerCase('pt-BR'))`. Note the deliberate asymmetry: filtering strips diacritics, the exact-match check does **not**, because `Valeria` and `Valéria` are different names and typing one must still offer to create it.
- `createRowLabel('contato', 'm', ' adsad ')` returns `'+ Criar novo contato "adsad"'`; `createRowLabel('área', 'f', 'Jurídico')` returns `'+ Criar nova área "Jurídico"'`. The leading `+ ` is a literal text node, not an icon, so the row's `textContent` is exactly the reference string.

### `apps/web/src/components/ui/combobox.tsx`

```tsx
export type { ComboboxOption } from './combobox-filter';

export type ComboboxProps = {
  /** Options in preferred order. Rendering order is derived by buildComboboxFilter. */
  options: ComboboxOption[];
  /** Controlled value. null or '' means nothing selected. */
  value: string | null;
  /** Fired with the chosen option's `value`. Never fired for the create row. */
  onChange: (value: string) => void;

  /**
   * When provided, the create row is offered. Receives the trimmed query.
   * The primitive does NOT mutate `value` on create; the caller decides what to do.
   */
  onCreate?: (query: string) => void;
  /** Noun for the create row, e.g. 'contato', 'cliente', 'área'. Default 'item'. Required in practice whenever onCreate is set. */
  entityLabel?: string;
  /** pt-BR gender agreement for the create row: 'm' -> "novo", 'f' -> "nova". Default 'm'. */
  entityGender?: 'm' | 'f';

  /** Trigger id. Point a `<Label htmlFor>` at it. Falls back to React.useId(). */
  id?: string;
  /** Trigger text when nothing is selected. Default 'Selecionar...'. */
  placeholder?: string;
  /** Trigger text when `value` matches no option, e.g. a freshly typed name not yet in the list. */
  valueLabel?: string;
  /** Search field placeholder and its aria-label. Default 'Buscar...'. */
  searchPlaceholder?: string;
  /** Shown when nothing matches and no create row is offered. Default 'Nenhum resultado encontrado.'. */
  emptyMessage?: string;

  disabled?: boolean;
  /** Merged onto the trigger through `cn`, so sales-ops can pass formInputClass / formSelectClass. */
  className?: string;
  /** Merged onto the floating panel through `cn`. */
  panelClassName?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
};

export declare const Combobox: React.ForwardRefExoticComponent<
  ComboboxProps & React.RefAttributes<HTMLButtonElement>
>;
```

Single-select only. No multi-select, no `disabled` per option, no clear button, no `onOpenChange`, no async loading state, no `keywords`. None of those have a call site in this batch.

### Behaviour contract - all of it, no executor judgement left

**Ids.** `const baseId = id ?? React.useId()` used for the trigger. Derived ids: listbox `${baseId}-listbox`, search field `${baseId}-search`, option `${baseId}-option-${index}` where `index` is the position in `filtered`, create row `${baseId}-create`, group heading `${baseId}-group-${groupKeyIndex}`.

**Trigger label.** `options.find(o => o.value === value)?.label` if found, else `valueLabel` if non-empty, else `placeholder`. When the resolved text is the placeholder the trigger carries `data-placeholder=""` so `data-[placeholder]:text-muted-foreground` applies.

**Navigable rows.** `navigable = showCreate ? [...filtered, CREATE] : [...filtered]`. The create row is therefore the **last** navigable index, `filtered.length`.

**Create row placement.** The create row is rendered as a pinned footer inside the listbox element, in a `role="presentation"` wrapper that sits **outside** the scrollable options area, separated by `border-t border-border`. It is always visible without scrolling. When nothing matches, the options area is empty, so the create row sits directly under the search field exactly as the reference design shows; when matches exist it is pinned at the bottom of the panel and stays on screen. It is reachable by keyboard as the last row and by mouse click.

**Open.** Click, or `Enter` / `' '` / `ArrowDown` / `ArrowUp` keydown on the trigger, opens the panel. `disabled` blocks all of it. Typing a printable character on the trigger does **not** open it; that is out of scope.

**On open.** `query` resets to `''`. `activeIndex` = the position of the currently selected value in `filtered`, or `0` if not found. A layout effect focuses the search field.

**Search field keydown.**
| Key | Behaviour |
| --- | --- |
| `ArrowDown` | `preventDefault`; `activeIndex = (activeIndex + 1) % navigable.length`; wraps from last to first. No-op when `navigable.length === 0`. |
| `ArrowUp` | `preventDefault`; `activeIndex = (activeIndex - 1 + navigable.length) % navigable.length`; wraps from first to last. No-op when empty. |
| `Enter` | `preventDefault` **always**, so a surrounding `<form>` never submits. Commits the active row if there is one; otherwise does nothing further. |
| `Escape` | `preventDefault()`, `stopPropagation()`, and `event.nativeEvent.stopImmediatePropagation()`. Closes without selecting, returns focus to the trigger. The three calls together stop the Escape from also closing a surrounding Radix `Dialog`. |
| `Tab` | Does **not** `preventDefault`. Closes the panel and lets focus move on naturally. Does not select. |
| anything else | Falls through to the input's normal typing. |

`Home`, `End`, `PageUp`, `PageDown`, and type-ahead on the trigger are out of scope.

**Query change.** Any change to the search field sets `activeIndex = 0`.

**Commit an option.** `onChange(option.value)`, close, return focus to the trigger.
**Commit the create row.** `onCreate(query.trim())`, close, return focus to the trigger. `onChange` is **not** called. `query` is not preserved.

**Mouse.** Option and create rows are `<div>` (not `<button>`, which is invalid inside a listbox). Each has `onMouseMove` setting `activeIndex` to its own index, `onMouseDown` calling `preventDefault()` so the search field keeps focus, and `onClick` committing.

**Outside close.** While open, a `mousedown` listener on `document` closes the panel when `event.target` is outside the wrapper element, without changing the value. Use `mousedown`, not `pointerdown`, so it never races Radix's own `pointerdown` dismissal machinery. Attach in an effect, remove on cleanup and on close.

**Active row scrolling.** In an effect keyed on `activeIndex` and `open`, do `panelRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })`. The optional call guards happy-dom, which does not implement `scrollIntoView`.

**ARIA.**
- Trigger: `type="button"`, `role="combobox"`, `aria-expanded={open}`, `aria-haspopup="listbox"`, `aria-controls={listboxId}` **only while open** (a dangling `aria-controls` would reference a non-existent element), `id={baseId}`, plus passthrough `aria-label`, `aria-labelledby`, `aria-describedby`.
- Search field: `type="text"`, `id={`${baseId}-search`}`, `aria-label={searchPlaceholder}`, `aria-autocomplete="list"`, `aria-controls={listboxId}`, `aria-activedescendant` = the active row's id, or omitted when `navigable.length === 0`.
- Listbox element: `id={listboxId}`, `role="listbox"`, `aria-labelledby={baseId}` so it inherits the trigger's name.
- Scroll area wrapper and the create-row footer wrapper: `role="presentation"`, so their children are promoted into the listbox.
- Grouped options: a `role="group"` wrapper with `aria-labelledby` pointing at its heading div. The headingless bucket renders its options as direct children with no wrapper.
- Option rows: `role="option"`, `aria-selected={option.value === value}`, `data-active="true"` when active (attribute omitted otherwise).
- Create row: `role="option"`, `aria-selected={false}`, `data-combobox-create="true"`, `data-active` like any other row.
- Empty state: a plain `<div>` with no role, rendered inside the scroll area when `filtered.length === 0 && !showCreate`.

**Exact class strings.**

Wrapper: `className="relative w-full"`.

Trigger, base half of `cn(...)`:

```
'flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground [&>span]:line-clamp-1'
```

This is `input.tsx:10`'s box plus the three things `select.tsx:22` adds for a button trigger. `focus-visible:` is used rather than `select.tsx`'s `focus:` because the trigger is a button and a mouse click must not paint a ring; this is a deliberate divergence from `select.tsx`.

Trigger children: `<span>{triggerText}</span>` then `<ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 opacity-50" />` (same icon and sizing as `select.tsx:29`).

Panel, base half of `cn(...)`:

```
'absolute left-0 top-full z-50 mt-1 w-full overflow-hidden rounded-md border border-border bg-background text-foreground shadow-md'
```

Search row: `'flex items-center gap-2 border-b border-border px-3'`, holding `<Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />` (lucide, same icon the current client field uses at `SalesOpsApp.tsx:4210`) and the input at `'h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'`.

Listbox: `'flex max-h-72 flex-col'`. Scroll area: `'min-h-0 flex-1 overflow-y-auto p-1'`.

Group heading: `'px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground'`.

Option row: `cn('flex cursor-pointer select-none flex-col gap-0.5 rounded-sm px-2 py-1.5 text-sm outline-none', isActive && 'bg-accent text-accent-foreground')`, with `<span className="line-clamp-1 font-medium">{label}</span>` and, when `description` is set, `<span className="line-clamp-1 text-xs text-muted-foreground">{description}</span>`.

Create-row footer wrapper: `'border-t border-border p-1'`.
Create row: `cn('flex cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm font-semibold text-[#9c7210]', isActive ? 'bg-[#f4efe2]' : 'bg-[#fdf7e8]')`, with a single `<span className="line-clamp-1">{createRowLabel(...)}</span>`.

Empty state: `'px-3 py-6 text-center text-sm text-muted-foreground'`.

## Red

Write `apps/web/src/components/ui/__tests__/combobox.test.tsx` first and watch it fail.

**ORACLE**

```bash
pnpm --filter @fxl-sales/web test -- --run src/components/ui/__tests__/combobox.test.tsx
```

**Full gate before handing off**

```bash
pnpm run lint && pnpm run type-check && CI=true pnpm test
```

### Harness boilerplate (copy the idiom, do not invent)

- Line 1 is `// @vitest-environment happy-dom`.
- Import `* as React`, `createRoot`/`type Root` from `react-dom/client`, and `afterEach, beforeEach, describe, expect, it, vi` from `vitest`.
- `const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;` exactly as `areas-view.test.tsx:26-28`.
- `beforeEach` sets `IS_REACT_ACT_ENVIRONMENT = true`, creates `container`, appends it to `document.body`, `root = createRoot(container)`. `afterEach` unmounts inside `act`, removes the container, `vi.restoreAllMocks()`. Copy `areas-view.test.tsx:84-99`.
- No `vi.mock` of anything. The panel is inline, so it lives inside `container`.
- Local helpers to write once at the top of the file:
  - `const OPTIONS: ComboboxOption[] = [{ value: 'v1', label: 'Valéria', description: 'Clínica de Psicologia', group: 'Contatos' }, { value: 'v2', label: 'Vinícius', group: 'Contatos' }, { value: 'v3', label: 'Bruno', description: 'Bruno Consultoria', group: 'Empresas' }]`
  - `async function renderCombobox(props: Partial<ComboboxProps> = {})` renders `<Combobox onChange={onChange} options={OPTIONS} value={null} {...props} />` inside `act` and returns the spies it created.
  - `function trigger(): HTMLButtonElement` -> `container.querySelector('[role="combobox"]')`, throwing when absent.
  - `function panelSearch(): HTMLInputElement` -> `container.querySelector('input[type="text"]')`, throwing when absent.
  - `function listbox(): HTMLElement | null` -> `container.querySelector('[role="listbox"]')`.
  - `function optionRows(): HTMLElement[]` -> `[...container.querySelectorAll('[role="option"]')]`.
  - `function createRow(): HTMLElement | null` -> `container.querySelector('[data-combobox-create="true"]')`.
  - `async function click(el: Element)` dispatches `new MouseEvent('click', { bubbles: true, cancelable: true })` inside `act`.
  - `async function type(value: string)` uses the native `HTMLInputElement.prototype.value` setter plus `new Event('input', { bubbles: true })` inside `act`, exactly like `areas-view.test.tsx:101-107`.
  - `async function key(el: Element, k: string): Promise<KeyboardEvent>` builds `new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })`, dispatches it inside `act`, and returns the event so tests can assert `defaultPrevented`.
  - `async function open()` clicks the trigger.

### Tests - `describe('Combobox', ...)`

1. `'renders a closed trigger with the placeholder and no listbox'` - `trigger()` has `role="combobox"`, `aria-expanded === 'false'`, `aria-haspopup === 'listbox'`, no `aria-controls` attribute, `textContent` contains `'Selecionar...'`, and `listbox()` is `null`.
2. `'renders the selected option label on the trigger'` - `value: 'v1'` -> trigger `textContent` contains `'Valéria'`, does not contain `'Selecionar...'`, and the trigger has no `data-placeholder` attribute.
3. `'falls back to valueLabel when the value matches no option'` - `value: 'novo-1', valueLabel: 'Cliente Novo'` -> trigger `textContent` contains `'Cliente Novo'`.
4. `'opens on trigger click, focuses the search field and wires aria-controls'` - after `open()`: `listbox()` is not null with `id` ending `-listbox`, trigger `aria-expanded === 'true'` and `aria-controls` equals that id, `document.activeElement === panelSearch()`, and `optionRows()` has length 3.
5. `'opens on ArrowDown, Enter and Space from the trigger'` - three sub-assertions using fresh renders (or close between them): each key on the trigger produces a non-null `listbox()`.
6. `'filters options ignoring case and diacritics'` - open, `type('valeria')` -> `optionRows()` length 1 and its text contains `'Valéria'`. Then `type('NI')` -> length 1 and text contains `'Vinícius'`. Then `type('')` -> length 3.
7. `'renders group headings and the secondary description line'` - open, panel `textContent` contains `'Contatos'`, `'Empresas'` and `'Clínica de Psicologia'`; the panel has exactly two `[role="group"]` elements; each group's `aria-labelledby` resolves to an existing element inside the panel; `optionRows()` still has length 3 (headings are not options).
8. `'shows the create row with the typed query when nothing matches'` - `onCreate` spy and `entityLabel: 'contato'`, open, `type('adsad')` -> `createRow()` is not null, its `textContent!.trim()` is exactly `'+ Criar novo contato "adsad"'`, `optionRows()` has length 1 and `optionRows()[0] === createRow()`.
9. `'uses feminine agreement when entityGender is f'` - `entityLabel: 'área', entityGender: 'f'`, `type('Jurídico')` -> create row text is exactly `'+ Criar nova área "Jurídico"'`.
10. `'keeps the create row visible below the filtered options when some match'` - `onCreate` set, `type('Val')` -> `optionRows()` length 2, `optionRows()[0]` text contains `'Valéria'`, `optionRows()[1] === createRow()`, and the create row is **not** a descendant of the scrollable area (assert `createRow()!.closest('.overflow-y-auto') === null`).
11. `'hides the create row when the query exactly matches an existing option label'` - `type('Valéria')` -> `createRow()` is `null` and `optionRows()` has length 1. Also assert `type('  valéria  ')` still hides it (trim plus case-insensitive).
12. `'shows the create row when the query differs from an option only by an accent'` - `type('Valeria')` -> `createRow()` is not null, and `optionRows()` also contains the `Valéria` row (diacritic-insensitive filtering, diacritic-sensitive exact match).
13. `'hides the create row when the query is empty or whitespace only'` - `type('   ')` -> `createRow()` is `null` and `optionRows()` has length 3.
14. `'shows the empty state instead of a create row when onCreate is absent'` - no `onCreate`, `type('zzz')` -> panel `textContent` contains `'Nenhum resultado encontrado.'`, `createRow()` is `null`, `optionRows()` has length 0.
15. `'selects an option with the mouse, closes the panel and restores focus'` - open, `click(optionRows()[1])` -> `onChange` called once with `'v2'`, `listbox()` is `null`, trigger `aria-expanded === 'false'`, `document.activeElement === trigger()`.
16. `'moves the active row with ArrowDown and ArrowUp and reflects it in aria-activedescendant'` - open (nothing selected, so index 0 active): `panelSearch().getAttribute('aria-activedescendant')` equals `optionRows()[0].id`. `key(panelSearch(), 'ArrowDown')` twice -> equals `optionRows()[2].id` and that row has `data-active === 'true'` while the others do not. `key(..., 'ArrowUp')` once -> equals `optionRows()[1].id`. Then `key(..., 'Enter')` -> `onChange` called with `'v2'` and `listbox()` is `null`.
17. `'wraps the active row at both ends'` - open, `key(..., 'ArrowUp')` -> active descendant is `optionRows()[2].id`. `key(..., 'ArrowDown')` -> back to `optionRows()[0].id`.
18. `'starts with the selected option active when reopening'` - `value: 'v3'`, open -> active descendant is the id of the row whose text contains `'Bruno'`.
19. `'selects the create row with Enter when it is the active row'` - `onCreate` spy, `entityLabel: 'cliente'`, open, `type('Cliente Novo')` (matches nothing, so the create row is the only row and is active) -> `key(panelSearch(), 'Enter')` calls `onCreate` once with `'Cliente Novo'`, `onChange` is not called, `listbox()` is `null`, `document.activeElement === trigger()`.
20. `'closes on Escape without selecting and stops the event from reaching an ancestor'` - render the combobox inside a wrapper element that carries a React `onKeyDown` spy. Open, `type('Val')`, then `key(panelSearch(), 'Escape')` -> `listbox()` is `null`, `onChange` and `onCreate` not called, `document.activeElement === trigger()`, the ancestor spy was not called, and the returned event has `defaultPrevented === true`.
21. `'closes on outside mousedown without changing the value'` - open, then inside `act` dispatch `new MouseEvent('mousedown', { bubbles: true })` on `document.body` -> `listbox()` is `null`, `onChange` not called.
22. `'closes on Tab without selecting and lets focus move on'` - open, `const ev = await key(panelSearch(), 'Tab')` -> `listbox()` is `null`, `onChange` not called, `ev.defaultPrevented === false`.
23. `'never submits a surrounding form on Enter'` - render the combobox inside `<form onSubmit={submitSpy}>`, no `onCreate`, open, `type('zzz')` (no rows), `const ev = await key(panelSearch(), 'Enter')` -> `submitSpy` not called and `ev.defaultPrevented === true`.
24. `'resets the query and the active row on every open'` - open, `type('valeria')`, `key(..., 'Escape')`, `open()` again -> `panelSearch().value === ''` and `optionRows()` has length 3.
25. `'does not open when disabled'` - `disabled: true` -> `trigger().disabled === true`, `open()` leaves `listbox()` null.
26. `'takes its accessible name from a Label through htmlFor and forwards aria-labelledby'` - render `<><Label htmlFor="cliente-cb" id="cliente-cb-label">Cliente</Label><Combobox aria-labelledby="cliente-cb-label" id="cliente-cb" ... /></>` -> `trigger().id === 'cliente-cb'`, `container.querySelector('label[for="cliente-cb"]')!.textContent === 'Cliente'`, `trigger().getAttribute('aria-labelledby') === 'cliente-cb-label'`. Open, then `listbox()!.getAttribute('aria-labelledby') === 'cliente-cb'` and `panelSearch().getAttribute('aria-label') === 'Buscar...'` and `panelSearch().getAttribute('aria-autocomplete') === 'list'`.
27. `'matches the Input box styling and lets a caller className win'` - default render: `trigger().className` contains all of `h-10`, `w-full`, `rounded-md`, `border-input`, `bg-background`, `text-sm`, `ring-offset-background`, `focus-visible:ring-2`, `data-[placeholder]:text-muted-foreground`. Then re-render with `className: 'h-11 rounded-[10px] border-[#dcdce2] bg-[#fafafb] pr-9'` and assert the merged result contains `h-11`, `rounded-[10px]`, `border-[#dcdce2]`, `bg-[#fafafb]`, `pr-9` and does **not** contain `h-10`, `rounded-md`, `border-input` or `bg-background`.

## Green

1. Create `apps/web/src/components/ui/combobox-filter.ts` with the five exports and the exact semantics in Component API. Pure TypeScript, no React, no JSX, no `any`.
2. Create `apps/web/src/components/ui/combobox.tsx`. Imports: `* as React`, `{ ChevronDown, Search } from 'lucide-react'`, `{ cn } from '@/lib/utils'`, and `{ buildComboboxFilter, createRowLabel, shouldShowCreateRow, type ComboboxOption } from './combobox-filter'`. Re-export `export type { ComboboxOption };`.
3. Declare `ComboboxProps` exactly as specified and `export const Combobox = React.forwardRef<HTMLButtonElement, ComboboxProps>((props, forwardedRef) => { ... })` with `Combobox.displayName = 'Combobox'`.
4. State and refs: `const [open, setOpen] = React.useState(false)`, `const [query, setQuery] = React.useState('')`, `const [activeIndex, setActiveIndex] = React.useState(0)`, `wrapperRef`, `triggerRef`, `searchRef`, `panelRef`. Merge `forwardedRef` onto the trigger with a callback ref that assigns `triggerRef.current` and then applies `forwardedRef` (function or object form).
5. Derive, memoized on `options` and `query`: `const { groups, filtered } = buildComboboxFilter(options, query)`, `const showCreate = shouldShowCreateRow(options, query, Boolean(onCreate))`, `const navigableCount = filtered.length + (showCreate ? 1 : 0)`, `const createIndex = filtered.length`.
6. Derive ids from `const reactId = React.useId()` and `const baseId = id ?? reactId`, per the Ids contract.
7. Derive `activeDescendantId`: `undefined` when `navigableCount === 0`; the create row id when `showCreate && activeIndex === createIndex`; otherwise `optionId(activeIndex)`.
8. `openPanel()`: if `disabled` return; `setQuery('')`; `setActiveIndex(Math.max(0, filtered.length ? options.findIndex(...) : 0))` computed against the unfiltered list rendered in `buildComboboxFilter(options, '').filtered` so the selected row's render index is used, defaulting to `0`; `setOpen(true)`.
9. `closePanel({ focusTrigger })`: `setOpen(false)`; when `focusTrigger` is true, `triggerRef.current?.focus()`.
10. A layout effect keyed on `open` focuses `searchRef.current` when the panel opens.
11. An effect keyed on `open` attaches a `mousedown` listener on `document` while open that closes the panel (without refocusing the trigger) when `wrapperRef.current` does not contain `event.target`. Clean it up on unmount and whenever `open` goes false.
12. An effect keyed on `open` and `activeIndex` does the guarded `scrollIntoView` described in the behaviour contract.
13. `commitOption(option)` -> `onChange(option.value)` then `closePanel({ focusTrigger: true })`. `commitCreate()` -> `onCreate?.(query.trim())` then `closePanel({ focusTrigger: true })`. `commitActive()` -> dispatch on `activeIndex` versus `createIndex`, no-op when `navigableCount === 0`.
14. `handleTriggerKeyDown` implements the Open rules. `handleSearchKeyDown` implements the whole Search field keydown table verbatim, including the three Escape calls and the unconditional `preventDefault` on Enter.
15. `handleQueryChange` sets `query` and resets `activeIndex` to `0`.
16. Render the wrapper, the trigger, and (only when `open`) the panel, using the exact class strings and the exact ARIA attribute set from the behaviour contract. Build `aria-controls` on the trigger with `open ? listboxId : undefined` so React drops the attribute when closed.
17. Render the listbox as `[scroll area role="presentation"]` + optional `[create footer role="presentation"]`. Inside the scroll area, map `groups`: the `'__ungrouped__'` bucket renders its options bare, every other bucket renders a `role="group"` wrapper with a heading. Track the running render index so option ids and `data-active` line up with the `filtered` index.
18. Render the empty-state div inside the scroll area when `filtered.length === 0 && !showCreate`.
19. Run the ORACLE until green, then run the full gate. Fix any `@typescript-eslint/no-explicit-any` or `react-hooks` findings the run reports.
20. Stage exactly the three paths in `files_modified` and commit as one atomic commit, for example `feat(ui): add searchable Combobox primitive with explicit create-new row`. Do **not** stage `apps/web/src/components/ui/__tests__/zz-probe.test.tsx` or `.vscode/`.

## Refactor

- Keep `combobox.tsx` under roughly 260 lines. If the render body grows past that, extract the panel body into a local, non-exported `ComboboxPanel` function inside the same file rather than a new module, so the react-refresh export surface stays a single component.
- Collapse the option row and the create row onto one internal `Row` local component only if it does not force conditional class soup. Two small explicit JSX blocks are preferred over one branchy one.
- Leave the residual duplication between `combobox.tsx`'s trigger class and `input.tsx`'s class as-is. Extracting a shared constant is tempting but it would change `input.tsx`, which is not this slice's file, and the strings differ in the three button-specific additions anyway.

## Out of scope

- Any change to `apps/web/src/sales-ops/SalesOpsApp.tsx`. All 17 `NativeSelect` call sites and both `datalist` fields are slice 06's work.
- The native number spinner cleanup (`type="number"` at `SalesOpsApp.tsx:2276, 2285, 2314, 2344, 2565, 2775, 2807, 2998, 4296, 4467, 4579`, and the rest). Slice 06 owns it. Do not add it here.
- Native `<input type="date">` stays, per the batch overview's "Deliberately excluded" note.
- Multi-select, per-option `disabled`, a clear/reset button, async option loading, `keywords`, virtualised lists, tags/chips, `onOpenChange`, collision-aware or portalled positioning.
- Fixing the dead `bg-popover` / `text-popover-foreground` classes in `select.tsx:78` and `dropdown-menu.tsx:48,72` (or adding the `popover` token to `tailwind.config.ts` and `index.css`). Flag it to the human; it changes how those two existing panels render.
- Any new dependency, and therefore any edit to `apps/web/package.json`, `pnpm-lock.yaml` or the `optimizeDeps.include` list at `apps/web/vite.config.ts:35-49`.
- Deleting `apps/web/src/components/ui/__tests__/zz-probe.test.tsx`; it is another slice's untracked scratch file.

## Risks

- **A portalled panel would be untestable in this harness.** Avoided by decision: the panel is an inline, non-portalled, absolutely positioned `<div>` inside the component's own `relative` wrapper, so every Red assertion is a plain `container.querySelector`. No `vi.mock` is needed anywhere in the test file.
- **No collision detection, so a combobox near the viewport bottom opens off-screen.** Accepted. Mitigations already in the design: the panel is capped at `max-h-72` and the create row is pinned outside the scroll area so it is never the thing that overflows. Every call site in this batch sits inside a dialog body that already scrolls (`SalesOpsApp.tsx:4183`, `max-h-[calc(92vh-210px)] overflow-y-auto`). If a real off-screen case shows up in slice 06, that is the slice to add a `top-auto bottom-full` flip through `panelClassName`, not this one.
- **Escape inside a Radix `Dialog` could close the dialog instead of just the combobox.** Avoided by calling `preventDefault()`, `stopPropagation()` and `nativeEvent.stopImmediatePropagation()` together in the Escape branch, and locked by test 20's ancestor-`onKeyDown` spy assertion.
- **Enter submitting the surrounding form.** Every adoption site is inside a `<form>` whose submit handler saves the record. Avoided by `preventDefault()` on Enter unconditionally, not only when a row is committed, and locked by test 23.
- **twMerge not letting `formSelectClass` / `formInputClass` win, producing visual drift in slice 06.** Avoided by test 27, which asserts both directions: the base tokens are present by default, and the caller's `h-11 rounded-[10px] border-[#dcdce2] bg-[#fafafb] pr-9` fully displaces `h-10 rounded-md border-input bg-background`.
- **happy-dom gaps.** `scrollIntoView` is not implemented, so the call is optional-chained. `mousedown` is used for outside-close rather than `pointerdown`, so the test dispatches a plain `MouseEvent`. `String.prototype.normalize` and `React.useId` both work under Node 20 plus happy-dom 20.
- **A blue create row inside an amber UI.** Avoided by the explicit colour decision in Current state: the create row uses `bg-[#fdf7e8] text-[#9c7210]` / active `bg-[#f4efe2]`, not `bg-primary`, because `--primary` is blue and unused across the entire sales-ops surface.
- **Diacritics making the create row appear or vanish wrongly.** Avoided by the deliberate asymmetry, filtering strips diacritics while the exact-match check does not, locked by tests 6, 11 and 12.
- **The create row scrolling out of view on a long list.** Avoided by pinning it in a footer wrapper outside the scrollable options area, locked by test 10's `closest('.overflow-y-auto') === null` assertion.
- **`react-refresh/only-export-components` noise from mixing pure helpers with a component.** Avoided by keeping all pure logic and all types in `combobox-filter.ts` and re-exporting only `export type { ComboboxOption }` from `combobox.tsx`.
- **Committing another slice's untracked probe file.** Avoided by staging exactly the three `files_modified` paths.
