# Validação geral da integração Sales ↔ Finance ↔ Hub

Rodar numa sessão nova, de qualquer diretório. É somente leitura.

```
Você vai auditar o estado da integração de duas vias entre FXL Sales e FXL Finance, com o FXL Hub como plano de controle, e me dizer o que falta, quais prompts rodar e, se estiver tudo pronto, como testar.

SOMENTE LEITURA. Não edite, crie, apague, commite, faça push, publique, promova nem remova nada. Não suba servidores. Pode rodar suítes de teste uma vez, em modo run-once (nunca watch), e deve encerrar pelo PID/grupo qualquer processo que você mesmo iniciar.

Repositórios:
- Sales: /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales (trunk master)
- Finance: /Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance (trunk main)
- Hub: /Users/cauetpinciara/Documents/fxl/projects/16--INTERNAL--fxl-hub (trunk main)

Leia primeiro:
- a auditoria e o contrato v0: Sales/nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md, seções 10 e 11;
- os prompts já preparados: Sales/nexo/playbooks/sales-finance-integration/ (01 a 06; o 01 já foi executado);
- o plano do Hub: Hub/nexo/plans/platform-contratos-plano-de-controle/ (00-OVERVIEW.md com os gates G1 a G5, e handoffs/PROMPT-SALES-... e PROMPT-FINANCE-...);
- os report.md e AUDIT.md das runs recentes em nexo/runs/ de cada repo.

Passo 1: estado de cada repo. Para cada um: branch atual, mudanças sem commit, quanto está à frente/atrás de origin, runs vivas (.nexo/runs/*/status.json com state diferente de done), worktrees que sobraram (git worktree list) e se o branch delas já está contido no trunk. Uma run viva significa trabalho em andamento: diga isso e não trate o item dela como faltando.

Passo 2: confira cada item abaixo NO CÓDIGO, com arquivo:linha ou commit como evidência. Não aceite um report como prova; o report só diz onde procurar. Classifique cada item em FEITO, PARCIAL, FALTANDO ou EM ANDAMENTO.

Hub
- H1. Plano de controle implementado no main: registro de event types, Contratos, Activations, discovery, tickets e introspecção, heartbeat, página admin.
- H2. Migration nova do plano de controle (0029 ou posterior) existe; registre que ela precisa rodar em staging e produção (o 00-OVERVIEW dizia "sem migration nova", o que ficou desatualizado).
- H3. main publicado em origin (push).
- H4. Gate G5: `npm view @fxl-business/fxl-contracts version` mostra a versão que Sales e Finance fixam. Sem isso, Sales e Finance NÃO podem ter integrado.
- H5. O pacote exporta o que os handoffs usam (enqueueIntegrationEvent, startPositionPublisher, readIntegrationFeed, createIntrospectionVerifier, startIntegrationPuller, reduceSettlement, syncedObligationSubset, createFakeIntegrationAuthority).

Sales, pré-requisitos locais
- S1. Slices 01 a 06 da run 20260924T013019Z-finance-prereqs: dia de São Paulo, redutor reduzirLiquidacao, tabela imutável sales_ops_settlements com revision/updated_at, edição de proposta por id sem apagar, wizard com ids, API de baixa/estorno/histórico só admin, trava de sair de won e de cancelar contrato com baixa ativa.
- S2. Gate de admin em POST /sales, POST /sales/:id/transition, POST /sales/:id/cancel-contract, PUT /sales/:id e PUT /settings (gate G2 do Hub), e moeda travada em BRL.
- S3. Tela de baixa: marcar como pago com data, estornar com motivo, histórico.
- S4. Rota /operacional/vendas/:saleId abrindo a proposta, inclusive em entrada a frio (login e volta).
- S5. Teste de concorrência da migração 0018 sem deadlock intermitente.

Finance, pré-requisitos locais
- F1. lancamento_baixas imutável, reduzirLiquidacao puro, colunas do lançamento como cache.
- F2. Baixa em dobro recusada com a linha travada; pago acima do original não quebra view, Realizado, Fluxo de Caixa nem Tático.
- F3. requireOrgEditor nas rotas de baixa e estorno.
- F4. Edição que troca o ano do vencimento move a linha para o lote do ano novo.
- F5. Regras do contrato: maior data entre baixas ativas, nada no futuro, dia de São Paulo, centavos sem float, valor com baixa ativa recusado.
- F6. Paridade entre reduzirLiquidacao do Finance, o do Sales e reduceSettlement do pacote do Hub: liste qualquer diferença de regra.

Integração (só pode estar feita se H4 estiver feito)
- I1. Sales: pacote fixado na versão EXATA, outbox escrito dentro da transação (proposta ganha, edição, cancelamento, baixa, estorno), publicador de posição, rota GET /integration/v1/feed protegida por introspecção, puller seguro com várias instâncias, inbox, cursor, handler dos eventos do Finance, anti-eco, cliente de ticket, subconjunto sincronizado (sem imposto, sem recorrência indefinida, sem afiliados), heartbeat.
- I2. Finance: o mesmo do lado dele, mais referência externa única por org, origem 'sales', linhas do Sales travadas (sem editar nem excluir, sem Desvincular; baixa, estorno, categoria, conta e observações permitidos), estado anulado, link "Editar no Sales" montado com o app_url do Sales vindo do Hub.
- I3. Modo fake: createFakeIntegrationAuthority ligado no boot do auth-fake dos dois apps, e uma org de fixture COMUM aos dois rosters, com seeds coerentes.
- I4. Teste de ponta a ponta local cobrindo: proposta ganha aparece no Finance; baixa num app aparece no outro; estorno sincroniza; venda com baixa não sai de ganha; baixa simultânea nos dois vira "registrada em duplicidade".

Passo 3: rode as suítes de cada repo uma vez (a suíte padrão e a de integração quando existir) e registre o resultado. Vermelho é um item FALTANDO, com a falha citada.

Passo 4: responda em português, nesta ordem.

1. Tabela de status: item, status, evidência (arquivo:linha ou commit), observação.
2. Se houver itens PARCIAL ou FALTANDO: para cada repo, o prompt exato que eu devo rodar, pronto para colar, em ordem e com dependências explícitas (por exemplo, "só depois de publicar o pacote"). Reaproveite os prompts de nexo/playbooks/sales-finance-integration/ e os handoffs do Hub quando servirem; ajuste o texto ao que já foi feito, para ninguém refazer trabalho. Todo prompt deve começar com um passo 0 que valida o estado do repo e PARA se algo estiver fora do esperado. Ações que só eu posso fazer (publicar no npm, push, promover, rodar migration em staging/produção, ligar a Activation) vão numa lista separada "Ações suas", com o comando ou o caminho na tela.
3. Se tudo estiver FEITO: um roteiro de teste para eu executar.
   a. Local, sem Hub: os comandos para subir os dois apps em modo fake (confira os alvos reais nos Makefiles, por exemplo make dev-fake-setup e make dev-fake, e as portas de cada app), qual identidade e qual org de fixture usar em cada app, e o passo a passo dos cinco cenários do item I4, dizendo o que eu devo ver em cada tela e em quanto tempo (o intervalo do pull).
   b. Onde olhar quando algo não aparecer: tabelas de outbox, inbox e cursor, heartbeat, logs, com as consultas SQL prontas.
   c. Staging: o que precisa estar deployado e migrado em cada app e no Hub, como ligar a Activation para uma org, e os mesmos cinco cenários.
   d. O que ainda falta antes de produção (gates G2 e G3, migrations, promoção), como lista de decisões minhas.
Se apenas parte estiver pronta, diga qual parte já dá para testar agora e como.
```
