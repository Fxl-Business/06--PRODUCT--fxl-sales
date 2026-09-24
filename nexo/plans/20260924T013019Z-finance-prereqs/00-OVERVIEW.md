---
id: 20260924T013019Z-finance-prereqs
milestone: v4.1.0
flow: feature
mode: autopilot
dispatch_token: 3yxjyf2u
---

# Sales-side prerequisites for the Sales-Finance two-way sync

## Frame

WHAT: make the Sales ledger (receivables and payables of a proposta) a stable, auditable record that another app can later mirror.
Editing a proposta preserves row ids, "paid" becomes an immutable settlement fact with a real date, financial routes are admin-only, every row carries a monotonic revision, a proposta has a URL of its own, currency is locked to BRL, and civil dates are São Paulo days.
WHY: the two-way sync (audit `nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`, sections 10 and 11) needs stable row identity (PC2), a place for "paid" to land (PC1/Q1), a revision to publish, and a deep link for Finance's "Editar no Sales".
Each item has value on its own.
Out of scope: partial payment, interest, fines, discounts, indefinite recurrence, tax, and ANY integration code (outbox, feed, events, external ids, Hub or Finance calls).

## REQUEST (verbatim)

**Contexto**

Estamos planejando uma integração de duas vias entre o FXL Sales (este repo) e o FXL Finance (`/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance`), com o FXL Hub (`/Users/cauetpinciara/Documents/fxl/projects/16--INTERNAL--fxl-hub`) como plano de controle.
Numa Organization que usa os dois apps em modo For Business, o usuário vai vender só no Sales: as contas a receber (parcelas) e a pagar (comissões, custo de profissional, outros custos) das propostas ganhas vão aparecer sozinhas no Finance, e "marcar como pago" vai valer nos dois apps, não importa onde foi feito.
Os dois apps continuam funcionando sozinhos; a integração só vale para orgs conectadas.

Leia antes de planejar:
- a auditoria completa: `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`, principalmente a seção 2.1 (Sales hoje), os pontos PC1, PC2, PC23, a seção 10 (decisões do dono) e a seção 11 (contrato consolidado v0, que substitui as seções 4 a 6 onde conflitarem);
- o desenho de baixas reais do Finance, resumido na seção 11: tabela imutável `lancamento_baixas` e o redutor `reduzirLiquidacao` em `F:packages/shared-utils/src/liquidacao.ts` (quando existir; o desenho foi aprovado, a implementação está em andamento).

**Esta tarefa NÃO constrói nada da integração** (nada de outbox, feed, eventos, ids externos ou chamadas ao Hub ou ao Finance).
Ela entrega os pré-requisitos do lado do Sales, que têm valor sozinhos.

**O que precisamos**

1. **Editar uma venda nunca apaga e recria linhas (PC2).**
   Hoje `updateSale` (`apps/api/src/domains/sales-ops/service.ts`, a partir da linha 2445) apaga todos os receivables, payables, profissionais e itens da venda e recria tudo com uuids novos.
   A regra passa a ser: editar altera as linhas existentes e preserva os ids.
   Uma linha que deixou de existir no plano novo fica anulada (`void`), não apagada.
   Isso exige que o wizard mande de volta os ids das linhas que está editando, e que o casamento nunca dependa do rótulo `N/M` (ele renumera quando uma parcela é zerada).
   Decida no plano como tratar rascunhos, justificando.
2. **Baixa real no Sales (Q1), como fato imutável, no mesmo modelo do Finance.**
   Tabela de baixas e estornos para receivables e payables: id próprio, org, linha de origem, tipo `baixa|estorno`, baixa estornada (no máximo um estorno por baixa), data real `YYYY-MM-DD`, valor em centavos, origem (`manual`; `finance` só quando a integração existir), autor com nome gravado no momento, data do registro, motivo opcional no estorno.
   Registros imutáveis (recuse UPDATE no banco).
   O estado de pago e a data do último pagamento são calculados por um redutor puro com as MESMAS regras do Finance: baixa ativa é a que não tem estorno; pago é a soma das ativas; a data exibida é a MAIOR entre as ativas.
   A coluna `status` de receivables e payables continua existindo; `paid` vira cache do redutor e `void` continua sendo decisão do Sales.
   Na v1 só existe baixa integral (valor = aberto inteiro); recuse baixa numa linha já paga.
   A data de pagamento tem padrão hoje (dia de São Paulo) e nunca pode ser no futuro.
3. **UI de baixa:** marcar como pago com a data, estornar com motivo e ver o histórico, nas parcelas e nas contas a pagar (comissões, custos), onde elas já aparecem hoje.
4. **Travas com baixa ativa:**
   - uma linha com baixa ativa não pode mudar valor nem vencimento (estorne antes), e a edição da venda precisa dizer qual linha bloqueou;
   - uma venda com baixa ativa em qualquer linha não pode sair de `won` (Q5: o estorno é manual e explícito). Isso substitui a regra atual "leaving won voids only open payables and receivables".
5. **Gate de papel nas rotas financeiras (PC23):** ganhar, reverter, cancelar contrato, editar venda, editar configurações e registrar ou estornar baixa ficam restritos a admin.
6. **Revisão por linha:** `updated_at` e uma `revision` monotônica em receivables e payables, incrementada a cada mudança de valor, vencimento, contraparte ou estado. A integração vai publicar essa revisão.
7. **Link direto para uma proposta:** o Finance vai ter um botão "Editar no Sales" que abre a proposta. Crie uma rota que abre uma proposta pelo id a partir da URL (a URL já é a fonte da verdade da navegação), inclusive em entrada a frio: sem sessão, login e volta para a proposta.
8. **Moeda travada em BRL:** a configuração `currency` não tem efeito hoje, mas a UI oferece USD. Remova a opção.
9. **Datas:** `due_date` é `timestamptz`. Garanta que vencimento e data de pagamento sejam tratados como dia de São Paulo, sem escorregar um dia por fuso.
10. Atualize o `CLAUDE.md` e `nexo/knowledge/reference/propostas.md` no mesmo change que mudar cada regra.

**Fora desta etapa:** pagamento parcial, juros, multa e desconto; recorrência indefinida; imposto; qualquer código de integração.

**Modo de execução: autopilot.** As decisões de produto já foram tomadas pelo dono (seções 10 e 11 da auditoria); não pare para pedir aprovação do plano.
Planeje os slices (schema, migração dos dados atuais, API, UI, testes oráculo de cada regra acima) e execute.
Se algo exigir uma decisão de produto que não está na auditoria, registre no `AUDIT.md` da run com a opção que você escolheu e siga.

## ACCEPTANCE (verbatim)

1. Editar uma venda (updateSale) nunca apaga linhas: receivables, payables, profissionais e itens existentes mantem o id; uma linha que saiu do plano vira void; o wizard devolve os ids das linhas editadas e o casamento nunca usa o rotulo N/M. O tratamento de rascunhos esta decidido e justificado no plano.
2. Existe uma tabela imutavel de baixas/estornos para receivables e payables (id, org, linha de origem, tipo baixa|estorno, baixa estornada com no maximo um estorno, data real YYYY-MM-DD, valor em centavos, origem manual, autor com nome snapshot, registrado_em, motivo opcional no estorno); UPDATE e recusado pelo banco; RLS por org como as demais tabelas de tenant.
3. Um redutor puro com as MESMAS regras do reduzirLiquidacao do Finance calcula pago (soma das baixas ativas, ativa = sem estorno) e a data exibida (a MAIOR entre as ativas); status paid e cache desse redutor e void continua decisao do Sales.
4. Baixa v1 so integral (valor = aberto inteiro); baixa numa linha ja paga e recusada; data padrao hoje em America/Sao_Paulo; data futura e recusada na API e na UI.
5. UI: marcar como pago com data, estornar com motivo e ver historico nas parcelas e nas contas a pagar (comissoes, custos) onde elas ja aparecem hoje.
6. Uma linha com baixa ativa nao pode mudar valor nem vencimento; a edicao da venda recusa e nomeia a linha que bloqueou. Uma venda com baixa ativa em qualquer linha nao pode sair de won (substitui 'leaving won voids only open').
7. Ganhar, reverter, cancelar contrato, editar venda, editar configuracoes e registrar/estornar baixa respondem 403 para quem nao e admin (PC23).
8. Receivables e payables tem updated_at e revision monotonica, incrementada a cada mudanca de valor, vencimento, contraparte ou estado.
9. Uma rota abre uma proposta pelo id a partir da URL, inclusive em entrada a frio: sem sessao, login e volta para a proposta.
10. A opcao USD some da configuracao de moeda; so BRL.
11. Vencimento e data de pagamento sao tratados como dia de America/Sao_Paulo sem escorregar um dia por fuso (oraculo com instante perto da meia-noite UTC).
12. Dados existentes migram: payables/receivables ja paid ganham uma baixa sintetica coerente com o redutor; CLAUDE.md e nexo/knowledge/reference/propostas.md atualizados no mesmo change de cada regra.
13. Nenhum codigo de integracao (outbox, feed, eventos, ids externos, chamadas ao Hub ou ao Finance). Decisoes de produto ausentes da auditoria (secoes 10 e 11) vao para o AUDIT.md da run com a opcao escolhida.

## Shared contract (every planner codes against THIS, not against a guess)

Planners run in parallel, so the cross-slice interfaces are fixed here.
A planner that finds this contract wrong in the real code says so in its plan's `## Contract deviations` section instead of silently diverging.

C1. São Paulo day - `packages/shared-utils/src/sao-paulo-day.ts`, exported as subpath `@fxl-sales/shared-utils/sao-paulo-day` (and from the root index).
  - `todayInSaoPaulo(now?: Date): string` returns `YYYY-MM-DD` for `America/Sao_Paulo`.
  - `saoPauloDayOf(instant: Date): string` the civil São Paulo day of an instant.
  - `isIsoDay(value: string): boolean` strict `YYYY-MM-DD` that round-trips as a real calendar day.
  - `isAfterTodayInSaoPaulo(day: string, now?: Date): boolean`.
  - Storage of `due_date` (timestamptz) is unchanged: a civil day `D` is stored as `D T00:00:00Z` and read back with the UTC slice. Only "today"-type decisions use São Paulo.
C2. Settlement reducer - `packages/shared-utils/src/liquidacao.ts`, exported as `@fxl-sales/shared-utils/liquidacao` (and root index).
  - Same rules and, as far as the Finance plan allows, the same names as Finance's `reduzirLiquidacao` (Finance plan: `/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance/nexo/plans/20260924T011357Z-feedback-socio-financeiro/01-liquidacao-redutor.md` and decision `.../nexo/knowledge/decisions/2026-09-23-baixas-for-business-e-contrato-sales.md`).
  - RESOLVED by plan-check (Finance parity wins; slice 02 is the source of truth and every later slice uses these exact names):
  - `reduzirLiquidacao({ valorOriginalCentavos, eventos })` where each event is `{ id, tipo: 'baixa' | 'estorno', estornaBaixaId: string | null, data: 'YYYY-MM-DD', valorCentavos }`.
  - Output: `{ pagoCentavos, abertoCentavos, dataUltimoPagamento: string | null, baixasAtivas: BaixaEvento[] }` (full copied facts sorted by `(data, id)`; ids are `baixasAtivas.map((b) => b.id)`). There is NO `quitado`. Active = baixa with no estorno pointing at it. Paid = sum of active (never clamped). Displayed date = the GREATEST active `data`.
  - A malformed history (estorno of an estorno or of an unknown id, second estorno, amount mismatch) THROWS `LiquidacaoErro` (never ignored); callers let it answer 500.
  - Same subpath also exports the helpers every consumer MUST use instead of re-implementing them: `eventoDeSettlement(row)` (DB row to event), `statusCacheDaLinha(status, liquidacao)` (the `paid` cache; `void` stays `void`), `temBaixaAtiva(eventos)` (the C5 lock predicate), `validarNovaBaixa(...)` and `validarEstorno(...)` (the pre-write checks returning the C5 wire codes).
  - The API imports the subpaths `@fxl-sales/shared-utils/liquidacao` and `@fxl-sales/shared-utils/sao-paulo-day`, never the root (keeps `vi.mock('@fxl-sales/shared-utils')` factories unaffected); the web must use subpaths anyway.
C3. Schema - one migration `apps/api/drizzle/0024_*.sql` (slice 03 owns ALL DDL of this feature except anything slice 07 needs for currency).
  - `sales_ops_receivables` and `sales_ops_payables` gain `revision integer NOT NULL DEFAULT 1` and `updated_at timestamptz NOT NULL DEFAULT now()`.
  - New tenant table `sales_ops_settlements`: `id uuid pk`, `org_id` (same type as other sales_ops tables), `sale_id` FK, `target_kind text CHECK IN ('receivable','payable')`, `receivable_id uuid NULL` FK, `payable_id uuid NULL` FK (exactly one set, matching `target_kind`; FKs `ON DELETE RESTRICT`), `type text CHECK IN ('baixa','estorno')`, `reverses_settlement_id uuid NULL` self-FK with a UNIQUE constraint (at most one estorno per baixa) and a CHECK that it is set iff `type = 'estorno'`, `paid_on date NOT NULL` (for an estorno it is the reversal day), `amount_brl integer NOT NULL CHECK > 0` (cents), `origin text NOT NULL DEFAULT 'manual' CHECK IN ('manual','finance')`, `actor_user_id text NOT NULL`, `actor_name text NULL` (snapshot), `recorded_at timestamptz NOT NULL DEFAULT now()`, `reason text NULL` (only on an estorno).
  - Immutability: a trigger refuses UPDATE (and DELETE, unless the Finance design shows a reason not to) with a named error. FORCE RLS with the same org policy pattern as the other sales_ops tables (`0008_single_role_rls_context.sql`).
  - Data migration: every existing `paid` receivable or payable gets ONE synthetic `baixa` coherent with the reducer (amount = row amount, `origin = 'manual'`, `actor_user_id = 'system'`, `actor_name = 'Migração'`); the planner picks the `paid_on` rule from what the table actually stores, never a future day.
  - RESOLVED by plan-check: every settlement FK is composite and leads with `org_id`; the row FKs are `(org_id, sale_id, receivable_id|payable_id)`, so a settlement's `sale_id` MUST be the target row's `sale_id` (slice 06 copies it from the row). The one-estorno rule is the partial unique index `sales_ops_settlements_one_estorno_per_baixa_idx` (`23505`). SQLSTATEs `FXS01` (UPDATE/DELETE refused), `FXS02` (estorno does not mirror its baixa), `FXS03` (backfill verification).
  - RESOLVED by plan-check: the same `0024` migration also adds `removed_at timestamptz NULL` to `sales_ops_sale_items` and `sales_ops_sale_professionals` (plus `removedAt` on both Drizzle tables), so slice 04 needs no migration of its own.
  - RESOLVED by plan-check: slice 03 alone owns the dev seed coherence (one synthetic baixa per seeded paid row, replica-mode settlement delete before re-seed) and the test cleanup helper `deleteSettlementsForOrgs` in `apps/api/src/db/__tests__/settlement-test-cleanup.ts`, which every later integration test that creates a settlement calls BEFORE deleting ledger rows or sales.
C4. Row identity on edit - `PUT /sales/:id` payload carries optional `id` on every item, professional and installment row being edited; absent `id` = new row. Matching NEVER uses the `N/M` label. A receivable or payable whose id is not in the new plan becomes `status = 'void'` (never deleted). Items and professionals keep ids too; one that leaves the payload gets `removed_at` (never deleted) and every reader filters `removed_at IS NULL`.
  - RESOLVED by plan-check: recurring cycles are not payload rows, so their ids travel as `recurring.receivableIds?: string[]` where index `i` is the live `M` row of cycle `i + 1` (the stored non-void `M` rows sorted by due date). Its length is at most `recurring.cycles` (API answers `400 validation_error` `recurring_ids_exceed_cycles` otherwise), so the wizard sends only the first `cycles` ids and the API voids every live `M` row not listed. Indefinite recurrence has no `M` rows and sends no list.
  - RESOLVED by plan-check: `PUT /sales/:id` keeps status: from `draft|open` the body says `draft` or `open`; from `won` the body MUST say `won` ("won stays won", accepted); `draft|open -> won` and `won -> draft|open` through PUT answer `409 invalid_status_change`; `lost|cancelled` answer `409 sale_not_editable`. The wizard saves a won proposta with `status: 'won'`.
C5. Locks and errors (JSON `{ error: <code>, ... }`):
  - editing value or due date of a row with an active baixa: `409 { error: 'row_has_active_settlement', rows: [{ kind: 'receivable'|'payable', id, label }] }`.
  - leaving `won` (transition to anything) with any active baixa on the sale: `409 { error: 'sale_has_active_settlements', rows: [...] }` (same row shape).
  - settlement errors: `409 already_paid`, `409 row_void`, `409 sale_not_won`, `409 already_reversed`, `422 paid_on_in_future`, `422 invalid_paid_on`, `404 not_found`.
  - RESOLVED by plan-check, `rows[].label` (one function, `ledgerRowLabel` family exported by slice 04 from `ledger-reconcile.ts`, reused by slice 06): a receivable is its stored label (`2/3`, `M1/12`); a payable is `<beneficiaryName> (<linked receivable label>)` or `<beneficiaryName>` alone when it has no receivable (`Ana Martins (2/3)`, `Outros custos`). Rows are ordered receivables first, then payables. The UI prints its own prefix (`A parcela 2/3`, `A conta a pagar Ana Martins (2/3)`) or a bootstrap description, and never prints `id`.
  - RESOLVED by plan-check, web transport: slice 05 adds `rows?: ApiErrorRow[]` (`ApiErrorRow = { kind: 'receivable' | 'payable'; id: string; label: string }`) to `ApiError` in `apps/web/src/lib/api-client.ts`, filled in both `apiFetch` and `apiFetchBlob` only when `Array.isArray(body.rows)`. No other body field is kept. Slice 08 reuses it and does not touch `api-client.ts`.
C6. Settlement routes (slice 06) on `salesOpsRouter`, all `requireAdmin`:
  - `POST /api/v1/sales-ops/settlements` body `{ targetKind: 'receivable'|'payable', targetId, paidOn?: 'YYYY-MM-DD' }` (default São Paulo today; amount is ALWAYS the whole open amount, never from the body).
  - `POST /api/v1/sales-ops/settlements/:id/reverse` body `{ reason?: string }` (reversal day = São Paulo today).
  - `GET /api/v1/sales-ops/sales/:id/settlements` returns the sale's full history, newest first.
  - `/bootstrap` receivables and payables gain `revision`, `updatedAt`, and `paidOn: string | null` (reducer output); bootstrap gains nothing else unless the UI slice needs it.
  - RESOLVED by plan-check, response shapes: both POSTs answer `201 { settlement: SettlementEntry, row: { kind, id, status, revision, updatedAt, paidOn } }`; the GET answers `200 { settlements: SettlementEntry[] }` with `SettlementEntry = { id, saleId, targetKind, receivableId: string | null, payableId: string | null, type: 'baixa' | 'estorno', reversesSettlementId: string | null, reversedBySettlementId: string | null, paidOn: 'YYYY-MM-DD', amountBrl, origin: 'manual' | 'finance', actorName: string | null, recordedAt: ISO instant, reason: string | null }`. `actor_user_id` is NEVER projected; the UI builds row descriptions from the bootstrap, so the entry carries no label.
  - RESOLVED by plan-check, lock order: every ledger writer locks the parent `sales_ops_sales` row FIRST and the ledger row(s) second. `updateSale`, `transitionSale` and `cancelContract` take the sale `FOR UPDATE`; settlement writes take the sale `FOR SHARE` (conflicts with `FOR UPDATE`, lets two baixas on different rows of one sale proceed) and then the target row `FOR UPDATE`. No writer locks a ledger row before its sale, so no deadlock.
C7. Revision - `revision` increments by exactly 1 (and `updated_at = now()`) in the same statement as any change of amount, due date, counterparty (beneficiary / person) or status (`open|paid|void`) of that row; a no-op edit does not bump.
C8. Deep link - the web path `/operacional/vendas/:saleId` opens that proposta (the Finance `deepLinkPath`). Cold entry without a session goes to login and returns to the same path.

## HOW decisions taken without the human (autopilot; mirrored into AUDIT.md)

H1. Won propostas become editable. The owner's PC2 decision says editing alters existing receivables AND payables, and payables exist only on `won`; the section 11 row lock and Finance's "Editar no Sales" button are only meaningful if a won proposta can be edited. `updateSale` accepts `draft|open|won`, still refuses `lost|cancelled`; on `won` the payables are reconciled in place (ids kept, removed ones voided). Product decision not explicit in the audit: recorded in AUDIT.md.
H2. Drafts follow the SAME reconcile path as every other editable status (ids preserved, rows that left the plan become `void`). Justification: one code path with no status branch; a draft can go straight to `won`, so its ids must already be stable; void rows carry no money in any summary. The cost (void rows accumulate on a much-edited draft) is invisible because void rows are hidden from the wizard and do not count.
H3. A baixa is only allowed on a non-void row of a `won` proposta (a draft/open proposta's receivables are projections, not obligations).
H4. PC23 gate: `requireAdmin` on `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id`, `PUT /settings` and every settlement route. `POST /sales` stays open to non-admins (the seller's lead conversion creates propostas) but answers 403 when the body asks for `status: 'won'` and the caller is not admin.
H5. `cancel-contract` refuses (409 `sale_has_active_settlements`) when any row it would void has an active baixa.
H7. (plan-check) Error surfaces on the web: the wizard's own save error (slice 05, `describeSaleSaveError`, inside the open wizard) and the dialogs' own errors (slice 08, `settlementErrorMessage`, inside the open dialog) stay local to their dialog; every other failed sales-ops mutation (transition, cancel-contract, settings) renders slice 07's `MutationErrorBanner`, which slice 08 extends with the named blocking rows of a `409 sale_has_active_settlements`. There is no second page-level error component. Every 403 copy on these surfaces is `MUTATION_ERROR_COPY.adminRequired`.
H6. Execution is SERIAL (one slice at a time, still each in its own worktree): every API slice runs the integration suite against the one local Docker test DB, and two worktrees migrating it with different migration sets at once would corrupt each other's runs.

## Slice index (intended; `waves.sh` derives the real waves)

| id | goal | depends_on |
| --- | --- | --- |
| 01-sao-paulo-day | C1 helper; API "today" decisions (won date, cancel cut-off) and web due-date display stop slipping a day | - |
| 02-liquidacao-reducer | C2 pure reducer with Finance parity oracles | - |
| 03-ledger-schema | C3 migration: revision, updated_at, immutable settlements table with RLS, synthetic baixas for existing paid rows | - |
| 04-update-sale-in-place | C4/C5/C7 API: reconcile by id, void removed, won editable (H1), lock rows with active baixa, revision bumps | 01, 02, 03 |
| 05-wizard-row-ids | web wizard sends row ids, edits a won proposta, shows which row blocked | 04 |
| 06-settlements-api | C6 routes, reducer-backed paid cache, leave-won lock, cancel-contract lock (H5) | 04 |
| 07-admin-gate-and-brl | H4 role gate on the financial routes; currency locked to BRL in API and UI | 05, 06 |
| 08-settlements-ui | mark paid with date, reverse with reason, history, in the sale detail and the payables list | 05, 06, 07 |
| 09-sale-deep-link | C8 route, including cold entry through login | 08 |
