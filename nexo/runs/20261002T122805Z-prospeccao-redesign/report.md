# Relatório: prospeccao-redesign

## Status da solicitação
pass · Redesign completo entregue em 4 slices, todas em master e verdes; suíte web 1219/1219, lint/type-check/build limpos. Não promovido (Gate 3 humano).
Pedido: Implementar o redesign da tela Prospecção (Operacional) e Minha prospecção descrito em .demo/design_handoff_prospeccao/README.md

## Entregue
- 01-ui-foundations  5708747  Cores por etapa (ciclo normal + conversion/lost por object-lookup), faixas de cor do selo de dias, iniciais de avatar, tokens de classe e strings pt-BR.
- 02-list-mode-and-toggle  709b685  Alternância Quadro/Lista e o modo Lista completo: chips de fase com totais, tabela (Lead/Fase/Produtos/Vendedor/Na fase/Valor/Ações Mover+Editar) e rodapé com TOTAL.
- 03-board-column-headers  5b28b54  Cabeçalho de coluna no Quadro com total da fase em R$, % do total, barra de proporção, cor por etapa na coluna e no drag-over, e o botão Ver em lista.
- 04-compact-card  958b9e6  Card compacto sem botões: clicar abre a edição (guard por limiar de ponteiro), arrastar move; selo de dias com faixas no rodapé; oráculos keyboard/dropzones/lead-conversion reescritos para mover via modo Lista.

## Não feito e por quê
- n/a  park · out_of_scope
  Persistência em URL de leadView/leadStageFilter (?view=&stage=) - opcional no README; exigiria tocar o routing em SalesOpsApp.tsx. Estado ficou de componente. Audit: nexo/runs/20261002T122805Z-prospeccao-redesign/AUDIT.md

## Decisões tomadas sem você
- Card clicável para editar com guard por limiar de ponteiro (6px), superando o princípio 'o card não é ativável' de LeadCard, exigido pelo WHAT do README. (nexo/knowledge/reference/kanban-de-leads.md + CLAUDE.md)
- Cor por etapa via object-lookup KIND_COLORS[stage.kind] + stageIsNormal, para não violar o write-surface scan (que proíbe kind === '...'). (apps/web/src/sales-ops/leads/board-ui.ts)
- NO_PRODUCTS_DASH usa '-' em vez do '—' do protótipo, honrando a regra global de não usar em dash. (board-labels.ts)
- Filtro de vendedor mantido como Combobox (não o <select> nativo do protótipo, banido por lint). (LeadsBoard.tsx)
- Execução serial (trunk master; nexo-wave-exec hardcoda main e worktrees pnpm sem node_modules); Gate 2 por agente Verify separado, não enfraquecido. (nexo/runs/.../run.md)

## Perguntas
1. Quer promover agora (cut de release v4.2.0 via /nexo-ship) ou ainda vai testar master localmente primeiro?
   a) Testar master primeiro (autopilot parou aqui de propósito)
   b) Rodar /nexo-ship
   c) outra: ___

Responda para retomar: <n><k>
