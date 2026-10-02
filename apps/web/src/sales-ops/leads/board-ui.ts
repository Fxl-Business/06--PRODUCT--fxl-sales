/*
  Intentional local copies of the `SalesOpsApp.tsx` style constants, exactly as
  `CadastroHistoryPanel.tsx` and `ProfessionalSplitPanel.tsx` re-declare what they
  cannot import: `SalesOpsApp.tsx` imports this board, so an import the other way
  would be a cycle.

  Class names only, and no component export, so `react-refresh/only-export-components`
  stays quiet.

  Picker geometry has exactly two canonical sizes (CLAUDE.md, "UI Controls"):
  `formSelectClass` at 44px inside a dialog, so a picker and the `Input` beside it
  line up, and `comboboxTriggerClass` at 40px for the compact filter bar. Call
  sites pass only non-geometry extras.
*/

import type { LeadStageKind, SalesOpsLeadStage } from './types';

export const formInputClass =
  'h-11 rounded-[10px] border-[#dcdce2] bg-[#fafafb] px-3 text-sm text-[#201f24] shadow-none outline-none ring-0 transition focus-visible:border-[#eaa81a] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-[#f4f4f6] disabled:text-[#9b9ba3] disabled:opacity-100';

/** The compact 40px picker: the board's filter bar and nothing else. */
export const comboboxTriggerClass =
  'h-10 rounded-md border-[#dcdce2] bg-[#fafafb] px-3 text-sm font-medium text-[#201f24] transition focus-visible:border-[#eaa81a] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60';

/** Every picker inside a dialog. Deliberately the same 44px as `formInputClass`. */
export const formSelectClass = `${comboboxTriggerClass} h-11 rounded-[10px]`;

export const formTextareaClass =
  'min-h-[88px] w-full rounded-[10px] border border-[#dcdce2] bg-[#fafafb] px-3 py-2 text-sm text-[#201f24] outline-none transition focus-visible:border-[#eaa81a]';

export const fieldLabelClass =
  'text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';

export const boardScrollerClass = 'flex gap-4 overflow-x-auto pb-4';

export const columnClass =
  'flex w-[300px] shrink-0 flex-col gap-3 rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc] p-3';

export const columnHeaderClass =
  'flex items-center justify-between gap-2 text-[12px] font-bold uppercase tracking-[0.06em] text-[#6a6a72]';

export const cardClass =
  'flex flex-col gap-2 rounded-[14px] border border-[#e8e8ec] bg-white p-3 text-left shadow-none transition';

/**
 * The ORIGINAL card while its copy rides the DragOverlay. It stays in the flow so
 * the column keeps its height and the other cards do not jump, but it is faded
 * out so the overlay is unambiguously the thing being moved.
 */
export const cardDraggingClass = 'opacity-40';

/**
 * REQUIRED on anything that starts a pointer drag, and the reason the board felt
 * like it kept "letting go" mid-gesture.
 *
 * Without `touch-action: none` the browser owns the gesture first: on a
 * horizontally scrollable board it reads the same movement as a pan, takes over,
 * and fires `pointercancel`. dnd-kit then aborts the drag, correctly, because
 * the pointer stream it was promised ended. The board's own `overflow-x-auto`
 * scroller made this the normal case rather than an edge case.
 *
 * dnd-kit documents this as a requirement of `PointerSensor`, not a nicety.
 */
export const dragHandleSurfaceClass = 'touch-none select-none';

/** The card riding the cursor. Elevated so it reads as lifted off the board. */
export const dragOverlayCardClass = 'w-[276px] rotate-2 cursor-grabbing shadow-xl';

/**
 * Read-only is a property of the CARD (`leadIsConverted`) and never of a column,
 * which is why this constant is named for a card. No column is read-only: the
 * conversion column in particular is a drop target.
 */
export const readOnlyCardClass = 'border-dashed bg-[#fbfbfc]';

/** Pill geometry only. Compose with `dayBadgeTone(days)` for the colour. */
export const daysBadgeClass =
  'inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold';

export const chipClass =
  'inline-flex items-center rounded-full bg-[#f4f4f6] px-2 py-0.5 text-[11px] font-medium text-[#57575f]';

export const cardButtonClass =
  'inline-flex items-center rounded-[9px] border border-[#dcdce2] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210] disabled:cursor-not-allowed disabled:opacity-60';

export const primaryButtonClass =
  'inline-flex items-center justify-center rounded-[10px] bg-[#eaa81a] px-4 py-2 text-sm font-semibold text-[#201f24] transition hover:bg-[#d79a16] disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-[10px] border border-[#dcdce2] bg-white px-4 py-2 text-sm font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:text-[#9c7210]';

export const mutedStateClass = 'text-[13px] text-[#8b8b92]';

export const blockedNoticeClass = 'text-[13px] font-medium text-[#a5341c]';

export const noticeClass =
  'rounded-[10px] border border-[#f0e2bd] bg-[#fdf7e8] px-3 py-2 text-[13px] text-[#9c7210]';

/**
 * The converted card's proposta link.
 *
 * It is a full-width button rather than a chip because it is the ONLY way from
 * the board to the proposta a lead became, and the bare status chip it replaces
 * was unusable: the card is titled with the CONTACT name while the propostas
 * screen is keyed on the CLIENT, so `Ganha` alone told the operator a status
 * without telling them WHOSE.
 */
export const saleLinkClass =
  'flex w-full items-center justify-between gap-2 rounded-md border border-[#d8d8e0] ' +
  'bg-white px-2.5 py-1.5 text-left text-[12px] font-medium text-[#3d3d47] ' +
  'transition-colors hover:border-[#b9b9c6] hover:bg-[#f5f5f8] ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'focus-visible:outline-[#7c7ce0]';

/** The code half of that link, kept monospace so a código reads as an identifier. */
export const saleLinkCodeClass = 'font-mono text-[12px] tracking-tight text-[#1f1f27]';


export interface StageColor {
  /** Hex for the dot and the bar. */
  dot: string;
  /** Hex soft background. */
  soft: string;
  border: string;
  ink: string;
}

const NORMAL_PALETTE: readonly StageColor[] = [
  { dot: '#4f63d8', soft: '#f3f4fd', border: '#dfe3fa', ink: '#3443a8' },
  { dot: '#8656d0', soft: '#f6f2fd', border: '#e7dcf8', ink: '#6a3db0' },
  { dot: '#d07a1f', soft: '#fdf5ec', border: '#f5e1c8', ink: '#9a5610' },
  { dot: '#22928f', soft: '#eef8f7', border: '#d0ebe9', ink: '#17706d' },
];

// Only the two special kinds are keys; the normal kind is NOT, so its lookup is
// undefined and no inline kind comparison is ever needed.
const KIND_COLORS: Partial<Record<LeadStageKind, StageColor>> = {
  conversion: { dot: '#2f9155', soft: '#eef7f1', border: '#d3ebdc', ink: '#226c3f' },
  lost: { dot: '#c2413b', soft: '#fcf1f0', border: '#f2d6d4', ink: '#9b2f2a' },
};

/** `stages` must already be in position order; it is not reordered here. */
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
      map.set(stage.id, NORMAL_PALETTE[normalIndex % NORMAL_PALETTE.length]!);
      normalIndex += 1;
    }
  }
  return map;
}

export function stageIsNormal(stage: Pick<SalesOpsLeadStage, 'kind'>): boolean {
  return !KIND_COLORS[stage.kind];
}

export function dayBadgeTone(days: number): string {
  if (days <= 7) return 'bg-[#f1f1f4] text-[#6a6a72]';
  if (days <= 14) return 'bg-[#fbf1d9] text-[#8a6210]';
  return 'bg-[#fcf1f0] text-[#9b2f2a]';
}

export function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export const segmentedContainerClass =
  'inline-flex items-center gap-1 rounded-[11px] bg-[#f2f2f4] p-1';

export const segmentedButtonClass =
  'inline-flex items-center gap-1.5 rounded-[8px] px-[13px] py-2 text-[13px] font-bold text-[#6a6a72] transition-colors';

export const segmentedButtonActiveClass = 'bg-[#201f24] text-white';

export const avatarClass =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f7e2a8] text-[10px] font-bold text-[#7a5a12]';

export const columnHeaderCardClass =
  'rounded-[13px] bg-white px-[14px] py-3 shadow-[0_1px_2px_rgba(32,31,36,0.05)]';

export const proportionTrackClass = 'h-[5px] w-full overflow-hidden rounded-full bg-[#eeeef1]';

export const iconButtonClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#9b9ba3] hover:bg-[#f2f2f4]';

export const phaseChipClass =
  'inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[#e2e2e7] bg-white px-3 py-1.5 text-[13px] font-semibold text-[#201f24]';

export const phaseChipActiveClass = 'border-transparent bg-[#201f24] text-white';

export const listTableCardClass = 'overflow-x-auto rounded-[18px] border border-[#e8e8ec]';

export const listTheadClass =
  'bg-[#fafafb] text-[11.5px] font-bold uppercase tracking-[0.06em] text-[#8b8b92]';

export const listRowClass = 'border-t border-[#f0f0f3] hover:bg-[#fcfcfd]';

export const listFooterClass =
  'flex items-center justify-between border-t border-[#e8e8ec] bg-[#fafafb] px-4 py-3';

/** Semantic alias; `cardButtonClass` stays until the card slice drops it. */
export const listActionButtonClass = cardButtonClass;
