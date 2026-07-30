---
run: batch-01K9NX4QPTUI0730CADPRODWIZ
flow: batch
milestone: v2.3.0
trunk: master
mode: autopilot
started: 2026-07-30
closed: 2026-07-30
execution: serial-on-master
outcome: 12 of 12 done, 0 parked
---

# Batch run: produto/serviço wizardization + proposta wizard polish

## Why serial

Nine of the ten planned slices land in `apps/web/src/sales-ops/SalesOpsApp.tsx`, so
`files_modified` overlapped almost everywhere and no wave was parallel-safe.
`nexo-wave-exec.sh` also hardcodes a `main` trunk while this repo's trunk is `master`.
Both pointed the same way: serial on `master`, one slice = one local branch = one
`--no-ff` merge, each gated by a separate Verify agent.

## Gate 1

Skipped - `--auto`. One design decision was flagged for the human up front: slice 07
relaxes a documented `CLAUDE.md` invariant (a Serviço having no own value).

## Queue

| # | Slice | Status | Verify | Merge |
|---|---|---|---|---|
| 01 | `funcao-optimistic` | done | PASS | `4e6fe58` |
| 02 | `wizard-shell-footer` | done | PASS | `7cc86c9` |
| 03 | `wizard-itens-row` | done | PASS | `db728bd` |
| 04 | `wizard-plano-layout` | done | PASS | `839363b` |
| 05 | `wizard-funcao-create` | done | PASS (2nd dispatch) | `34f2520` |
| 06 | `wizard-custo-mode` | done | PASS | `eba648a` |
| 06.1 | `funcao-create-guard` | done | inline + full suite | `1431db2` |
| 07 | `servico-base-value` | done | **FAIL then PASS** | `207f09f` |
| 08 | `produto-wizard` | done | PASS | `b7eee6d` |
| 09 | `produto-codigo-default` | done | PASS | `f9ad914` |
| 10 | `info-hints` | done | **FAIL then PASS** | `6f743b0` |
| 10.1 | `helper-contrast` | done | inline + full suite | `88027ab` |

Slices 06.1, 10.1 were inserted mid-run from Verify findings; 04.1 was considered and
dropped once the class conflict it targeted turned out to be already fixed by slice 03.

## Gate 2 - what the separate Verify agents actually caught

Two slices were blocked and sent back. Both findings were real and neither would have
been caught by the test suite as written:

- **Slice 07** deleted the `Definido na venda` affordance outright rather than preserving
  it for the zero case. Since `centsToInput(0)` returns `"0"`, every existing Serviço -
  all of which store 0 - would have opened showing a literal `Valor base (R$): 0`. There
  was no assertion for the zero-value dialog at all. Fixed by seeding blank with a
  placeholder; the second cycle also restored an `openPrice` fallback the first cycle had
  dropped, which had forced weakened assertions across three wizard test files.
- **Slice 10** shipped an Escape handler that closed the whole wizard, discarding the
  operator's typed work, **and** a test that could not detect it: deleting the single
  protecting line left all seven tests green. Radix registers `useEscapeKeydown` on
  `document` with `{capture: true}`, so no React-tree handler can pre-empt it. Fixed at
  the `DialogContent` seam with an inline-layer registry. `Combobox` had the same latent
  hole on `master` and is fixed by the same seam.

## Final state on `master`

| Gate | Result |
|---|---|
| `pnpm run lint` | clean |
| `pnpm run type-check` | clean |
| `pnpm test` | 426 web / 41 files, 300 api / 29 files, 23 shared-utils / 2 files |
| `pnpm --filter @fxl-sales/api test:integration` | 101 / 19 files |
| `pnpm run build` | clean |

Baseline at Frame was 354 web / 38 files and 101 integration / 19. Net +72 web tests and
+3 files, nothing lost at any slice boundary.

## Not done

**No browser E2E.** Every executor flagged this independently: the dialogs need an FXL Hub
session that is not available in this environment, so all layout work is pinned at DOM and
class level rather than visually. Four slices (02, 03, 04, 08) are pure geometry and their
oracles cannot measure geometry. A human pass over the two dialogs is the missing check.

## Follow-ups filed

See `nexo/ROADMAP.md`.
