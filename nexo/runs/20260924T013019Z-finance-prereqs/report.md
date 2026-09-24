# Relatório: finance-prereqs

## Status da solicitação
park · 6 de 9 slices entregues em master e verificados (identidade das linhas, baixa imutável na API, datas de São Paulo, revisão por linha); 07 (gate de admin e BRL), 08 (UI de baixa) e 09 (link direto) ficaram estacionados com plano completo por falta de orçamento.
Pedido: **Contexto**

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

## Entregue
- 01-sao-paulo-day  7286f2c  Vencimento, data de ganho e corte do cancelamento passam a ser o dia de São Paulo, sem escorregar um dia perto da meia-noite UTC, na API e na tela.
- 02-liquidacao-reducer  46a3cd7  Redutor puro reduzirLiquidacao com as mesmas regras do Finance: baixa ativa é a sem estorno, pago é a soma das ativas, data exibida é a maior.
- 03-ledger-schema  e22b29b  Migração 0024: tabela imutável sales_ops_settlements (UPDATE e DELETE recusados, no máximo um estorno por baixa, RLS por org), revision e updated_at nas parcelas e contas a pagar, removed_at em itens e profissionais, e baixa sintética para cada linha já paga.
- 04-update-sale-in-place  4a4045a  Editar uma proposta altera as linhas existentes pelo id e nunca apaga: o que sai do plano vira void (ou removed_at), a proposta ganha pode ser editada, e uma linha com baixa ativa bloqueia a edição com 409 nomeando a linha.
- 06-settlements-api  ca847d9  API só de admin para registrar baixa integral (data padrão hoje em São Paulo, nunca no futuro), estornar com motivo e ler o histórico; uma proposta com baixa ativa não sai de Ganha nem tem o contrato cancelado.
- 05-wizard-row-ids  67872dd  O wizard devolve os ids de itens, profissionais, parcelas e mensalidades, edita proposta ganha e mostra dentro do wizard qual linha bloqueou a edição.

## Não feito e por quê
- 07-admin-gate-and-brl  park · budget
  Gate de admin em transição, cancelar contrato, editar venda e configurações, e moeda travada em BRL. As rotas de baixa já exigem admin. Plano completo pronto para rodar. Audit: nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md
- 08-settlements-ui  park · budget
  Tela de marcar como pago, estornar e histórico. A API existe; sem esta slice a baixa só é feita pela API. Depende de 07. Audit: nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md
- 09-sale-deep-link  park · budget
  Rota /operacional/vendas/:saleId com entrada a frio pelo login. O planejador achou que hoje a rota cai no catch-all e perde o id antes do login. Depende de 08. Audit: nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md

## Decisões tomadas sem você
- Proposta ganha passa a ser editável (H1), porque a decisão PC2 inclui payables, que só existem em Ganha. (nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md)
- Rascunho segue o mesmo caminho de reconciliação por id; linhas que saem do plano viram void (H2). (nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md)
- Baixa só em linha não anulada de proposta Ganha (H3); cancelar contrato recusa se uma linha que seria anulada tem baixa ativa (H5). (nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md)
- A migração grava baixa sintética com paid_on = menor entre o dia UTC do vencimento e hoje em São Paulo, e recusa DELETE além de UPDATE, diferente do Finance. (nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md)
- Uma queda por limite de uso fez o nexo-wave-exec reverter a onda 1 sadia; reaplicado só com commits de revert, árvore idêntica à verificada. (nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md)
- As ondas 2 e 3 dividiram uma única verificação integrada completa para caber no orçamento. (nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md)

## Perguntas
1. Retomo as slices estacionadas 07, 08 e 09 (nessa ordem) numa nova run a partir dos planos prontos?
   a) Sim, rodar agora
   b) Depois
   c) outra: ___
2. O teste de concorrência da migração 0018 deu deadlock uma vez na verificação integrada (preexistente, fora deste diff). Abro uma correção de flakiness?
   a) Sim
   b) Não agora
   c) outra: ___

Responda para retomar: <n><k>
