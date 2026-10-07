# Relatório: lead-lixeira

## Status da solicitação
pass · Tudo entregue em master: excluir pelo menu do card, pela Lista e pelo formulário, lixeira com Restaurar e log em Cadastros > Leads excluídos, e o contador/totais/funil da coluna pelo total real do servidor.
Pedido: Excluir lead pelo menu do card e pelo formulário, com lixeira restaurável e log para o gestor; contador e totais da coluna pelo total real

## Entregue
- 01-api-lixeira  d8ccf14  Excluir vira lixeira: o lead some de todas as telas para todos, mas fica guardado com quem excluiu e quando. Vendedor exclui o que ele enxerga; gestor exclui qualquer um e é o único que restaura. Cada exclusão e restauração fica no histórico auditado.
- 02-api-stage-summary  994e259  O servidor passa a informar quantos leads e quanto valor existem em cada etapa, respeitando o que cada pessoa pode ver.
- 03-web-delete-ui  79e59a4  Cada card ganhou um menu '...' (também no clique direito) com Excluir; a Lista e o formulário de edição também têm Excluir, sempre com confirmação. De quebra, corrigido um erro que fazia ações sem resposta do servidor (como revogar link de finder) parecerem falhar.
- 04-web-lixeira-screen  f4f9c6a  Nova tela Cadastros > Leads excluídos para o gestor: quem excluiu, quando, qual lead e etapa, com o botão Restaurar.
- 05-web-board-totals  e597739  O número da coluna, os totais em R$, a Lista e o Funil passam a usar o total real: 115 leads aparecem como 115 mesmo com 100 carregados, e o botão diz 'Carregar mais leads (100 de 115)'.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- A exclusão é uma lixeira (soft delete) com uma ação POST, porque o sistema nunca apaga cadastros e não tem verbo DELETE. (nexo/knowledge/decisions/2026-10-07-lead-trash-soft-delete.md)
- Restaurar não pede confirmação (não perde nada) e devolve o lead ao fim da sua etapa, ou da primeira etapa aberta se a dele foi arquivada. (nexo/runs/20261007T203517Z-lead-lixeira/AUDIT.md)
- O botão '...' do card fica sempre visível em cinza claro, porque escondido até o hover deixava um buraco e não funciona em tela de toque. (nexo/runs/20261007T203517Z-lead-lixeira/AUDIT.md)
- O contador da coluna usa o maior entre o total do servidor e os cards já carregados, para nunca mostrar menos do que está na tela. (nexo/runs/20261007T203517Z-lead-lixeira/AUDIT.md)
- O quadro carrega 100 leads por página (e não 50, como eu tinha dito); por isso o seu print mostrava exatamente 100. (nexo/runs/20261007T203517Z-lead-lixeira/AUDIT.md)

## Perguntas
- nada a registrar.
