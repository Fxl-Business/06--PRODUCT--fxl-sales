# Relatório: prospeccao-kanban-navegacao

## Status da solicitação
pass · Quatro fatias implementadas e verificadas; typecheck, lint e testes passaram nas ondas. Custo: 23 despachos de agentes Codex; 4 fatias e 4 ondas. Sem push ou deploy.
Pedido: Projeto: FXL Sales (futuro FXL Vendas). Fluxo Nexo. Sem push e sem deploy. Objetivo: melhorar a navegação e a usabilidade do kanban e das etapas de Prospecção. Na sidebar, Prospecção vira o item principal e se expande como um menu com cada etapa do funil. Clicar numa etapa abre essa etapa no modo lista. Remover a mini navbar Lista/Kanban de dentro do conteúdo. O Funil (kanban completo) vira uma página própria na sidebar. Header das colunas fixo ao rolar. Rolagem independente por coluna, sem scroll geral da página. Busca dentro do kanban por nome do lead, empresa e contato, filtrando os cards em tempo real. Botão Mover no card para trocar a etapa sem arrastar. Depois de mover, editar ou excluir, mostrar um aviso com Desfazer por alguns segundos. Typecheck, lint e testes devem passar, com prints de cada tela em .nexo/tmp/.

## Entregue
- 01-navigation  8baac04  Prospecção abre as etapas ativas em listas pela sidebar; Funil tem rota própria e o seletor interno foi removido.
- 02-board  fe5e761  Kanban com cabeçalhos fixos, rolagem por coluna, busca instantânea nos cards carregados e botão Mover, mantendo arrastar.
- 03-restore-permission  8a8d32a  Vendedor pode restaurar somente lead próprio excluído na sua organização, permitindo o Desfazer da exclusão com a política de acesso preservada.
- 04-undo  5dfb620  Mover, editar e excluir exibem aviso temporário com Desfazer persistido; conflitos detectáveis impedem sobrescrever mudanças posteriores.

## Não feito e por quê
- nada a registrar.

## Decisões tomadas sem você
- A busca do Funil filtra os cards carregados e mantém os totais e a paginação do servidor. (nexo/runs/20261020T124625Z-prospeccao-kanban-navegacao/REPORT.md) (escolhido: a; alternativas: b) Criar busca paginada no servidor)
- O restauro recoloca o lead no fim de uma etapa válida, sem prometer a posição anterior. (nexo/runs/20261020T124625Z-prospeccao-kanban-navegacao/REPORT.md) (escolhido: a; alternativas: b) Persistir e restaurar a posição anterior)
- O Desfazer de edição ou movimento lê o lead antes da inversão para detectar mudanças posteriores; uma corrida entre leitura e escrita ainda requer precondição atômica na API. (nexo/runs/20261020T124625Z-prospeccao-kanban-navegacao/REPORT.md) (escolhido: a; alternativas: b) Acrescentar versão e mutação condicional na API)
- As capturas locais mostram até dois cards por etapa; a rolagem de coluna longa foi verificada por testes automatizados. (nexo/runs/20261020T124625Z-prospeccao-kanban-navegacao/REPORT.md) (escolhido: a; alternativas: b) Bloquear a entrega até popular uma coluna longa)
- A entrega permanece no master local, sem push, deploy ou promoção. (nexo/runs/20261020T124625Z-prospeccao-kanban-navegacao/REPORT.md) (escolhido: a; alternativas: b) Publicar em remoto ou ambiente)

## Perguntas
- nada a registrar.
