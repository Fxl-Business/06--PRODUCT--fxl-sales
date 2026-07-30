# Verify - slice 12 `proposta-overrides` (Gate 2)

Branch `feat/12-proposta-overrides`, single commit `1dc0032` on `master` (`d92a8e2`).

**Verdict: PASS.**

Every gate is green, drizzle does not drift, both new tenancy filters are provably load-bearing, the composite FK is provably load-bearing, a cross-tenant write is a 400 end to end, no persisted number moved, payables behaviour is unchanged, and no pre-existing test was weakened.

Four findings are reported below.
Two are pre-existing on `master` and proven so by measurement, one is a documented cosmetic inconsistency, and one is test hygiene in the new integration file.
None of them blocks the merge, and none is a regression introduced by this slice.

---

## 1. Gates

All five run by me, from the restored tree, after every probe was reverted.

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |
| `pnpm --filter @fxl-sales/api test:integration` | 0 |
| `pnpm run build` | 0 |

Totals against the stated baseline - every number rose, nothing was removed.

| Suite | Baseline | Now | Delta |
| --- | --- | --- | --- |
| web | 35 files / 320 tests | 38 / 352 | +3 files, +32 tests |
| api unit | 27 / 283 | 29 / 300 | +2 files, +17 tests |
| api integration | 18 / 88 | 19 / 101 | +1 file, +13 tests |
| shared-utils | 1 / 17 | 2 / 23 | +1 file, +6 tests |

The three new API/integration files account exactly for the deltas: `sale-margin-parity.test.ts` (6), `sale-professional-funcoes.test.ts` (11 unit), `test/rls/sale-professional-funcoes.test.ts` (13).

`pnpm --filter @fxl-sales/api db:generate` (run with `DATABASE_URL` overridden to the local Docker URL, never staging): **`No schema changes, nothing to migrate`**.
No drift, and `git status` was unchanged afterwards.

`db:migrate` was never run.
`apps/api/test/rls/setup-env.ts` still carries the hard override `process.env.DATABASE_URL = appUrl` (assignment, not `??=`), so the suite cannot fall back to the staging URL that `apps/api/.env` still holds.
All migration work went through the integration `globalSetup` against local Docker container `06--product--fxl-sales-db-1` on port 5006.

---

## 2. The cross-tenant hole

### 2.1 All four id kinds are now validated in-org

`resolvePartyContexts` (`apps/api/src/domains/sales-ops/service.ts`) resolves `sellerPersonId`, `finderPersonId`, every `professionals[].personId` and every `professionals[].funcaoId` inside the caller's `withTenant` transaction, through `and(eq(table.orgId, orgId), inArray(table.id, ids))`, and throws `SaleInputError` on any miss.
Both `createSale` and `updateSale` call it before `buildSaleLedger`.
The two snapshots the ledger writes come only from the resolved rows, so a disagreeing body label loses.

No endpoint trusts an org, user, account or workspace id from a request body - proven directly in 2.3 below.

### 2.2 Mutation probes: each filter deleted in turn, each time a test went Red

I reproduced the trap the implementer describes, and it is real.

**Probe A1** - deleted `eq(salesOpsPeople.orgId, orgId)`, leaving only `inArray(salesOpsPeople.id, personIds)`:

```
× rejects a cross-org personId even when row security cannot hide the miss (admin context)
  AssertionError: promise resolved "{ sale: { …(32) }, …(2) }" instead of rejecting
  Tests  1 failed | 12 passed (13)
```

The four app-connection tenancy tests stayed **green** with the filter gone, exactly as reported.
`sales_ops_people` is referenced by a single-column FK that does not consult the RLS predicate, so this is an accepted cross-org write.

**Probe A2** - deleted `eq(salesOpsFuncoes.orgId, orgId)`:

```
× rejects a cross-org funcaoId even when row security cannot hide the miss (admin context)
  AssertionError: expected Error: Failed query: insert into "sales_o… to be an instance of SaleInputError
  Tests  1 failed | 12 passed (13)
```

Again the app-connection test stayed green (RLS hid org B's função, so the map lookup missed and the right error was thrown for the wrong reason).
Over the admin connection the miss surfaces as a raw `23503` from the composite FK.

Both filters restored and verified byte-identical (`git hash-object`).

### 2.3 Cross-tenant write end to end

I mounted `salesOpsRouter` behind a stub middleware that sets `orgId` and drove real HTTP requests at `POST /api/v1/sales-ops/sales` with org A active and org B's ids in the body.

| Case | Status | Reason |
| --- | --- | --- |
| `professionals[].funcaoId` from org B | **400** | `funcao_not_found` |
| `professionals[].personId` from org B | **400** | `person_not_found` |
| `sellerPersonId` from org B | **400** | `seller_not_found` |
| `finderPersonId` from org B | **400** | `finder_not_found` |
| `orgId` in the body | 201 (ignored) | written into org A |
| `workspaceId` + `accountId` in the body | 201 (ignored) | written into org A |

`sales_ops_sales` and `sales_ops_sale_professionals` for org B: **0 rows**.
400, never 500, never a success.

### 2.4 The composite FK is load-bearing

I downgraded `sales_ops_sale_professionals_org_funcao_fk` in the database from `FOREIGN KEY (org_id, funcao_id) REFERENCES sales_ops_funcoes(org_id, id)` to a single-column `FOREIGN KEY (funcao_id) REFERENCES sales_ops_funcoes(id)`.

```
× the composite foreign key rejects a cross-org funcao_id even in the admin context
  AssertionError: promise resolved "[]" instead of rejecting
```

The cross-org row became storable and the test caught it.
The composite constraint was restored and re-verified from `pg_constraint`.

---

## 3. Payables

`materializeWonPayables` is unchanged apart from three call-site renames of `pctOf` to the imported `pctOfCents`.
The bodies are identical: `Math.floor((amount * rate) / 100)` in both.

Verified by integration test, over the real service and the real DB:

- `professional_cost` payables at `won` equal the overridden per-row costs (`[30000, 100000]`), every one with `receivableId === null`, one-shot at the won date.
- `seller_commission`, `finder_commission` and `tax` are generated **per receivable row** and each equals `floor(receivable.amountBrl * pct / 100)`; the per-row sums reconcile with the persisted `sellerCommissionBrl` / `finderCommissionBrl` / `taxBrl` (299999 / 69999 / 119999 on the overridden fixture).
- Reverting a `won` proposta voids the `open` `professional_cost` row and leaves a `paid` one at `paid`, with a positive control proving the revert really fired.

The status machine is untouched - the diff contains no change to `transitionSale`, `cancelContract` or the void logic.

The `"N/M"` and `"MN/M"` receivable label conventions are unchanged.
They are still built in `buildSaleLedger`; only the money block was delegated.
My master-parity probe deep-equals the entire `receivables` array, labels included, across eight shapes.

---

## 4. Margin unification - no persisted number moved

### 4.1 Against master's actual code

I materialised `master`'s `service.ts` alongside HEAD's and ran both `buildSaleLedger` implementations over identical parsed inputs, comparing the whole persisted `sale` object plus `receivables` and `items`.

Eight cases: single parcela; with finder; uneven three parcelas; bounded recorrência + uneven parcelas + finder; indefinite recorrência; all-zero; fractional percentages with odd cents; two items including a free-form row.

```
✓ src/domains/sales-ops/__tests__/zz-probe-parity.test.ts (8 tests)
```

`expect(head.sale).toEqual(base.sale)` passed in every case, which covers `total_brl`, `recurring_brl`, `seller_commission_brl`, `finder_commission_brl`, `tax_brl`, `professional_costs_brl`, `other_costs_brl`, `net_margin_brl`, `net_margin_pct`, the three `*_pct` strings, `condition`, `installments` and `payment_method`.
Integer cents throughout; `netMarginPct` is still the `toFixed(2)` string.

**No persisted number moved.**

The `...financials` spread in the object literal is safe: none of the eight keys it carries collides with the `sellerCommissionPct` / `finderCommissionPct` / `taxPct` keys written above it.

### 4.2 Client and server now agree

Not just at the arithmetic level (they import the same module) but at the *input* level, which is where they used to diverge.
I drove the **real wizard** on the edit path with a bounded recorrência of 4 cycles and three uneven parcelas - the exact shape the two implementations disagreed on - and read what it renders:

```
Total R$ 20.000,00
Margem líquida  R$ 21.227 (70.76%)
Comissão vendedor (15%)  R$ 4.499,99
Comissão finder (3.5%)   R$ 1.049,99
```

The server persists `net_margin_brl = 2122658`, `net_margin_pct = '70.76'`, `seller_commission_brl = 449999`, `finder_commission_brl = 104999` for the same proposta.
They match exactly.
On `master` the same wizard displayed `R$ 13.677 (68.4%)` against a persisted `R$ 21.226,58` - the bug is real and is fixed.

I also checked the two remaining input-shape risks and both are equivalent:

- the server drops zero-amount parcelas from `receivables` while the wizard keeps them in the preview, but `pctOfCents(0, r) === 0`, so no sum moves;
- `hasFinderForSale` is true only when `sellerIsFinder || Boolean(finderPersonId)`, and in both branches the emitted payload carries a non-empty `finderPersonId`, so the wizard's `hasFinder` is equivalent to the server's `Boolean(input.finderPersonId)`.

### 4.3 `commissionOnRecurring`

The claim that the server ignores it is **true**: `grep` finds it only in the Zod schema, the column, the settings form and the type.
Neither `buildSaleLedger` nor `materializeWonPayables` reads it.
Removing the gate from the payables preview therefore corrects an under-report rather than changing behaviour.
I drove the wizard with `commissionOnRecurring: false` and the preview now matches the server.

---

## 5. Override semantics

| Claim | Verified | How |
| --- | --- | --- |
| A hand-typed percentage survives a produto change | yes | drove the real wizard: typed 15, changed produto, still 15, while the untouched neighbour moved to the new default |
| The edit path seeds the pin from stored-vs-inherited | yes | mutation: forcing the seed to `OVERRIDE_FIELDS_NONE` turns `keeps every stored override…` Red |
| `Restaurar padrão` genuinely clears the pin | yes | mutation: dropping `setManualOverrides(false)` and keeping only `setValue(default)` turns that test Red (`expected '10' to be '12'`) |
| The pin guard itself is load-bearing | yes | mutation: removing `if (!manualOverrides.sellerCommissionPct)` turns **3** tests Red |
| A `costManual` pin survives a **função** change | yes | drove the wizard: typed `777,77`, switched Testador to Desenvolvedor, value stayed `777,77` with the chip on |

The `Restaurar padrão` test does exactly what the implementer claims: it changes the produto *afterwards*, because a restored value equals its default and the chip alone cannot distinguish a cleared pin from a live one.
I confirmed the test can fail.

I also verified `Restaurar padrão` on the **profissional cost** row: after restoring, the cost returned to the derived default, the chip was replaced by the derivation text, and a subsequent item-quantity change moved the cost from `1000` to `2000` - proving the pin was really cleared and not merely overwritten.

The render-phase guard terminates: `setCommissionDefaultsSource(currentCommissionDefaultsSource)` advances unconditionally, and `funcaoCostKey` is derived from a pure function of the items and the cadastro rows, so the next render always finds the keys equal.

---

## 6. The percent base

Specified as the sum over items whose produto declares the função of `floor(itemSubtotal * pct / 100)`, excluding the recurring mensalidade.
I drove the real wizard against a produto with `setupBrl 2_000_000` **and** `monthlyBrl 500_000`:

| Step | `CUSTO ALOCADO` | Rendered derivation |
| --- | --- | --- |
| pick `Desenvolvedor` (5% pct) | `1000` | `5% de Product A (R$ 20.000,00)` |
| pick `Testador` (fix 30000) | `300` | `R$ 300,00 de Product A` |
| item quantity 1 to 2 | `2000` | `5% de Product A (R$ 40.000,00)` |

- 5% of R$ 20.000,00 is R$ 1.000,00. **The rendered derivation matches the cents actually used**, in every case, because `describeFuncaoCostBasis` reads the same `FuncaoCostBasisEntry` the cents came from.
- The mensalidade of R$ 5.000,00 never enters the base - the derivation names R$ 20.000,00, the item subtotal alone.
- Fixed mode is subtotal-insensitive, as it should be.
- Free-form items contribute nothing (`if (!item.productId) continue;`), which is right: a row with no produto has no cadastro default to read.

The stated reason for the exclusion is correct: a `professional_cost` payable is one-shot at win with `receivableId: null`, which I confirmed in the integration suite.

---

## 7. Migration 0014

Replayed **from scratch** into a fresh database via the `globalSetup` migrate path, twice in a row.

```
MIGRATE PASS 1 OK
MIGRATE PASS 2 OK (idempotent replay of journal)
```

Catalog on the freshly replayed database:

- `sales_ops_sale_professionals_org_funcao_fk` = `FOREIGN KEY (org_id, funcao_id) REFERENCES sales_ops_funcoes(org_id, id) ON DELETE RESTRICT`
- `relrowsecurity = t`, `relforcerowsecurity = t`
- both policies present: `_tenant_isolation` and `_admin_context`, each with `USING` and `WITH CHECK`
- `sales_ops_sale_professionals_org_funcao_idx` on `(org_id, funcao_id)` present
- the FK target `sales_ops_funcoes_org_id_id_idx` (unique, `(org_id, id)`) is present from 0012

**Statement ordering is correct.** The sibling-slice hazard was `drizzle-kit` emitting a composite FK before its target index; here the target index comes from 0012 and the from-scratch replay succeeded, which is the strongest available proof.

**Backfill** verified by integration test against the shipped SQL, replayed statement by statement:

- `'  dESENVOLVEDOR  '` matched the `Desenvolvedor` cadastro row via `lower(btrim(...))` and got its `funcao_id`, keeping its original snapshot text
- `'Cargo Inexistente'` was left with `funcao_id IS NULL` and its label intact - no função was minted from a typo
- both `UPDATE`s are guarded (`WHERE funcao_name_snapshot = ''` and `WHERE funcao_id IS NULL`), so replay is a no-op; the double `migrate` above exercised this

`role` still exists as `NOT NULL` and is written with the same string as `funcao_name_snapshot` on every insert, never independently.
The only readers left are the wizard's fallback label (`row.funcaoNameSnapshot || row.role`) and the schema's optional-role refine; nothing that reads it broke, and `sale-wizard-edit.test.tsx` pins the legacy round trip.

Journal entry idx 14 is unique and in order.

---

## 8. Error paths under concurrency

I drove 90 concurrent `POST /sales` at the new write path, twice.

| Scenario | Result |
| --- | --- |
| 90 concurrent creates, all-valid party ids | 10 x 201, **80 x 500** |
| 90 concurrent creates, mixed valid / cross-org ids | 60 x **400** (all correct rejections), 7 x 201, 23 x 500 |

Every 500 is the same error:

```
PostgresError: duplicate key value violates unique constraint "sales_ops_sales_org_sequence_idx"  code: 23505
```

**This is pre-existing, and I proved it.** I ran the identical 90-way concurrency against `master`'s own `createSale`:

```
MASTER_CONCURRENCY rejected= 86 of 90; byCode= {"23505":86}
```

Master loses 86 of 90; HEAD loses 80 of 90.
The cause is the untouched `SELECT COALESCE(MAX(sequence), 0) + 1` followed by an `INSERT` in `createSale` - a classic TOCTOU against the `(org_id, sequence)` unique index.
The diff does not touch that block.

The **new** code behaves correctly under concurrency: all 60 cross-org attempts in the mixed run returned a clean 400, with no `23503` and no `23514` anywhere.
No new 500 path was introduced.

See finding **F1** below.

---

## 9. Anti-gaming

`git diff master..feat/12-proposta-overrides -- '*test*'` reviewed in full.
No `.skip`, `.only`, `.todo` or `xit` was added anywhere.

Per-file `it()` / `expect()` counts, master to HEAD - **no file lost a single one**:

| File | `it()` | `expect()` |
| --- | --- | --- |
| `produtos-servicos-migration.test.ts` | 10 -> 10 | 42 -> 43 |
| `calculations.test.ts` (web) | 14 -> 15 | 46 -> 49 |
| `combobox-adoption.test.tsx` | 18 -> 18 | 92 -> 92 |
| `sale-wizard-edit.test.tsx` | 7 -> 8 | 47 -> 48 |
| `sale-wizard-ui-contract.test.ts` | 2 -> 2 | 41 -> 48 |

The four modified pre-existing tests:

- **`produtos-servicos-migration.test.ts`** - replaced `some(idx === 14) === false` with a uniqueness-and-monotonicity invariant over the whole journal. **Stronger.** The old assertion was a claim that every later migration is obliged to break, and it was never the test's subject; the subject (0013 occupies idx 13, nothing collides) is kept and generalised.
- **`combobox-adoption.test.tsx`** - the expected first profissional moved from `Carla Prestadora` to `Ana Martins` and a função pick was added. **Equivalent**, reflecting the deliberate population widening; the seed now needs one active função because the field became a Combobox. Assertion count unchanged and the payload assertion got *more* specific (it now pins `funcaoId`).
- **`sale-wizard-edit.test.tsx`** - the positional `row.querySelectorAll('input')[0]` helper was replaced with aria-label lookups, and a new test was added. **Stronger**: an aria-label handle survives layout changes that silently invalidate a DOM position.
- **`sale-wizard-ui-contract.test.ts`** - seven assertions added, none removed, including three negative pins (`not.toContain('Custos + imposto')`, `not.toContain('Digite manualmente')`, `not.toContain("role: 'Operacional'")`). **Stronger.**

**No test was weakened.**

### `isCollaboratorPerson` deletion

On `master` the helper had exactly one consumer (`SalesOpsApp.tsx:4971`, the wizard's Profissional picker); I confirmed this with `git grep` against `master`.

The deletion is safe and does **not** undo the sibling slice that was blocked for narrowing a prestador pool.
That block was for *narrowing*; this change *widens*:

- old pool: `isCollaboratorPerson(person) && person.status === 'active'` (has at least one non-system função, and active)
- new pool: `person.status === 'active'`

The new pool is a strict **superset** of the old one, so no operator loses a name from any picker.
The stated motive - a vendedor who also delivers was being hidden - is correct, since a vendedor carries only the system `vendedor` função.
The deprecated `is_collaborator` column on the API side is untouched, and the produto Prestador picker is a different call site that this diff does not modify.

---

## 10. Scope, docs, hygiene

- **Scope.** No change to the propostas status machine, to the payables rules, or to the receivable label conventions. The one behaviour change outside the literal ask (the payables preview no longer gating on `commissionOnRecurring`) is a fix, is flagged in the commit message, and is verified above.
- **`CLAUDE.md`.** All 18 added sentences were checked against the code one by one and **every one is true.** Spot checks that mattered: the `manualOverrides` seeding description matches the initializer exactly; `role` really is written only as a mirror of `funcaoNameSnapshot`; MATCH SIMPLE really is what lets a NULL `funcao_id` pass (verified in the catalog and by a dedicated integration test); `packages/shared-utils/src/index.ts` really does `export * from './hmac.js'`, which is the stated reason the web imports the `/sale-financials` subpath; `commission_on_recurring` really is read by nothing that computes anything.
- **UI identifiers.** No raw account or workspace id is rendered. The new pickers show `displayName` and `name` via `valueLabel`.
- **pt-BR.** All new strings are pt-BR: `Alterado manualmente`, `Restaurar padrão`, `Selecione a função de cada profissional alocado.`, `Nenhuma função cadastrada`, `Nenhuma pessoa cadastrada`, `Selecionar função...`, `Buscar função...`.
- **No blocking dialog without a visible error.** The new step-3 guard sets `showCostErrors` *before* returning, so a blocked `Avançar` always renders `Selecione a função de cada profissional alocado.` plus `border-destructive` on the offending Combobox. A legacy proposta is not blocked, because its free-text `funcaoName` satisfies the predicate.
- **No `any` casts, no `as unknown as`, no swallowed `catch`** in any added line.
- **Commit hygiene.** One commit. Conventional Commit subject. Author `CauetPinciara <cauetpinciara@gmail.com>`. No trailers at all, so no co-author and no AI attribution. No em dash in any added line (`git diff | grep '^+' | grep '—'` is empty).

---

## Findings

### F1 - `createSale` sequence TOCTOU escapes as HTTP 500 (PRE-EXISTING, not this slice)

80 of 90 concurrent creates return 500 on `23505 sales_ops_sales_org_sequence_idx`.
Master returns 86 of 90 on the identical probe, so this is neither introduced nor materially worsened here, and the offending statement is untouched by the diff.
Worth its own slice: the fix is a real sequence or an `INSERT … ON CONFLICT` retry rather than `SELECT MAX(sequence) + 1`.
**Does not block slice 12.**

### F2 - Revisão `Total` no longer reconciles with `Margem líquida` (PRE-EXISTING line, newly exposed)

The Revisão card renders `Total` from `totalCents` (items only) while the margin base is now `items + bounded recorrência`.
On the probe fixture that reads `Total R$ 20.000,00` next to `Margem líquida R$ 21.227 (70,76%)` - a margin larger than the total.
Every individual number is correct and matches what is persisted; the mismatch is that the `Total` label excludes the bounded recorrência while `sales_ops_sales.total_brl` includes it.
The line is **byte-identical to master** (`formatMoneyBrl(totalCents)`, and `totalCents` itself is unchanged), so this slice did not introduce it - it made the margin correct and thereby surfaced a `Total` that was already wrong relative to what gets saved.
The follow-up is to render `financials.totalBrl` there.
**Does not block slice 12.**

### F3 - the `Alterado manualmente` chip means two different things

For the four step-3 fields the chip requires **pin AND divergence**, which the implementer correctly calls out as what keeps the marker honest.
For a profissional cost row the same chip is gated on `costManual` alone, and `deriveWizardPrefill` sets `costManual: true` unconditionally - so opening any existing proposta labels **every** profissional cost `Alterado manualmente`, including a cost that equals the produto default.
The behaviour is deliberate and documented in `CLAUDE.md` ("a prefilled row is `costManual` unconditionally"), and the underlying reason is sound (a persisted cost is a saved decision that must never be recomputed).
It is the *label* that overstates.
Cosmetic; **does not block**.

### F4 - the new integration test leaks `sales_ops_people` rows

`apps/api/test/rls/sale-professional-funcoes.test.ts`'s `afterAll` deletes nine tables but omits `sales_ops_people`.
Measured deterministically: starting from zero, one standalone run leaves **19 orphan `sales_ops_people` rows** in the shared local test DB, and every subsequent run adds 19 more.
Sibling files such as `funcoes-concurrency.test.ts` do delete it, so this is an inconsistency with the established pattern rather than a repo-wide habit.
No assertion is affected (org ids are unique per run) and nothing about the product is affected.
Test hygiene; **does not block**.

---

## Probe hygiene

Everything I mutated was restored and verified.

**Source files.** Six files hashed before and after; `git hash-object` output is identical for all six:

```
4b7cfb9d…  apps/api/src/domains/sales-ops/service.ts
807a5515…  apps/api/src/db/schema.ts
4278b1bd…  apps/web/src/sales-ops/SalesOpsApp.tsx
939d1388…  apps/web/src/sales-ops/calculations.ts
f9b90ab9…  packages/shared-utils/src/sale-financials.ts
f7d804cf…  apps/api/drizzle/0014_sale_professional_funcoes.sql
```

`git diff HEAD` is **empty**. `git status --porcelain` shows only the two entries that were present when I started (`.vscode/`, `exec-12-proposta-overrides.result.json`) plus this report and my result file. Still on `feat/12-proposta-overrides` at `1dc0032`; nothing merged, pushed, committed or amended.

**Probe files, all deleted:** `zzMasterService.ts`, `__tests__/zz-probe-parity.test.ts`, `test/rls/zz-probe-http-concurrency.test.ts`, `test/rls/zz-probe-master-concurrency.test.ts`, `__tests__/zz-probe-e2e-margin.test.tsx`, `__tests__/zz-probe-derivation.test.tsx`, `apps/api/zz-probe-replay.mts`.

**Database.** The composite FK was restored from `pg_constraint` after the downgrade probe. The scratch replay database `fxl_sales_verify12` was dropped. `pg_database` holds only `fxl_sales`, `postgres`, `template0`, `template1`; `pg_roles` holds only `postgres` and `fxl_sales_test` - no probe roles. All fixture rows removed:

```
funcoes 0 | people 0 | sales 0 | sale_professionals 0 | areas 0 | products 0
```

Migrations applied through id 18 (0014). The database is clean and working - the final five-gate run was executed against it *after* the cleanup and all five passed.
