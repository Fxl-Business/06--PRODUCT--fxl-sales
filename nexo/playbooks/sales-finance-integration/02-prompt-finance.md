# Finance, agora: revisão pós-implementação das baixas reais

Rodar no repo do Finance, em autopilot, depois que a run das baixas terminou (`20260924T011357Z-feedback-socio-financeiro`).

> **Contexto**
>
> Vocês implementaram "Baixas reais no For Business": baixas e estornos como fatos imutáveis em `lancamento_baixas` (migração 073), o redutor puro `reduzirLiquidacao` e as colunas do lançamento como cache.
> Esse desenho foi a resposta à PC3 da auditoria de uma integração futura de duas vias entre o FXL Sales (`/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`) e o FXL Finance.
> A auditoria está em `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`; a seção 11 (contrato consolidado v0) já incorpora o desenho de vocês.
> O Sales já implementou a baixa dele no MESMO modelo.
> As decisões de produto já foram tomadas; rode em autopilot e registre no `AUDIT.md` da run qualquer decisão que faltar, com a opção escolhida.
>
> **Esta tarefa continua sem NENHUM código de integração**: nada de API para o Sales, ids externos, outbox, feed, eventos ou chamadas ao Hub.
>
> **Passo 0: valide o estado do repo ANTES de planejar ou escrever qualquer coisa.** Relate o resultado de cada item no início da run.
>
> 1. Você está no checkout principal, no `main`, sem mudanças sem commit. Havendo mudanças: PARE e relate, não faça stash, commit nem descarte.
> 2. `main` contém `origin/main` (estar muito à frente, sem push, é esperado). Atrás ou divergente: PARE e relate.
> 3. Nenhuma run viva: todo `.nexo/runs/*/status.json` tem `state = done`. Se houver outra, PARE e relate.
> 4. Worktrees: liste `git worktree list`. Existem worktrees antigas em `.worktrees/` e uma workspace do Conductor (`victoria`). Não mexa na do Conductor. Remova uma worktree de `.worktrees/` só se a run dela está `done`, o branch já está contido no `main` e ela não tem mudanças; senão, deixe e relate.
> 5. Leia o `report.md` e o `AUDIT.md` da run `20260924T011357Z-feedback-socio-financeiro` e monte uma tabela: cada item da seção "Confirme e corrija" abaixo contra o que a run já entregou (arquivo:linha). Não refaça o que já está feito.
> 6. Linha de base: rode a suíte completa uma vez antes de mudar qualquer coisa e registre o resultado. Vermelho: PARE e relate antes de seguir.
>
> **Confirme no código e corrija o que faltar**
>
> - **Baixa em dobro:** um duplo clique ou duas abas não podem criar duas baixas. Com baixa sempre integral, uma linha já paga recusa nova baixa (409), checado com a linha travada (`SELECT ... FOR UPDATE`), não só na UI.
> - **Pago acima do original:** duas baixas ativas vão poder existir no futuro (uma registrada em cada app ao mesmo tempo). O redutor e todo agregado que lê `valor_pago` / `valor_recebido` (view unificada, Realizado, Fluxo de Caixa, Tático) precisam se comportar bem com pago maior que o original, com teste.
> - **Quem pode dar baixa:** as rotas de baixa e estorno exigem `requireOrgEditor`; proponha ao dono estender às de lançamento manual (registre no `AUDIT.md`).
> - **Edição que troca o ano do vencimento:** a linha precisa ir para o lote do ano novo (`import_batch_id`), não ficar no lote do ano antigo.
> - **Redutor isolado:** `reduzirLiquidacao` puro, sem depender do resto do Finance, com teste que cubra todas as ordens possíveis de baixas e estornos. O Hub publicou `reduceSettlement` no pacote `@fxl-business/fxl-contracts` (ainda não no npm) com as mesmas regras; aponte qualquer diferença entre os dois (código do pacote em `/Users/cauetpinciara/Documents/fxl/projects/16--INTERNAL--fxl-hub/packages/fxl-contracts`).
> - **Regras fixadas pelo contrato:** data exibida com mais de uma baixa ativa é a MAIOR; data de pagamento nunca no futuro; "hoje" é o dia de São Paulo; centavos inteiros sem float em nenhum caminho de escrita; mudar o valor de um lançamento com baixa ativa é recusado.
>
> **Não implementar agora, só não fechar a porta:** linhas vindas do Sales não poderão ser editadas nem excluídas no Finance, sem "Desvincular", com link "Editar no Sales" (continuam permitidos: baixa, estorno, categoria, conta bancária, observações); referência externa única por org em `contas_*` e `lancamento_baixas`; `origem = 'sales'`; lote próprio para linhas sincronizadas; estado "anulado" no status, na view e nos agregados. Se algo entregue dificultar esses itens, registre e avise o dono.
>
> Entregue um relatório curto: o que já estava certo (arquivo:linha), o que foi corrigido e o que ficou pendente.
