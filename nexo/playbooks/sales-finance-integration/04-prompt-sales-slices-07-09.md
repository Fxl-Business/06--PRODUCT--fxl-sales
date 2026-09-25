# Sales, agora: slices 07, 08 e 09 da run finance-prereqs, mais o teste instável da 0018

Rodar no repo do Sales, em autopilot (`/nexo --feature --autopilot` com o bloco abaixo).

> **Contexto**
>
> A run `20260924T013019Z-finance-prereqs` entregou os slices 01 a 06 dos pré-requisitos da integração Sales ↔ Finance e estacionou os slices 07, 08 e 09 por orçamento, com os planos prontos em `nexo/plans/20260924T013019Z-finance-prereqs/`.
> Leia antes: o `report.md` e o `AUDIT.md` dessa run, e as seções 10 e 11 de `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md` (decisões do dono e contrato v0).
> As decisões de produto já foram tomadas; rode em autopilot e registre no `AUDIT.md` da nova run qualquer decisão que faltar, com a opção escolhida.
>
> **Passo 0: valide o estado do repo ANTES de planejar ou escrever qualquer coisa.** Relate o resultado de cada item no início da run.
>
> 1. Você está no checkout principal, no `master`, e `git status` só mostra `.vscode/` como não rastreado. Qualquer outra mudança sem commit: PARE e relate, não faça stash, commit nem descarte.
> 2. `master` contém `origin/master` (pode estar à frente, sem push; isso é esperado). Se estiver atrás ou divergente: PARE e relate.
> 3. Nenhuma run viva: todo `.nexo/runs/*/status.json` tem `state = done`. Se houver outra, PARE e relate (pode ser um worker em andamento).
> 4. A worktree que sobrou em `.worktrees/20260924T013019Z-finance-prereqs/run`: confirme que a run está `done`, que o branch `nexo/20260924T013019Z-finance-prereqs` já está contido no `master` e que a worktree não tem mudanças. Só então remova a worktree e apague o branch. Se qualquer condição falhar, deixe como está e relate.
> 5. Os slices 01 a 06 estão no `master`: confirme os merges de `01-sao-paulo-day`, `02-liquidacao-reducer`, `03-ledger-schema`, `04-update-sale-in-place`, `05-wizard-row-ids` e `06-settlements-api`, e que os três reverts da onda 1 foram desfeitos pelos "Reapply" (a árvore tem de ter o conteúdo dos slices).
> 6. Os planos 07, 08 e 09 ainda valem contra o código atual. Para cada um, confira as afirmações do plano no código de hoje (arquivo:linha), por exemplo:
>    - 07: quais das rotas POST `/sales`, POST `/sales/:id/transition`, POST `/sales/:id/cancel-contract`, PUT `/sales/:id` e PUT `/settings` ainda não têm `requireAdmin`, e se a UI ainda oferece USD;
>    - 08: onde as parcelas e contas a pagar aparecem hoje e se as rotas de baixa, estorno e histórico existem como o plano diz;
>    - 09: se a entrada a frio ainda cai no catch-all e perde o id antes do login.
>    Plano desatualizado: replaneje só aquele slice antes de executar.
> 7. Linha de base: rode o `pnpm test` completo e os testes de integração (`pnpm --filter @fxl-sales/api test:integration`) uma vez, antes de mudar qualquer coisa, e registre o resultado. Vermelho que não seja o teste de concorrência da migração 0018: PARE e relate.
>
> **Depois do passo 0, execute:**
>
> - **07-admin-gate-and-brl:** as cinco rotas acima só para admin, e moeda travada em BRL. É também o gate G2 do Hub para ligar a integração em produção.
> - **08-settlements-ui:** tela de marcar como pago (com data), estornar (com motivo) e ver o histórico.
> - **09-sale-deep-link:** a rota `/operacional/vendas/:saleId`, que abre a proposta pela URL e sobrevive à entrada a frio (login e volta para a proposta). O Finance vai usar esse caminho no botão "Editar no Sales".
> - **Novo slice, teste instável:** o teste de concorrência da migração 0018 deu deadlock uma vez e depois passou. Reproduza (rode-o repetidas vezes), ache a causa e conserte a instabilidade, no teste ou no código, sem enfraquecer o que ele prova.
>
> Não faça nada da camada de integração (outbox, feed, puller, inbox, ticket): isso é outro prompt, que depende do pacote `@fxl-business/fxl-contracts` no npm.
> Não promova nem tagueie nada; a migração 0024 em staging e produção é decisão do dono.
