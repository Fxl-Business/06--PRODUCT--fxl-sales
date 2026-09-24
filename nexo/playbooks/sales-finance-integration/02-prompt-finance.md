# Prompt para o FXL Finance: revisão pós-implementação das baixas reais

Rodar DEPOIS que a implementação de "Baixas reais no For Business" (`lancamento_baixas`, `reduzirLiquidacao`, migração 073) estiver terminada e mergeada.
Não rodar em paralelo com ela.

> **Contexto**
>
> Vocês acabaram de implementar "Baixas reais no For Business": baixas e estornos como fatos imutáveis em `lancamento_baixas`, o redutor puro `reduzirLiquidacao` e as colunas do lançamento como cache.
> Esse desenho foi escrito como resposta à PC3 da auditoria de uma integração futura de duas vias entre o FXL Sales (`/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`) e o FXL Finance.
> A auditoria está em `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/nexo/knowledge/doubts/20260922-sales-finance-two-way-sync-audit.md`; a seção 11 (contrato consolidado v0) já incorpora o desenho de vocês.
> O FXL Sales está implementando a baixa dele no MESMO modelo (fato imutável, estorno como fato novo, mesmas regras de cálculo).
>
> **Esta tarefa continua sem NENHUM código de integração**: nada de API para o Sales, ids externos, outbox, feed, eventos ou chamadas ao Hub.
> É uma revisão do que foi entregue, com correções só do lado do Finance.
>
> **1. Confirme no código entregue, com arquivo:linha, e corrija o que faltar**
>
> - **Baixa em dobro:** `POST .../baixas` não tem chave de idempotência, então um duplo clique ou duas abas podem criar duas baixas. Como a baixa é sempre integral, uma linha já paga deve recusar uma nova baixa (409), checado com a linha travada (`SELECT ... FOR UPDATE`), não só na UI.
> - **Pago acima do original:** mesmo com o 409, duas baixas ativas vão poder existir no futuro (uma registrada em cada app ao mesmo tempo). Confirme que o redutor e todo agregado que lê `valor_pago` / `valor_recebido` (view unificada, Realizado, Fluxo de Caixa, Tático) se comportam bem com pago maior que o original, com um teste.
> - **Quem pode dar baixa:** as rotas de manual-entries não têm `requireOrgEditor` (a manual-import tem). As rotas de baixa e estorno precisam do gate; proponha ao dono estender às de lançamento manual.
> - **Edição que troca o ano do vencimento:** a edição recalculava `ano` sem trocar o `import_batch_id`, deixando a linha no lote do ano errado. Confirme se a nova função única de escrita resolveu; se não, corrija.
> - **Redutor isolado:** `reduzirLiquidacao` deve continuar puro, sem depender de nada do resto do Finance, com teste que cubra todas as ordens possíveis de baixas e estornos. Ele vai servir de base para o redutor único que o Hub vai publicar no pacote do contrato.
> - **Regras que o contrato já fixou e que o código precisa seguir:** data exibida com mais de uma baixa ativa é a MAIOR; data de pagamento nunca no futuro; "hoje" é o dia de São Paulo; valores em centavos inteiros, sem float em nenhum caminho de escrita; mudar o valor de um lançamento com baixa ativa é recusado.
>
> **2. Decisões do dono que afetam o Finance mais tarde (não implementar agora, só não fechar a porta)**
>
> - Linhas vindas do Sales não poderão ser editadas nem excluídas no Finance, e não haverá "Desvincular". Terão um link "Editar no Sales" que abre a proposta. Continuarão permitidos: registrar e estornar baixas, e os campos que só existem no Finance (categoria, conta bancária, observações). Confira que nada no desenho entregue impede um bloqueio por linha depois.
> - A etapa de integração vai precisar de: colunas de referência externa únicas por org em `contas_*` e em `lancamento_baixas`; `origem = 'sales'`; um tipo de lote próprio para linhas sincronizadas; um estado "anulado" em `deriveLancamentoStatus`, na view e nos agregados (uma linha que o Sales anula não pode ser apagada nem contar como aberta).
> - Se algo do que foi entregue dificultar qualquer um desses itens, registre no documento de resposta e avise o dono.
>
> Entregue um relatório curto: o que já estava certo (com arquivo:linha), o que foi corrigido e o que ficou como pendência.
