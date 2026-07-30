---
run: batch-01K9NX4QPTUI0730CADPRODWIZ
flow: batch
milestone: v2.3.0
trunk: master
mode: autopilot
started: 2026-07-30
execution: serial-on-master
---

# Batch run: produto/serviço wizardization + proposta wizard polish

## Why serial

Nine of the ten slices land in `apps/web/src/sales-ops/SalesOpsApp.tsx` (7175 lines), so
`files_modified` overlaps almost everywhere and no wave is parallel-safe. Additionally the
`nexo-wave-exec.sh` helper hardcodes a `main` trunk while this repo's trunk is `master`.
Both point the same way: run the queue **serial on `master`**, one slice = one local branch
= one `--no-ff` merge, with a separate Verify agent per slice.

## Gate 1

Skipped - `--auto`. One design decision is flagged for the human in
`nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/00-OVERVIEW.md` (slice 07 relaxes a documented
`CLAUDE.md` invariant about Serviço values).

## Queue

| # | Slice | Status | Branch | Merge SHA | Note |
|---|---|---|---|---|---|
| 01 | `funcao-optimistic` | todo | | | |
| 02 | `wizard-shell-footer` | todo | | | |
| 03 | `wizard-itens-row` | todo | | | |
| 04 | `wizard-plano-layout` | todo | | | |
| 05 | `wizard-funcao-create` | todo | | | |
| 06 | `wizard-custo-mode` | todo | | | |
| 07 | `servico-base-value` | todo | | | |
| 08 | `produto-wizard` | todo | | | |
| 09 | `produto-codigo-default` | todo | | | |
| 10 | `info-hints` | todo | | | |

## Log

- Frame + triage complete; 10 planners dispatched in parallel.
