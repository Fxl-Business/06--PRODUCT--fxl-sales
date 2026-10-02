---
id: 02-list-mode-and-toggle
milestone: v4.2.0
status: todo
depends_on: [01-ui-foundations]
files_modified:
  - apps/web/src/sales-ops/leads/LeadsBoard.tsx
  - apps/web/src/sales-ops/leads/board-labels.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-list-view.test.tsx
acceptance: "Dado o board, quando clico em 'Lista', então a tabela de leads aparece com chips de fase (Todas as fases + uma por etapa com total e contagem), colunas Lead/Fase/Produtos/Vendedor/Na fase/Valor/Ações (Mover+Editar), ordenada por etapa e position, com rodapé escopo+TOTAL; clicar num chip filtra; voltar a 'Quadro' preserva filtro de vendedor e fase; o modo Quadro permanece idêntico."
goal: "Alternância Quadro/Lista e o modo Lista completo, sem alterar o modo Quadro."
must_not_break:
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-board-dropzones.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx
rules:
  - "Nenhuma comparação inline de kind em LeadsBoard.tsx. Para cor/kind use stageColors()/stageIsNormal() (object-lookup) de board-ui; para a etapa de conversão/perda use helpers de leads/calculations.ts (conversionStage/lostStage) que NÃO é arquivo escaneado."
  - "@dnd-kit, board-move.ts e MoveLeadDialog.tsx inalterados. O board (DndContext) não muda nesta slice."
  - "Filtro de vendedor continua Combobox; o board nunca filtra seus próprios leads por vendedor (scoping é server-side). O filtro de FASE no modo Lista É client-side (apenas a tabela)."
verifier_focus: "Alternar para Lista e voltar preserva sellerFilter e leadStageFilter; os totais por fase e o total geral batem com a soma de estimatedValueBrl; Ações carregam data-move-trigger/data-edit-lead."
---

# Slice 02 - Alternância Quadro/Lista + modo Lista

## Estado novo (em `LeadsBoard`)
- `const [leadView, setLeadView] = React.useState<'board' | 'list'>('board');`
- `const [leadStageFilter, setLeadStageFilter] = React.useState<string>('');` (`''` = todas as fases).
- Guard: se a etapa filtrada não estiver mais em `columns` (arquivada), voltar para `''`:
  ```ts
  React.useEffect(() => {
    if (leadStageFilter && !columns.some((s) => s.id === leadStageFilter)) {
      setLeadStageFilter('');
    }
  }, [columns, leadStageFilter]);
  ```
- NÃO persistir em URL (fora de escopo; item de auditoria).

## Derivados (memos)
- `colors = React.useMemo(() => stageColors(columns), [columns])` (de board-ui).
- `totalByStage: Map<string, number>` = para cada `stage` em `columns`, soma de `estimatedValueBrl`
  de `leadsInStage(leads, stage.id)` (usar `leads`, não `visibleLeads`).
- `totalGeral` = soma de `totalByStage` sobre as etapas ATIVAS (todas em `columns`).
- `countByStage: Map<string, number>` = `leadsInStage(leads, stage.id).length`.
- `shareByStage(stageId)` = `totalGeral > 0 ? Math.round((totalByStage.get(stageId) ?? 0) / totalGeral * 100) : 0` (inteiro).
- `orderedLeads` para a tabela: concatenar, na ordem de `columns`, `leadsInStage(leads, stage.id)`
  (já ordenado por position); se `leadStageFilter`, só a etapa filtrada.
- `listTotalCents` = soma de `estimatedValueBrl` sobre `orderedLeads` (respeita o filtro de fase).
- `listCount` = `orderedLeads.length`.
- `scopeLabel` = `leadStageFilter ? (columns.find(s=>s.id===leadStageFilter)?.name ?? ALL_PHASES_LABEL) : ALL_PHASES_LABEL`.
- Formatação de moeda: `const fmtBrl0 = (c: number) => formatMoneyBrl(c, { minimumFractionDigits: 0, maximumFractionDigits: 0 });`
  (import `formatMoneyBrl` de `../calculations`).

## Toolbar (reescrever o `<header>` existente, L340-364)
`flex flex-wrap items-center justify-between gap-3`:
- **Esquerda** (`flex items-center gap-2.5`):
  - Segmentado (sempre visível), `data-view-toggle`:
    ```tsx
    <div className={segmentedContainerClass} data-view-toggle="true" role="group" aria-label="Alternar visualização">
      <button type="button" data-view-option="board" aria-pressed={leadView === 'board'}
        className={`${segmentedButtonClass}${leadView === 'board' ? ' ' + segmentedButtonActiveClass : ''}`}
        onClick={() => setLeadView('board')}>
        <SquareKanban aria-hidden size={15} /> {BOARD_VIEW_LABEL.board}
      </button>
      <button type="button" data-view-option="list" aria-pressed={leadView === 'list'}
        className={`${segmentedButtonClass}${leadView === 'list' ? ' ' + segmentedButtonActiveClass : ''}`}
        onClick={() => setLeadView('list')}>
        <List aria-hidden size={15} /> {BOARD_VIEW_LABEL.list}
      </button>
    </div>
    ```
    (import `{ List, SquareKanban }` de `lucide-react`.)
  - Seller filter: mover o bloco `sellerFilter ? <Combobox .../> : null` para DENTRO do grupo
    esquerdo (largura `w-[220px]`). Quando ausente, não renderizar nada (sem o `<span/>`), pois o
    segmentado já ocupa a esquerda.
- **Direita**: o botão `Novo lead` (`onCreateLead`), agora com ícone "+" à esquerda do rótulo:
  `<Plus aria-hidden size={16} /> Novo lead` (import `Plus` de `lucide-react`, junto de `List`/`SquareKanban`).
  Manter `primaryButtonClass`; garantir que ele alinha ícone+texto (`inline-flex items-center gap-1.5`);
  se o token não tiver flex, compor a classe no uso.

## Render condicional
- `leadView === 'board'`: renderizar EXATAMENTE o board atual (o `<DndContext>...>` + DragOverlay),
  sem alterações. Envolver o board atual num fragmento condicional.
- `leadView === 'list'`: renderizar o modo Lista (abaixo). O `MoveLeadDialog` (L476-492) e o footer
  "Carregar mais leads" (L463-474) ficam FORA do condicional (valem para os dois modos; o dialog é
  acionado pelo "Mover" da lista também).

## Modo Lista (novo bloco)
Container `flex flex-col gap-4`, `data-leads-list="true"`.

### Chips de fase (`flex flex-wrap gap-2`)
- Primeiro chip "Todas as fases":
  ```tsx
  <button type="button" data-phase-chip="" aria-pressed={leadStageFilter === ''}
    className={`${phaseChipClass}${leadStageFilter === '' ? ' ' + phaseChipActiveClass : ''}`}
    onClick={() => setLeadStageFilter('')}>
    <span>{ALL_PHASES_LABEL}</span>
    <span className="sales-ops-num">{fmtBrl0(totalGeral)}</span>
    <span data-phase-count>{leads.length}</span>
  </button>
  ```
- Um chip por etapa de `columns`: bolinha `style={{ backgroundColor: colors.get(stage.id)?.dot }}`
  (7-9px round), nome, total `fmtBrl0(totalByStage.get(stage.id) ?? 0)` em `sales-ops-num` com
  `opacity-75`, e contagem `countByStage.get(stage.id) ?? 0` numa pílula com
  `style={{ backgroundColor: colors.get(stage.id)?.soft, color: colors.get(stage.id)?.ink }}`.
  `data-phase-chip={stage.id}`, `aria-pressed`, `onClick={() => setLeadStageFilter(stage.id)}`.

### Tabela (dentro de `listTableCardClass`, `min-w-[900px]`)
- `<table className="w-full border-collapse text-left text-[13px]">`.
- `<thead className={listTheadClass}>` com `<th>`s: `LIST_HEADERS.lead`, `.phase`, `.products`,
  `.seller`, `.inStage`, `.value` (text-right), `.actions` (text-right). `px-4 py-2.5`.
- `<tbody>`: para cada `lead` em `orderedLeads`, uma `<tr className={listRowClass}
  data-list-row={lead.id}>`:
  - **Lead**: nome (`font-semibold text-[#201f24]`) + empresa `leadCompanyLabel(lead, lookups)`
    (`text-[12.5px] text-[#8b8b92]`).
  - **Fase**: pílula soft/ink + bolinha dot. Resolver a etapa do lead via
    `columns.find(s => s.id === lead.stageId)`; cor via `colors.get(lead.stageId)`. Nome da etapa.
    `data-row-phase={lead.stageId}`.
  - **Produtos**: `leadProductLabels(lead, lookups).join(', ')` ou `NO_PRODUCTS_DASH` se vazio.
  - **Vendedor**: `<span className={avatarClass}>{avatarInitials(leadSellerLabel(lead, lookups))}</span>`
    + `leadSellerLabel(lead, lookups)`.
  - **Na fase**: selo de dias. `const stage = columns.find(s=>s.id===lead.stageId);`
    `const showBadge = stage ? stageIsNormal(stage) && !leadIsConverted(lead) : false;`
    `const days = daysInCurrentStage(lead.stageChangedAt, now);`
    se `showBadge`: `<span className={`${daysBadgeClass} ${dayBadgeTone(days)}`} data-days-in-stage={days}>{describeDaysInStage(days)}</span>`; senão `NO_PRODUCTS_DASH`.
  - **Valor** (`text-right`): `<span className="sales-ops-num font-bold">{fmtBrl0(lead.estimatedValueBrl)}</span>`.
  - **Ações** (`text-right`, `flex` à direita, `gap-2`):
    - Se convertido (`leadIsConverted(lead)`) e `onOpenSale` e `lead.saleCode`: botão que abre a
      proposta, `data-open-sale={lead.saleId}`, mostra `lead.saleCode` em `font-mono`,
      `onClick={() => onOpenSale(lead.saleId!)}`.
    - Se NÃO convertido: botão "Mover": `data-move-trigger={lead.id}` className `listActionButtonClass`,
      `onClick={() => openMoveDialog(lead)}` → `{MOVE_LABEL}`.
    - Sempre (convertido ou não? README: "Editar" sempre nas Ações): botão "Editar"
      `data-edit-lead={lead.id}` className `listActionButtonClass`, `onClick={() => onEditLead?.(lead)}`
      → `{EDIT_LABEL}`. (Para um lead convertido, "Editar" abre a edição do lead como hoje; manter.)
  - Linha vazia: se `orderedLeads.length === 0`, uma `<tr>` com `<td colSpan={7}>` e
    `EMPTY_PHASE_LIST` centralizado.
- **Rodapé** (`listFooterClass`, fora do `<table>` mas dentro do card ou logo abaixo):
  esquerda `<span>{scopeLeadsCount(scopeLabel, listCount)}</span>`; direita
  `<span>{TOTAL_LABEL}</span><span className="sales-ops-num" data-list-total>{fmtBrl0(listTotalCents)}</span>`.

## Red (escrever primeiro) - `__tests__/leads-list-view.test.tsx`
Renderizar `<LeadsBoard>` com 3 etapas (2 normal, 1 conversion) e alguns leads com
`estimatedValueBrl` conhecidos e `stageChangedAt`. Asserir:
1. Padrão é Quadro: `[data-stage-column]` presente e `[data-leads-list]` ausente; clicar
   `[data-view-option="list"]` mostra `[data-leads-list]` e ESCONDE o board - asserir a ausência
   via `[data-stage-column]` (ou o scroller `.overflow-x-auto`) virar null, NÃO via `[data-leads-board]`,
   que é o wrapper externo permanente e não testemunha "board escondido".
2. Chips: existe `[data-phase-chip=""]` (Todas as fases) com o total geral formatado; existe um
   `[data-phase-chip="<stageId>"]` por etapa com o total da fase.
3. Filtro: clicar um chip de etapa reduz as `[data-list-row]` às daquela etapa; "Todas as fases"
   volta a mostrar todas.
4. Rodapé: `[data-list-total]` mostra a soma formatada das linhas visíveis; o escopo mostra
   "Todas as fases · N leads" / "<Fase> · N leads".
5. Ações: uma linha não convertida tem `[data-move-trigger="<id>"]` e `[data-edit-lead="<id>"]`;
   clicar Editar chama `onEditLead`; clicar Mover abre `[role="dialog"]` (MoveLeadDialog).
6. Preserva estado: selecionar um vendedor (se testável) e uma fase, alternar para Quadro e voltar,
   a fase continua selecionada. (Ou, mais simples: selecionar fase, ir para Quadro, voltar, o chip
   da fase segue `aria-pressed=true`.)
7. Converted row: um lead convertido mostra `[data-open-sale]` com o `saleCode`.

Também garantir que `board-write-surface`, `leads-board-dropzones` e `leads-board-keyboard`
seguem verdes (o modo Quadro não mudou).

## Verificação (oráculo nomeado)
`leads-list-view.test.tsx` + `board-write-surface` + `leads-board-dropzones` + `leads-board-keyboard`
verdes; lint no diff.

## Fora de escopo
Cabeçalho rico de coluna e cores no Quadro (slice 03); card compacto (slice 04).
