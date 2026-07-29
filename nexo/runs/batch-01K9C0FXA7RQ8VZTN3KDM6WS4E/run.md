---
run: batch-01K9C0FXA7RQ8VZTN3KDM6WS4E
flow: batch
milestone: v2.3.0
mode: autopilot
trunk: master
started: 2026-07-29
gate1: skipped-autopilot
plan_set: nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/
---

# Run: UX rails + Pessoas/Funções + Produtos & Serviços + payment builder

Frame, locked design decisions, batch-level acceptance and scope limits live in
`nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/00-OVERVIEW.md`.

Execution is serial-on-`master` (batch tier). `nexo-wave-exec.sh` is **not** used: it hardcodes
`main` as the trunk and this repo's trunk is `master`. The orchestrator drives the merge sequence
directly, one slice at a time, each gated by a separate local Verify agent (Gate 2).

## Queue

| # | Slice | Status | Branch | Verify | Merge SHA | Note |
|---|---|---|---|---|---|---|
| 01 | query-cache-refresh | todo | | | | wave 1 |
| 02 | dialog-no-outside-close | todo | | | | wave 1 |
| 03 | combobox-primitive | todo | | | | wave 1 |
| 04 | itens-section-align | todo | | | | wave 1 |
| 05 | pessoas-funcoes-api | todo | | | | wave 1 |
| 06 | combobox-adoption | todo | | | | wave 2 |
| 07 | produtos-servicos-api | todo | | | | wave 2 |
| 08 | service-description-optional | todo | | | | wave 3 |
| 09 | pessoas-funcoes-web | todo | | | | wave 3 |
| 10 | produtos-servicos-web | todo | | | | wave 3 |
| 11 | payment-plan-builder | todo | | | | wave 3 |
| 12 | proposta-overrides | todo | | | | wave 4 |

## Oracle command forms (verified 2026-07-29 - overrides any plan file that says otherwise)

`pnpm --filter <pkg> test -- --run <path>` does **not** filter: pnpm swallows the positional and all
21 web test files run (measured: 21 files / 122 tests instead of 1 file / 7 tests).
Use `exec vitest run` instead:

```bash
# web, single file
CI=true pnpm --filter @fxl-sales/web exec vitest run <path-relative-to-apps/web>
# api unit, single file
CI=true pnpm --filter @fxl-sales/api exec vitest run <path-relative-to-apps/api>
# api integration, single file (needs the local Docker test DB up)
VITEST_INTEGRATION=1 CI=true pnpm --filter @fxl-sales/api exec vitest run <path>
```

Executors must use these forms for the per-slice fast verify regardless of what their plan file
states. Full-suite wave verify stays `pnpm run lint && pnpm run type-check && CI=true pnpm test`.

## Baseline (master, pre-batch)

`pnpm run lint` exit 0 · `pnpm run type-check` exit 0 · `CI=true pnpm test` exit 0
(21 web test files / 122 web tests passing, api suite passing).

## Slice log
