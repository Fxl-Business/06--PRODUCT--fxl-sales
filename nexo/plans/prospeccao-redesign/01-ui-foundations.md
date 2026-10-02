---
id: 01-ui-foundations
milestone: v4.2.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/sales-ops/leads/board-ui.ts
  - apps/web/src/sales-ops/leads/board-labels.ts
  - apps/web/src/sales-ops/leads/__tests__/board-ui.test.ts
acceptance: "Dado o conjunto de etapas, quando resolvo cores e faixas, então stageColors() cicla a paleta normal por ordem e fixa conversion/lost por kind via object-lookup; dayBadgeTone() retorna a faixa certa (<=7, 8-14, >14); avatarInitials() extrai iniciais; e board-write-surface segue verde."
goal: "Fundações de UI puras (cores por etapa, faixas do selo de dias, iniciais de avatar, tokens de classe, strings pt-BR) consumidas pelas slices seguintes."
must_not_break:
  - apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts
  - apps/web/src/sales-ops/leads/__tests__/lead-card-days-parked.test.tsx
rules:
  - "NUNCA usar kind === 'normal'|'lost' em nenhum arquivo do board, nem kind === 'conversion' fora de board-move.ts, nem a string 'converted'. Cor por etapa é object-lookup KIND_COLORS[stage.kind] (chaves só conversion/lost) + contador de ciclo para normal."
  - "board-ui.ts permanece puro: sem React, sem import de componente; pode importar o TIPO SalesOpsLeadStage de ./types."
  - "Textos em pt-BR exatamente como no README; centralizar novas strings em board-labels.ts."
verifier_focus: "A ausência de qualquer comparação inline de kind em board-ui.ts (o scan é regex sobre o texto do arquivo) e o ciclo correto da paleta normal por ORDEM das etapas."
---

# Slice 01 - UI foundations (cores por etapa, faixas de dias, tokens, strings)

## Objetivo
Adicionar helpers puros e tokens de classe que as slices 02-04 consomem, sem ainda mudar
comportamento visível. Tudo em `board-ui.ts` (puro) e strings novas em `board-labels.ts`.

## Contexto de código (fatos)
- `board-ui.ts` (`apps/web/src/sales-ops/leads/board-ui.ts`) hoje só exporta constantes de classe
  (sem React, sem componente). Paleta atual é âmbar `#eaa81a` + cinzas; `daysBadgeClass` é UMA
  constante única; não existe cor por etapa.
- Tipos em `./types`: `SalesOpsLeadStage` tem `{ id, name, position, kind, isSystem, status, ... }`,
  `LeadStageKind = 'normal' | 'conversion' | 'lost'`. `SalesOpsLead` tem `estimatedValueBrl` (CENTS),
  `stageChangedAt` (ISO), `saleId`.
- Faixa de dias hoje: `daysInCurrentStage(stageChangedAt, now)` e `describeDaysInStage(days)` vivem em
  `board-move.ts`/`calculations.ts` (NÃO recriar; apenas consumir nas slices seguintes). Esta slice
  só adiciona a função de TOM (cor) por faixa.
- Scan `board-write-surface.test.ts`: regex `/kind\s*===\s*['"](normal|lost)['"]/` proíbe comparação
  inline; `'converted'` proibido; `/transition`, `transitionSale`, `useMutation`, `@/lib/api-client`,
  `@/lib/app-mutation` proibidos.

## Red (escrever primeiro) - `__tests__/board-ui.test.ts`
Criar `apps/web/src/sales-ops/leads/__tests__/board-ui.test.ts` com:

1. **stageColors cicla a paleta normal por ordem**: dadas 6 etapas na ordem
   `[normal, normal, normal, normal, conversion, lost]` (objetos mínimos `{ id, name, position, kind }`
   em ordem de `position`), `stageColors(stages)` retorna um `Map<string, StageColor>` onde as 4
   normais recebem, em ordem, as paletas normal #1..#4 (asserir pelo campo `dot`:
   `#4f63d8`, `#8656d0`, `#d07a1f`, `#22928f`), a 5ª (conversion) recebe `dot = '#2f9155'` e a 6ª
   (lost) recebe `dot = '#c2413b'`.
2. **stageColors cicla além de 4 normais**: com 5 etapas normais, a 5ª volta ao `dot = '#4f63d8'`
   (ciclo `% 4`).
3. **stageColors ignora a ordem de kind**: conversion/lost NÃO consomem índice do ciclo normal
   (ex.: `[normal, conversion, normal]` → dots `#4f63d8`, `#2f9155`, `#8656d0`).
4. **dayBadgeTone**: `dayBadgeTone(0)` e `dayBadgeTone(7)` retornam a classe neutra (contém
   `bg-[#f1f1f4]` e `text-[#6a6a72]`); `dayBadgeTone(8)` e `dayBadgeTone(14)` a âmbar (contém
   `bg-[#fbf1d9]` e `text-[#8a6210]`); `dayBadgeTone(15)` a vermelha (contém `bg-[#fcf1f0]` e
   `text-[#9b2f2a]`).
5. **avatarInitials**: `avatarInitials('Ana Paula Souza')` → `'AP'`; `avatarInitials('Carlos')` → `'C'`;
   `avatarInitials('')` e `avatarInitials('Sem vendedor')`... (use um caso de nome vazio → `'?'`);
   dois nomes → primeira letra do primeiro e do último token, maiúsculas.

## Green (implementar em `board-ui.ts`)
Adicionar (mantendo as constantes existentes que ainda são usadas):

```ts
import type { LeadStageKind, SalesOpsLeadStage } from './types';

export interface StageColor {
  dot: string;    // hex p/ bolinha e barra
  soft: string;   // hex fundo suave
  border: string; // hex borda
  ink: string;    // hex texto
}

const NORMAL_PALETTE: readonly StageColor[] = [
  { dot: '#4f63d8', soft: '#f3f4fd', border: '#dfe3fa', ink: '#3443a8' },
  { dot: '#8656d0', soft: '#f6f2fd', border: '#e7dcf8', ink: '#6a3db0' },
  { dot: '#d07a1f', soft: '#fdf5ec', border: '#f5e1c8', ink: '#9a5610' },
  { dot: '#22928f', soft: '#eef8f7', border: '#d0ebe9', ink: '#17706d' },
];

// Somente as duas kinds "especiais"; 'normal' NÃO é chave => lookup devolve undefined,
// sem nenhuma comparação `kind === ...`.
const KIND_COLORS: Partial<Record<LeadStageKind, StageColor>> = {
  conversion: { dot: '#2f9155', soft: '#eef7f1', border: '#d3ebdc', ink: '#226c3f' },
  lost: { dot: '#c2413b', soft: '#fcf1f0', border: '#f2d6d4', ink: '#9b2f2a' },
};

export function stageColors(
  stages: readonly Pick<SalesOpsLeadStage, 'id' | 'kind'>[],
): Map<string, StageColor> {
  const map = new Map<string, StageColor>();
  let normalIndex = 0;
  for (const stage of stages) {
    const special = KIND_COLORS[stage.kind];
    if (special) {
      map.set(stage.id, special);
    } else {
      map.set(stage.id, NORMAL_PALETTE[normalIndex % NORMAL_PALETTE.length]);
      normalIndex += 1;
    }
  }
  return map;
}

// Predicado "é etapa normal?" via object-lookup (sem comparar kind com string),
// para o board (arquivo escaneado) gatear o selo de dias sem violar o write-surface.
export function stageIsNormal(stage: Pick<SalesOpsLeadStage, 'kind'>): boolean {
  return !KIND_COLORS[stage.kind];
}
```
Adicionar no teste: `stageIsNormal({ kind: 'normal' })` → `true`; `stageIsNormal({ kind: 'conversion' })`
e `stageIsNormal({ kind: 'lost' })` → `false`.
- IMPORTANTE: assumir que `stages` já vem na ordem de `position` (as slices passam
  `boardStages(stages)` / a lista ordenada). Não reordenar aqui.

`dayBadgeTone`:
```ts
export function dayBadgeTone(days: number): string {
  if (days <= 7) return 'bg-[#f1f1f4] text-[#6a6a72]';
  if (days <= 14) return 'bg-[#fbf1d9] text-[#8a6210]';
  return 'bg-[#fcf1f0] text-[#9b2f2a]';
}
```

`avatarInitials`:
```ts
export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}
```

Tokens de classe NOVOS (adicionar; serão consumidos nas slices 02-04). Usar Tailwind arbitrário
coerente com o restante do arquivo:
- `segmentedContainerClass`: `inline-flex items-center gap-1 rounded-[11px] bg-[#f2f2f4] p-1`.
- `segmentedButtonClass` (base inativo): `inline-flex items-center gap-1.5 rounded-[8px] px-[13px] py-2 text-[13px] font-bold text-[#6a6a72] transition-colors`.
- `segmentedButtonActiveClass`: `bg-[#201f24] text-white`.
- `avatarClass`: `inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f7e2a8] text-[10px] font-bold text-[#7a5a12]`.
- `columnHeaderCardClass`: `rounded-[13px] bg-white px-[14px] py-3 shadow-[0_1px_2px_rgba(32,31,36,0.05)]`.
- `proportionTrackClass`: `h-[5px] w-full overflow-hidden rounded-full bg-[#eeeef1]`.
- `iconButtonClass`: `inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#9b9ba3] hover:bg-[#f2f2f4]` (botão "Ver em lista").
- `phaseChipClass` (base, inativo): `inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[#e2e2e7] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#201f24]`.
- `phaseChipActiveClass`: `border-transparent bg-[#201f24] text-white`.
- `listTableCardClass`: `overflow-x-auto rounded-[18px] border border-[#e8e8ec]`.
- `listTheadClass`: `bg-[#fafafb] text-[11.5px] font-bold uppercase tracking-[0.06em] text-[#8b8b92]`.
- `listRowClass`: `border-t border-[#f0f0f3] hover:bg-[#fcfcfd]`.
- `listFooterClass`: `flex items-center justify-between border-t border-[#e8e8ec] bg-[#fafafb] px-4 py-3`.
- `listActionButtonClass`: reaproveitar o estilo do `cardButtonClass` atual (borda `#e2e2e7`, hover âmbar). Pode exportar um alias semântico, mas NÃO remover `cardButtonClass` ainda (usado pelo card até a slice 04).
- Manter `daysBadgeClass` existente (geometria da pílula, SEM cor); nas slices, compor
  `daysBadgeClass + ' ' + dayBadgeTone(days)`. Se `daysBadgeClass` hoje já tem cor embutida,
  extrair a parte de cor para `dayBadgeTone` e deixar `daysBadgeClass` só com geometria
  (`inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold`).

Strings novas em `board-labels.ts` (exportar; consumidas nas próximas slices):
- `BOARD_VIEW_LABEL = { board: 'Quadro', list: 'Lista' }`.
- `ALL_PHASES_LABEL = 'Todas as fases'`.
- `VIEW_IN_LIST_LABEL = 'Ver em lista'`.
- `EMPTY_COLUMN_HINT = 'Arraste um lead para cá'`.
- `CARD_TOOLTIP = 'Clique para editar · arraste para mover'`.
- `PERCENT_OF_TOTAL = (pct: number) => `${pct}% do total``.
- `LIST_HEADERS = { lead: 'Lead', phase: 'Fase', products: 'Produtos', seller: 'Vendedor', inStage: 'Na fase', value: 'Valor estimado', actions: 'Ações' }`.
- `MOVE_LABEL = 'Mover'` e `EDIT_LABEL = 'Editar'` (ações do modo Lista).
- `TOTAL_LABEL = 'TOTAL'`.
- `NO_PRODUCTS_DASH = '—'`.
- `scopeLeadsCount = (scope: string, n: number) => `${scope} · ${n} ${n === 1 ? 'lead' : 'leads'}``.
- `EMPTY_PHASE_LIST = 'Nenhum lead nesta fase.'`.

## Verificação (oráculo nomeado)
`pnpm --filter @fxl-sales/web test -- --run board-ui.test board-write-surface lead-card-days-parked`
(ou o runner equivalente do projeto). Devem passar: o novo `board-ui.test.ts`,
`board-write-surface.test.ts` (sem violações novas) e `lead-card-days-parked.test.tsx` (inalterado).
Lint no diff.

## Fora de escopo
Nenhuma mudança em `LeadsBoard.tsx`/`LeadCard.tsx` nesta slice.
