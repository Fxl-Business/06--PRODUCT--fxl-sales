# Exec report - slices 01 and 03 (web)

Branch: `feat/archive-hiding-and-purge` (not switched, not committed, not pushed).
Scope touched: `apps/web/**` only. `apps/api/**` and `CLAUDE.md` untouched.

## Slice 01 - archived rows leave the four cadastro lists

`apps/web/src/sales-ops/SalesOpsApp.tsx`

- `ProductsView`, `AreasView`, `PessoasView` and `FuncoesView` each filter to
  `status === 'active'` before anything else renders.
  A pessoa's archived literal is `inactive`, and the same filter covers it.
- `ProductsView` filters the segmented bar's COUNTS from the same filtered list, not only
  the rows.
  A segment reading `Produtos 3` above a two-row table would read as a row the list had
  lost.
- The three views with an early empty state now key it on the FILTERED list.
  Without that, an org whose only área is archived rendered a table header with no rows
  underneath it.
  `ProductsView` needed no change there - its empty branch was already keyed on the
  per-kind `visible` list.
- `CadastroArchiveButton` lost its `archived` prop, its `ArchiveRestore` branch and the
  `restoreVerb` column of the `cadastroArchive` table.
  This is the dead-code consequence the brief called out: with archived rows out of the
  lists, a row-level `Restaurar` sits on a row nobody can reach.
  Restore now exists in exactly one place, `Histórico de arquivamentos`.
- `useCadastroArchive.select` collapsed to an unconditional `setPending`.
  Its `target.status === 'active' ? onArchive(...)` branch was the un-confirmed restore
  path and is unreachable now that no control can produce `status: 'active'`.
- `archivedRowClass` (`opacity-55`) and the `ArchiveRestore` lucide import are deleted -
  no remaining reference anywhere in `apps/web/src`.
- Confirmation copy updated: every `confirmBody` used to end "…você pode restaurá-la aqui
  a qualquer momento", where "aqui" meant this table. It now says
  "no histórico de arquivamentos, em Cadastros > Geral", and each opens with
  "Ela sai desta lista e das listas de seleção…", which is the newly true fact.

### The status badge column - removed, and why

Removed in all four:

| View | Was | Now |
|---|---|---|
| `ProductsView` | inline `Arquivado` badge in the `Nome` cell | gone (there was never a `Status` column) |
| `AreasView` | `Status` column, `Ativa`/`Arquivada` | column gone |
| `PessoasView` | `Status` column, `Ativo`/`Inativo` | column gone |
| `FuncoesView` | `Status` column, `Ativa`/`Arquivada` | column gone (the `Tipo` column stays) |

A column whose value is constant by construction carries zero information and costs
width on tables that are already 5 to 9 columns wide.
Every listed row is active now, so the column could only ever read `Ativa`.
The archived vocabulary survives exactly where it still discriminates: the history panel.

### What was deliberately NOT touched

Hiding archived rows is a LIST rule, never a rule about the records that REFERENCE them.
Verified intact, each with a passing test:

- `productOption` label fallback `"<nome> (arquivado)"` (`SalesOpsApp.tsx:902`) - an
  archived produto still names the sale item that references it, and is still offered in
  that one item's picker so the edit path does not silently retarget it.
  Pinned by the pre-existing `cadastro-archive.test.tsx` Block E, unchanged and green.
- `funcaoCostOptionLabel` `"<nome> (arquivada)"` (`SalesOpsApp.tsx:2669`) - a produto cost
  row pointing at an archived função keeps its own stored value selectable and labelled.
- `selectableAreas` in `ProductDialog` - an archived-but-current área is still prepended
  into the picker it belongs to.
- `PessoasView`'s função chips are explicitly NOT filtered by the função's own status, and
  now carry a comment saying so.
  New test: `still renders the chip of an archived função a listed pessoa carries`.
- `MeuPainelView`, the wizard pickers and every `productRowRequirements` /
  `isServiceProduct` classification read are untouched.

## Slice 03 - the history handles a purged entity

Bound to what the API actually emits, read from
`apps/api/src/domains/sales-ops/purge-service.ts:271-279`:
`action: 'cadastro.purged'`, `actorUserId: 'system'`, `actorOrgId` = the purged row's own
org, and `afterJsonb: { status: 'purged', label: locked.label, actorLabel: 'Sistema' }`.
`history-service.ts:132` projects `entityLabel` as `after_jsonb ->> 'label'`, so the
snapshot reaches the panel through the field the panel already reads.

`apps/web/src/sales-ops/cadastro-history.ts`

- `CADASTRO_HISTORY_ACTIONS` gained `'cadastro.purged'` - this is the list that actually
  filters the request, and the API comment says so explicitly.
- `CadastroHistoryVerb` gained `'purge'`; `normalizeHistoryVerb` matches the literal
  exactly (`'cadastro.purge'` still resolves to `null`).
- New `RestoreState` member `{ state: 'purged' }`.
- New exported pure `purgedEntityIds(rows)` - one pass over the page.
- `restoreStateFor(row, bootstrap, purged?)` gained rule 0, ahead of every other branch:
  a purge outranks a live row still sitting in a stale bootstrap cache, because the PATCH
  would 404 either way.
  It fires both on the purge entry itself AND on the same entity's earlier ARCHIVE entry,
  which is the row an operator would actually click.
- `resolveHistoryRow` threads `purged` through and labels the event
  `Excluiu definitivamente`.
  The entity name needs no new code path: `live` is null by construction after a purge, so
  the existing `live?.name ?? row.snapshotLabel ?? row.entityId` already falls through to
  the ledger snapshot. That is now asserted rather than assumed.
- Both new parameters default to a shared frozen-empty set, so no existing call site or
  test signature changed.

`apps/web/src/sales-ops/CadastroHistoryPanel.tsx`

- `purgedEntityIds(entries)` computed once for the table, not per row - an entity's archive
  row cannot see the later purge entry on its own.
- The `Evento` badge uses the existing `Perdida` / `Imposto` palette
  (`bg-[#f6d1c5] text-[#a5341c]`) for a purge. No new colour was invented.
- The `Ações` cell renders a muted `Excluído definitivamente`, the same shape as
  `Já restaurado`, and never a disabled button - the reason the original code gives still
  holds: a disabled control reads as "try again later".
- The empty-state copy now mentions that the automatic 30-day deletion is recorded here
  too, so the panel does not describe itself as archive-only while rendering purges.

The pre-existing rule is unchanged: `Restaurar` is still offered only on an archive event
whose entity is still archived, non-optimistic and not a system função.
New test `leaves an untouched entity restorable when another one was purged` is the
positive control that the purge gate did not swallow the general case.

## Tests - updated, not deleted

Every assertion that described the old behaviour was replaced with its inverse, so real
coverage went up rather than down.

| File | Change |
|---|---|
| `cadastro-archive.test.tsx` | `restores without any confirmation…` and the two-control `type="button"` test replaced by five: one per cadastro asserting the archived row is ABSENT and its restore control is null, plus a sweep asserting zero `Restaurar`/`Reativar` controls across all four lists. Block E (archived produto still names its sale item) untouched and green. |
| `areas-view.test.tsx` | list test inverted (`not.toContain('FXL Visual')`, `not.toContain('Arquivada')`, `not.toContain('Ativa')`, one `tbody tr`); new all-archived empty-state test. |
| `pessoas-funcoes-view.test.tsx` | pessoa list test inverted; funções list test drops `Ativa` and shifts its cell indices 3 -> 2 for the removed column; new all-inactive and all-archived empty-state tests; new archived-função-chip non-regression. |
| `produtos-servicos-view.test.tsx` | new test pinning that an archived row leaves the table AND the segment counts; new all-archived-bucket empty-state test. |
| `cadastro-history.test.tsx` | action-set assertion now expects the three-action list; `normalizeHistoryVerb` and `CADASTRO_HISTORY_ACTIONS` tests extended; new Block E with five purge tests including the pure `restoreStateFor` / `purgedEntityIds` contract. |

Net: 87 tests in the five touched files, up from 66.

## Verify - all three, run once, no watch mode

`pnpm --filter @fxl-sales/web test`

```
 Test Files  48 passed (48)
      Tests  590 passed (590)
   Duration  4.55s
```

`pnpm --filter @fxl-sales/web lint`

```
> @fxl-sales/web@1.0.0 lint
> eslint src/
```

(no output, exit 0)

`pnpm run type-check`

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

Red-first was observed: before the implementation the same five files reported
`Test Files 5 failed (5) / Tests 21 failed | 66 passed (87)`, each failure naming the
archived row still present or the purge export still missing.

No process was left running - every command was a one-shot `vitest run` / `eslint` / `tsc`.

## Known gap, out of scope

`apps/web` never refetches on its own after the nightly purge runs server-side; the panel
picks the purge entry up on the next `['sales-ops']` invalidation or page load.
That is inherent to a nightly job with no push channel and was not in this slice.
