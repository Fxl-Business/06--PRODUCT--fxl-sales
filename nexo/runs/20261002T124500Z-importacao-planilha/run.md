# Run: Importação por planilha (onboarding e sob demanda)

- Flow: feature (autopilot, Gate 1 skipped by explicit request). Trunk: master. Integration: local, serial.
- Request: um modelo de planilha para importação do Sales, para o onboarding e também "on-demand" (por exemplo só mais algumas propostas via Excel).
- Milestone: v4.2.0 (prospectivo; não promovido, Gate 3 humano).
- Reference: `nexo/knowledge/reference/importacao-por-planilha.md`.

## Resultado

Tela `cadastros/importacao` (admin) com modelo em branco e com exemplo, prévia (dry-run) com contagens e erros localizados por aba, linha e coluna, e commit tudo-ou-nada.
Planilha com 13 abas de dados mais `Leia-me`, definidas por um único `workbook-schema.ts` que alimenta modelo, parser e planejadores.
Profundidade básica (proposta Aberta só com cliente, vendedor e produto) até completa (Ganha com dia histórico, Perdida, Cancelada, itens, profissionais, parcelas, recorrência e baixas).

## Slices

| slice | merge | entrega |
| --- | --- | --- |
| 01 contract-and-parser | cb26441 | `exceljs` fixado, tipos, `workbook-schema.ts`, coercers, parser |
| 02 catalog-refs-cadastros | 0a4b18a | catálogo da org, índice de refs, planejador de cadastros |
| 08 template | 6c4ec4a | modelo xlsx, `Listas`, validações, dataset de exemplo |
| 09 web-import-view | b77fb06 | tela, navegação, prévia e commit |
| 03 plan-leads | b790a04 | planejador de leads |
| 04 plan-propostas | 088e9d6 | propostas, itens, profissionais, parcelas, recorrência |
| 06 executor | 624aaed | executor tudo-ou-nada e ação de auditoria `import.completed` |
| 05 plan-desfechos | 0f28d68 | Ganha/Perdida/Cancelada e Pagamentos; recusa com Finance ativo |
| 07 routes-and-roundtrip | daaca93 | `planImport`, rotas, oráculo de round trip do modelo de exemplo |
| 09.1 web-409-detail | 7338cfa | o 409 mostra a aba e a linha recusadas (adicionada na execução) |
| 10 mutation-survivors | 1f4f96d | testes para os 5 sobreviventes do mutation (adicionada na execução) |

## Waves e verificação

Contagens de verify da suíte por wave (api / web):

| wave | slices | resultado |
| --- | --- | --- |
| 1 | 01 | 2399 / 305 |
| 2 | 02, 08, 09 | 2518 / 311 |
| 3 | 03, 04, 06 | 2608 / 318 |
| 4 | 05 | 2646 / 318 |
| 5 | 07, 09.1 | 2664 / 328 |
| 6 | 10 | 2667/2667 unit · 330/330 integration · lint 0 · build ok · 0 high |

## Verify

Tentativas por slice (`budget.json`): todas 1, exceto 03 e 08 com 2.
03 e 08 falharam uma vez por um travessão literal (U+2014) em um teste; corrigido nos commits `0985565` e `a4fe8a0` e aprovados na segunda tentativa.
Slice 10: verify reaplicou os 5 mutantes e cada teste novo ficou vermelho (28 web import, 63 api unit, 330 api integration; lint 0, type-check 0).

## Plan-check

Aprovado com 13 correções vinculantes (ImportRefIndex nos planejadores 03/04/05, helpers compartilhados, fixture com catálogo semeado, resolução dos desvios do slice 06). Replans: 2.

## Mutation

Rodada manual de feature: 45/50 mortos, 3 equivalentes excluídos (`funcao_required` morto, dois mutantes de comparação de string). Os 5 sobreviventes viraram a slice 10 e foram todos mortos, só com testes (sem mudança de produção).

## E2E no navegador

Feito pelo orquestrador com `make dev-fake` (identidade `team-owner`): baixar modelo em branco e de exemplo, validar o exemplo (`duplicate_existing` da função "Desenvolvedor" da org seed), validar uma cópia sem conflito, importar (31 registros, 201), ver as 5 propostas com os cinco status, abrir a Ganha com "Pago em 20/01/2026", e validar o modelo em branco ("A planilha não tem linhas para importar.").
Achado: sem `pnpm install` o servidor não sobe (`Cannot find package 'exceljs'`).

## Orçamento

Dispatches de agente 42 de 64; slices iniciais 9 de 16; total de slices 11 de 24; replans 2 de 3; recuperações de wave 0 de 1; nada esgotado.

## Decisões

D1 reuso dos serviços de domínio numa transação `withTenant`. D2 Finance ativo recusa Ganha e Pagamentos. D3 dia de vitória histórico por `createSale(now)`. D4 pagamentos como baixas manuais (`applyBaixaTx`). D5/D6 nome existente é erro, referência arquivada é erro, cliente e pessoa só avisam. D7 lead fora da etapa de conversão, Perdido exige motivo. D8 sem migração. D9 limites 5 MB, 5000 linhas, 500 issues. D10 histórico de cadastro não lista `import.completed`. D11/D11b rotas semeiam etapas e funções do sistema dentro da transação; prévia e modelo fazem rollback (proposta do planejador do executor rejeitada). Segurança: override de `brace-expansion` subiu para 1.1.21; resta 1 aviso moderado `exceljs > uuid`.
Detalhe completo na reference e em `AUDIT.md`.

## Não promovido

Autopilot para em master. Gate 3 (`/nexo-ship`) é humano. Ver `AUDIT.md`.
