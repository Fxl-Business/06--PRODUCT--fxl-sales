---
id: 04-compact-card
milestone: v4.2.0
status: done
depends_on: [03-board-column-headers]
files_modified:
  - apps/web/src/sales-ops/leads/LeadCard.tsx
  - apps/web/src/sales-ops/leads/LeadsBoard.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-dropzones.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-card-days-parked.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx
acceptance: "Dado o modo Quadro, quando o card renderiza, então ele não tem botões 'Mover para…'/'Editar'; clicar no card (sem arrastar) chama onEdit; arrastar move; um clique ao FIM de um arraste (ponteiro moveu > limiar) NÃO chama onEdit; o card convertido não arrasta, mostra o selo de status e abre a proposta; o selo de dias só aparece em etapas normais e leads não convertidos, com a faixa de cor correta."
goal: "Card compacto sem botões, clique abre a edição, selo de dias com faixas; oráculos keyboard/dropzones reescritos para mover via modo Lista."
must_not_break:
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-list-view.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-columns.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/move-dialog-inline-layer.test.tsx
rules:
  - "@dnd-kit, board-move.ts, MoveLeadDialog.tsx inalterados. Nenhuma comparação inline de kind; o gating do selo usa stageIsNormal() (object-lookup) calculado em LeadsBoard e passado ao card por prop."
  - "Preservar data hooks: data-lead-card, data-read-only-card, data-days-in-stage, data-open-sale, data-sale-status, .touch-none (SortableLeadCard), .overflow-x-auto (scroller). REMOVER data-move-trigger e data-edit-lead DO CARD (passam a existir só no modo Lista, da slice 02)."
  - "O 'Mover para' continua existindo como controle: modo Lista (botão Mover) + drag-para-perda (abre MoveLeadDialog). MoveLeadDialog segue o único emissor de MoveLeadPayload."
verifier_focus: "Guard de clique-após-arraste por limiar de deslocamento do ponteiro (não confiar no dnd-kit); card convertido sem data-move-trigger e sem botões quando onOpenSale ausente; selo de dias ausente em etapa conversion/lost."
---

# Slice 04 - Card compacto (sem botões, clique abre edição) + reescrita dos oráculos

## LeadCard.tsx

### Props
- REMOVER `onRequestMove` de `LeadCardProps` e do corpo.
- ADICIONAR `onClickCard?: (lead) => void` NÃO - em vez disso reaproveitar `onEdit` para o clique do
  card não convertido, e `onOpenSale` para o clique do card convertido.
- ADICIONAR `showDaysBadge?: boolean` (default `true`, para o teste standalone não quebrar).
- Manter `onEdit`, `onOpenSale`, `dragHandleProps`, `isDragging`.

### Clique vs arraste (guard por limiar)
O `<article>` é a superfície de drag (`dragHandleProps` espalhado) E o alvo de clique. Compor os
handlers para não perder o `onPointerDown` do dnd-kit e evitar editar ao fim de um arraste:
```tsx
const ACTIVATION_DISTANCE = 6; // igual ao PointerSensor
const pointerDown = React.useRef<{ x: number; y: number } | null>(null);

function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
  pointerDown.current = { x: event.clientX, y: event.clientY };
  (dragHandleProps?.onPointerDown as ((e: React.PointerEvent<HTMLElement>) => void) | undefined)?.(event);
}

function handleClick(event: React.MouseEvent<HTMLElement>) {
  const start = pointerDown.current;
  pointerDown.current = null;
  if (start) {
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved > ACTIVATION_DISTANCE) return; // foi um arraste, não um clique
  }
  if (readOnly) {
    if (lead.saleId && onOpenSale) onOpenSale(lead.saleId);
    return;
  }
  onEdit?.(lead);
}
```
No `<article>`: espalhar `dragHandleProps` PRIMEIRO, depois sobrepor `onPointerDown={handlePointerDown}`
e `onClick={handleClick}` (para que o nosso onPointerDown componha o do dnd-kit e o nosso onClick
exista). Adicionar `title={readOnly ? undefined : CARD_TOOLTIP}` e classe `cursor-pointer`.
Manter o `<article>` SEM `role` e SEM virar `<button>` (preserva os testes que checam ausência de role).

### Layout (reescrever o corpo conforme o README)
- **Linha 1** (`flex items-start justify-between gap-2`): à esquerda bloco nome+empresa
  (nome `text-[14px] font-semibold text-[#201f24]`; empresa `text-[12.5px] text-[#8b8b92]` via
  `leadCompanyLabel`); à direita o **valor estimado** `sales-ops-num text-[14px] font-bold text-[#201f24]`
  usando `formatMoneyBrl(lead.estimatedValueBrl, { minimumFractionDigits: 0, maximumFractionDigits: 0 })`.
  REMOVER a linha/label "Valor estimado".
- **Chips de produto** (igual ao atual: `MAX_PRODUCT_CHIPS = 3` + `+N`).
- **Bloco de motivo da perda** (NOVO): se `lead.lostReason` truthy, renderizar
  `<div className="rounded-lg bg-[#fcf1f0] px-3 py-2 text-[12px] text-[#9b2f2a]" data-lost-reason-note>{lead.lostReason}</div>`.
  (Não comparar kind; a presença de `lostReason` basta.)
- **Bloco convertido** (manter como está, L135-164): adicionar `stopPropagation` ao `onClick` do
  botão open-sale para não disparar o handler do card:
  `onClick={(e) => { e.stopPropagation(); onOpenSale(lead.saleId as string); }}`.
- **Footer** (NOVO, `border-t border-[#f0f0f3] pt-2.5 mt-1 flex items-center justify-between gap-2`):
  - Esquerda: `<span className={avatarClass}>{avatarInitials(leadSellerLabel(lead, lookups))}</span>`
    + `<span className="truncate text-[12px] text-[#57575f]">{leadSellerLabel(lead, lookups)}</span>`.
  - Direita (selo de dias): renderizar SÓ quando `showDaysBadge && !readOnly`:
    `<span aria-label={`${describeDaysInStage(days)} nesta etapa`} className={`${daysBadgeClass} ${dayBadgeTone(days)}`} data-days-in-stage={days}>{describeDaysInStage(days)}</span>`.
- REMOVER o bloco de botões (L166-190) inteiramente. Remover o import de `cardButtonClass` se ficar
  sem uso. Importar `avatarClass`, `dayBadgeTone`, `avatarInitials` de `./board-ui` e `CARD_TOOLTIP`
  de `./board-labels`.
- Atualizar o comentário de cabeçalho do arquivo (L24-34): agora o card É clicável para editar; o
  antigo princípio "o card não é ativável" foi superado DELIBERADAMENTE pelo redesign, e a segurança
  contra editar-ao-fim-de-arraste é o guard por limiar de ponteiro (não o fato de não ser clicável).

## LeadsBoard.tsx
- Remover `onRequestMove` de `SortableCardProps` e de `SortableLeadCard`, e parar de passar
  `onRequestMove={(row) => openMoveDialog(row)}` ao `SortableLeadCard` (L431). (O `openMoveDialog`
  continua usado pelo botão "Mover" do modo Lista e pelo drag-para-perda.)
- Passar `showDaysBadge={stageIsNormal(stage) && !leadIsConverted(lead)}` ao `<LeadCard>` e ao
  `<SortableLeadCard>` (importar `stageIsNormal` de `./board-ui`). Para o `SortableLeadCard`,
  encaminhar a prop ao `LeadCard` interno.
- O `LeadCard` do `DragOverlay` (L457) pode receber `showDaysBadge={false}` (overlay enxuto) ou o
  valor do lead ativo; escolher o que mantiver o visual coerente (sugestão: computar pelo stage do
  lead ativo; se custoso, `false`).

## Reescrita dos oráculos

### lead-card-days-parked.test.tsx
- Continua renderizando `<LeadCard>` standalone (não convertido, etapa normal). Com
  `showDaysBadge` default `true`, o selo aparece: manter as asserções de `data-days-in-stage`, texto
  e `aria-label`. Se algum caso renderiza lead CONVERTIDO esperando o selo, ajustar: convertido não
  mostra selo. Adicionar um caso: `showDaysBadge={false}` → sem `[data-days-in-stage]`.

### leads-board-dropzones.test.tsx
- As asserções de `[data-stage-dropzone]`, `[data-stage-column]`, `[data-lead-card]`, `.touch-none`,
  `.overflow-x-auto`, `[data-open-sale]`, `[data-sale-status]` seguem válidas.
- A asserção "`[data-move-trigger]` é null para card convertido" segue válida (e agora é null para
  TODO card no Quadro). Se o teste afirmava `[data-move-trigger]` presente para card NÃO convertido
  no Quadro, REMOVER/ajustar essa expectativa (no Quadro não há mais move-trigger).
- Clique no card: adicionar/ajustar um caso — clicar num `[data-lead-card]` não convertido chama
  `onEditLead`.

### lead-conversion.test.tsx (BLOCANTE - B1 do plan-check)
Este suíte (full-app) dirige a conversão pelo `moveIntoConversionColumn()` (L449-460), que hoje
clica `[data-move-trigger="${LEAD_ID}"]` DO CARD no modo Quadro. 8 testes o usam
(L477,499,539,571,589,610,624,634). Com o card sem move-trigger, todos lançam "not found".
Reescrever SÓ o helper para passar pelo modo Lista (o resto dos testes fica igual):
```ts
async function moveIntoConversionColumn() {
  await click(required('[data-view-option="list"]'));           // entra no modo Lista
  await click(required(`[data-move-trigger="${LEAD_ID}"]`));    // Mover da LINHA da lista
  const trigger = container.querySelector('[aria-labelledby="move-lead-stage-label"]');
  if (!trigger) throw new Error('destination picker not found');
  await click(trigger);
  const row = [...container.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent?.trim() === 'Proposta enviada',
  );
  if (!row) throw new Error('conversion stage not offered as a move target');
  await click(row);
  await click(required('[data-move-confirm]'));
}
```
O caso convertido em L655 (`[data-move-trigger]` é null) roda em Quadro e NÃO chama o helper: segue
válido (agora o card nunca tem move-trigger). Rodar `lead-conversion.test.tsx` inteiro como oráculo
adicional desta slice e confirmar os 8 + o convertido verdes. Se algum dos 8 asserir DOM específico
de coluna do Quadro após o move, ajustar para o equivalente no modo Lista (ou reentrar no Quadro com
`[data-view-option="board"]` antes da asserção de card, conforme o que o teste checa).

### leads-board-keyboard.test.tsx
- Este suíte abria o MoveLeadDialog via `[data-move-trigger]` do CARD. Reescrever para abrir via o
  **modo Lista**: no setup, clicar `[data-view-option="list"]`, então usar o `[data-move-trigger]`
  da LINHA da lista (mesmo seletor, agora na tabela). O resto do fluxo (combobox de destino,
  `[data-lost-reason]`, `[data-move-confirm]`, asserção de `onMoveLead`/optimistic) permanece.
- O caso do card convertido (zero botões, `data-read-only-card`, sem `role`, texto "Ganha") roda com
  `onOpenSale` ausente → segue válido.
- O caso do seller-filter (combobox "Todos os vendedores" → `onChange(null)`) permanece; o filtro
  agora vive no grupo esquerdo da toolbar, mas o seletor `[role="combobox"]` é o mesmo.
- Adicionar: no modo Quadro, clicar num card não convertido chama `onEditLead` (o novo gesto de
  edição), e um "clique" com deslocamento > 6px NÃO chama `onEditLead` (simular `pointerdown` em
  (0,0) e `click` em (20,20); happy-dom entrega clientX/clientY nos eventos sintéticos).

## Verificação (oráculo nomeado)
`lead-card-days-parked` + `leads-board-dropzones` + `leads-board-keyboard` + `board-write-surface` +
`leads-list-view` + `leads-board-columns` verdes; lint no diff. Rodar a suíte web completa na
verificação de wave.

## Fora de escopo
Nada novo; esta é a última slice. Persistência em URL do leadView/stageFilter permanece como item de
auditoria (opcional, não implementado).
