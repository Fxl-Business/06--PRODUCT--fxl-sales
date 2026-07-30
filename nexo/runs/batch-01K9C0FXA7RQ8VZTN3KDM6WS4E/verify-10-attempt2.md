# Verify (Gate 2) - slice 10 produtos-servicos-web, attempt 2

Branch `feat/10-produtos-servicos-web`, one commit `647c542` on `master` (`a7d7248`).

Verdict: **FAIL** on one item, narrowly scoped and cheap to fix.
The blocking behavioural defect from attempt 1 is genuinely closed, correctly implemented, and well pinned - I verified all of it by independent probe and by mutation, not by reading the implementer's claims.
What blocks is that the fix left `CLAUDE.md` stating the opposite of the behaviour it just shipped, in the one bullet that governs this picker.

## 1. Gates - all zero, nothing removed

Run from a clean tree, exactly as briefed:

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |
| `pnpm run build` | 0 |

Totals: web **34 files / 288 tests**, api **27 / 283**, shared-utils **1 / 17**.
Matches the brief exactly. Attempt 1 was 34/283, so the amend added 5 tests (2 clamp, 3 archived-função) and removed none.

No `.skip`, `.only`, `.todo`, `xit` or `xdescribe` anywhere under `apps/web/src`, `apps/api/src`, `apps/api/test` or `packages`.

Per-file `it()` counts against `master`: **no file lost a single `it()`**.
Only `combobox-adoption.test.tsx` moved down on `expect()` (94 -> 92), the file with attempt 1's rewritten test, which the amend did not touch and which the previous pass already judged equivalent-to-stronger.
`areas-view.test.tsx` gained 2. Everything else is identical.

## 2. The archived-função defect - probed, then mutated

I built the harness myself rather than reading the shipped tests: a throwaway probe file driving the real `ProductDialog` and the real `Combobox` (only `@/components/ui/dialog` mocked, for the portal), with a stored `Custos padrão por função` row of `valueBrl: 30000` pointing at an **archived** função `Redator`.

| Probe | Result |
| --- | --- |
| trigger text | `Redator (arquivada)` - names the função, marked archived, no placeholder, no uuid |
| money on the row | `300` |
| payload on submit | `[{"funcaoId":"…ff05","mode":"fix","valueBrl":30000}]` - the original id, carried |
| options on that row | `["Redator (arquivada)", "Desenvolvedor"]` - restorable after a stray edit; `Vendedor` (system) absent |
| deliberate change | picking `Desenvolvedor` retargets the row and submits `funcaoId` = dev, money intact |
| a NEW row's pool | `["Desenvolvedor"]` only - the archived one is not offered to a row that does not carry it |
| `Adicionar` with the archived row present and `Desenvolvedor` free | **enabled**, no tooltip |
| `Adicionar` when the eligible pool really is exhausted | disabled, title `Todas as funções já têm custo padrão` |
| unresolvable `funcaoId` (`…dead`, absent from `funcoes` entirely) | trigger reads `Função não encontrada`; the whole dialog's `textContent` does not contain the uuid |

So both halves of the defect are fixed, and the second symptom the implementer self-reported is real and is fixed.

### Both halves go Red independently

Five mutations, each applied alone to a pristine tree, each reverted after:

| Mutation | Result |
| --- | --- |
| **M1** escape hatch scoped back inside `eligibleFuncoes` (drop the `withCurrent` admission) | **Red**: `keeps naming an archived função on the cost row that already carries it` - `expected [ 'Desenvolvedor' ] to include 'Redator (arquivada)'` |
| **M2** `allFuncoesUsed` counted against the wrong pool (`usedFuncaoIds.size >= eligibleFuncoes.length`) | **Red**: `never offers an archived função to a row that does not already carry it` - the `Adicionar` click is a no-op, so row 2 never mounts |
| **M3** drop the `valueLabel` prop | **Red**: `names a cost row whose função is missing from the bootstrap…` - `expected 'Selecione a função' to be 'Função não encontrada'` |
| **M4** delete `Math.min(parcelasCeiling, …)` from `submit()` | **Red**: `clamps a hand-typed parcela count to the ceiling at submit` |
| **M5** delete the `Math.max(1, …)` floor from `submit()` | **Red**: `floors a hand-typed parcela count at one` |

Note that M1 alone still leaves the trigger *reading* correctly, because `valueLabel` covers display. The shipped test is Red anyway because it asserts the option is **offered** - i.e. it pins restorability, not just display. That is the right assertion, and it is exactly the distinction the implementer argued for.

### The `valueLabel` deviation: acceptable, and the better call

The previous verifier offered two fixes as alternatives ("admit `row.funcaoId` into `eligibleFuncoes` **or** pass a `valueLabel`"). The implementer took the first as primary and gave the second a different, narrower job. I agree, on merit:

- `valueLabel` alone repairs only the trigger text. The archived función would still be absent from the row's options, so the operator still could not restore the value after a stray edit, and picking anything would still silently retarget the cost. That is two-thirds of the defect surviving a "fix".
- The implementer's stated objection to shipping `valueLabel` as an unfalsifiable prop is correct on the facts: with admission in place, `valueLabel` is dead for every reachable archived-función state. Giving it the genuinely-unresolvable case makes it falsifiable, and **M3 proves it** - removing the prop goes Red.
- The chosen shape also matches two conventions already in the file: `selectableAreas` (L3259-3264) keeps an archived-but-current área selectable by the same prepend, and the Pessoas/Funções section of `CLAUDE.md` documents the same rule for the assignment picker.
- `Função não encontrada` rather than the placeholder or a raw id satisfies the `CLAUDE.md` UI-identifiers rule, and "não encontrada" rather than "removida" is factually right because a função is never deleted.

Not a defect. A better fix than the one suggested.

## 3. The submit clamp - now pinned, values correct

M4 and M5 above prove both halves. Values probed independently through the real dialog:

| Input | Submitted `defaultRemainingInstallments` |
| --- | --- |
| hand-typed `500`, no entrada | **120** |
| hand-typed `500` with a fixed entrada | **119** |
| hand-typed `0` | **1** |

`120` without and `119` with an entrada is right: `materializeDefaultPaymentPlan` pushes the entrada row before the parcela loop and `CreateSaleSchema` caps `installments` at 120.

## 4. Formatting - measured with prettier, not with `git diff -w`

Prettier is not a dependency and there is no config file, so I measured with `pnpm dlx prettier@3` (3.9.6) at the repo's effective style (`--parser typescript --print-width 100 --single-quote`), counting diff lines between each file version and its prettified form, and splitting whitespace-only from substantive via `difflib` on stripped lines:

| Version | prettier diff lines | non-whitespace | whitespace-only |
| --- | --- | --- | --- |
| `master` | 492 | 438 | **54** (27 source lines) |
| attempt 1 `ec2b364` | 1142 | 414 | **728** |
| branch `647c542` | 574 | 414 | **160** (80 source lines) |

Then I intersected the whitespace-only set with the set of lines the slice actually **adds** (parsed out of `git diff -U0 master..HEAD`, 808 added lines):

```
ws-only prettier deltas on ADDED lines        : 0
ws-only prettier deltas on PRE-EXISTING lines : 80
```

**Zero whitespace deltas attributable to the slice's added lines.** The brief's enumerated FAIL condition is satisfied, and this is a real, large improvement over attempt 1's ~670.

Of the 80 remaining, 23 are `master`'s own pre-existing baseline that survived the slice (L1858-1861, L3070-3073, L4892-4906; `master`'s fourth baseline run was in the deleted providers editor).

**The implementer's account of the other 57 is wrong on both facts.** It reports "the remaining 72 shifted lines are the `Módulos` block, legitimately +2 inside its new conditional, and prettier agrees with that depth". Prettier does agree about the `Módulos` block - it has **no** whitespace delta at all (L3956 region is clean), so that half of the claim checks out as a statement about `Módulos`. But the residual is not there. All 57 sit in `ProductsView`'s table, L2330-2454, and they are **under**-indented, not legitimately +2:

- On `master` the `<Table>` sat at indent 6 directly under the panel `<div>`.
- The slice wrapped it in `{visible.length === 0 ? (…) : (` at indent 6, so the block's depth rose by 2 - and the pre-existing lines were not re-indented.
- The newly added lines inside it *were* written at the correct new depth, which interleaves the two: L2338 `<TableHead …>Valor</TableHead>` sits at indent 18 while L2344 `<TableHead …>Setup</TableHead>`, at identical syntactic depth, sits at indent 12.

Because those lines were left untouched they are context lines, so `git diff -w` cannot see them either - the -w residual is still +25/-25 (808/262 plain vs 783/237 with `-w`), which is the `Módulos` block that *was* correctly re-indented.

**Not blocking**, per the brief: no formatter is configured, no gate is violated, and no added line is at fault. Recorded because the implementer's report is materially wrong about where the residual is, and because slice 11 rewrites this exact region and will inherit an interleaved indentation mismatch.

## 5. The amend is scoped

`git diff ec2b364..647c542` is 2 files. With `-w` it is 197 insertions / 9 deletions, and every one is one of the four expected things:

- `funcaoCostOptionLabel` helper, `funcaoById` map, `costRowFuncaoOptions`, `costRowFuncaoValueLabel`, and the two changed `Combobox` props (item 1);
- `usedEligibleCount` / `allFuncoesUsed` (the second symptom);
- 2 clamp tests and 3 archived-función tests (item 2);
- the balance of the 647 raw lines is the re-indentation (item 3).

Nothing else. The commit message body also changed - a clamp-pinning sentence, the archived-função bullet, and `ten` -> `twelve` fixtures, which corrects the inaccuracy attempt 1 flagged. All three in scope.

## 6. Previously-passed properties - re-confirmed, not assumed

**`providers` is still data-safe, proved against the real database.** I wrote a throwaway integration test (`apps/api/test/rls/zzverifyprobe.test.ts`, since deleted) driving the real `createProduct` / `updateProduct` through the non-superuser app role against the local Docker test DB, using the **exact** payload I captured from the shipped dialog on an edit:

```
before      >>>[{"personName": "Ana", …}, {"personName": "Bruno", …}]<<<
'providers' in UpdateProductSchema.parse(payload)  >>>false<<<
after       >>>[{"personName": "Ana", …}, {"personName": "Bruno", …}]<<<   byte-identical
afterClear  >>>[]<<<   control: sending providers: [] DOES clear it
```

So `.partial()` really does beat `.default([])`, the omission is load-bearing, and the cost row still lands.

The captured payload's key set is also the control for two other claims - it contains no `providers`, no `openPrice` and no `type`, and for a serviço it forces `setupBrl: 0` / `monthlyBrl: 0` even when the stored product carried `monthlyBrl: 50000`.

**Cost formatting.** A stored `valueBrl: 30000` renders `300` in the row input and `R$ 300,00` in the list cell, never `R$ 30.000,00`.

**Neither prestador pool re-narrowed.** `isCollaboratorPerson` has exactly one call site, and it is character-for-character identical to `master`:

```
master  L4311  bootstrap.people.filter((person) => isCollaboratorPerson(person) && person.status === 'active')
branch  L4850  bootstrap.people.filter((person) => isCollaboratorPerson(person) && person.status === 'active')
```

Slice 09 stands. The produto Prestador pool was deleted with its editor, not narrowed.

**Slice 11's labels** are all live in source and all pinned: `Tipo de entrada` (L3765/3768), `Parcelas restantes` (L3792), `Número de ciclos` (L3818/3820), asserted in `product-service-dialog.test.tsx` and `sale-wizard-edit.test.tsx`.

**Scope and invariants.** `apps/api/**` untouched by the whole slice (27 files, all `apps/web/src/sales-ops/` plus `CLAUDE.md`). No raw account or workspace id rendered - probe F confirms the dialog's `textContent` never contains the unresolvable uuid, and the diff adds no `orgId` / `accountId` / `workspaceId` / `userId` to any rendered expression. No em dash in any added line. pt-BR gender correct, including the new `(arquivada)` on the feminine `função`.

## 7. The blocking item: `CLAUDE.md` now contradicts the shipped picker

The amend did not touch `CLAUDE.md`. The bullet the slice itself added still reads:

> - The função cost picker offers active, non-system funções only. `vendedor` and `finder` are already paid by `Comissionamento padrão`, so offering them here would create two competing ways to pay one role. A função already used by another row is filtered out, so the client can never trip `duplicate_funcao_cost`.

The shipped picker **deliberately violates the first sentence**: on a row that already carries an archived função, it offers that archived función. The implementer's own code comment says so and cites the convention -

> the same rule CLAUDE.md documents for the pessoa assignment picker: an archived função stays visible on the record that already carries it while disappearing from the pool new rows draw from.

- so it read `CLAUDE.md`, correctly applied a convention from the Pessoas/Funções bullet, and left the bullet that actually governs *this* picker asserting the opposite.

Why I am counting this rather than filing it as a nit:

1. It is the same failure mode as attempt 1, inverted. Attempt 1 failed in part *because* the code contradicted the documented archived-función convention. The contradiction is still present; only its direction changed.
2. `CLAUDE.md` in this repo is prefaced "These instructions OVERRIDE any default behavior and you MUST follow them exactly as written." As written, it now instructs a future agent to remove the escape hatch - which is to re-introduce the defect. The three new tests are a backstop that would go Red, but an agent following an explicit instruction would then be reconciling a doc against tests instead of reading a doc it can trust.
3. Slice 11 rewrites this region next and will read this section.
4. The fix is one clause in a file already in the commit. Something like: "offers active, non-system funções to a NEW row; a row's own stored função stays offered even once archived, marked `(arquivada)`, and an unresolvable id reads `Função não encontrada`."

Everything else in the bullet still holds. I re-derived the duplicate guard: `costRowFuncaoOptions` filters `usedFuncaoIds` for every função except the row's own, and the prepended `current` is by definition the row's own, so no two rows can ever offer the same función. `duplicate_funcao_cost` stays unreachable, and `does not offer the same função twice` still pins it.

No other `CLAUDE.md` sentence in the touched sections was made false by the amend. I re-checked the `onCreate` bullet (the cost picker really has no `onCreate`), the `isCollaboratorPerson` "one call site left" bullet, and the `providers` bullet (probed above).

## 8. The three deferrals, ruled

**(a) The stale `Cadastros > Produtos` wizard hint - should have been closed here, non-blocking.**
`SalesOpsApp.tsx:5816` renders `Defina a área deste produto em Cadastros {'>'} Produtos.` while the nav entry this slice renamed now reads `Produtos & Serviços` (`navigation.ts:66`). The string is asserted verbatim at `sale-wizard-free-items.test.tsx:287`.
The implementer's reasons do not survive scrutiny. "String and test move as a pair" is an argument about *how* to fix it (two lines), not a reason to leave it. "Slice 11 rewrites the region" cuts the other way: if slice 11 deletes the string, fixing it now costs nothing slice 11 would not discard anyway, and until slice 11 ships the UI points an operator at a nav label that does not exist.
Not blocking, because the operator can still find the entry - first word, same icon, same position - so it is imprecise rather than misleading. But this slice created the staleness and should have closed it.

**(b) The Profissional pool - correctly deferred.**
`isCollaboratorPerson(person) && person.status === 'active'` is slice 09's decision, byte-identical to `master`, and `CLAUDE.md` now documents it explicitly as the one surviving call site. Touching it would widen this slice into the wizard for no reason.

**(c) The cost picker marks archived funções while the área picker in the same dialog does not - correctly deferred.**
The premise is real: `knownAreas` (L3259-3260) prepends an archived-but-current área, and `areaOptions` (L591-593) maps to a bare `area.name`, so in one dialog an archived función reads `Redator (arquivada)` and an archived área reads just its name.
Deferring is right. The área behaviour is pre-existing and unchanged by this slice, `areaOptions` is shared with the wizard and other pickers so changing it widens the blast radius, and unlike the função case nothing about the área is unrestorable or mislabelled - it is a polish asymmetry, not a correctness gap. When it is closed, the resolution is to mark the área too, not to unmark the função.

## 9. Equivalent mutants

Stated explicitly, since the brief asks: `parseDecimal` / `pctToInput` accepting `null`, and the `paymentMethodLabels` hoist, remain behaviourally unobservable and are correctly untested. They are equivalent mutants, not defects. The `Pix` vs `PIX` split is pre-existing and correctly left alone.

## 10. Style, reported separately and not counted

- The 57 under-indented pre-existing lines in `ProductsView`'s table (section 4).
- `usedEligibleCount` at L3294-3295 is itself indented 4 where its siblings are at 2, and its block comment's body sits at 6 with the closing `*/` at 4. Prettier does not flag it (the whole statement reflows), but it reads as drift inside the very code that fixed the drift.

## 11. Tree restored

Every probe reverted, byte-identity confirmed with `git hash-object` against `git rev-parse HEAD:<path>`:

- `apps/web/src/sales-ops/SalesOpsApp.tsx` - `59b39823e73aa4a3461d2e277cc4d2c90290b6bd`, matches `HEAD` (mutated five times, restored from a pristine copy each time).
- `apps/web/src/sales-ops/__tests__/zzverifyprobe.test.tsx` - created, deleted.
- `apps/api/test/rls/zzverifyprobe.test.ts` - created, deleted.

`git diff HEAD` is empty. `HEAD` is still `647c542` on `feat/10-produtos-servicos-web`; nothing merged, pushed, committed or amended. No process I started is still running (the one background command exited 0; every test run was `vitest run`).

`git status --porcelain` matches exactly what I found at the start:

```
?? .vscode/
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/exec-10-produtos-servicos-web.result.json
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/verify-10-produtos-servicos-web.result.json
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/verify-10.md
```

plus this report and the rewritten result JSON.

## What has to change to pass

1. **Blocking:** update the `CLAUDE.md` "Produtos & Serviços" função-cost-picker bullet so it describes the escape hatch it now ships, instead of forbidding it.
2. Recommended in the same amend, both one-liners: correct the stale `Cadastros > Produtos` hint and its paired assertion, and correct the report's attribution of the residual formatting drift (it is `ProductsView`'s table, under-indented, not the `Módulos` block).
