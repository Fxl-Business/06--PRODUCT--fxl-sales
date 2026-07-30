# Roadmap

## Backlog

(one line per intent; Nexo files new requests here)

- feat: dashboard funnel per área/produto/vendedor with real month filtering (Phase 2 of Propostas)
- feat: contract document generation from a won proposta (Phase 3)
- chore: add mutation testing tooling (feature-boundary gate currently skipped)
- chore: real .env.dev.example flow - local DATABASE_URL should not point at staging by default
- fix: `createProduct` / `updateProduct` have no 23505 handling, so a duplicate `code_suffix` escapes as a bare HTTP 500. `createFuncao`'s `FUNCAO_UNIQUE_VIOLATIONS` is the precedent; map to `400 validation_error / duplicate_code_suffix`. Batch `01K9NX4QPTUI0730CADPRODWIZ` slice 09 made a collision much rarer but did not remove it: `useAppMutation` invalidates in `onSettled`, after the modal closes, so reopening the dialog inside that one in-flight GET still reads a stale catalogue and repeats the suffix.
- chore: a11y sweep of the 11.5px muted body copy. `#8b8b92` on white is 3.38:1, under WCAG 1.4.3 AA's 4.5:1, and appears at 11.5px in the sidebar, the produto dialog and the wizard. Batch `01K9NX4QPTUI0730CADPRODWIZ` fixed only the two lines it touched (to `#6a6a72`, 5.36:1) rather than restyling app-wide unasked.
- chore: `formatProductCommission` vs `formatFuncaoCost` are one keystroke apart and format different units (reais vs cents). Consider making the cents type nominal so the wrong one cannot compile.
- test: a Serviço carrying a base mensalidade now auto-suggests recorrência in the wizard (`hasMonthly && monthlyBrl > 0`), which was unreachable before slice 07. Correct and desirable, but untested and unremarked in CLAUDE.md.
