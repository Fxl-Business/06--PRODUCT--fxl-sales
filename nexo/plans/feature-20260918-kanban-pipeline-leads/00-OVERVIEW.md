---
feature: feature-20260918-kanban-pipeline-leads
milestone: v4.1.0
run: 20260918T000000Z-kanban-pipeline-leads
token: q7k4n2ma
---

# Kanban de prospecção (CRM simples) antes da proposta

## REQUEST (verbatim, as dispatched)

> Adicionar um quadro Kanban de prospeccao (CRM simples) ANTES da proposta. Um lead carrega nome do contato, empresa, um ou mais produtos em negociacao, valor estimado, descricao e vendedor responsavel, e anda por etapas configuraveis. Mover um lead para a etapa de conversao abre automaticamente o wizard de proposta e so permite o movimento depois que a proposta for criada.

## ACCEPTANCE (verbatim, as dispatched)

1. Um lead e uma entidade propria em sales_ops_leads. Criar um lead NAO insere em sales_ops_sales e NAO consome sequence/code de proposta. Ampliar sales_ops_sales.status com etapas pre-proposta esta explicitamente fora de escopo e foi rejeitado na analise: total_brl/net_margin_pct sao NOT NULL e alimentam getSalesOpsSummary, o dashboard e computeSaleFinancials.
2. O lead carrega: nome do contato, empresa como client_id OPCIONAL mais texto livre de fallback, valor estimado em centavos inteiros num campo cujo nome deixa claro que e estimativa, descricao, seller_person_id e stage_id. Criar um lead nunca cria automaticamente linha em sales_ops_clients.
3. Produtos do lead vivem em TABELA FILHA com product_id nulavel mais snapshot de nome, espelhando sales_ops_sale_items. Nao e jsonb: a regra ja registrada em CLAUDE.md e que um id nao fica pendurado dentro de jsonb (product_funcao_costs e tabela por isso; cost_split_bp e jsonb por nao carregar id).
4. O vendedor de um lead e resolvido por person_funcoes contra a funcao de sistema vendedor, nunca pelo espelho depreciado is_seller.
5. Etapas vivem em tabela propria semeada por org com is_system, ordem e status arquivavel, seguindo o precedente de sales_ops_funcoes. Admin cria, renomeia, reordena e arquiva etapas numa tela de cadastro sob cadastros/. Uma etapa de sistema responde 409 do mesmo jeito que funcao_is_system responde hoje. Etapa nunca e deletada, apenas arquivada; salesOpsRouter continua sem verbo DELETE.
6. Existe etapa terminal negativa Perdido que EXIGE motivo: salvar a movimentacao sem motivo e rejeitada pela API com validation_error e barrada na UI antes do envio.
7. O card mostra ha quantos dias o lead esta parado na etapa atual, derivado de um stage_changed_at que muda APENAS quando a etapa muda e nao em qualquer edicao do lead.
8. Ordenacao manual dentro da coluna persiste, via coluna de posicao, e reordenar nao altera stage_changed_at.
9. Arrastar move entre colunas e reordena dentro da coluna, E existe um menu Mover para totalmente operavel por teclado que faz exatamente a mesma coisa. O drag e conveniencia, o menu e o controle real. Qualquer picker novo usa Combobox de @/components/ui/combobox; select/option/datalist nativos continuam banidos.
10. Toda movimentacao e otimista e REVERTE o card para a posicao anterior quando a API falha, seguindo o padrao ja existente em apps/web/src/sales-ops/optimistic.ts.
11. Mover um lead para a etapa que marca conversao abre o wizard de proposta pre-preenchido com empresa, vendedor, produtos, valor e descricao. O card SO muda de etapa depois que o POST /sales devolver 201. Cancelar o wizard deixa o card exatamente onde estava, sem estado intermediario persistido. Isso precisa de oraculo proprio: o wizard hoje exige cliente, item com area e totalCents > 0 antes mesmo de Salvar rascunho, entao um lead incompleto nao pode virar card fantasma numa coluna sem proposta.
12. Quando a empresa do lead nao tem client_id, a conversao resolve ou cria a linha em sales_ops_clients nesse momento, e nao antes.
13. Depois de convertido, o card entra numa coluna final SOMENTE LEITURA que espelha sale.status (draft/open/won/lost/cancelled) e nao e arrastavel. Nenhuma acao do quadro chama POST /sales/:id/transition. Arrastar um card nunca pode materializar payables: ganhar ou perder continua acontecendo na tela de propostas, que segue sendo o unico escritor de sale.status.
14. SALE_TRANSITIONS e sua EXPECTED_MATRIX ficam BYTE-INALTERADAS.
15. Admin ve o quadro completo com filtro por vendedor sob operacional/; quem carrega seller ve somente os proprios leads sob meus-dados/. O escopo por vendedor e aplicado no SERVIDOR dentro de withTenant, provado por um teste em apps/api/test/rls/ no mesmo estilo dos existentes, e nunca por filtro no cliente. A visibilidade dos workspaces continua derivando so de profile.roles via getVisibleWorkspaces.
16. Leads NAO viajam no /bootstrap. Endpoint proprio e paginado, porque getSalesOpsSnapshot ja despeja todas as vendas, itens e payables sem paginacao e leads sao a entidade de maior volume do produto.
17. Nenhum valor de lead entra em getSalesOpsSummary, no dashboard ou em computeSaleFinancials. Um teste prova que criar leads nao move nenhum numero financeiro existente.
18. Nenhuma tela nova dentro de apps/web/src/sales-ops/SalesOpsApp.tsx, que ja tem 8946 linhas. O quadro e a tela de cadastro de etapas vivem em arquivos proprios.
19. Movimentacao de etapa NAO escreve em audit_log: o ledger e hash-chained, tem trava global de cauda e nunca e purgado, e movimento de card e ruido de alta frequencia.
20. Toda query nova filtra por eq(table.orgId, c.get('orgId')) e nenhum org_id, user_id ou person_id e lido do corpo da requisicao.
21. As rotas novas entram em resolveSalesOpsRoute/buildSalesOpsPath e a URL continua sendo a unica fonte de verdade do painel e da pagina ativa. As rotas canonicas existentes nao mudam de nome nem de segmento.
22. A dependencia de drag-and-drop e adicionada com versao pinada e justificada no commit; nao existe nenhuma hoje em apps/web/package.json.
23. pnpm run lint, pnpm run type-check, pnpm test, pnpm run build e pnpm --filter @fxl-sales/api test:integration todos verdes ao final da wave.
24. CLAUDE.md ganha a secao do dominio de leads e a afirmacao de que navigation.ts esta byte-inalterado e corrigida no mesmo commit que a alterar.

## Áreas tocadas (from the dispatch)

- `apps/api/src/db/schema.ts`
- `apps/api/drizzle`
- `apps/api/src/domains/sales-ops`
- `apps/web/src/sales-ops`
- `apps/web/src/sales-ops/navigation.ts`
- `apps/web/package.json`
- `CLAUDE.md`

## Frame — o que e por quê

Hoje o produto começa na **proposta**: `sales_ops_sales` é a primeira entidade que existe, e ela
já nasce com `total_brl` / `net_margin_pct` `NOT NULL`, alimentando `getSalesOpsSummary`, o
dashboard e `computeSaleFinancials`. Não existe nenhum lugar para o trabalho que acontece *antes*
de haver números: contato, empresa, o que está em negociação, quem está tocando, e há quanto tempo
parou.

Este feature adiciona esse estágio como **entidade própria** (`sales_ops_leads`), com etapas
configuráveis por organização, um quadro Kanban, e **uma única porta de saída**: mover o lead para
a etapa de conversão abre o wizard de proposta e só confirma o movimento quando `POST /sales`
devolver `201`. Nada no quadro escreve `sale.status`, materializa payables ou toca
`SALE_TRANSITIONS`.

A decisão estruturante, já tomada na análise e registrada aqui para não ser revisitada: **não**
ampliar `sales_ops_sales.status` com etapas pré-proposta. Um lead não é uma venda com número
zerado; é outra entidade, com outro ciclo de vida, outro volume e outra tela.

## Invariantes que este feature não pode quebrar

- `SALE_TRANSITIONS` e `EXPECTED_MATRIX` **byte-inalterados**.
- `salesOpsRouter` continua **sem verbo DELETE**. Etapa arquiva, nunca deleta.
- Movimento de card **não** escreve em `audit_log`.
- Nenhum valor de lead entra em `getSalesOpsSummary`, no dashboard ou em `computeSaleFinancials`.
- Leads **não** viajam no `/bootstrap`.
- `<select>` / `<option>` / `<datalist>` nativos continuam banidos; todo picker novo é `Combobox`.
- Escopo por vendedor é aplicado **no servidor**, dentro de `withTenant`, provado em
  `apps/api/test/rls/`.
- `SalesOpsApp.tsx` (8946 linhas) não ganha nenhuma tela nova.

## Índice de slices

| id | objetivo | depends_on | wave |
|---|---|---|---|
| 01-leads-schema | Migração + schema Drizzle + RLS + seed das etapas de sistema por org | — | 1 |
| 02-api-stage-cadastro | Endpoints de etapas (criar, renomear, reordenar, arquivar; 409 de sistema) | 01 | 2 |
| 03-api-leads | CRUD de lead, listagem paginada própria, movimentação, escopo por vendedor no servidor | 02 | 3 |
| 04-web-data-layer | Tipos, client, query keys, hooks e movimentação otimista com reversão | 03 | 4 |
| 05-web-stage-cadastro | Tela `cadastros/etapas` em arquivo próprio | 04 | 5 |
| 06-web-kanban-board | Quadro em arquivo próprio: drag + menu "Mover para" por teclado, dias parados, coluna final read-only | 04 | 5 |
| 07-web-routing | `navigation.ts` + `resolveSalesOpsRoute`/`buildSalesOpsPath` + montagem no shell | 05, 06 | 6 |
| 08-web-conversion | Conversão: wizard pré-preenchido, card só move após 201, cliente resolvido na hora | 07 | 7 |

## Contrato reconciliado (2026-09-18, pós plan-check)

Os slices 01-08 foram planejados em paralelo e divergiram sobre o schema e o contrato de fio. O
plan-check (`nexo/runs/20260918T000000Z-kanban-pipeline-leads/plan-check-report.md`) achou seis
defeitos; esta seção registra as decisões que os fecham, **para que nenhum leitor posterior as
reabra**. O detalhe por slice está em
`nexo/runs/20260918T000000Z-kanban-pipeline-leads/replan-report.md`.

**Slice 01 é o dono do schema e ganha toda disputa. Slice 03 é o dono do contrato de fio.**

1. **`kind` tem exatamente três valores: `'normal' | 'conversion' | 'lost'`.** Não existe
   `'converted'` em camada nenhuma, e nunca existiu em migração, serviço ou resposta de API.
   `'open'` também não: o valor padrão é `'normal'`.
2. **Não existe coluna `slug` em `sales_ops_lead_stages`** - `kind` é a chave de máquina. Mas nome
   duplicado **é** rejeitado, porque a aceitação 5 manda seguir "o precedente de
   `sales_ops_funcoes`", e esse precedente é um índice UNIQUE de banco
   (`sales_ops_funcoes_org_name_idx`) exposto como `409 funcao_name_taken`, não uma sonda de
   serviço sujeita a corrida. Logo: `sales_ops_lead_stages_org_name_idx` UNIQUE `(org_id, name)` na
   migração 0022, e o slice 02 responde `409 {error:'conflict',reason:'stage_name_taken'}`. Existe
   um único sentinela de duplicata, `'duplicate'`. `slug`, `slugifyFuncao`, `'duplicate_slug'`,
   `stage_slug_taken` e `reserved_slug` não existem em lugar nenhum.
3. **O conceito de etapa somente-leitura foi DELETADO. Somente-leitura é propriedade do CARD.**
   `stageIsReadOnly` não existe. Um card é somente-leitura sse o lead foi convertido
   (`leadIsConverted(lead) === lead.saleId !== null`): ele não é arrastável e espelha `sale.status`
   (aceitação 13). A etapa `'conversion'` tem dois papéis diferentes conforme a direção: como
   ORIGEM não tem nada de especial (seus cards já são recusados pela regra do card); como DESTINO é
   um alvo legítimo que **nunca** move o card otimisticamente - ela devolve o controle ao fluxo de
   conversão, que abre o wizard de proposta, e o card só muda de etapa depois que `POST /sales`
   devolver `201` (aceitação 11). Cancelar deixa o card exatamente onde estava, sem nada
   persistido. Por isso `moveTargetsFor` **oferece** a etapa `'conversion'` para um lead não
   convertido e **não oferece nada** para um lead convertido; arrastar e o menu "Mover para" fazem
   exatamente a mesma coisa (aceitação 9), porque terminam no mesmo `emitMove`.
4. **Os dois routers têm identificadores distintos e não há alias de import.** Slice 02 exporta
   `leadStagesRouter` de `apps/api/src/domains/sales-ops/leads/stage-routes.ts` e monta
   `salesOpsRouter.route('/', leadStagesRouter)`. Slice 03 exporta `leadsRouter` de
   `apps/api/src/domains/sales-ops/leads/lead-routes.ts` e monta
   `salesOpsRouter.route('/leads', leadsRouter)`. Quatro linhas em `routes.ts`, dois imports, duas
   montagens, nenhum alias.
5. **`MoveLeadPayload` carrega `saleId?: string`**, e o único produtor é o `emitMove` de
   `apps/web/src/sales-ops/leads/LeadsBoard.tsx`, como `onMoveLead({ ...payload, saleId })`, depois
   de aguardar `onRequestConversion`. Não existe `board-model.ts`, não existe `LeadMoveCommand` e
   não existe `board-model.test.ts` neste feature; `LeadConversionRequest` é
   `{ lead, toStageId, toIndex }` (o campo é `lead`, não `source`).
6. **`LeadStagesView.tsx` importa `SalesOpsLeadStage` de `'./types'`**, irmão declarado pelo slice
   04 em `apps/web/src/sales-ops/leads/types.ts`. `'../types'` é o arquivo compartilhado
   `apps/web/src/sales-ops/types.ts`, que o slice 04 deixa byte-inalterado e que não declara esse
   tipo.

Duas reconciliações adicionais, achadas durante o replan e registradas aqui pelo mesmo motivo:

7. **`GET /leads` é POR COLUNA**: o `ListLeadsQuerySchema` do slice 03 declara `stageId` como
   obrigatório. O slice 04 mantém UMA entrada de cache plana (que é o que a aceitação 10 exige para
   reverter um movimento que cruza duas colunas) fazendo o fan-out dentro da `queryFn` de
   `useLeadsBoard(stages, filters)`: uma "página" do infinite query é uma rodada de pedidos, um por
   coluna, mesclada. `Carregar mais leads` é do quadro inteiro.
8. **O corpo do move é `{stageId, position, reason?, saleId?}`** e o schema é `.strict()`. O tipo
   do cliente mantém `toStageId` / `toIndex` e `leadsApi.moveLead` traduz uma única vez, com
   spreads condicionais para `reason` e `saleId`.

## Notas de decomposição

- A camada de API dos leads vive em `apps/api/src/domains/sales-ops/leads/`, montada **uma vez**
  em `routes.ts`, para não engordar mais um arquivo já compartilhado por todo o domínio.
- As telas vivem em `apps/web/src/sales-ops/leads/`, nunca dentro de `SalesOpsApp.tsx`.
- 05 e 06 são a única wave paralela: arquivos disjuntos, nenhuma dependência entre si.
- A dependência de drag-and-drop entra em 06, com versão exata (sem caret) e justificativa no
  commit, seguindo o precedente do pin exato de `@fxl-business/hub-sdk`.
