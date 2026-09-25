# Relatório: finance-prereqs-07-10

## Status da solicitação
pass · Tudo o que foi pedido está no master e verificado (07, 08, 09 e o flake da 0018), mais três correções achadas no caminho (tipos nos testes da API, totais do mês, hubAuth no dev-fake); master não foi enviado ao origin, nada promovido nem tagueado.
Pedido: Sales: slices 07 (gate de admin e BRL), 08 (UI de baixa), 09 (link direto da proposta) da run finance-prereqs, mais o teste instavel da migracao 0018 (nexo/playbooks/sales-finance-integration/04-prompt-sales-slices-07-09.md)

## Entregue
- 07-admin-gate-and-brl  e8ea0b9  Transição, cancelar contrato, editar proposta e salvar configurações só para admin (403 admin_role_required); POST /sales recusa status won de não-admin antes da validação. Moeda travada em BRL na API e na tela (Real (BRL) somente leitura). Um 403 nessas ações mostra um aviso na própria tela, sem ForbiddenPanel. É o gate G2 do Hub.
- 10-migration-0018-deadlock  c79abed  Causa real: a migração 0024 travava receivables e depois payables, e o tráfego do teste fazia o inverso (30% de falha serial, 57% concorrente). O runner de migração agora espera lock no máximo metade do deadlock_timeout e refaz a unidade inteira até 50 vezes; o teste ficou intacto e passou 30/30 serial e 21/21 concorrente, sem deadlock. Vale também para produção, onde o mesmo ciclo podia derrubar um deploy.
- 13-fake-identity-hubauth  c20d24f  No make dev-fake o contexto da requisição não tinha hubAuth: baixas saíam como 'Autor não identificado' e o escopo de leads do seller ficava sem e-mail. Corrigido no ponto único applyHubAuthContext, sem branch por requisição.
- 11-api-test-typecheck  575bc5a  O type-check não cobria apps/api/test; 115 erros de tipo corrigidos sem afrouxar nenhuma asserção, e o type-check agora inclui a árvore de testes.
- 08-settlements-ui  80d425c  Admin em Operacional marca parcela ou conta a pagar como paga (data padrão hoje em São Paulo, nunca futura), estorna com motivo e vê o histórico, no detalhe da proposta e em Comissões. Linhas não mudam de lugar depois de uma baixa; o aviso de reabrir ou cancelar contrato recusado nomeia as linhas bloqueadas. Meus dados fica só leitura.
- 09-sale-deep-link  416c1a2  /operacional/vendas/:saleId abre a proposta pela URL, inclusive a frio (login e volta para a proposta), e um returnTo antigo não sequestra a volta. Id desconhecido ou de outra org mostra 'Proposta não encontrada' sem o id. O card convertido do kanban abre a proposta.
- 12-month-totals  39a8f50  'Total pago no mês' e 'Receita ganha no mês' somavam tudo desde sempre; agora contam só o mês de São Paulo (pela data de pagamento e pelo dia da vitória). A visibilidade das ações de baixa ganhou teste automatizado.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- A run foi executada nesta sessão aberta no checkout principal (em vez de só gerar um dispatch), com registros e slices em worktrees próprias. (nexo/runs/20260925T191541Z-finance-prereqs-07-10/AUDIT.md P1)
- A worktree antiga da run finance-prereqs não foi removida: ela tem uma mudança não commitada em budget.json, como o passo 0 manda. (AUDIT.md P2)
- Os planos 07-09 foram reaproveitados após revalidação contra o código de hoje (todos válidos, só linhas mudaram); só as slices novas foram planejadas e checadas. (AUDIT.md P3)
- Três slices entraram no meio da run: 11 (tipos nos testes da API), 12 (totais do mês) e 13 (hubAuth no dev-fake), achadas pelos executores; isso esgotou o orçamento de replanejamento. (AUDIT.md P6, P7, P8, P10)
- 'No mês' passou a significar o mês civil de São Paulo de hoje: pagamentos pela data da baixa (paidOn), receita ganha pelo dia de São Paulo da vitória, nunca pelo vencimento. (AUDIT.md P7; CLAUDE.md Civil days)
- O redirecionamento do seller de /meus-dados/vendas para vendedores é intencional (vendas em meus-dados é a tela do finder) e não foi mexido. (AUDIT.md P9)
- A regra canSettle foi movida sem mudança para canSettleInWorkspace, para poder ser testada. (AUDIT.md P17)
- O master fica à frente do origin sem push, como já estava antes da run; nada promovido nem tagueado, e a migração 0024 em staging e produção continua decisão sua.

## Perguntas
1. Um seller vê em meus-dados/comissões as contas a pagar de toda a org (o /bootstrap é por org, não por papel). Ele pode ver comissões de outras pessoas?
   a) Não: restringir no servidor às contas a pagar dele
   b) Sim, é intencional
   c) outra: ___
2. 'A pagar este mês' na barra lateral soma todas as contas abertas, de qualquer mês. O que deve contar? (ou mudar só o rótulo)
   a) Só vencimento no mês de São Paulo
   b) Vencimento no mês mais as vencidas
   c) outra: ___
3. Ficaram no ROADMAP quatro achados fora do escopo: o guard de docs do dev-fake que nunca existiu, a tela não responsiva em 390px, o returnTo antigo numa entrada em /, e testes de auth da API que estouram tempo sob carga. Abro uma run para eles?
   a) Sim, rodar agora
   b) Depois
   c) outra: ___
4. Faço o push do master para o origin?
   a) Sim
   b) Não, eu faço
   c) outra: ___

Responda para retomar: <n><k>
