# Verify 06-combobox-adoption - attempt 2 (narrow re-verify)

Branch `feat/06-combobox-adoption`, one commit `762232b` on top of `master` (`e2c43a0`).
Attempt 1 was `8dd3273` and its report is `nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/verify-06.md`.
I am a different agent from the attempt-1 verifier and I did not write this code.

**Verdict: PASS.**

## 1. Gates - all four green, run by me

| Gate | Command | Exit |
| --- | --- | --- |
| lint | `pnpm run lint` | 0 |
| type-check | `pnpm run type-check` | 0 |
| test | `CI=true pnpm test` | 0 |
| build | `pnpm run build` | 0 |

Test counts match the expected baseline exactly:

- `apps/web`: 30 test files passed (30), 210 tests passed (210)
- `apps/api`: 24 test files passed (24), 248 tests passed (248)
- `packages/shared-utils`: 1 test file passed (1), 17 tests passed (17)

`pnpm run lint` ran `eslint src/` for both `apps/api` and `apps/web`, both `Done`.
`pnpm run type-check` ran `tsc --noEmit` across all four projects, all `Done`.
`pnpm run build` finished `built in 1.44s` with no warnings beyond chunk sizes.

## 2. Only `CLAUDE.md` moved since the verified state

`git diff --name-only 8dd3273..762232b` returns exactly one path: `CLAUDE.md`.
So attempt 1's clean findings transfer unchanged and I did not need to re-derive them.

For completeness, `git diff --name-only e2c43a0..762232b` is the same 24-file slice attempt 1 reviewed
(`CLAUDE.md`, `apps/web/eslint.config.js`, `ProductDialog.tsx`, `auth/react.tsx`, `combobox.test.tsx`,
`dropdown-menu.tsx`, `select.tsx`, `LinkGeneratorForm.tsx`, `index.css`, `SalesOpsApp.tsx` and 12 sales-ops tests) -
no file was added or dropped between attempts.

The whole textual diff between the two attempts is the `## UI Controls` rewrite: the one overloaded sentence
became three bullets (app-wide ban, scoped Combobox mandate, named exception). Nothing else in `CLAUDE.md`
changed - the numeric-field, `type="date"`, geometry and `onCreate` bullets are byte-identical to attempt 1.

## 3. Every sentence in `## UI Controls` is true as written

I checked each factual claim against the tree rather than against the commit message.

### 3.1 The ban (line 43-44)

> Native `<select>`, `<option>` and `<datalist>` are banned everywhere in `apps/web/src`, and `no-restricted-syntax` in `apps/web/eslint.config.js` fails lint if one comes back.

**True.** My own greps over `apps/web/src`:

- `grep -rnE '<(select|option|datalist)[ >/]'` - no matches
- `grep -rnE '</(select|option|datalist)>'` - no matches
- `grep -rni 'datalist'` - 11 hits, all comments, test names, or string literals inside the two guard tests
  (`combobox-adoption.test.tsx:713,736`, `sale-wizard-ui-contract.test.ts:48-49`). Zero markup.

The rule really does live in `apps/web/eslint.config.js` and really does error - see section 5.

### 3.2 The Combobox mandate and its scope (line 45-46)

> Every single-select picker in `apps/web/src/sales-ops/**`, plus the workspace switcher in `apps/web/src/auth/react.tsx` and every data-driven picker in the legacy `admin/**` and `finder/**` trees, uses `Combobox` [...] It is the only searchable picker in the app.

**True, and the scope is accurate.** A picker in this codebase can only be one of four things, and I enumerated all four:

1. Native `select`/`datalist` - zero, per 3.1.
2. Radix `Select` - `grep -rn "components/ui/select"` returns exactly two importers,
   `admin/products/ProductDialog.tsx:13` and `admin/products/CommissionRuleForm.tsx:13`. Both are the named exception.
3. `Combobox` - `<Combobox` appears in `sales-ops/SalesOpsApp.tsx` (17), `auth/react.tsx` (1),
   `admin/products/ProductDialog.tsx` (1), `finder/links/LinkGeneratorForm.tsx` (2), plus two test files.
4. Radix `DropdownMenu` - used only in `sales-ops/SalesOpsApp.tsx`, at `:933` (account menu) and `:1593` (row actions).
   Both are action menus, not value pickers, so they do not bear on the claim.

Inside the claimed scope nothing is left on anything else:

- **`sales-ops/**`**: all 17 `<Combobox>` sites, no `Select` import, no native picker, no `role="listbox"`,
  no `Popover`/`Command` composition outside the primitive.
- **`auth/react.tsx`**: the Hub workspace switcher at `:238` is a `Combobox` (confirmed by reading `HubUserControls`).
- **legacy `admin/**` / `finder/**`, data-driven pickers**: `grep -rniE 'options=|role="listbox"|role="combobox"|aria-haspopup'`
  over `admin finder seller` returns exactly three hits, and all three are `Combobox` option lists -
  `ProductDialog.tsx:107` (apps), `LinkGeneratorForm.tsx:93` (apps) and `:105` (products).
  The remaining legacy forms (`PriceBandForm.tsx`, `AppDialog.tsx`) contain only `<Input>`; the other admin pages
  are tables with no picker at all (`PayoutsPage.tsx:130` is a `type="checkbox"`, not a picker).

"It is the only searchable picker in the app" survives the exception, because a Radix `Select` is not searchable.

Note the mandate is scoped, not app-wide, and that scoping is load-bearing and correct: `auth/react.tsx:240` passes
its own `h-9` trigger class, which would violate the "exactly two canonical sizes" bullet if that bullet were not
itself scoped to sales-ops. The two bullets are mutually consistent precisely because both are scoped.

### 3.3 The exception (line 47-49)

**Both paths are correct and both sites exist as described.** I read both files in full.

- `apps/web/src/admin/products/ProductDialog.tsx:132` - `<Select value={status} onValueChange={...}>` with exactly two
  hardcoded `SelectItem`s, `value="active"` and `value="archived"`, cast to `ProductStatus`. Rendered only when `isEdit`.
- `apps/web/src/admin/products/CommissionRuleForm.tsx:94` - `<Select value={basis} onValueChange={...}>` with exactly two
  hardcoded `SelectItem`s, `value="quoted_net"` and `value="list_net"`, cast to `CommissionBasis`.

"Documented exception, and the only one" is true - only these two files import `@/components/ui/select`.
"do not add a third such site" is consistent with that.
"a Radix `Select` is not a browser-native picker, so both already satisfy the ban above" is true and resolves what would
otherwise read as a carve-out from the ban: the ban is about native elements, and neither site emits one (lint proves it).
The instruction "Convert them to `Combobox` whenever those two screens are next worked on" gives a future agent a concrete
trigger and action, which is what the previous defect was missing.

### 3.4 The exception's reason is honest (check 4)

> Both are two-option closed enums that never grow, so search buys nothing

**Accurate.** Neither option set is data-driven. Both are literal JSX children, not `.map()` over any query result,
and each is the full domain of a TypeScript union imported from `@/admin/types` (`ProductStatus`, `CommissionBasis`).
No API response, no `useQuery`, no props feed either list. The same `ProductDialog` file proves the distinction is
being drawn honestly: its one genuinely data-driven picker, the apps list at `:104-110`, *is* a `Combobox`
(`options={(apps ?? []).map(...)}`). So the reason is not a rationalization - the file applies exactly the rule it states.

### 3.5 Numeric fields and the `type="date"` carve-out (line 50-52)

**Both true and mutually consistent.**

- 19 `type="number"` sites exist in production source (11 in `SalesOpsApp.tsx`, 8 across `CommissionRuleForm`,
  `PriceBandForm`, `AppDialog`). All are on `<Input>`, which lint proves: the ESLint selector fires on a raw
  `<input>` carrying `type="number"` and lint exits 0.
- The base-layer rule really is in `apps/web/src/index.css` inside `@layer base` (opened at `:7`):
  `input[type='number'] { appearance: textfield; }` at `:87` plus the `::-webkit-*-spin-button` pair at `:91-95`.
- Only four raw `<input>` remain in `apps/web/src` and none is numeric or a picker:
  `SalesOpsApp.tsx:2886` (`type="text"`, digit-masked code suffix), `PayoutsPage.tsx:130` (`type="checkbox"`),
  `combobox.tsx:329` (the panel's own search box), `input.tsx:6` (the primitive).
- The three `type="date"` sites (`SalesOpsApp.tsx:4537,4884,4984`) are all `<Input type="date">`.
  A date input is not a `select`, `option` or `datalist`, so line 52 does not contradict line 43.
  This is the contradiction the implementer says it caught in its own draft, and I confirm the shipped text does not have it:
  line 43 bans three named elements, it does not claim "no browser-native picker anywhere".

### 3.6 Picker geometry (line 53-54)

**True.** `SalesOpsApp.tsx:156` defines `comboboxTriggerClass` with `h-10` (40px) and `:164` defines
`formSelectClass = ${comboboxTriggerClass} h-11 rounded-[10px]` (44px). `formInputClass` at `:150` is also `h-11
rounded-[10px] ... text-sm`, so "matching `formInputClass`" holds.

- "exactly two canonical sizes in sales-ops": the file has 17 `<Combobox>` sites and 17 geometry-class usages -
  `comboboxTriggerClass` at `:1061,1076` and `formSelectClass` at 15 sites. Every sales-ops picker gets one of the two.
- "`comboboxTriggerClass` (40px, the compact `Filtros` bar only)": both usages sit inside the single
  `filtersOpen && view === 'vendas'` filter bar at `:1053-1085`. No other consumer.
- "Call sites pass only non-geometry extras": the only wrapped call sites are `:3131` and `:3191`, both
  `cn(formSelectClass, 'bg-white')`. `bg-white` is not geometry. All other 15 pass the bare class.

### 3.7 `onCreate` wiring (line 55-57)

**True.** I walked all 17 `<Combobox>` call sites and listed which carry `onCreate`:

| Picker | `onCreate` | Matches the claim |
| --- | --- | --- |
| cliente (`:4436`) | `void createClient(name)` -> `onCreateClient` -> API | yes, "cliente [...] create through the API" |
| área, product modal (`:2911`) | `createArea(name)` -> `onCreateArea` -> API | yes, "área create through the API" |
| área, sale item (`:4591`) | `onCreateArea` | yes |
| prestador (`:3189`) | writes the typed name as a snapshot | yes, "accept the typed name verbatim" |
| profissional (`:5098`) | writes the typed name as a snapshot | yes |
| produto (`:4686`) | `onCreateProduct(name)` -> `setModal({kind:'product', prefillName: name})` at `:1239` | yes, "opens `ProductDialog` prefilled instead" |
| vendedor (`:4465`), finder (`:4488`) | none | yes, "Pessoa pickers get no create row" |
| the 9 enum/filter pickers | none | consistent |

## 4. No internal contradictions, and none against the rest of `CLAUDE.md`

I read the section as a whole looking for the class of bug the implementer nearly shipped, and checked every
`CLAUDE.md` line that mentions a picker, select, combobox or input (43-57, 63, 76).

- ban (43) vs `type="date"` (52): consistent, see 3.5.
- mandate (45) vs exception (47): consistent, because the mandate is scoped and "only searchable picker" is
  a property Radix `Select` does not have.
- "and the only one" (47) vs "do not add a third such site" (49): consistent, and both verified true today.
- mandate scope (45) vs geometry scope (53): consistent, and necessarily so - see the note in 3.2.
- `## Sales Ops Routing:63` ("the old 'Nível de visualização' selector was removed"): still true;
  the only occurrence of that string in `apps/web/src` is a negative assertion in `routing.test.tsx:334`.
- `## Propostas domain:78` ("product `Tipo` was removed from the UI"): not contradicted. The
  `Tipo do módulo` Combobox at `SalesOpsApp.tsx:3129` is a *module* type inside the product modal
  (`Módulo/Upsell/Downsell/Cross-sell/Add-on`), a different field from the removed product `Tipo`.
- `AGENTS.md` mentions no picker or UI-control rule, so there is no cross-document conflict.

## 5. ESLint still enforces exactly what the section claims

`no-restricted-syntax` in `apps/web/eslint.config.js` carries four selectors: `JSXOpeningElement[name.name="select"]`,
`"datalist"`, `"option"`, and `JSXOpeningElement[name.name="input"] > JSXAttribute[name.name="type"][value.value="number"]`.

**Probe 1** - `apps/web/src/__probe_verify06__.tsx` with all four banned forms:

```
4:7   error  Native <select> is banned. ...            no-restricted-syntax
5:9   error  <option> only exists inside a native picker, ...  no-restricted-syntax
7:7   error  Native <datalist> is banned. ...          no-restricted-syntax
8:14  error  Use <Input type="number"> ...             no-restricted-syntax
4 problems, exit 1
```

**Probe 2** - `apps/web/src/admin/products/__probe2__/p.tsx`, deliberately placed in the *same directory* as the two
excepted files, to prove the exception was not implemented as a lint escape hatch: 2 errors, exit 1.

Scope is not narrowed. The rule block is `files: ['**/*.{ts,tsx}']` with only the top-level `{ ignores: ['dist'] }`.
The one `ignores: ['src/lib/app-mutation.ts']` in the config belongs to a *different*, later block that carries only
`no-restricted-imports`, so it does not exempt anything from the picker ban.
`grep -rn "eslint-disable.*no-restricted-syntax" apps/web/src` returns nothing, and
`apps/web/eslint.config.js` is the only ESLint config in the package - no `.eslintrc*` override exists.

Both probes deleted (`rm -f` and `rm -rf` of the probe dir). See section 7.

## 6. Hygiene

- **Exactly one commit**: `git rev-list --count e2c43a0..762232b` = 1.
- **Conventional Commit**: subject is `feat(web): adopt the searchable Combobox everywhere and delete every native picker`.
- **No co-author, no AI attribution**: `git log -1 --format='%(trailers)'` is empty. Author and committer are both
  `CauetPinciara <cauetpinciara@gmail.com>`. The only case-insensitive hit for `claude` in the message is
  `The CLAUDE.md rule is written to be true as stated ...` - a filename, explicitly not attribution.
- **No em dash**: no `—` in any added line of `git diff e2c43a0..762232b`, and none in the commit message.
- The commit body's "The CLAUDE.md rule is written to be true as stated rather than aspirational" paragraph accurately
  describes what the text now says, including naming the two-site exception and its reason.

## 7. Tree restored

Both probe artifacts deleted. `git diff HEAD --stat` is empty. `git status --porcelain` shows the same four untracked
entries that were present when I started and nothing else:

```
?? .vscode/
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/exec-06-combobox-adoption.result.json
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/verify-06-combobox-adoption.result.json
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/verify-06.md
```

I did not merge, push, commit or amend, and I stayed on `feat/06-combobox-adoption`.
(This report and the result JSON add two further untracked files under `nexo/`, which is the required output.)

## 8. Observations - none blocking, none in this attempt's diff

The attempt-1 defect is fixed and I found no new one. Three things are worth a future agent's attention but are
outside `## UI Controls`, outside this attempt's one-file diff, and none makes a `CLAUDE.md` sentence untrue:

1. **`apps/web/eslint.config.js:26-28`** - the rule's rationale comment still says "this codebase has exactly one
   single-select control: `Combobox`", which is the same overstatement the `CLAUDE.md` fix just corrected, and is now
   mildly out of step with the documented two-site exception. It is a code comment, not the contract, and the rule it
   documents behaves correctly. Worth a one-line touch-up next time that file is opened.
2. **`apps/web/src/index.css:82`** - "The OS number spin buttons are the last browser-native picker widget in the app"
   sits slightly oddly beside `CLAUDE.md:52` naming `<input type="date">` as the one still allowed. Both readings are
   defensible (the spin buttons are suppressed, the date picker is kept), and the CSS comment is not the contract.
3. **`SalesOpsApp.tsx:789-870`** - the sales-ops sidebar workspace switcher is a hand-rolled button list with a `Check`
   mark rather than a `Combobox`. I read it as navigation, not a picker: `setWorkspace` drives the URL, which
   `CLAUDE.md:62` names the single source of truth for the active workspace, and it sits immediately above the `nav`
   whose items do the same thing. Under the opposite reading it would be a single-select in sales-ops that is not a
   `Combobox`. I do not treat this as a false claim, because the section's own vocabulary (`formSelectClass` aligning
   with `formInputClass`, `onCreate` inline creation, "searchable picker") is plainly about form value pickers, and the
   same generous reading would also make the sidebar nav and the account `DropdownMenu` "pickers". Flagging it only
   because a future agent could read line 45 either way.

Separately, `SalesOpsApp.tsx:1044-1048` renders a static "Julho 2026" chip with a `ChevronDown` and no dropdown behind
it. Pre-existing decoration, untouched by this slice, not a picker - noting it as a by-eye item, not a defect.

## 9. Carried forward for Gate 3 (by eye)

Attempt 1's visual list stands unchanged, since no code moved:

1. Create rows end to end against the real API: `cadastros/produtos` Área picker searching and its amber
   `+ Criar nova área "..."` row actually creating; the Nova proposta Cliente create row producing a cliente that then
   appears in `cadastros/clientes`. Everything below the `onCreateClient`/`onCreateArea` boundary is spy-mocked in tests.
2. The two CSS-only claims: no OS spin buttons on any number field including inside Radix Dialog portals, and the
   admin/finder Radix `Select` and `DropdownMenu` panels now having a real background where `bg-popover` emitted nothing.
3. Rendered pixel geometry - proven at class-token level only, since happy-dom computes no Tailwind. Eyeball an Itens
   row and a parcela row, the rows that move 40px -> 44px.
4. The inline, non-portalled panel inside the two `overflow-y-auto` dialog bodies: opening the picker on the LAST
   parcela or LAST profissional row extends the dialog's scroll area instead of floating above it.
5. Two stacked Radix modals: the now-wired "Cadastrar produto" button and the produto create row open `ProductDialog`
   while the wizard dialog is still open. Confirm backdrop, focus trap, focus return, and that wizard state survives.
