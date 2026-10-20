# Prospecção: navegação e kanban

Projeto: FXL Sales (futuro FXL Vendas). Fluxo Nexo. Sem push e sem deploy. Objetivo: melhorar a navegação e a usabilidade do kanban e das etapas de Prospecção. Na sidebar, Prospecção vira o item principal e se expande como um menu com cada etapa do funil. Clicar numa etapa abre essa etapa no modo lista. Remover a mini navbar Lista/Kanban de dentro do conteúdo. O Funil (kanban completo) vira uma página própria na sidebar. Header das colunas fixo ao rolar. Rolagem independente por coluna, sem scroll geral da página. Busca dentro do kanban por nome do lead, empresa e contato, filtrando os cards em tempo real. Botão Mover no card para trocar a etapa sem arrastar. Depois de mover, editar ou excluir, mostrar um aviso com Desfazer por alguns segundos. Typecheck, lint e testes devem passar, com prints de cada tela em .nexo/tmp/.

Pace: economico

## Acceptance

- A sidebar mostra Prospecção com as etapas do funil; selecionar cada etapa abre a lista da etapa correta.
- O conteúdo não mostra seletor Lista/Kanban; Funil abre como página própria a partir da sidebar.
- Com muitos cards, o cabeçalho de cada coluna permanece visível e cada coluna rola independentemente sem fazer a página inteira rolar.
- A busca do kanban filtra cards em tempo real por nome do lead, empresa e contato; limpar a busca restaura todos os cards.
- O botão Mover permite escolher uma etapa sem arrastar, persiste a mudança e mantém drag-and-drop funcional.
- Depois de mover, editar ou excluir, um aviso oferece Desfazer por alguns segundos; desfazer restaura o estado persistido e a interface.
- Typecheck, lint e testes passam em invocações únicas, sem modo watch.
- Capturas das telas de Prospecção por etapa e do Funil com busca e colunas são salvas em .nexo/tmp/; eventual impedimento visual é registrado como item de Revisão, sem bloquear a entrega com gates automatizados verdes.
- Nenhum push, deploy ou promoção de staging/production é executado.

## Slices

- 01-navigation: sidebar routes and stage list.
- 02-board: independent columns, search, move control.
- 03-restore-permission: scoped API restore for undo of seller deletion.
- 04-undo: reversible move, edit, delete.

## Visual capture after automated gates

The run orchestrator owns one capture attempt after integrated automated verification.
Start the app using a run-once controlled server, capture each active stage list as `.nexo/tmp/<run-id>/stage-<stage-id>.png`, and capture the Funil with visible columns and a search query as `.nexo/tmp/<run-id>/funil-search.png`.
Write `.nexo/tmp/<run-id>/manifest.json` with the stage IDs, filenames, and capture result.
If app access or fixture data prevents a capture, record the limitation as a Report decision and Revisão item; it does not hold a green automated delivery.
No push, deploy, or promotion is authorized.
