# Verify 09 - produto código default

**Verdict: PASS**

Slice: `09-produto-codigo-default` on `feat/09-produto-codigo-default` (uncommitted).
Reviewed adversarially from `git diff` only; no executor notes were read.

## Diff surface

Seven files, all in `apps/web`, `+247 / -3`.

| File | Role |
| --- | --- |
| `apps/web/src/sales-ops/calculations.ts` | new `MAX_PRODUCT_CODE_SUFFIX` + `nextProductCodeSuffix` |
| `apps/web/src/sales-ops/SalesOpsApp.tsx` | new required `products` prop, `productForm` seed param, one `aria-label` |
| `__tests__/calculations.test.ts` | +11 unit tests |
| `__tests__/product-service-dialog.test.tsx` | +5 dialog tests |
| `__tests__/areas-view.test.tsx`, `combobox-adoption.test.tsx`, `product-commission-editor.test.tsx` | prop plumbing only (`products={[]}`) |

No API file is touched. No migration. No new dependency.

## Oracles - verbatim results

### `pnpm test`

```
apps/api test:  Test Files  29 passed (29)
apps/api test:       Tests  300 passed (300)
apps/web test:  Test Files  39 passed (39)
apps/web test:       Tests  409 passed (409)
```

Baseline was 393 web / 39 files and 300 api / 29 files.
Web is **+16 tests, 0 files**, which is exactly the 11 + 5 the diff adds. API is unchanged. No drop.

`git diff | grep -E "\.skip|\.only|todo\("` returns nothing. No test was disabled to make this green.

### `pnpm run lint`

```
apps/api lint: Done
apps/web lint: Done
```

Clean.

### `pnpm run type-check`

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

Clean.

### Em dash

`git diff | grep "—"` returns nothing. None introduced.

## Decisive check 1 - the edit path is untouched

`apps/web/src/sales-ops/SalesOpsApp.tsx:3164`:

```ts
codeSuffix: product?.codeSuffix ?? nextCodeSuffix ?? '0',
```

The `??` short-circuit is the guard, and it is `??` rather than `||`, which matters: `code_suffix` is
`NOT NULL DEFAULT '0'`, so `'0'` is a legitimate stored value that `||` would have silently replaced
with a recomputed max+1. That would have been the exact renumbering regression, on every produto that
happens to hold suffix 0. The operand order is correct as written.

The assertion covering it is real, not decorative. Mutation M2 inverted the operand order to
`nextCodeSuffix ?? product?.codeSuffix ?? '0'` and ran the whole `sales-ops` suite:

```
× the código da venda suffix suggestion > leaves an existing produto on its own stored suffix
AssertionError: expected '8' to be '3' // Object.is equality
 Test Files  1 failed | 27 passed (28)
      Tests  1 failed | 323 passed (324)
```

One failure, the right one, failing for the right reason (the recomputed 8 rather than the stored 3).

## Decisive check 2 - pure exported function

`nextProductCodeSuffix` lives in `apps/web/src/sales-ops/calculations.ts:71`, is exported, takes
`readonly Pick<SalesOpsProduct, 'codeSuffix'>[]` and returns `string`. No React, no closure over
component state, no I/O. The 11 unit tests in `calculations.test.ts` exercise it with plain arrays and
never render. The narrow `Pick<>` parameter is the right call: it lets the unit tests pass one-key
literals while the dialog tests still pass whole `SalesOpsProduct` fixtures.

## Decisive check 3 - edge case audit

Every case is both implemented and asserted with a real expected value.

| Case | Behaviour | Test | Judgment |
| --- | --- | --- | --- |
| empty catalogue | `'0'` | `starts an empty catalogue at the column default 0` | Correct. Matches the column default, so a first produto behaves exactly as before. |
| gaps `['0','3','7']` | `'8'` | `takes the max and never fills a gap` | Correct, and it is the operator's literal request. Lowest-free would have recycled a number an archived produto still owns in operator memory even when the row is gone. |
| order independence | `['7','0','3'] -> '8'` | `is order-independent` | Good. Guards against a first-element or last-element implementation. |
| non-numeric ignored | `['FIN','CST'] -> '0'` | `ignores non-numeric suffixes...` | Correct, and provably safe (see the soundness argument below). |
| malformed variants | `['2','FIN','007','100','',' 5'] -> '3'` | `counts only strictly-shaped values...` | The strongest test in the file. It pins the API regex `/^\d{1,2}$/` as the admission rule rather than a loose `parseInt`. |
| numeric not lexicographic | `['9','10'] -> '11'` | `orders numerically, not lexicographically` | Correct. The comment names the `.sort()` implementation it rules out. |
| 99 upper bound | `MAX_PRODUCT_CODE_SUFFIX === 99` | `bounds the domain at 99...` | Matches the API regex and the input `maxLength={2}`. |
| 99 overflow | `['99'] -> '0'`, `['0','99'] -> '1'` | `falls back to the lowest free slot once 99 is taken` | Good choice. max+1 would be `'100'`, which the API rejects and the submit sanitizer `slice(0, 2)` would silently truncate to `'10'`, a live collision candidate. Falling back to lowest-free keeps the suggestion saveable. |
| full exhaustion | all 100 taken -> `'0'` | `returns 0 rather than 100 when the whole space is exhausted` | Acceptable. With 0..99 all occupied no suffix is saveable at all, so `'0'` reproduces today's behaviour rather than emitting an API-invalid `'100'`. Documented in the code. |
| archived + Serviço count | `[{'4', archived}, {'6', service}] -> '7'` | `counts archived rows and serviço rows too` | Correct, and I verified it end to end: `getSalesOpsSnapshot` (`apps/api/src/domains/sales-ops/service.ts:2323-2327`) selects products with `where(eq(orgId))` and **no status filter**, so archived rows genuinely reach `bootstrap.products`. The index `sales_ops_products_org_code_suffix_idx` has no `WHERE` clause, so this is required, not merely defensible. |

## Decisive check 4 - snapshot choice

`products={persistedBootstrap.products}` (`SalesOpsApp.tsx:1442`), matching every sibling prop on the
same element.

I confirmed `OptimisticCollection` in `apps/web/src/sales-ops/optimistic.ts:31` is
`'areas' | 'clients' | 'funcoes' | 'people'` and that `withoutOptimisticRows` filters exactly those
four, so `persistedBootstrap.products === bootstrap.products` by reference today. There is no
`optimistic:` product row that could inflate the max. I also confirmed `useSaveSalesOpsProduct`
(`apps/web/src/sales-ops/hooks.ts:139-149`) deliberately has **no** optimistic write.

So the choice is inert today but correct by convention, and it is the right side to be on: reading
the raw `bootstrap` here would silently start inflating the max the day products become optimistic.

## Decisive check 5 - slice 08 wizard structure

The `Final do código da venda` block is inside the `wizardStep === 1` branch
(`SalesOpsApp.tsx:3851-3877`), alongside `Nome` and `Área`, which is where it belongs on the
`Identificação` step.

The seed reaches it through a `useState` **lazy initializer** (`SalesOpsApp.tsx:3450-3458`), so it is
computed once per mount. `ProductDialog` keys `ProductDialogBody` on
`props.modal.product?.id ?? "new-${kind}-${prefillName}"` and returns `null` when `modal` is null, so
the body unmounts and remounts on every open. Two consequences I checked and both are right:

- a background bootstrap refetch mid-edit cannot re-derive the field under the operator;
- opening `Novo serviço` straight after `Novo produto` still reseeds.

There is exactly one production render site (`SalesOpsApp.tsx:1419`); the proposta wizard's produto
create row routes through the same modal state, so it inherits `products` for free. Making the prop
**required** rather than optional is the right call and is what forced the four call-site updates
instead of letting a missed site silently read as an empty catalogue.

The submit sanitizer at `SalesOpsApp.tsx:3646`
(`form.codeSuffix.replace(/\D/g, '').slice(0, 2) || '0'`) passes any value this function can emit
through unchanged, verified below.

## Adversarial work

### Mutation testing

Source backed up and restored byte-identically after every mutation
(sha256 `df40eb2f...` / `9ba31fd0...` before and after; `git status` and full `git diff` both
`diff`-identical to what I found).

**M1 - neuter the function** (`if (used.size >= 0) return '0'`, i.e. the pre-slice constant):

```
Tests  10 failed | 72 passed (82)
AssertionError: expected '0' to be '1'
AssertionError: expected '0' to be '8'
AssertionError: expected '0' to be '3'
AssertionError: expected '0' to be '11'
AssertionError: expected '0' to be '7'
...
```

Ten failures across both files, every one a concrete expected value.

**M2 - invert the edit guard**: 1 failure, the edit-path test, `expected '8' to be '3'` (above).

**M3 - loosen the regex** to a plain `Number.parseInt`:

```
× nextProductCodeSuffix > counts only strictly-shaped values, exactly as the API regex does
AssertionError: expected '0' to be '3'
 Tests  1 failed | 30 passed (31)
```

All three mutants are killed, each by the test that claims to own that behaviour. The tests assert
real values, not tautologies. In particular `nextProductCodeSuffix(rows('9','10')) === '11'` and
`rows('0','3','7') === '8'` are values a wrong implementation genuinely produces differently, and the
dialog tests read the rendered `input.value` and the `onSave` payload rather than re-calling the
function they are testing.

### Trying to break the pure function

I ran the real exported function against 31 hostile inputs via a throwaway `tsx` script in the
scratchpad (deleted; nothing was added to the repo). For each I checked (a) does the output collide
with a stored text value, and (b) does the output satisfy the API's `/^\d{1,2}$/`.

```
MAX = 99
  ok    apiOK  duplicates 5,5,5       -> "6"
  ok    apiOK  negative -1            -> "0"
  ok    apiOK  negative + real        -> "5"
  ok    apiOK  007                    -> "0"
  ok    apiOK  07                     -> "8"
  ok    apiOK  07 and 7               -> "8"
  ok    apiOK  " 7 "                  -> "0"
  ok    apiOK  " 5"                   -> "0"
  ok    apiOK  float 1.5              -> "0"
  ok    apiOK  float 99.9             -> "0"
  ok    apiOK  empty string           -> "0"
  ok    apiOK  undefined              -> "0"
  ok    apiOK  null                   -> "0"
  ok    apiOK  number 7               -> "0"
  ok    apiOK  number 7 + "3"         -> "4"
  ok    apiOK  "NaN"                  -> "0"
  ok    apiOK  hex 0x5                -> "0"
  ok    apiOK  "+5"                   -> "0"
  ok    apiOK  "1e2"                  -> "0"
  ok    apiOK  arabic-indic 7         -> "0"
  ok    apiOK  fullwidth 7            -> "0"
  ok    apiOK  "7\n"                  -> "0"
  ok    apiOK  "00"                   -> "1"
  ok    apiOK  "99"                   -> "0"
  ok    apiOK  "98","99"              -> "0"
COLLIDE apiOK  0..99 all              -> "0"
  ok    apiOK  0..99 minus 42         -> "42"
  ok    apiOK  toString object        -> "0"
  ok    apiOK  "999999999999"         -> "0"
  ok    apiOK  "Infinity"             -> "0"
  ok    apiOK  empty catalogue        -> "0"
```

I could not break it. Findings:

- **No input produces an API-invalid suffix.** All 31 outputs satisfy `/^\d{1,2}$/`. Notably no
  input reaches `'100'`, so the submit-path `slice(0, 2)` truncation can never silently retarget a
  suggestion at an occupied slot.
- **No input produces a collision except total exhaustion**, which is unavoidable and documented.
  This is not luck, and I convinced myself it is structurally sound: the function only ever emits
  a non-padded decimal in `'0'..'99'`, every such string matches the admission regex and is therefore
  always counted, so in the max+1 branch the result strictly exceeds every counted value and in the
  fallback branch it explicitly skips `used`. A row the function ignores is by definition a row whose
  text fails the regex, and therefore a row whose text can never equal any emitted value. Ignoring
  malformed rows is provably safe rather than merely conservative.
- **Prefix and padding cases behave correctly.** `'007'` is ignored and `'07'` counts as 7, which
  looks inconsistent until you note the column is `text`: `'007'`, `'07'` and `'7'` are three
  distinct rows under the unique index, and the function emits only the canonical form. `['00']`
  returns `'1'`, skipping the genuinely free text `'0'` - over-conservative by one slot, never a
  collision.
- **`' 7 '`, `'+5'`, `'1e2'`, `'٧'`, `'７'`, `'7\n'`** are all rejected rather than coerced. This is
  correct for the same reason: none of them can be produced by the API, and none of them can equal an
  emitted value.
- **Duplicates, negatives, floats, empty string, `undefined`, `null`, a `toString` object** all
  degrade to being ignored. No throw, no `NaN` leaking into `Math.max`, no `-Infinity` (the
  `used.size === 0` early return is what prevents `Math.max()` of an empty spread).
- `Math.max(...used)` spreads at most 100 elements, so there is no argument-count hazard.

## Findings

**F1 - residual: reopen-before-refetch can repeat a suffix (non-blocking).**
`useSaveSalesOpsProduct` has no optimistic write and `useAppMutation` fires
`void queryClient.invalidateQueries(...)` in `onSettled`, which runs *after* the per-call
`onSuccess: () => setModal(null)` (`apps/web/src/lib/app-mutation.ts:56-63`,
`SalesOpsApp.tsx:1434`). So the dialog closes before the bootstrap refetch has even started. An
operator who clicks `Novo produto` again inside that window reads a stale catalogue and is handed the
suffix they just consumed, producing a 23505 and the bare 500 the acceptance criteria describe.

I am not failing on this. The window is one in-flight GET, the behaviour is strictly better than the
status quo (which seeded `'0'` and therefore collided on the *second* produto every single time,
deterministically), and the durable fix is the 23505 mapping that was deliberately scoped out. Worth
carrying forward as a note attached to whichever slice picks up the `createProduct` conflict mapping,
because that mapping closes this hole completely.

**F2 - the deliberately out-of-scope bug is genuinely untouched.**
`createProduct` (`apps/api/src/domains/sales-ops/service.ts:1648-1682`) still performs a plain
`.insert().returning()` with no 23505 handling. `mapFuncaoUniqueViolation` and
`FUNCAO_UNIQUE_VIOLATIONS` are the only 23505 mappers in the file and both remain função-only. No API
file appears in the diff at all. Correct restraint - fixing it here would have been scope creep.

**F3 - the one added `aria-label` is justified, not creep.**
`aria-label="Final do código da venda"` on the raw `<input>` at `SalesOpsApp.tsx:3866`. The visible
`0000-` prefix is a sibling `div`, not a `<label>`, so before this the field had no accessible name
at all. It is what makes the field addressable by the `labeledInput` helper, it mirrors the existing
`aria-label="Área do produto"` two fields above, and it is a genuine a11y fix. The input itself is
`type="text"` with `inputMode="numeric"`, pre-existing and unmodified, so the CLAUDE.md ban on raw
`<input type="number">` is not in play.

**F4 - no other scope creep.** The three untouched-behaviour test files change by exactly one line
each (`products={[]}`), forced by the prop being required. Nothing else in the diff is unrelated to
the código default.

**F5 - documentation.** The function carries a docblock that states the unique-index constraint, the
`max + 1` rule, the admission regex and the no-zero-padding invariant; the overflow fallback and the
`??`-not-`||` guard each carry an inline rationale. The test files carry the same reasoning at
`describe` level. This is at the standard the rest of `calculations.ts` sets. CLAUDE.md does not
currently describe the código suffix rule under `Produtos & Serviços`; adding a line there at capture
time would be consistent with how slices 07 and 08 were recorded, but that is a capture-step
observation, not a Gate 2 defect.

## Verdict

**PASS.**

All three oracles are clean with a +16 test delta and no suppressions. The edit-path regression is
guarded correctly (`??`, correct operand order) and is covered by an assertion that I proved fails
for the right reason. The computation is a genuinely pure exported function that I could not break
with 31 hostile inputs, and its "ignore malformed rows" rule is provably collision-free rather than
merely defensive. Every named edge case is implemented, tested with a real expected value, and the
two judgment calls (max+1 over lowest-free, lowest-free over `'100'` on overflow) are both the right
ones. The snapshot is the persisted one. The deliberately out-of-scope 23505 bug is untouched.

One residual (F1) is worth carrying forward but does not block the merge.
