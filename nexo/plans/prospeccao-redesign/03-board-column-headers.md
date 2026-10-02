---
id: 03-board-column-headers
milestone: v4.2.0
status: todo
depends_on: [02-list-mode-and-toggle]
files_modified:
  - apps/web/src/sales-ops/leads/LeadsBoard.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-columns.test.tsx
acceptance: "Dado o modo Quadro, quando renderizo as colunas, então cada cabeçalho mostra bolinha+nome da etapa, pílula de contagem, total em R$ (sem decimais), 'N% do total' e barra de proporção com largura = % do total; a coluna usa a cor suave/borda da etapa e o drag-over assume a cor da etapa; a coluna vazia mostra a área tracejada 'Arraste um lead para cá'; e o botão 'Ver em lista' abre o modo Lista filtrado por aquela fase."
goal: "Cabeçalho de coluna rico com valor por fase, cor por etapa e atalho 'Ver em lista', no modo Quadro."
must_not_break:
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
  - apps/web/src/sales-ops/leads/__tests__/leads-board-dropzones.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx
  - apps/web/src/sales-ops/leads/__tests__/leads-list-view.test.tsx
rules:
  - "Nenhuma comparação inline de kind em LeadsBoard.tsx; cores via stageColors() (object-lookup). Manter data-stage-column, data-stage-dropzone, data-conversion-column, .overflow-x-auto, .touch-none."
  - "@dnd-kit, board-move.ts, MoveLeadDialog.tsx inalterados. Card (LeadCard) inalterado nesta slice."
verifier_focus: "A barra de proporção com largura = share%; os totais por coluna; o drag-over trocando para a cor da etapa (StageDropZone recebe a cor); 'Ver em lista' setando leadView='list' + leadStageFilter=stage.id."
---

# Slice 03 - Cabeçalho de coluna (valor por fase, cor por etapa, 'Ver em lista')

## Limpeza de imports (evitar falha de lint - N2)
Ao substituir o `<header className={columnHeaderClass}>` pelo cabeçalho rico e a coluna vazia
`mutedStateClass` pela área tracejada, os imports `columnHeaderClass` e `mutedStateClass` em
`LeadsBoard.tsx` podem ficar SEM USO. Conferir e remover do bloco de import de `./board-ui` o que
ficar órfão (o `eslint` do projeto falha em import não usado). Importar `columnHeaderCardClass`,
`proportionTrackClass`, `iconButtonClass` de `./board-ui` e `VIEW_IN_LIST_LABEL`/`PERCENT_OF_TOTAL`
de `./board-labels`.

## Reaproveitar derivados da slice 02
`colors`, `totalByStage`, `countByStage`, `shareByStage` já existem (slice 02). Se algum só existia
para a Lista, promovê-lo para memo compartilhado.

## StageDropZone (cor da etapa no drag-over)
Passar a cor para o dropzone para que o drag-over use a cor `dot` da etapa (em vez do atual
`bg-[#eeeef6]`), e a área ganhe `rgba(255,255,255,.6)`:
```tsx
function StageDropZone({ stageId, dotColor, children }: {
  stageId: string; dotColor: string; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  return (
    <div
      className="flex min-h-[72px] flex-col gap-2 rounded-md transition-colors"
      data-stage-dropzone={stageId}
      ref={setNodeRef}
      style={isOver ? { backgroundColor: 'rgba(255,255,255,0.6)', outline: `1.5px solid ${dotColor}` } : undefined}
    >
      {children}
    </div>
  );
}
```
Passar `dotColor={colors.get(stage.id)?.dot ?? '#cfcfd6'}` no uso (L408).

## Coluna com cor da etapa
No `<section>` da coluna (L396-401), aplicar a cor suave/borda via `style`:
```tsx
const c = colors.get(stage.id);
<section
  className={columnClass}
  style={{ backgroundColor: c?.soft, borderColor: c?.border }}
  data-stage-column={stage.id}
  ...
>
```
(Manter `columnClass`, mas se ele fixa bg/border hex, remover essas cores fixas do token em board-ui
na slice 01? NÃO — slice 01 já passou. Aqui: o `style` inline sobrepõe o bg/border do className, o
que é suficiente. Se houver conflito visual, preferir remover apenas as classes de cor do uso via
um className adicional; manter simplicidade com style inline sobrepondo.)

## Cabeçalho rico (substituir L402-405)
Dentro de `columnHeaderCardClass` (card interno branco), três linhas:
```tsx
<header className={columnHeaderCardClass}>
  <div className="flex items-center gap-2">
    <span className="h-[9px] w-[9px] shrink-0 rounded-full" style={{ backgroundColor: c?.dot }} />
    <span className="flex-1 truncate text-[13.5px] font-bold text-[#201f24]">{stage.name}</span>
    <span className="rounded-full px-2 py-0.5 text-[11.5px] font-bold"
      style={{ backgroundColor: c?.soft, color: c?.ink }} data-stage-count>{count}</span>
    <button type="button" className={iconButtonClass} aria-label={`${VIEW_IN_LIST_LABEL}: ${stage.name}`}
      data-view-in-list={stage.id}
      onClick={() => { setLeadStageFilter(stage.id); setLeadView('list'); }}>
      <List aria-hidden size={15} />
    </button>
  </div>
  <div className="mt-2 flex items-baseline justify-between">
    <span className="sales-ops-num text-[20px] font-bold text-[#201f24]" data-stage-total>{fmtBrl0(totalByStage.get(stage.id) ?? 0)}</span>
    <span className="text-[11.5px] font-semibold text-[#9b9ba3]">{PERCENT_OF_TOTAL(share)}</span>
  </div>
  <div className={`mt-2 ${proportionTrackClass}`}>
    <div className="h-full rounded-full" style={{ width: `${share}%`, backgroundColor: c?.dot }} data-stage-bar />
  </div>
</header>
```
onde `count = column.length` (usar o `column` já calculado por coluna, que usa `visibleLeads`; para o
total/▐share usar `totalByStage`/`shareByStage` derivados de `leads`). `share = shareByStage(stage.id)`.
`List` de lucide-react já importado na slice 02.

NOTA sobre `data-conversion-column` e a contagem: manter o atributo
`{...(stageOpensConversion(stage) ? { 'data-conversion-column': 'true' } : {})}` no `<section>`.

## Coluna vazia (substituir L435-437)
Trocar o `<p className={mutedStateClass}>Nenhum lead nesta etapa.</p>` pela área tracejada:
```tsx
{column.length === 0 ? (
  <div className="flex min-h-[80px] items-center justify-center rounded-lg border-[1.5px] border-dashed p-3 text-center text-[12.5px] text-[#9b9ba3]"
    style={{ borderColor: c?.border }} data-empty-column={stage.id}>
    {EMPTY_COLUMN_HINT}
  </div>
) : null}
```
Se algum teste existente asseria o texto "Nenhum lead nesta etapa." no QUADRO, atualizá-lo para
`EMPTY_COLUMN_HINT` ("Arraste um lead para cá"). (Buscar com grep antes: `grep -rn "Nenhum lead nesta etapa" apps/web/src`.)

## Red (escrever primeiro) - `__tests__/leads-board-columns.test.tsx`
Renderizar `<LeadsBoard>` no modo Quadro com etapas de kinds variados e leads de valores conhecidos.
Asserir:
1. Cada `[data-stage-column]` tem um `[data-stage-total]` com o total formatado da fase e um
   `[data-stage-count]` com a contagem.
2. `[data-stage-bar]` tem `style.width` = `${share}%` (ex.: uma fase com metade do total geral → 50%).
3. A bolinha e a barra usam a cor `dot` da etapa (asserir `style.backgroundColor` ≈ hex esperado;
   comparar via `rgb(...)` se happy-dom normalizar).
4. Uma coluna vazia mostra `[data-empty-column]` com o texto `EMPTY_COLUMN_HINT`.
5. Clicar `[data-view-in-list="<stageId>"]` troca para a Lista (`[data-leads-list]` presente) com o
   chip daquela fase `aria-pressed=true`.

## Verificação (oráculo nomeado)
`leads-board-columns` + `board-write-surface` + `leads-board-dropzones` + `leads-board-keyboard` +
`leads-list-view` verdes; lint no diff.

## Fora de escopo
Card compacto e remoção de botões do card (slice 04).
