# Relatório: importacao-funil

## Status da solicitação
pass · Tudo entregue: 3 de 3 fatias, testadas no app real.
Pedido: Importação por planilha: coluna Funil no Excel e uma aba que mostre os funis e as etapas de cada funil

## Entregue
- 01-api-plano-por-funil  eaee6f58  Cada lead e cada etapa da planilha entra no funil da linha.
- 02-api-modelo-e-exportacao  3f5c8f86  Modelo com a aba Funis e etapas, lista de etapas por funil e exportação com o funil.
- 03-web-mapear-funis  28f2f01b  Tela Mapear funis antes de Mapear etapas.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- Codex sem cota: testes cegos e Verify feitos por agentes Sonnet separados (nexo/runs/20261123T111719Z-importacao-funil/AUDIT.md)
- A exportação escreve o nome do funil mesmo arquivado (nexo/plans/importacao-funil/contracts/SEAM-CONTRACT.md)
- O teste de aceitação mapear-etapas já falhava no main e foi corrigido (tests/acceptance/mapear-etapas/map-stages.integration.test.ts)

## Perguntas
- nada a registrar.
