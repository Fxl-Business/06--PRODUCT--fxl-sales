---
feature: prospeccao-redesign
milestone: v4.2.0
---

# Feature: Redesign da tela Prospecção (Operacional) e Minha prospecção

## WHAT / WHY (Frame)

Redesenhar o quadro de leads ("Prospecção" no workspace Operacional e "Minha prospecção"
em Meus dados) conforme `.demo/design_handoff_prospeccao/README.md`. O `FXL Sales.dc.html`
é referência visual, não código a copiar.

O redesign adiciona:
1. **Valor total por fase** no cabeçalho de cada coluna (quantidade, total em R$, % do total, barra de proporção).
2. **Alternância Quadro / Lista**.
3. **Modo Lista** com todas as fases ou uma fase só, e total no rodapé.
4. **Quadro compacto**: o card não tem botões. Clicar no card abre a edição; arrastar move o lead.
5. **Cor por etapa** e **selo de dias parado na fase** com alerta por faixa.

## Scope limits (YAGNI / out of scope)

- **Não** trocar a lib de drag-and-drop (`@dnd-kit`): manter sensores, `activationConstraint` e animações.
- **Não** alterar `board-move.ts` nem `MoveLeadDialog.tsx` (motivo da perda, aviso de conversão) nem o fluxo de conversão em proposta (`conversion.ts`, as wiring em `SalesOpsApp.tsx`).
- **Não** tocar em `SalesOpsApp.tsx` (fora do escopo; os sentinelas `BOARD-WRITE-FENCE` vivem lá e seguem intactos).
- **Não** mexer em routing (`operacional/leads` vs `meus-dados/leads`) nem em `withTenant`/RLS. `leadView` e `leadStageFilter` são estado de componente; a persistência em URL (`?view=&stage=`) é OPCIONAL e, se custosa, fica como item de auditoria, não entra.
- O board NUNCA filtra `leads` por conta própria: o escopo por vendedor é server-side; `leads` já chega filtrado. Totais derivam do `leads` recebido.

## Binding constraints (oráculos e regras de casa)

- **Write-surface scan** (`__tests__/board-write-surface.test.ts`): nenhum arquivo do board pode
  conter `kind === 'normal'|'lost'` (regex `/kind\s*===\s*['"](normal|lost)['"]/`), `kind === 'conversion'` fora de `board-move.ts`, nem a string `'converted'`, nem `/transition`, `transitionSale`, `useMutation` próprio, `@/lib/api-client`, `@/lib/app-mutation`. **Cores por etapa usam object-lookup** `KIND_COLORS[stage.kind]` (só chaves `conversion`/`lost`) + contador de ciclo para `normal` - NUNCA `===`.
- **Data hooks a preservar** (ou atualizar o teste em lockstep): `data-lead-card`, `data-stage-column`, `data-stage-dropzone`, `data-days-in-stage`, `data-open-sale`, `data-sale-status`, `data-read-only-card`, a superfície `.touch-none`, o scroller `.overflow-x-auto`; `MoveLeadDialog` mantém `data-move-confirm`/`data-lost-reason`.
- **`data-move-trigger="${id}"` e `data-edit-lead="${id}"`** deixam o card e passam a viver nas **Ações do modo Lista** (e o drag-para-perda continua abrindo o `MoveLeadDialog`). `MoveLeadDialog` segue sendo o único emissor de `MoveLeadPayload`.
- **Read-only é propriedade do CARD convertido** (`leadIsConverted(lead) = lead.saleId !== null`), nunca de uma coluna. Não existe kind `'converted'`.
- Pickers: filtro de vendedor usa `Combobox` (`comboboxTriggerClass`); `<select>` nativo é banido por lint. O segmentado Quadro/Lista são `<button>`s (não é picker).
- Moeda: `formatMoneyBrl(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 })` para "R$ X" sem casas. Número monetário usa a classe `sales-ops-num` (Space Grotesk). Código da proposta em `font-mono`.
- Ícones: `lucide-react` (`SquareKanban` para Quadro - `KanbanSquare` é alias deprecado -, `List`, `Plus`).
- Textos em pt-BR exatamente como no README; centralizar novas strings em `board-labels.ts`.

## Acceptance criteria (feature-level)

- AC1: No modo Quadro, cada coluna mostra cabeçalho com nome+bolinha da cor da etapa, pílula de contagem, total em R$ (sem decimais), "N% do total" e barra de proporção com largura = % do total. Totais derivam do `leads` recebido.
- AC2: Existe alternância Quadro/Lista (segmentado); o padrão é Quadro; o filtro de vendedor e a fase selecionada são mantidos ao alternar.
- AC3: No modo Lista, chips de fase ("Todas as fases" + um por etapa com total e contagem) filtram a tabela; a tabela lista Lead/Fase/Produtos/Vendedor/Na fase/Valor/Ações, ordenada por etapa e `position`; o rodapé mostra escopo, nº de leads e TOTAL em R$.
- AC4: No modo Quadro o card não tem botões; clicar no card abre a edição (`onEdit`) e arrastar move o lead; card convertido não arrasta e mantém o botão de abrir a proposta.
- AC5: Cor por etapa aplicada a colunas/cabeçalho/chips (ciclo da paleta para `normal`, cor fixa para `conversion`/`lost`), via object-lookup; selo de dias com 3 faixas de cor (≤7, 8-14, >14), só para etapas `normal` e leads não convertidos.
- AC6: `board-write-surface.test.ts` segue verde; `@dnd-kit` e `board-move.ts`/`MoveLeadDialog.tsx` inalterados; nenhum card dispara edição ao fim de um arraste.
- AC7: Lint, type-check e a suíte web completos passam; os testes que dependiam dos botões do card são atualizados.

## Slices (serial - trunk é `master`; execução serial por padrão neste repo)

| # | slice | entrega | depends_on | arquivos |
|---|---|---|---|---|
| 01 | ui-foundations | Resolver de cor por etapa, faixas do selo de dias, iniciais de avatar, novos tokens de classe e strings pt-BR (sem consumidor ainda). | - | board-ui.ts, board-labels.ts, __tests__/board-ui.test.ts |
| 02 | list-mode-and-toggle | Segmentado Quadro/Lista + estado `leadView`/`leadStageFilter`, modo Lista completo (chips, tabela com Ações Mover/Editar, rodapé de total). Board inalterado. | 01 | LeadsBoard.tsx, board-labels.ts, __tests__/leads-list-view.test.tsx |
| 03 | board-column-headers | Cabeçalho de coluna com total/%, barra de proporção, cor por etapa na coluna e no drag-over, botão "Ver em lista", coluna vazia "Arraste um lead para cá". Card inalterado. | 02 | LeadsBoard.tsx, __tests__/leads-board-columns.test.tsx |
| 04 | compact-card | Card compacto sem botões (clique abre edição), selo de dias com faixas no rodapé, tooltip; reescrita dos oráculos keyboard/dropzones para o novo board (mover via modo Lista / drag). | 03 | LeadCard.tsx, LeadsBoard.tsx, __tests__/leads-board-keyboard.test.tsx, __tests__/leads-board-dropzones.test.tsx, __tests__/lead-card-days-parked.test.tsx |

Ordem deliberada: o modo Lista (02) carrega as Ações Mover/Editar ANTES de o card perder os botões (04),
para que a suíte completa fique verde em cada fronteira de wave.
