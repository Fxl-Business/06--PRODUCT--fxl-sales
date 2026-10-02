# Run: Redesign da tela Prospecção (Operacional) e Minha prospecção

- Flow: feature (autopilot, front-door). Trunk: master. Integration: local, serial.
- Request: implementar `.demo/design_handoff_prospeccao/README.md` (valor por fase, Quadro/Lista, card compacto, cor por etapa, selo de dias).
- Milestone: v4.2.0 (prospectivo; não promovido — Gate 3 humano).

## Resultado
4 slices, todas mergeadas em master, cada uma verde por um agente Verify separado; suíte web completa + lint verdes em cada wave; type-check e build reais verdes na fronteira da feature.

| slice | merge | diff | oráculo |
|---|---|---|---|
| 01 ui-foundations | 5708747 | +201/-1, 3f | board-ui.test (9), write-surface (10), days (4) |
| 02 list-mode-and-toggle | 709b685 | +503/-21, 2f | leads-list-view (6) + regressões |
| 03 board-column-headers | 5b28b54 | +248/-11, 2f | leads-board-columns (5) + regressões |
| 04 compact-card | (merge) | +169/-80, 6f | suíte web completa 1219/1219 |

Suíte web final: 103 arquivos, 1219 testes (de 1204 no baseline, +15 novos). Lint 0. type-check 0. build 0 (bundle limpo).

## Plan-check
1 bloqueante achado e corrigido no replan 1: `lead-conversion.test.tsx` dirigia a conversão pelo `data-move-trigger` do card no Quadro (removido na slice 04); o helper `moveIntoConversionColumn()` passou a entrar no modo Lista. Não-bloqueantes N1/N2/N4 incorporados (assert de "board escondido", imports mortos, ícone Plus no Novo lead).

## Decisões HOW
- Card clicável para editar com guard por limiar de ponteiro (supersede o princípio "card não é botão" em LeadCard).
- Cores por etapa via object-lookup (write-surface safe), sem `kind === …`.
- leadView/stageFilter como estado de componente (URL opcional não feita).
- NO_PRODUCTS_DASH = '-' (regra global de em dash) em vez do '—' do protótipo.

## Não promovido
Autopilot para em master. Gate 3 (`/nexo-ship`) é humano. Ver AUDIT.md.
