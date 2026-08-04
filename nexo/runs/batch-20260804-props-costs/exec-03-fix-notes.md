# Execute fix - 03 `Profissional` picker, função first

Branch: `feat/03-profissional-picker-funcao-first` (uncommitted working tree, slice 03's original changes preserved, one fix layered on top).

## Defect

Verify (`nexo/runs/batch-20260804-props-costs/verify-03.md`, section 5) proved the `grants the funcao to a flagged pessoa with her FULL existing funcaoIds` test in `apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx` was vacuous on the `contactEmail` field.
The fixture pessoa Ana Martins had `contactEmail: null`, so the implementation's `contactEmail: person.contactEmail ?? undefined` produced `undefined`, and the test asserted `contactEmail: undefined`.
`toHaveBeenCalledWith` uses `toEqual` semantics, under which an expected `undefined` property also matches an object that omits the key entirely - so deleting the whole `contactEmail` line from `grantFuncaoToPerson` left all 28 tests green.

## Fix

1. Gave Ana Martins a real `contactEmail: 'ana@exemplo.com'` in the fixture (`sale-wizard-funcao-costs.test.tsx:144`), and asserted that exact string in the grant-payload `toHaveBeenCalledWith`. An omitted key is now a genuine mismatch.
2. Rewrote the misleading comment above the assertion. It used to claim "only a full-object assertion fails on it"; it now states the real mechanism - an expected `undefined` matches an omitted key under `toEqual`, so only a non-undefined expected value can catch the drop.
3. Fallout from giving Ana a `contactEmail`: `professionalPersonOptions` renders `contactEmail` as the Combobox option's `description`, and `combobox.tsx` renders label and description as sibling `<span>`s with no separator between them, so an option row's `textContent` for Ana is now `"Ana Martins" + "ana@exemplo.com"` concatenated, not the bare label.
   - `partitions the profissional picker...` test: replaced the exact `toEqual(['Bruno Entrega', 'Ana Martins'])` with an order-preserving `options[0] === 'Bruno Entrega'` / `options[1]?.startsWith('Ana Martins')` pair (the test's own point is the ORDER/partition, not the description text), and swapped `optionRow('Ana Martins')` for a new `optionRowStartingWith` helper (mirroring the file's existing `pickOptionStartingWith`, used elsewhere for the produto/área picker).
   - `grants the funcao...` test: swapped `pickOption('Profissional 1', 'Ana Martins')` for `pickOptionStartingWith(...)`. The post-selection assertion `comboboxText('Profissional 1')).toBe('Ana Martins')` needed no change - the Combobox trigger renders only `option.label`, never the description, so the closed trigger still reads the bare name.
4. Added a second, cheap sibling assertion for the case the brief flagged: a pessoa whose `contactEmail` really is `null` must still produce a payload that omits the key on the wire, not one that sends a literal `null`.
   New test `omits contactEmail from the grant payload for a pessoa with none, rather than sending null` grants Bruno Entrega (holds `devFuncaoId`, `contactEmail: null`) the unrelated `Testador` função, and asserts:
   - `payload.contactEmail` is the JS value `undefined` (not merely "falsy") - the object literal still carries the key at the JS level (`person.contactEmail ?? undefined` assigns it), so a naive `hasOwnProperty` check is false-positive here (tried it, failed, is correct behavior - the key genuinely exists with an `undefined` value).
   - `JSON.parse(JSON.stringify(payload))` (i.e. what actually crosses the wire, since `JSON.stringify` drops `undefined`-valued keys) does NOT have a `contactEmail` property - this is the assertion that actually proves the wire-level omission the brief is worried about.

## Mutation proof (not vacuous)

Deleted the `contactEmail: person.contactEmail ?? undefined,` line (plus its comment) from `grantFuncaoToPerson` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, ran the test file:

```
FAIL src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx > sale wizard profissionais alocados > grants the funcao to a flagged pessoa with her FULL existing funcaoIds
 Test Files  1 failed (1)
      Tests  1 failed | 28 passed (29)
```

Exactly the intended test goes red (diff shows the received payload missing `"contactEmail": "ana@exemplo.com"`), nothing else moves.

Restored the line verbatim, re-ran:

```
 Test Files  1 passed (1)
      Tests  29 passed (29)
```

`git diff apps/web/src/sales-ops/SalesOpsApp.tsx` after restoring shows no residual mutation artifact - only the original slice's diff.

## Gates - all green, run-once

- `pnpm run lint` - exit 0, both `apps/api` and `apps/web` clean.
- `pnpm run type-check` - exit 0, both packages and both apps clean.
- `pnpm --filter @fxl-sales/web test` - `Test Files 44 passed (44)`, `Tests 497 passed (497)` (496 baseline + 1 new sibling test).

## Files touched by this fix

- `apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx` (fixture, assertions, new helper, new test, comment)

`SalesOpsApp.tsx` was only touched transiently for the mutation proof and is back to its pre-fix (slice 03 original) state.
