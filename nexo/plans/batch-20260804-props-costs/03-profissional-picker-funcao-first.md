---
id: 03-profissional-picker-funcao-first
milestone: v2.4.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx
  - apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx
  - CLAUDE.md
acceptance: "given wizard step 3 with row 1's FUNÇÃO NO PROJETO set to Desenvolvedor, when the operator opens PROFISSIONAL and picks Ana Martins - who carries only Vendedor and therefore renders under the `Adicionar a esta função` group heading - then the row takes Ana Martins and exactly one person write fires carrying funcaoIds [vendedorFuncaoId, devFuncaoId], her existing set PLUS the new função, never the new one alone."
---

# 03 - `Profissionais alocados`: função first, person list partitioned by it

> Two facts the planner established that correct the brief:
> 1. **`isCollaboratorPerson` is already deleted.** `apps/web/src/sales-ops/SalesOpsApp.tsx:494-501` is a tombstone comment where it used to live; `grep` across `apps/web/src` finds zero call sites. CLAUDE.md lines 108-110 are stale *today*, before this slice.
> 2. **The UI-contract file is `sale-wizard-ui-contract.test.tsx`, not `.ts`** (CLAUDE.md also names it wrong).

## 1. Current behaviour

All line numbers are `apps/web/src/sales-ops/SalesOpsApp.tsx` at the tip of `master`.

**Table header** - `7302-7308`. One grid div, `grid-cols-[minmax(0,1fr)_minmax(0,1fr)_212px_36px]`, four `<span>`s in this order:

- `7303` `<span>Profissional</span>`
- `7304` `<span>Função no projeto</span>`
- `7306` `<span>Custo alocado</span>` (preceded by the left-align comment at `7305`)
- `7307` `<span />` (the trash column)

**Row render** - `professionals.map((professional, index) => {` at `7315`, row grid div `7325-7328` repeating the same four-column template. Cells in DOM order:

- `7329-7367` the `PROFISSIONAL` `Combobox`, `aria-label={`Profissional ${index + 1}`}`, `options={personOptions(allocatablePeople)}` at `7362`, `onChange` at `7335-7352`, `onCreate` at `7353-7361`.
- `7368-7402` the `FUNÇÃO NO PROJETO` cell (a `flex flex-col gap-1` wrapper around a `Combobox`, `aria-label={`Função do profissional ${index + 1}`}`), delegating to `applyFuncaoToProfessional` at `7383`.
- `7403-7503` the `CUSTO ALOCADO` cell.
- `7504-7514` the remove button.

**Person options list** - `allocatablePeople` `useMemo` at `5404-5410`: every `bootstrap.people` row with `status === 'active'`, sorted by `displayName` with pt-BR collation, **no função filter at all** (the justifying comment is `5397-5403`). It is mapped through the shared `personOptions` helper at `683-689`, which the vendedor picker (`6500`) and the finder picker (`6524`) also use.

**Supporting sites this slice touches**

- `7272-7296` the `+ profissional` button. `7278-7279` seed a new row with `allocatablePeople[0]?.id` / `.displayName` - the first pessoa alphabetically is silently allocated.
- `5851-5853` `professionalsValid`, today only "has a `funcaoId` or a legacy `funcaoName`".
- `7519-7523` the step-3 error bar, `Selecione a função de cada profissional alocado.`
- `6399-6409` `createPayload`'s `professionals` map.
- `6251-6262` `applyFuncaoToProfessional`, the single write point for a row's função.
- `5327-5338` exported `SaleWizardDialog` props; `5342-5357` the pass-through to `SaleWizardDialogBody`; `5361-5380` the body's own prop list.
- `749` `const savePerson = useSaveSalesOpsPerson();`, `851-858` `createFuncaoByName` (the idiom every inline write in this file copies), `1493-1513` the `<SaleWizardDialog>` render.
- `494-501` the tombstone comment where `isCollaboratorPerson` used to live.

**The defect.** `allocatablePeople` never consults the row's função, so with `FUNÇÃO NO PROJETO = Desenvolvedor` the picker still offers Daniel Russo, who carries only `Vendedor`. The proposta then stores a `funcao_id` the pessoa does not hold, and nothing in the cadastro ever learns she now does that work.

## 2. The fix

### 2a. New module-level helper, beside `personOptions` (insert after `689`)

```
const FUNCAO_GRANT_GROUP_LABEL = 'Adicionar a esta função';

function professionalPersonOptions(people, rowFuncaoId): ComboboxOption[]
```

For each pessoa: `{ value: person.id, label: person.displayName, description: person.contactEmail ?? undefined }`, plus `group: FUNCAO_GRANT_GROUP_LABEL` **only** when `rowFuncaoId !== '' && !person.funcaoIds.includes(rowFuncaoId)`.

Module-local, not exported: `react-refresh/only-export-components` allows component exports only from this module (same reason `FUNCAO_SLUG_VENDEDOR` at `487` is not exported). Do **not** change `personOptions` - the vendedor and finder pickers share it.

`buildComboboxFilter` in `apps/web/src/components/ui/combobox-filter.ts:53-88` already renders the headingless bucket FIRST and each named group after it, under a `<div role="group" aria-labelledby>` with a visible uppercase heading. So carriers list normally and non-carriers land under one pt-BR heading, with **zero** change to the `Combobox` primitive and with the partition surviving a search query (the grouping is recomputed per query). The flagged rows keep their e-mail `description` - the heading is the flag, so the per-row secondary line is not spent on it.

### 2b. Column order swap (header `7302-7308`, row `7325-7515`)

Move `<span>Função no projeto</span>` to the FIRST header cell and `<span>Profissional</span>` to the second. In the row, move the whole `7368-7402` função cell above the `7329-7367` person cell. The grid template string is **unchanged** - both leading tracks are `minmax(0,1fr)`, so only JSX order moves. Keep every `aria-label` byte-identical (`Profissional ${index + 1}`, `Função do profissional ${index + 1}`): four test files address these rows by label.

### 2c. Person picker gating - DECISION: locked until the row names a função

Inside the `map` callback, above the JSX:

```
const personPickerLocked = !professional.funcaoId && !professional.funcaoName.trim();
```

On the `PROFISSIONAL` `Combobox`:

- `disabled={personPickerLocked}`
- `placeholder={personPickerLocked ? 'Selecione a função primeiro' : 'Buscar ou digitar um nome...'}`
- `options={professionalPersonOptions(allocatablePeople, professional.funcaoId)}`
- `searchPlaceholder`, `valueLabel`, `emptyMessage`, `entityGender`, `entityLabel`, `onCreate` all unchanged.

**Why locked rather than "everyone unflagged".** Listing everyone before a função exists re-creates the exact defect the screenshot shows: the operator picks a person, then names a função she does not hold, and there is no flag and no grant path, because the grant decision is taken at person-select time. It would force a second, different mismatch affordance later in the row. Locking makes the column reorder load-bearing instead of cosmetic and needs exactly one mechanism. The `Combobox` primitive already refuses to open when `disabled` (`combobox.tsx:158-165`, `openPanel` returns early), so the lock is real, not decorative, and `disabled:opacity-50` on the trigger (`combobox.tsx:316`) reads as inert.

**Legacy escape hatch.** A stored proposta row may carry a free-text `funcaoName` with a null `funcaoId` (CLAUDE.md, Propostas domain: `funcao_id` is nullable and MATCH SIMPLE skips the FK lookup). `personPickerLocked` is false for such a row, so it stays editable, and `professionalPersonOptions` groups nobody because `rowFuncaoId` is `''`. There is no id to partition on and locking would make a stored proposta uneditable - that is the one deliberate hole in the rule.

### 2d. Selecting a person, and granting the função

Replace the inline `onChange` at `7335-7352` with a call to a new handler declared beside `applyFuncaoToProfessional` (after `6262`). The row's own `funcaoId` is passed in from the render closure rather than read back out of state, so there is no side effect inside a `setState` updater (StrictMode double-invokes those) and no stale read.

```
function selectProfessionalPerson(index, rowFuncaoId, personId)
```

1. `const person = allocatablePeople.find((candidate) => candidate.id === personId);`
2. `setProfessionals(...)` writing `personId` and `personName: person?.displayName ?? ''` on row `index`, and **nothing else** - the existing comment at `7339-7340` ("a pessoa is not a cost driver, the função is") still holds verbatim; carry it over.
3. `if (!person || !rowFuncaoId) return;`
4. `if (person.funcaoIds.includes(rowFuncaoId)) return;`
5. `void grantFuncaoToPerson(person, rowFuncaoId);`

```
async function grantFuncaoToPerson(person: SalesOpsPerson, funcaoId: string) {
  if (!onAssignFuncao) return;
  await onAssignFuncao({
    id: person.id,
    displayName: person.displayName,
    contactEmail: person.contactEmail ?? undefined,
    status: person.status,
    funcaoIds: [...person.funcaoIds, funcaoId],
  });
}
```

Three things are load-bearing and must be commented in place:

- **`funcaoIds` is the FULL EXISTING SET plus one.** `apps/api/src/domains/sales-ops/service.ts:279-281` treats a present `funcaoIds` as authoritative and `replacePersonFuncoes` (`1284-1285`) deletes and reinserts. Sending only the new id wipes every other função the pessoa holds.
- **`contactEmail` must be sent.** `service.ts:1268-1276` sets `contactEmail: data.contactEmail || null` **unconditionally**, and its own comment says "any PATCH that omits contactEmail clears it, so a caller sending funcaoIds must send contactEmail alongside". `person.contactEmail ?? undefined` re-sends the stored address when there is one and omits the key when it is already null.
- **Fire-and-forget, and the row keeps the person either way.** Step 2 above runs synchronously and unconditionally; the grant is awaited only inside `grantFuncaoToPerson`. A rejected grant resolves to `null` and the optimistic rollback in `hooks.ts:95-98` restores the pessoa's old `funcoes`, so the flag simply reappears. No dialog in this app surfaces API errors today (`6264-6272` says so explicitly for the função create) and this slice does not change that.

### 2e. The new prop, and its wiring to the real mutation

Add to the exported `SaleWizardDialog` props (`5327-5338`), to the pass-through (`5342-5357`) and to `SaleWizardDialogBody`'s destructure and prop type (`5361-5380`):

```
onAssignFuncao?: (payload: SavePersonPayload) => Promise<SalesOpsPerson | null>;
```

Optional, exactly like `onCreateFuncao`, so the existing `sale-wizard-ui-contract.test.tsx` render (which passes neither) still type-checks. `SavePersonPayload` is already imported at `144`; `SalesOpsPerson` is already in scope.

The wizard builds the payload rather than the app, because the wizard is the only side that holds `bootstrap.people` and therefore the pessoa's existing `funcaoIds`. This is the same shape `PersonDialog` already uses (`4814`: `onSave: (payload: SavePersonPayload) => void`).

In `SalesOpsApp`, immediately after `createFuncaoByName` (`858`), mirroring it byte for byte:

```
async function assignFuncaoToPerson(payload: SavePersonPayload): Promise<SalesOpsPerson | null> {
  try {
    const { person } = await savePerson.mutateAsync(payload);
    return person;
  } catch {
    return null;
  }
}
```

Pass `onAssignFuncao={assignFuncaoToPerson}` on the `<SaleWizardDialog>` at `1493-1513`.

**Invalidation is free and must not be re-implemented.** `useSaveSalesOpsPerson` (`hooks.ts:117-134`) already carries `invalidates: [queryKeys.salesOps.all]` plus the optimistic bootstrap patch (`optimistic.ts:221-262`), which resolves `funcaoIds` into nested `funcoes` against the cached catalogue. An existing pessoa keeps her real uuid, so `withoutOptimisticRows` (`optimistic.ts:322-336`) does not strip her and `persistedBootstrap` (`788`) hands the updated row straight back to the open wizard. `SaleWizardDialogBody` is keyed on `editSale?.id ?? 'create'` only (`5343-5347`), never on bootstrap rows, so the operator's in-progress typing survives. Net effect: the flag disappears the instant the optimistic patch lands, and the refetch confirms it.

### 2f. Consequences of dropping the auto-seeded pessoa

Change the `+ profissional` seed at `7278-7279` to `personId: ''`, `personName: ''`. A fresh row must not allocate whoever sorts first - and with the picker locked it could not be corrected in place anyway.

That makes an empty `personName` reachable, and the API rejects it (`service.ts:61` and `:349`, `personName: z.string().min(1)`). Two guards, both required:

**Split `professionalsValid` (`5851-5853`) into two named flags**, keeping the existing one's identifier and comment:

```
const professionalFuncoesValid = professionals.every(
  (professional) => Boolean(professional.funcaoId) || Boolean(professional.funcaoName.trim()),
);
const professionalPeopleValid = professionals.every(
  (professional) => Boolean(professional.personName.trim()),
);
const professionalsValid = professionalFuncoesValid && professionalPeopleValid;
```

`canAdvanceStepThree` (`5854`) is unchanged and keeps reading `professionalsValid`.

**Render two error bars** at `7519-7523`, same skin, in this order:

- `showCostErrors && !professionalPeopleValid` -> `Selecione a pessoa de cada profissional alocado.`
- `showCostErrors && !professionalFuncoesValid` -> `Selecione a função de cada profissional alocado.` (unchanged string; `sale-wizard-ui-contract.test.tsx:365` pins it)

**Drop personless rows in `createPayload`** (`6399`): `professionals.filter((professional) => professional.personName.trim() !== '').map(...)`. `Avançar` past step 3 already refuses such a row with a visible message, so the only path that can reach the drop is `Salvar rascunho`, which gates on `draftValid` (`5871-5878`) and deliberately does not gate on professionals. A half-filled row carries no person, so the drop loses nothing addressable, and the alternative is an opaque 400 on a draft save. **Do not add `professionalsValid` to `draftValid`** - it would disable `Salvar rascunho` for the "refuses an optimistic funcao" oracle below, whose whole point is a row left without a função.

### 2g. Exact pt-BR strings introduced by this slice

| String | Where |
| --- | --- |
| `Adicionar a esta função` | `FUNCAO_GRANT_GROUP_LABEL`, the `Combobox` group heading over non-carriers |
| `Selecione a função primeiro` | the locked `PROFISSIONAL` trigger's `placeholder` |
| `Selecione a pessoa de cada profissional alocado.` | the new step-3 error bar |

No existing string is deleted.

### 2h. API: no change, and why

None is needed. `resolvePartyContexts` (CLAUDE.md, Propostas domain) validates `professionals[].personId` and `.funcaoId` in-org; the função already exists in the org before the grant, and the grant only writes rows in `sales_ops_person_funcoes` through the existing `PATCH /api/v1/sales-ops/people/:id`. The proposta payload is byte-identical to today's. Touch nothing under `apps/api/`.

## 3. The named oracle test

### 3a. `apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx`

The fixture is already perfect: `Ana Martins` carries only `Vendedor` (`137-149`), `Bruno Entrega` carries `Desenvolvedor` (`150-160`), `Zulmira Inativa` is inactive (`161-171`).

**Harness changes.** Add a 4th optional positional parameter to `renderWizard` (`306-331`), `onAssignFuncao?: (payload: SavePersonPayload) => Promise<SalesOpsPerson | null>`, passed straight through as the prop. Import `SavePersonPayload` from `'../api'` and `SalesOpsPerson` from `'../types'`. Add one helper:

```
function groupHeadingTexts(): string[]   // [...container.querySelectorAll('[role="group"]')].map(g => g.textContent?.trim() ?? '')
```

**New test 1 - `partitions the profissional picker by the row's função and flags the rest`**

Render, `goToCosts()`, `addProfessional()`, `pickOption('Função do profissional 1', 'Desenvolvedor')`, `flushReact()`, then `openPicker('Profissional 1')`:

- `expect(optionLabels()).toEqual(['Bruno Entrega', 'Ana Martins'])` - carrier first in the headingless bucket, non-carrier after the heading.
- `expect(groupHeadingTexts().some((text) => text.startsWith('Adicionar a esta função'))).toBe(true)`
- the `Ana Martins` option row is inside a `[role="group"]` and the `Bruno Entrega` row is not (`row.closest('[role="group"]')`).
- `expect(optionLabels()).not.toContain('Zulmira Inativa')` - inactive still excluded.

**New test 2 - `locks the profissional picker until the row names a função`**

Render, `goToCosts()`, `addProfessional()`:

- `expect(comboboxText('Profissional 1')).toBe('Selecione a função primeiro')`
- `expect(comboboxTrigger('Profissional 1').disabled).toBe(true)`
- `await click(comboboxTrigger('Profissional 1'))` then `expect(container.querySelectorAll('[role="option"]')).toHaveLength(0)` - the panel really cannot open.
- positive control: `pickOption('Função do profissional 1', 'Desenvolvedor')`, `flushReact()`, then `expect(comboboxTrigger('Profissional 1').disabled).toBe(false)`.

**New test 3 - the acceptance oracle - `grants the função to a flagged pessoa with her FULL existing funcaoIds`**

`const onAssignFuncao = vi.fn(async () => null);` Render with it, `goToCosts()`, `addProfessional()`, `pickOption('Função do profissional 1', 'Desenvolvedor')`, `flushReact()`, `pickOption('Profissional 1', 'Ana Martins')`, `flushReact()`:

- `expect(comboboxText('Profissional 1')).toBe('Ana Martins')` - the row takes her regardless of the write.
- `expect(onAssignFuncao).toHaveBeenCalledTimes(1)`
- `expect(onAssignFuncao).toHaveBeenCalledWith({ id: sellerId, displayName: 'Ana Martins', contactEmail: undefined, status: 'active', funcaoIds: [vendedorFuncaoId, devFuncaoId] })`
- **the anti-regression that is the whole point:** `expect(onAssignFuncao.mock.calls[0][0].funcaoIds).toContain(vendedorFuncaoId)` with the comment that person writes are a FULL SET replacement, so `[devFuncaoId]` alone would silently strip her Vendedor.

**New test 4 - `does not write when the pessoa already carries the row's função`**

Same setup, pick `Bruno Entrega` instead: `expect(onAssignFuncao).not.toHaveBeenCalled()`.

**New test 5 - `keeps a legacy free-text função row's pessoa picker open and ungrouped`**

`renderWizard(editSale)` (the stored row is `Operacional` / `Dev Externo`, pinned today at `636-642`), `goToCosts()`:

- `expect(comboboxTrigger('Profissional 1').disabled).toBe(false)`
- `openPicker('Profissional 1')` -> `expect(groupHeadingTexts()).toEqual([])`.

**Existing tests to update, exhaustively**

| Line(s) | Change |
| --- | --- |
| `465-478` | Rewrite. Its subject - "offers every active pessoa" with no função set - is precisely the rule this slice replaces. Keep the `Zulmira Inativa` and `Digite manualmente` negatives by folding them into New test 1. |
| `656-661` | After `pickOption('Função do profissional 1', 'Desenvolvedor')` add `pickOption('Profissional 1', 'Bruno Entrega')`; the row is otherwise still blocked by `professionalPeopleValid`. Add an assertion before it that the bar reads `Selecione a pessoa de cada profissional alocado.` |
| `668-669` | Swap: função before pessoa. |
| `771-776` | Restructure. The row ends with NO função (the optimistic create is refused), so its person picker is locked and `pickOption('Profissional 1', ...)` would throw. Pick `Desenvolvedor` and `Bruno Entrega` FIRST, then attempt the optimistic create, then assert `comboboxText('Função do profissional 1')` is still `Desenvolvedor` (stronger: a positive control the old shape lacked) and that the saved `funcaoId` is `devFuncaoId` and does not match `/^optimistic:/`. |
| `783-784`, `817-818`, `833-834`, `895-896` | Swap each pair: função before pessoa. |
| `610-622`, `688-710`, `712-729`, `731-748`, `847-866`, `868-889` | Already função-first or função-only. No change. |

### 3b. `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx`

New `it('puts FUNÇÃO NO PROJETO ahead of PROFISSIONAL and gates the person picker on it')`, source-substring in the file's existing register:

```
expect(source).toMatch(/<span>Função no projeto<\/span>\s*<span>Profissional<\/span>/);
expect(source).not.toMatch(/<span>Profissional<\/span>\s*<span>Função no projeto<\/span>/);
expect(source).toContain('Adicionar a esta função');
expect(source).toContain('Selecione a função primeiro');
expect(source).toContain('Selecione a pessoa de cada profissional alocado.');
expect(source).toContain('professionalPersonOptions(allocatablePeople, professional.funcaoId)');
// The grant is the REAL person write, not a bespoke fetch: same idiom as the
// onCreateFuncao={createFuncaoByName} count assertion above.
expect(source).toContain('onAssignFuncao={assignFuncaoToPerson}');
expect(source).toContain('savePerson.mutateAsync');
// The auto-seeded first pessoa is gone.
expect(source).not.toContain("personId: allocatablePeople[0]?.id ?? ''");
```

The second `toMatch` and the `not.toContain` are about markup that really existed before this slice, so neither can pass vacuously.

**Existing `not.toContain` guards: none break.** The full guard set in this file is `Custos + imposto`, `Digite manualmente`, `role: 'Operacional'`, `Fechamento da venda`, `Nova venda`, `Salvar incompleto`, `Confirmar venda`, `Passo {wizardStep} de 3`, `Salvar venda`, `Dividir em`, `+ parcela`, `Adicionar recorrência`, `Número de parcelas`, `Remover parcela`, `marque prazo indeterminado`, `<select`, `<option`, `<datalist`, `list="`, `NativeSelect`, `md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`, `sales-ops-num text-right text-[12.5px] font-bold`, `calc(92vh-`, `vh-210px`, `AlertTriangle`, and the amber-banner className. Checked one by one against the three new strings:

- `Adicionar a esta função` is not a substring match for `Adicionar recorrência` (they diverge at char 11).
- The row/header grid literal stays `grid-cols-[minmax(0,1fr)_minmax(0,1fr)_212px_36px]`, which does not contain the guarded `md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` - and this slice does not touch the template anyway.
- `expect(source).toContain('Selecione a função de cada profissional alocado.')` (line `365`) stays true: that sentence is kept, only joined by a second bar.
- `expect(source.match(/onCreateFuncao=\{createFuncaoByName\}/g)).toHaveLength(2)` (line `459`) and `expect(source.match(/<InfoHint /g)).toHaveLength(3)` (line `527`) are both untouched.

### 3c. `apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx`

One test, `lets a name-only profissional survive through the picker` (`525-558`):

- Replace `expect(comboboxText('Profissional 1')).toBe('Ana Martins')` (`532`) with `expect(comboboxText('Profissional 1')).toBe('Selecione a função primeiro')` and `expect(comboboxTrigger('Profissional 1').disabled).toBe(true)`; update the comment at `530-531`, which currently documents the seed this slice removes.
- Move the `Prestador` função pick (`542-543`) up, before the person-picker interaction at `534`.
- Everything from `534` (`click` the now-enabled trigger, type `Dev Externo`, assert the `+ Criar novo profissional "Dev Externo"` row, click it) is unchanged, as is the `onSave` payload assertion at `548-557` - a typed name still has no `personId`, so no grant fires and `personName: 'Dev Externo'` survives.
- The `renders no native select, option or datalist anywhere in the wizard` test (`560+`) is untouched: the picker stays a `Combobox`.

`sale-wizard-edit.test.tsx` addresses the row only through `comboboxText('Função do profissional 1')` and `labeledInput('Custo alocado do profissional 1')`, both aria-label lookups that survive the DOM reorder. It is deliberately **not** in `files_modified`.

### 3d. Run-once command

Verified against `apps/web/package.json` (`"test": "vitest run"`), so `--` forwards file filters to vitest:

```bash
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx src/sales-ops/__tests__/combobox-adoption.test.tsx
```

Then the full gate: `pnpm run lint && pnpm run type-check && pnpm test`.

## 4. Scope limits (YAGNI)

- **No API change.** Nothing under `apps/api/` or in any migration. No new endpoint, no assignment sub-resource - CLAUDE.md says there are none and this slice does not invent one.
- **No confirm dialog before granting.** The group heading states the consequence before the click; a modal on top of a picker inside a dialog is a third inline layer.
- **No un-grant.** Removing a função stays in `cadastros/pessoas`.
- **No change to `personOptions`, the vendedor picker or the finder picker.** Those pick a pessoa who must *already* hold a system função; they get no create row and no grant row for exactly that reason (CLAUDE.md, UI Controls).
- **No change to the `Combobox` primitive or to `combobox-filter.ts`.** `group` already does everything this needs.
- **No new pure function in `calculations.ts`.** `professionalPersonOptions` is view-shaping, not a money rule, and is proven in the DOM.
- **No change to the cost cell, the `%`/`R$` toggle, `buildFuncaoCostBasis` or `applyFuncaoToProfessional`'s re-derivation rule.** Picking a pessoa still does not touch the cost.
- **No archived-função handling in the person picker.** `allocatableFuncoes` (`5431-5443`) already keeps archived funções out of `FUNÇÃO NO PROJETO`, so a row can only ever be partitioned by an active one.

## 5. CLAUDE.md edits

**Edit 1 - "Pessoas e Funções", the `hasFuncao` sentence.**

Old (one sentence inside the `sales_ops_people` bullet):

> Web code goes through `hasFuncao` and `isCollaboratorPerson` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, never through a per-call-site slug comparison and never through a mirror.

New:

> Web code goes through `hasFuncao` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, never through a per-call-site slug comparison and never through a mirror.

**Edit 2 - "Pessoas e Funções", the two `isCollaboratorPerson` bullets.**

Old (two consecutive bullets, verbatim):

> - `isCollaboratorPerson` is "carries at least one non-system função" and nothing else. That is character for character how the API derives `is_collaborator` in `deriveBooleanMirrors`, and in particular neither side considers `status`.
> - `isCollaboratorPerson` has exactly one call site left, the proposta wizard's Profissional picker, which additionally requires `status === 'active'`. The produto Prestador picker that used to be the second call site is gone: a produto default cost now keys on a `funcaoId` rather than on a free-text person name.

New (one bullet):

> - `isCollaboratorPerson` is GONE from `apps/web`; a tombstone comment sits where it was declared in `apps/web/src/sales-ops/SalesOpsApp.tsx`. It meant "carries at least one non-system função", character for character how the API still derives `is_collaborator` in `deriveBooleanMirrors`, neither side considering `status`. Both call sites are retired: the produto Prestador picker (a produto default cost keys on a `funcaoId` now) and the proposta wizard's Profissional picker, which partitions on the ROW's `funcaoId` instead - see the Propostas domain entry. Do not reintroduce it. "Carries at least one non-system função" is not a question this app asks any more; `person.funcaoIds.includes(rowFuncaoId)` is.

**Edit 3 - "Propostas domain", the picker sentence inside the `sales_ops_sale_professionals` bullet.**

Old (verbatim):

> The wizard's `PROFISSIONAL` picker offers every ACTIVE pessoa (not only `isCollaborator` ones) and `FUNÇÃO NO PROJETO` is a Combobox over active funções; both free-text escape hatches (`Digite manualmente`, the seeded `role: 'Operacional'`) are gone and `sale-wizard-ui-contract.test.ts` fails if either string returns.

New:

> `FUNÇÃO NO PROJETO` is the FIRST column of `Profissionais alocados` and `PROFISSIONAL` the second, because the função is what partitions the person list. The person picker is DISABLED, placeholdered `Selecione a função primeiro`, until the row names a função; it then lists every ACTIVE pessoa who already carries that função in the headingless bucket and every other ACTIVE pessoa under the `Adicionar a esta função` group heading, which is `ComboboxOption.group` and needs nothing new in the primitive. Selecting a flagged pessoa GRANTS her that função through the `onAssignFuncao` prop, which `SalesOpsApp` wires to the ordinary `useSaveSalesOpsPerson` - so the bootstrap invalidation and the optimistic patch come for free and the flag disappears at once. The payload is her EXISTING `funcaoIds` PLUS the new one and must also carry `contactEmail`: person writes are a full set replacement and a PATCH that omits `contactEmail` clears it. Listing everyone unflagged before a função is chosen was rejected: it re-creates the unchecked pick this rule exists to stop, and leaves the grant with no moment to happen. The ONE exception is a legacy row carrying a free-text `funcaoName` with no `funcaoId` - it keeps the picker enabled and groups nobody, because there is no id to partition on and locking it would make a stored proposta uneditable. `FUNÇÃO NO PROJETO` is a Combobox over active funções; both free-text escape hatches (`Digite manualmente`, the seeded `role: 'Operacional'`) are gone and `sale-wizard-ui-contract.test.tsx` fails if either string returns. A fresh `+ profissional` row seeds NO pessoa - the old `allocatablePeople[0]` seed silently allocated whoever sorted first - so step 3 also refuses to advance with `Selecione a pessoa de cada profissional alocado.`, and `createPayload` drops a row whose `personName` is blank rather than sending one the API's `personName: z.string().min(1)` answers with a 400. `draftValid` deliberately does NOT gate on professionals, so `Salvar rascunho` stays reachable mid-edit.

Note the filename correction in Edit 3: the file is `sale-wizard-ui-contract.test.tsx`, and CLAUDE.md has been naming it `.ts`.

## 6. Risk / invariants touched

| Invariant | Verdict |
| --- | --- |
| UI Controls - native `<select>`/`<option>`/`<datalist>` banned, every sales-ops single-select is `Combobox` from `@/components/ui/combobox` | **Held.** The picker stays a `Combobox`; only `options`, `disabled` and `placeholder` change. The `renders no native select...` test in `combobox-adoption.test.tsx` and the four `not.toContain` guards in the UI-contract file are the enforcement and all still pass. |
| UI Controls - `useInlineLayer` on any inline layer inside a dialog | **Held.** Owned by the primitive (`combobox.tsx:93`), untouched. |
| UI Controls - `formSelectClass` (44px) is the only geometry a sales-ops picker call site passes | **Held.** Unchanged on both pickers. |
| UI Controls - `onCreate` is wired only where an inline create yields a valid record; profissional accepts the typed name verbatim | **Held.** `onCreate` survives on the person picker unchanged; it is simply unreachable while the row has no função, which is correct - a typed name is not a cadastro pessoa and can carry no função. |
| Pessoas e Funções - person writes send `funcaoIds` as a FULL SET replacement; no assignment sub-resource | **Held and newly enforced by a test.** The grant sends existing + new through the existing `PATCH`. |
| Pessoas e Funções - `isCollaboratorPerson` has one call site | **Already false before this slice.** The helper is deleted; CLAUDE.md is stale. Edits 1 and 2 land the correction, and the helper is deliberately NOT resurrected. |
| Propostas domain - `resolvePartyContexts` validates every `personId`/`funcaoId` in-org | **Held, untouched.** The proposta payload shape does not change and the função already exists in the org. |
| Propostas domain - `funcao_id` is nullable so a legacy row keeps its free-text label | **Held.** The explicit unlock for `funcaoId === '' && funcaoName !== ''` exists only to preserve it. |
| Propostas domain - cost re-derivation, `costManual` pinning, `buildFuncaoCostBasis` | **Untouched.** Picking a pessoa still writes only `personId`/`personName`. |
| Tenancy | **Untouched.** No id is read from a request body; the grant sends only ids the operator already sees in her own org's bootstrap. |

**Residual risks, each with its guard**

1. **Silently wiping a pessoa's other funções.** The single highest-consequence failure. Guarded by the explicit `toContain(vendedorFuncaoId)` assertion in oracle test 3 and by the fixture choosing a pessoa who holds a *system* função, so a regression destroys something visible.
2. **Silently clearing a pessoa's e-mail.** The API clears `contact_email` on any PATCH that omits it. Guarded by asserting the whole payload object with `toHaveBeenCalledWith` rather than `objectContaining`, so a dropped key fails.
3. **A stored proposta becoming uneditable.** The legacy free-text row is the case; oracle test 5 pins it on the real `editSale` fixture.
4. **A blank-pessoa row reaching the API as a 400.** Guarded by `professionalPeopleValid` on `Avançar` and the `createPayload` filter on `Salvar rascunho`.
5. **Test churn hiding a real regression.** Twelve existing assertions move. Every one of them is a pure reordering of two `pickOption` calls or the addition of a person pick, listed line by line in section 3a; no assertion is weakened, and `465-478` is the only test whose *subject* is replaced - deliberately, because it encodes the rule being changed.
6. **A grant firing on the edit path's initial render.** It cannot: `grantFuncaoToPerson` is reachable only from the picker's `onChange`, never from `deriveWizardPrefill` or a `useEffect`.
