# Prompt para o FXL Sales: pré-requisitos locais da integração com o Finance

Como rodar: `/nexo --feature --autopilot` com o bloco abaixo como pedido, a partir do `master`.

> **Contexto**
>
> Estamos planejando uma integração de duas vias entre o FXL Sales (este repo) e o FXL Finance (`/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance`), com o FXL Hub (`/Users/cauetpinciara/Documents/fxl/projects/16--INTERNAL--fxl-hub`) como plano de controle.
> Numa Organization que usa os dois apps em modo For Business, o usuário vai vender só no Sales: as contas a receber (parcelas) e a pagar (comissões, custo de profissional, outros custos) das propostas ganhas vão aparecer sozinhas no Finance, e "marcar como pago" vai valer nos dois apps, não importa onde foi feito.
> Os dois apps continuam funcionando sozinhos; a integração só vale para orgs conectadas.
>
> Leia antes de planejar:
> - a auditoria completa: `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`, principalmente a seção 2.1 (Sales hoje), os pontos PC1, PC2, PC23, a seção 10 (decisões do dono) e a seção 11 (contrato consolidado v0, que substitui as seções 4 a 6 onde conflitarem);
> - o desenho de baixas reais do Finance, resumido na seção 11: tabela imutável `lancamento_baixas` e o redutor `reduzirLiquidacao` em `F:packages/shared-utils/src/liquidacao.ts` (quando existir; o desenho foi aprovado, a implementação está em andamento).
>
> **Esta tarefa NÃO constrói nada da integração** (nada de outbox, feed, eventos, ids externos ou chamadas ao Hub ou ao Finance).
> Ela entrega os pré-requisitos do lado do Sales, que têm valor sozinhos.
>
> **O que precisamos**
>
> 1. **Editar uma venda nunca apaga e recria linhas (PC2).**
>    Hoje `updateSale` (`apps/api/src/domains/sales-ops/service.ts`, a partir da linha 2445) apaga todos os receivables, payables, profissionais e itens da venda e recria tudo com uuids novos.
>    A regra passa a ser: editar altera as linhas existentes e preserva os ids.
>    Uma linha que deixou de existir no plano novo fica anulada (`void`), não apagada.
>    Isso exige que o wizard mande de volta os ids das linhas que está editando, e que o casamento nunca dependa do rótulo `N/M` (ele renumera quando uma parcela é zerada).
>    Decida no plano como tratar rascunhos, justificando.
> 2. **Baixa real no Sales (Q1), como fato imutável, no mesmo modelo do Finance.**
>    Tabela de baixas e estornos para receivables e payables: id próprio, org, linha de origem, tipo `baixa|estorno`, baixa estornada (no máximo um estorno por baixa), data real `YYYY-MM-DD`, valor em centavos, origem (`manual`; `finance` só quando a integração existir), autor com nome gravado no momento, data do registro, motivo opcional no estorno.
>    Registros imutáveis (recuse UPDATE no banco).
>    O estado de pago e a data do último pagamento são calculados por um redutor puro com as MESMAS regras do Finance: baixa ativa é a que não tem estorno; pago é a soma das ativas; a data exibida é a MAIOR entre as ativas.
>    A coluna `status` de receivables e payables continua existindo; `paid` vira cache do redutor e `void` continua sendo decisão do Sales.
>    Na v1 só existe baixa integral (valor = aberto inteiro); recuse baixa numa linha já paga.
>    A data de pagamento tem padrão hoje (dia de São Paulo) e nunca pode ser no futuro.
> 3. **UI de baixa:** marcar como pago com a data, estornar com motivo e ver o histórico, nas parcelas e nas contas a pagar (comissões, custos), onde elas já aparecem hoje.
> 4. **Travas com baixa ativa:**
>    - uma linha com baixa ativa não pode mudar valor nem vencimento (estorne antes), e a edição da venda precisa dizer qual linha bloqueou;
>    - uma venda com baixa ativa em qualquer linha não pode sair de `won` (Q5: o estorno é manual e explícito). Isso substitui a regra atual "leaving won voids only open payables and receivables".
> 5. **Gate de papel nas rotas financeiras (PC23):** ganhar, reverter, cancelar contrato, editar venda, editar configurações e registrar ou estornar baixa ficam restritos a admin.
> 6. **Revisão por linha:** `updated_at` e uma `revision` monotônica em receivables e payables, incrementada a cada mudança de valor, vencimento, contraparte ou estado. A integração vai publicar essa revisão.
> 7. **Link direto para uma proposta:** o Finance vai ter um botão "Editar no Sales" que abre a proposta. Crie uma rota que abre uma proposta pelo id a partir da URL (a URL já é a fonte da verdade da navegação), inclusive em entrada a frio: sem sessão, login e volta para a proposta.
> 8. **Moeda travada em BRL:** a configuração `currency` não tem efeito hoje, mas a UI oferece USD. Remova a opção.
> 9. **Datas:** `due_date` é `timestamptz`. Garanta que vencimento e data de pagamento sejam tratados como dia de São Paulo, sem escorregar um dia por fuso.
> 10. Atualize o `CLAUDE.md` e `nexo/knowledge/reference/propostas.md` no mesmo change que mudar cada regra.
>
> **Fora desta etapa:** pagamento parcial, juros, multa e desconto; recorrência indefinida; imposto; qualquer código de integração.
>
> **Modo de execução: autopilot.** As decisões de produto já foram tomadas pelo dono (seções 10 e 11 da auditoria); não pare para pedir aprovação do plano.
> Planeje os slices (schema, migração dos dados atuais, API, UI, testes oráculo de cada regra acima) e execute.
> Se algo exigir uma decisão de produto que não está na auditoria, registre no `AUDIT.md` da run com a opção que você escolheu e siga.
