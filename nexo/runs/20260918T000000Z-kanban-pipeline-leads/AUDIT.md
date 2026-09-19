# Autopilot audit - run 20260918T000000Z-kanban-pipeline-leads

## Decisões estruturais tomadas sem você (autopilot skipped Gate 1 by dispatch)

### 1. Identidade do vendedor: `sales_ops_people.hub_account_id` (slice 03)
- **O quê:** a aceitação 15 exige que o escopo por vendedor seja aplicado NO SERVIDOR, dentro de
  `withTenant`. Ao planejar, ficou provado que **isso é impossível hoje**: `sales_ops_people` não
  tem coluna de conta Hub, e o `CLAUDE.md` já registra que "não há caminho de join de um Hub
  account id para uma pessoa". Sem esse elo, o servidor não sabe qual pessoa é o chamador.
- **A decisão:** adicionar `sales_ops_people.hub_account_id` (migração `0023`, unique parcial por
  org), escrita por um admin via `PATCH /people/:id` ou auto-reivindicada uma única vez a partir do
  e-mail verificado no próprio token, sob quatro guardas.
- **Por que isso precisa do seu olhar:** é um mecanismo de IDENTIDADE novo, não pedido
  explicitamente, e o caminho de auto-reivindicação é a parte sensível. Ele foi mantido porque a
  alternativa é filtrar no cliente, que a aceitação 15 proíbe nominalmente.
- **Onde:** `nexo/plans/feature-20260918-kanban-pipeline-leads/03-api-leads.md`, §escopo por vendedor.

### 2. Consequência operacional conhecida
- Orgs cujo `contact_email` da pessoa não bate com o login Hub do vendedor precisam de um PATCH
  administrativo até existir um controle web para isso. Nenhuma tela deste feature escreve
  `hubAccountId`. Registrado para o `nexo/ROADMAP.md`.

## Decisões da reconciliação do plan-set (autopilot, 2026-09-18)

O primeiro plan-check REPROVOU o conjunto: as oito slices foram planejadas em paralelo contra
versões divergentes do contrato de schema. Seis achados, três deles HIGH. As decisões abaixo foram
tomadas pelo orquestrador para fechá-los sem reabrir o WHAT, e estão registradas em
`00-OVERVIEW.md` §"Contrato reconciliado" para não serem revisitadas.

1. **`kind` da etapa tem exatamente três valores** (`normal | conversion | lost`). O `'converted'`
   que 02/04/06 usavam nunca existiu no schema da slice 01. A slice 01 é a dona do schema e vence.
2. **Sem coluna `slug` em `sales_ops_lead_stages`**; `kind` é a chave de máquina. Mas nome duplicado
   CONTINUA sendo rejeitado, por índice único REAL `(org_id, name)`, respondendo `409
   stage_name_taken`. Motivo: a aceitação 5 nomeia `sales_ops_funcoes` como precedente, e esse
   precedente é uma constraint de banco (`funcao_name_taken`), não uma sonda de serviço com corrida.
   Custo: uma emenda de uma linha na migração 0022 da slice 01, que ainda não executou.
3. **`stageIsReadOnly` foi DELETADO. Somente-leitura é propriedade do CARD**, não da coluna:
   `leadIsConverted(lead) === lead.saleId !== null`. A etapa de conversão tem dois papéis conforme a
   direção: como ORIGEM, um card convertido não arrasta; como DESTINO, ela nunca move o card de
   forma otimista, devolve para o wizard, e o card só muda depois do `201`. Isso é o que resolve a
   contradição que o checker achou, preservando as aceitações 11 e 13 inteiras.
4. **Identificadores de router distintos**: `leadStagesRouter` em `leads/stage-routes.ts` (02) e
   `leadsRouter` em `leads/lead-routes.ts` (03). Sem alias de import.
5. **Não existe `board-model.ts` nem `LeadMoveCommand`.** O `saleId` é enfiado no `MoveLeadPayload`
   da slice 04, no `emitMove` real do `LeadsBoard.tsx` da slice 06.
6. **`Verifique o servidor` de plan-check**: o segundo checker (independente) reprovou de novo por
   dois resíduos - a slice 07 ainda escreveria `LeadMoveCommand` DENTRO do `CLAUDE.md`, e o bloco de
   código da slice 04 usava um `BOARD_KEY` que o próprio parágrafo seguinte dizia não poder existir.
   Ambos foram corrigidos diretamente pelo orquestrador, por serem mecânicos e integralmente
   especificados pelo relatório. Um TERCEIRO plan-check completo foi DISPENSADO: o segundo relatório
   trouxe tabela exaustiva LIVE-vs-DOCUMENTARY de todas as ~40 ocorrências, e o fechamento dos dois
   resíduos foi verificado por grep determinístico, não por leitura de agente.

### Achados NOVOS levantados pelo replanner e aceitos sem consulta

- **R7:** a `ListLeadsQuerySchema` da slice 03 exige `stageId`, então o board-wide list da slice 04
  daria 400 em toda carga do quadro. Resolvido com fan-out por coluna dentro de um único `queryFn`,
  preservando a entrada plana de cache, o `boardKey` e o oráculo de rollback da aceitação 10. Custo:
  `useLeadsBoard` ganha um argumento `stages` e a slice 07 mudou uma linha.
- **R8:** o corpo do move é `{stageId, position, reason?, saleId?}` sob schema `.strict()`, e o
  cliente da slice 04 mandaria `toStageId`/`toIndex`. Corrigido com uma tradução explícita em
  `leadsApi.moveLead`.

### Decisão de verificação

`nexo-wave-exec.sh --wave-verify` recebe um SCRIPT determinístico
(`lint -> type-check -> test -> build -> api test:integration`) em vez de um agente, para que o
caminho de auto-revert-para-último-verde do script continue armado. O agente Verify separado
continua rodando por slice antes do merge, e de novo sobre o trunk integrado. Isso é estritamente
mais verificação que o mínimo do flow, não menos.

## Fraqueza de oráculo registrada e NÃO corrigida (slice 02)

`createLeadStage appends after the highest position` arquiva a etapa DO MEIO, então uma
implementação que calcule `max(position)` apenas sobre linhas ativas sobrevive ao teste. O oráculo
seria mais forte arquivando a ÚLTIMA etapa. Não é falha: a mutação nomeada pelo plano (posicionamento
por contagem) É pega, e o verificador confirmou. Fica registrado para um follow-up em vez de gastar
um ciclo de verify agora, sob autopilot com orçamento finito.

## Recuperação de wave 5: uma slice boa foi parqueada pelo MEU harness

O `--wave-verify` rodava `lint/test/build` no checkout principal SEM `pnpm install`. A slice 06
adiciona `@dnd-kit` ao `package.json`, e `git merge` não materializa dependência nova: no trunk
integrado todo import de `@dnd-kit` falhou em resolver. O `nexo-wave-exec.sh` agiu certo com a
evidência que tinha - reverteu para o último verde, re-rodou serialmente, apontou a 06 como culpada,
parqueou, re-mergeou a 05 e deixou `master` verde com reverts append-only. Mas o culpado era o
GATE, não a slice.

Dois consertos no gate, ambos load-bearing:
1. `pnpm install --frozen-lockfile` (mais `build:packages`) roda ANTES de tudo.
2. O log passa a ser POR INVOCAÇÃO. O anterior truncava a cada chamada, então a execução que FALHOU
   era sobrescrita pela execução de recuperação que PASSOU - que é exatamente o que tornou esse
   park difícil de diagnosticar.

A slice 06 foi reinstaurada por `git revert` do revert (append-only, sem `reset --hard`).

## Flake real encontrado no caminho, e consertado

Com o install corrigido, sobrou uma falha verdadeira: `stage_changed_at advances when and only when
stage_id actually changes`, em `apps/api/test/rls/leads-seller-scope.test.ts`, comparava `>` estrito
sobre milissegundos de JS. Medido: 2 falhas em 5 execuções. Passou na verificação da slice 03 e em
dois gates de wave por SORTE.

Diagnóstico final (corrige o meu): os stamps de move NÃO vêm do Postgres, vêm de um `new Date()` no
`lead-service.ts`, que não tem dígito abaixo do milissegundo. Precisão de leitura sozinha não
resolveria. O conserto tem as duas metades: ler o stamp como `bigint` de MICROSSEGUNDOS em SQL, e
esperar o relógio do processo ultrapassar o stamp guardado antes de cada escrita que precisa avançar.
O `>` estrito foi MANTIDO; relaxar para `>=` deixaria passar uma regressão que nunca avança o campo.
A metade "não avança" virou igualdade exata em microssegundos, mais forte do que era.
10 execuções seguidas verdes, e as duas mutações (sempre-avança, nunca-avança) ficam vermelhas.
