# Finance, depois do pacote publicado: camada de integração

Rodar no repo do Finance (/Users/cauetpinciara/Documents/fxl/projects/01--PRODUCT--fxl-finance), em autopilot, SÓ depois que `@fxl-business/fxl-contracts@0.1.0` estiver publicado no npm (gate G5, ato humano).

> **Contexto**
>
> Este é o passo de integração Sales ↔ Finance com o Hub como plano de controle.
> O prompt de implementação foi escrito pelo Hub e é a fonte da verdade: `/Users/cauetpinciara/Documents/fxl/projects/16--INTERNAL--fxl-hub/nexo/plans/platform-contratos-plano-de-controle/handoffs/PROMPT-FINANCE-integracao-plano-de-controle.md`.
> Leia-o inteiro, e também as seções 10 e 11 de `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`.
> As decisões de produto já foram tomadas; rode em autopilot e registre no `AUDIT.md` da run qualquer decisão que faltar, com a opção escolhida.
>
> **Passo 0: valide o estado ANTES de planejar ou escrever qualquer coisa.** Relate o resultado de cada item no início da run.
>
> 1. Checkout principal, no `main`, sem mudanças sem commit (fora `.vscode/`); `main` contém `origin/main`; nenhuma run viva em `.nexo/runs/*/status.json`. Falhou: PARE e relate.
> 2. Gate G5: `npm view @fxl-business/fxl-contracts@0.1.0 version` responde `0.1.0`. Se der 404: PARE e avise que o pacote não foi publicado. Não vendorize nem copie o código do pacote.
> 3. Pré-requisito deste app: a revisão de `02-prompt-finance.md` terminou e está no `main` (baixa em dobro recusada, gate de editor, lote por ano); se não, PARE e relate.
> 4. O prompt do Hub foi escrito em 2026-09-24 e o código mudou depois. Para CADA afirmação dele sobre este repo ("já existe", nomes de tabela, rota, função, arquivo, coluna, quais rotas têm ou não gate), confira no código atual e monte uma tabela: afirmação, confere sim/não, arquivo:linha. Divergência: siga o código atual, ajuste o plano e registre no `AUDIT.md`.
> 5. Confira que a versão publicada do pacote exporta o que o prompt do Hub usa (por exemplo `enqueueIntegrationEvent`, `startPositionPublisher`, `readIntegrationFeed`, `createIntrospectionVerifier`, `startIntegrationPuller`, `reduceSettlement`, `syncedObligationSubset`, `createFakeIntegrationAuthority`). Faltou algo: PARE e relate.
> 6. Linha de base: suíte completa e testes de integração uma vez antes de mudar qualquer coisa. Vermelho: PARE e relate.
>
> **Depois do passo 0, execute o prompt do Hub**, com estas regras por cima dele:
> - pin EXATO `0.1.0`, no mesmo commit do lockfile;
> - nada de promoção, tag ou enable de produção; ligar em staging e produção é decisão do dono;
> - termine com um teste de ponta a ponta local, com os dois apps em modo fake e a org de fixture comum, cobrindo: proposta ganha aparece no Finance; baixa num app aparece no outro; estorno sincroniza; venda com baixa não sai de ganha; baixa simultânea nos dois apps aparece como "registrada em duplicidade". Se o outro app ainda não tiver a camada dele, registre quais casos ficaram sem teste.
