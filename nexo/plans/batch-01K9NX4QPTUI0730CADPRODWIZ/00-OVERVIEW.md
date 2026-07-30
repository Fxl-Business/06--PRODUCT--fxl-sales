---
id: 00-OVERVIEW
milestone: v2.3.0
kind: batch
trunk: master
---

# Batch: produto/serviço dialog wizardization + proposta wizard polish

## Frame

The operator compared two dialogs side by side and found the produto/serviço cadastro
dialog visibly poorer than the proposta wizard: narrower, unstepped, and padded with
persistent yellow banners.
The ask is to raise the cadastro dialog to the wizard's standard, fix a set of concrete
layout defects in the wizard itself, and close one optimistic-update regression.

Everything except slice 01 and the API half of slice 07 lands in
`apps/web/src/sales-ops/SalesOpsApp.tsx` (7175 lines), so the queue runs
**serial on `master`** - no worktree fan-out.

## Scope limits (YAGNI)

- No redesign of the proposta wizard's step model; it stays four steps.
- No new design system primitives beyond one shared info-hint affordance.
- `sales_ops_products.providers` stays deprecated and untouched.
- No change to how payables/receivables materialize.

## Slice table

| # | Slice | Intent | Wave |
|---|---|---|---|
| 01 | `funcao-optimistic` | a created função appears in `cadastros/funcoes` without waiting for the refetch | 1 |
| 02 | `wizard-shell-footer` | the proposta wizard footer is never clipped at any viewport height | 1 |
| 03 | `wizard-itens-row` | step-1 item row reads as ONE product; description is opt-in | 2 |
| 04 | `wizard-plano-layout` | step-2 `Plano de pagamento` header controls align on one grid | 2 |
| 05 | `wizard-funcao-create` | `FUNÇÃO NO PROJETO` offers inline create like every other picker | 2 |
| 06 | `wizard-custo-mode` | `CUSTO ALOCADO` accepts `%` or `R$`, matching the produto cadastro | 3 |
| 07 | `servico-base-value` | a Serviço may carry a base value instead of always `Definido na venda` | 3 |
| 08 | `produto-wizard` | the produto/serviço dialog becomes a wide stepped wizard; `Plano de pagamento padrão` sits after Setup/Mensalidade | 4 |
| 09 | `produto-codigo-default` | `Final do código da venda` defaults to the highest existing código + 1 | 5 |
| 10 | `info-hints` | persistent yellow banners become on-demand info hints in BOTH dialogs | 6 |

## Flagged for the human

Slice 07 **changes a documented invariant**. `CLAUDE.md` currently states a Serviço has
no own value and that `setupBrl`/`monthlyBrl` are forced to 0 on write, backed by a DB
CHECK on the `openPrice` projection. The operator explicitly asked for a base value on a
Serviço, so the slice relaxes that rule and updates `CLAUDE.md`. Recorded here because it
is a domain decision, not a layout fix.
