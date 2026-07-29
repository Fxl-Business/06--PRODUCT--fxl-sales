---
id: 00-OVERVIEW
milestone: v2.3.0
kind: batch
run: batch-01K9C0FXA7RQ8VZTN3KDM6WS4E
created: 2026-07-29
gate1: skipped-autopilot
---

# Batch: UX rails + Pessoas/Funções + Produtos & Serviços + payment builder

## Frame

### What
A 12-item queue covering three things at once:

1. **Application-wide UX rails** - optimistic/automatic list refresh after every mutation, dialogs that never close on outside click, a searchable Combobox primitive with an explicit "create new" affordance, and the removal of every native OS picker.
2. **A people/roles data model** - `Pessoas` (people) and `Funções` (roles) become first-class org-configurable cadastros; `vendedor` and `finder` become predefined funções attached to a pessoa instead of two dedicated cadastro screens.
3. **Produtos & Serviços** - one Cadastros screen with a `Produto | Serviço` toggle, where a Serviço carries variable value plus default cost configuration per função, and every default is overridable inside a proposta.

Plus a redesigned payment-plan builder in the proposta wizard that generates installments automatically from an "entrada + restante em N x + recorrência" structure.

### Why
The current UI leaks implementation seams to the operator: lists need a manual reload after a create, dialogs lose typed work on a stray click, native pickers can't be searched, and people/roles are hardcoded as two special-cased screens so an org can't model its own team. Product configuration is also too thin to prefill a proposta, which forces re-typing the same commission and cost numbers on every deal.

### Locked design decisions (answered by the human at Frame, 2026-07-29)
- **Pessoas + Funções:** unified model. New `pessoas` cadastro plus `funcoes` cadastro. `vendedor` / `finder` become predefined funções attached to a pessoa. Existing sellers/finders migrate into pessoas + função assignments. The dedicated `cadastros/vendedores` and `cadastros/finders` screens are replaced by Pessoas. Tático and Meus dados screens stay.
- **Produtos & Serviços:** one screen renamed "Produtos & Serviços" with a `Produto | Serviço` toggle. Serviço unlocks variable value + função cost defaults; Produto keeps its own fixed value. One route, one list, one adaptive dialog.
- **Payment plan:** structured preset builder, no "Dividir" / "+ parcela" toggling. `Entrada (nenhuma | % | R$)` + `Restante em N x` + `Recorrência (mensalidade a partir de / ciclos)`. Rows regenerate live and each generated row stays editable for exceptions.
- **Mode:** autopilot. Gate 1 skipped; Gate 2 (separate Verify agent, local) enforced on every slice; Gate 3 stays human.

### Acceptance (batch level)
- Creating an Área in `cadastros/areas` shows it in the list with no manual reload; the same holds for every create/update/delete in the app.
- Clicking outside any open dialog does not close it.
- Typing a name that matches nothing in a picker shows an explicit `Criar novo <entidade> "<texto>"` row.
- No native `<select>` or native date/number spinner picker remains in `apps/web/src`.
- `cadastros/pessoas` and `cadastros/funcoes` exist; `cadastros/vendedores` and `cadastros/finders` no longer exist as separate cadastro screens; existing seller/finder records are reachable as pessoas with the matching função.
- `cadastros/produtos` renders as "Produtos & Serviços" with a working `Produto | Serviço` toggle and a Serviço carries default função costs.
- In the proposta wizard, entering `Entrada 50%` + `Restante 3 x` generates 4 editable installment rows summing to the proposta total.
- Every product/service default (seller %, finder %, costs, função costs, payment plan) is editable inside the proposta without changing the cadastro.

### Scope limits (YAGNI)
- No change to the propostas status machine, payables/receivables materialization rules, or the `"N/M"` / `"MN/M"` receivable label conventions.
- No change to the Hub auth model, tenancy filtering, or the `AppRole` visibility rules in `navigation.ts`.
- Legacy route trees `/admin/*`, `/finder/*`, `/seller/*`, `/no-role` stay untouched.
- No i18n extraction work; pt-BR strings stay where they already live.
- No new charting, reporting, or export surface.

## Slice table

| # | Slice | Source item | Depends on | Wave |
|---|---|---|---|---|
| 01 | `query-cache-refresh` | 1 | - | 1 |
| 02 | `dialog-no-outside-close` | 2 | - | 1 |
| 03 | `combobox-primitive` | 3, 4 | - | 1 |
| 04 | `itens-section-align` | 6 | - | 1 |
| 05 | `pessoas-funcoes-api` | 11 | - | 1 |
| 06 | `combobox-adoption` | 3, 4 | 03 | 2 |
| 07 | `produtos-servicos-api` | 5, 9 | 05 | 2 |
| 08 | `service-description-optional` | 7 | 07 | 3 |
| 09 | `pessoas-funcoes-web` | 11 | 05, 06 | 3 |
| 10 | `produtos-servicos-web` | 5, 9 | 06, 07 | 3 |
| 11 | `payment-plan-builder` | 10 | 06 | 3 |
| 12 | `proposta-overrides` | 8, 11 | 07, 11 | 4 |

Waves are derived by `waves.sh` from `depends_on`; the column above is the expected assignment.
Execution is **serial-on-`master`** (batch tier): one slice = one local branch = one `--no-ff`
merge, each gated by a separate Verify agent.

## Deliberately excluded (flag to the human)

Native `<input type="date">` fields are **kept**. Item 4's "no standard input pickers" rule is
applied to every dropdown/select picker (the searchability problem it describes) and to the native
number spinners, but the screenshots the human picked as the preferred payment layout use the native
date field, so replacing it is treated as a separate decision rather than assumed here.
