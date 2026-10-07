# Relatório: leads-sem-vendedor

## Status da solicitação
pass · Tudo o que foi pedido está em master: vendedores veem os leads sem vendedor, assumem ao mover ou editar, o gestor não assume, e o card mostra a marca; de quebra, corrigido um travamento ao mover cards da mesma coluna ao mesmo tempo.
Pedido: Leads sem vendedor visíveis a todos os vendedores e assumidos por quem mexer primeiro

## Entregue
- 01-api-claim  94cc43e  Um vendedor (não gestor) vê os próprios leads mais os leads sem vendedor. A primeira vez que ele move ou edita um lead sem vendedor, o lead passa a ser dele na mesma transação; se dois tentarem ao mesmo tempo, só o primeiro leva e o segundo recebe 'não encontrado'. O gestor mexe sem assumir.
- 02-web-marker  c6289bd  O card e a linha da Lista de um lead aberto sem vendedor mostram a marca 'Sem vendedor - disponível'. Um lead convertido sem vendedor continua com 'Sem vendedor'.
- 03-move-lock-order  d52389c  Mover ou criar leads da mesma coluna ao mesmo tempo não trava mais (antes o banco abortava um deles com erro 500) nem gera posições repetidas na coluna.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- As ondas foram integradas no branch do run, numa worktree própria, e master avançou uma única vez por fast-forward no fim, para não mexer nos arquivos do outro agente que trabalha no checkout principal. (nexo/runs/20261007T181210Z-leads-sem-vendedor/AUDIT.md)
- Incluída a fatia 03 (trava por organização no quadro) porque o planejamento achou um deadlock existente que o pool compartilhado de 114 leads tornaria frequente. (nexo/knowledge/decisions/2026-10-07-unassigned-lead-pool-and-board-lock.md)
- Só um vendedor ativo vê e assume o pool; um finder ou vendedor desativado continua vendo só os próprios leads. (CLAUDE.md)
- Lead convertido sem vendedor não recebe a marca 'disponível', porque é somente leitura e não pode ser assumido. (nexo/plans/leads-sem-vendedor/02-web-marker.md)
- O badge de dias no card ganhou shrink-0/whitespace-nowrap para não quebrar em duas linhas com nome de vendedor longo (defeito visual anterior). (nexo/runs/20261007T181210Z-leads-sem-vendedor/AUDIT.md)
- Teste de mutação da feature fechado como não aplicável (o repo não tem ferramenta); cada Verify de fatia fez uma sonda de mutação direcionada. (nexo/runs/20261007T181210Z-leads-sem-vendedor/AUDIT.md)

## Perguntas
1. Durante uma importação longa, cada requisição do quadro que espera a trava segura uma conexão do pool da API (máximo 10). Quer que eu limite essa espera com um lock_timeout?
   a) Sim, limitar a espera
   b) Não por agora
   c) outra: ___
2. Em Minha prospecção o subtítulo diz 'Seus leads em negociação', mas agora a tela também lista o pool sem vendedor. Mudar o texto?
   a) Manter
   b) Mudar para incluir os leads disponíveis
   c) outra: ___

Responda para retomar: <n><k>
