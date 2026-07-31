# Milestone v2.3.0

Released as `v2.3.0` on 2026-07-30.
The release commit is `b34c964ba80540a319e3ef19f73db2ef13fd4d3c`.

## Accomplishments

- Added the Propostas domain: every deal is a proposta with an explicit `draft|open|won|lost|cancelled` lifecycle, transition endpoints, mid-contract cancellation, and a ledger whose payables materialize only on win, per receivable row.
- Reworked the proposal write path onto a v2 payment-plan schema and rebuilt the sale wizard as the four-step Nova proposta flow.
- Replaced manual parcela editing with a declarative payment-plan builder: entrada plus restante plus recorrência regenerate the table live, every generated row stays editable, and a manual edit freezes the plan behind an explicit confirm.
- Made Pessoas and Funções first-class Cadastros, with `vendedor` and `finder` seeded as the only system funções and every other função org-created and dynamic.
- Bound a proposta's allocated profissionais to the funções cadastro, replacing both free-text escape hatches, and let a profissional cost be entered as a percentage of the função-scoped item subtotal.
- Renamed Produtos to Produtos & Serviços and classified every catalog row with a `kind` discriminator, kind-aware list columns, and a default payment plan plus default per-função costs.
- Let a Serviço carry a base value as a per-proposta default, retiring the "a Serviço has no own value" invariant and all four of its enforcement points.
- Turned the produto cadastro into a four-step wizard and defaulted a new produto's código to the highest existing suffix plus one.
- Added a configurable Áreas cadastro, required on every product and every proposal item, replacing the old free-text product `Tipo`.
- Made every commercial number a produto supplies a per-proposta default rather than a constraint, pinned by a per-field manual-override registry so a mid-edit produto change cannot clobber a stored override.
- Adopted the searchable `Combobox` everywhere and deleted every native picker, enforced by `no-restricted-syntax` in the web ESLint config.
- Routed every mutation through one query-cache refresh rail and kept dialogs open on outside click.
- Exposed client legal fields for contract data and added the propostas list view with transition actions.
- Pinned the API integration suite to the local Docker test database so it can never fall back to staging.

## Key decisions

- [Proposal payables materialize only on win, per receivable row](../../knowledge/decisions/2026-07-29-proposal-ledger-materializes-on-win.md).
- [Integration tests always run against the local Docker database](../../knowledge/decisions/2026-07-29-integration-tests-are-hermetic-local.md).
- [Escape scoping for inline layers inside a Radix dialog](../../knowledge/decisions/2026-07-30-inline-layer-escape-seam.md).
- [Never run `npx prettier` in this repo](../../knowledge/decisions/2026-07-30-no-npx-prettier.md).

## Verification and promotion

Independent release verification passed lint, type-check, 749 unit and contract tests across 72 files, 101 database integration tests across 19 files, the production build, the legacy-auth security guard, and a secret sweep of the full release diff.
The tagged commit was promoted through `staging` and then `production` without a staging validation pause under the explicit production-ready approval recorded at Gate 3.
Both promotions were fast-forwards from `db8df37`, the `v2.2.0` commit, and `master`, `staging` and `production` all rest at the tagged commit.

## Hotfix v2.3.1

`v2.3.0` did not reach production intact.
The `apps/web` deploy failed on Vercel with `TS2307: Cannot find module '@fxl-sales/shared-utils/sale-financials'`, while the API half deployed normally, so production briefly served the previous web bundle against the new API schema.

`v2.3.0` shipped the first `apps/web` import of `@fxl-sales/shared-utils` in the repo's history, and `vercel.json` builds only the web app while `packages/*/dist` is gitignored.
Every root script builds the packages first, so no local command could observe the gap and the release-verify PASS was accurate about the command it ran.

Fixed and promoted as `v2.3.1` (`cd852bdb20c222cf612959a48f9568824363a572`) on 2026-07-31.
Full detail in `nexo/runs/20260731-hotfix-vercel-build-contract/run.md`.

## Migration risk carried into production

Six migrations ship in this release, `0010_sales_ops_areas` through `0015_servico_base_value`, and the API image applies them at container start before the server serves traffic.
Three hazards were surfaced at Gate 3 and accepted by the human rather than cleared by the machine, because the staging database host is Coolify-internal and unreachable from a developer machine.

- `0013` runs `UPDATE sales_ops_products SET setup_brl = 0, monthly_brl = 0 WHERE open_price`, which is irreversible.
  It is believed inert because the old product dialog always forced both values to zero when "Preço aberto" was on, but that was never confirmed against real staging or production rows.
- `0012` creates unique indexes on área and função names per org.
  Duplicate names already present in an org would fail the migration, and because migrations run at container start, a failure means the new image does not serve.
- `0015` drops `sales_ops_products_service_no_fixed_value_check` and is forward-only.
  Rolling the API image back afterwards would leave Serviço rows carrying a value that the older code cannot re-assert, so recovery is roll-forward, never rollback.

## Verify this release in production

```sql
SELECT count(*) FROM sales_ops_products WHERE open_price AND (setup_brl <> 0 OR monthly_brl <> 0);
SELECT org_id, lower(btrim(name)), count(*) FROM sales_ops_areas GROUP BY 1, 2 HAVING count(*) > 1;
```

A non-zero first count means `0013` permanently zeroed a real price and should be escalated.
Any row from the second query means `0012` failed and the API container is not serving the new image.
