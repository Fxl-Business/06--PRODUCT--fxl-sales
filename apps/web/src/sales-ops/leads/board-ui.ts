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

/**
 * THE QUADRO NEVER GROWS WITH ITS CARDS.
 *
 * In the Quadro view the board root is a flex item that FILLS the height the page
 * content area gives it (the content area turns into a flex column for the leads
 * view), so the columns get a fixed height and each scrolls its own cards. Before
 * this a 31-card column stretched the board to 4144px on a 900px screen and every
 * other column with it, and the horizontal scrollbar sat under the tallest one.
 *
 * `min-h-0` lets the routed page bound the board even on a short viewport.
 */
export const boardFillClass = 'flex min-h-0 flex-1 flex-col gap-4';

/** The top scrollbar plus the scroller, which takes every remaining pixel. */
export const boardViewportClass = 'flex min-h-0 flex-1 flex-col gap-2';

/**
 * The horizontal scroller. Its native scrollbar is hidden because the board's own
 * `BoardScrollbar` sits ABOVE the columns, where the operator can reach it without
 * scrolling down; wheel, trackpad and touch panning still scroll it natively.
 * `[scrollbar-width:none]` hides it in Firefox and Chromium, the pseudo-element in
 * Safari. The inline-size container lets a column size itself against the
 * board's width (`cqw`) on a phone.
 */
export const boardScrollerClass =
  'flex min-h-0 flex-1 overflow-x-auto overflow-y-hidden [container-type:inline-size] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

/**
 * Every column, side by side, at their own width. `w-max` makes this element's
 * width the board's scroll width, so one ResizeObserver on it tells the top
 * scrollbar when a column appears or leaves.
 */
export const boardTrackClass = 'flex w-max shrink-0 gap-4';

/**
 * A column is as tall as the board (stretched by the track) and never taller.
 * `max-w-[calc(100cqw-28px)]` narrows it on a phone so a whole column fits with
 * a sliver of the next one showing; a browser without container units ignores
 * the declaration and keeps the 300px.
 */
export const columnClass =
  'flex min-h-0 w-[300px] max-w-[calc(100cqw-28px)] shrink-0 flex-col gap-3 rounded-[18px] border border-[#e8e8ec] bg-[#fbfbfc] p-3';

/**
 * The column's OWN vertical scroller, under its header. A 6px scrollbar drawn in
 * the column's right padding: `-mr-[9px]` reaches into the 12px padding,
 * `[scrollbar-gutter:stable]` keeps its 6px reserved whether or not the column
 * overflows, and `pr-[3px]` puts the cards' right edge back exactly under the
 * header card's. `-ml-1 pl-1` gives a card's focus ring room on the left.
 * Touch screens draw overlay scrollbars that reserve nothing, so on a coarse
 * pointer the trick is dropped and the cards keep the header's width there too.
 */
export const columnCardsScrollClass =
  'flex min-h-0 flex-1 flex-col overflow-y-auto -ml-1 -mr-[9px] pl-1 pr-[3px] [scrollbar-gutter:stable] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:border-0 [@media(pointer:coarse)]:mx-0 [@media(pointer:coarse)]:px-0 [@media(pointer:coarse)]:[scrollbar-gutter:auto]';

/**
 * The board's horizontal scrollbar, rendered ABOVE the columns. It is a real
 * control rather than a mirrored native strip because a native scrollbar is an
 * invisible overlay on iPad and phones and a 10px target for a finger.
 * `BoardScrollbar` adds `invisible` (never `hidden`) while every column fits, so
 * its height stays reserved. `touch-none` so dragging it with a finger never
 * pans the page.
 */
export const boardScrollbarClass =
  'group/scrollbar relative h-5 shrink-0 cursor-pointer touch-none select-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#eaa81a] [@media(pointer:coarse)]:h-7';

export const boardScrollbarTrackClass =
  'absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-[#ececf0] [@media(pointer:coarse)]:h-2.5';

/** Width and position are written straight to its style by `BoardScrollbar`. */
export const boardScrollbarThumbClass =
  'absolute inset-y-0 left-0 rounded-full bg-[#d2d2d8] transition-colors group-hover/scrollbar:bg-[#b4b4bb] group-data-[dragging=true]/scrollbar:bg-[#9b9ba3]';

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
 * The draggable card's surface. `touch-manipulation`, NOT `touch-none`.
 *
 * The board once ran dnd-kit's `PointerSensor`, which REQUIRES `touch-action:
 * none`: without it the browser read a drag as a pan and fired `pointercancel`,
 * and the card "let go" mid-gesture. But `touch-none` also meant a finger on a
 * card could never scroll anything, and once every column scrolls its own cards
 * a column made of cards could not be scrolled on an iPad or a phone at all.
 *
 * The board now runs the `MouseSensor` (touch-action is irrelevant to a mouse)
 * and a `TouchSensor` with a press-and-hold delay (`DRAG_ACTIVATION` in
 * `board-move.ts`), dnd-kit's documented recipe for draggables inside scrollable
 * containers: a swipe pans the column or the board natively, a hold lifts the
 * card, and once lifted the sensor cancels the `touchmove`s itself.
 */
export const dragHandleSurfaceClass = 'touch-manipulation select-none';

/**
 * The card riding the cursor. Elevated so it reads as lifted off the board.
 * `w-full`: dnd-kit sizes the overlay to the lifted card, whose width depends on
 * the column's (narrower on a phone).
 */
export const dragOverlayCardClass = 'w-full rotate-2 cursor-grabbing shadow-xl';

/**
 * Read-only is a property of the CARD (`leadIsConverted`) and never of a column,
 * which is why this constant is named for a card. No column is read-only: the
 * conversion column in particular is a drop target.
 */
export const readOnlyCardClass = 'border-dashed bg-[#fbfbfc]';

/**
 * Pill geometry only. Compose with `dayBadgeTone(days)` for the colour.
 *
 * `shrink-0 whitespace-nowrap`: a pill never shrinks or wraps. Without them a
 * long vendedor name beside it squeezed `há 12 dias` onto two lines and grew the
 * card footer from 35px to 49.5px (measured in Chromium on a 300px column).
 */
export const daysBadgeClass =
  'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold';

export const chipClass =
  'inline-flex items-center rounded-full bg-[#f4f4f6] px-2 py-0.5 text-[11px] font-medium text-[#57575f]';

export const cardButtonClass =
  'inline-flex items-center rounded-[9px] border border-[#dcdce2] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:bg-[#f5f2ea] hover:text-[#9c7210] disabled:cursor-not-allowed disabled:opacity-60';

export const primaryButtonClass =
  'inline-flex items-center justify-center rounded-[10px] bg-[#eaa81a] px-4 py-2 text-sm font-semibold text-[#201f24] transition hover:bg-[#d79a16] disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-[10px] border border-[#dcdce2] bg-white px-4 py-2 text-sm font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:text-[#9c7210]';

/**
 * The destructive pair, in the `lost` stage's red (`KIND_COLORS.lost`): the solid
 * confirm of `LeadDeleteDialog`, and the outlined `Excluir lead` that opens it
 * from an edit form. Same 40px geometry as `primaryButtonClass`.
 */
export const dangerButtonClass =
  'inline-flex items-center justify-center rounded-[10px] bg-[#c2413b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#a5341c] disabled:cursor-not-allowed disabled:opacity-60';

export const dangerOutlineButtonClass =
  'inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-[#f2d6d4] bg-white px-4 py-2 text-sm font-semibold text-[#9b2f2a] transition hover:border-[#c2413b] hover:bg-[#fcf1f0] disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The card's kebab. A constant 28px slot in the card's top row, always rendered
 * and always in the tab order, so opening or hovering it never reflows the card.
 * Quiet by default (a light grey glyph), darker while the card is hovered and
 * on its own focus ring, chip-backed while hovered or open. Never `opacity-0`:
 * an invisible slot reads as a misaligned value, and a touch device has no hover
 * to reveal it. `-mr-1.5 -mt-1` tuck the 16px glyph into the card's corner
 * padding and centre it on the 20px first line beside it.
 */
export const leadMenuTriggerClass =
  '-mr-1.5 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[#b4b4bb] outline-none transition-colors hover:bg-[#f2f2f4] focus-visible:ring-2 focus-visible:ring-[#eaa81a] group-hover/card:text-[#6a6a72] data-[state=open]:bg-[#f2f2f4] data-[state=open]:text-[#201f24]';

/** The card menu panel; the same surface as the propostas table's row menu. */
export const leadMenuContentClass = 'w-[180px] rounded-xl border-[#e5e5ea] bg-white p-1.5';

export const leadMenuDeleteItemClass =
  'cursor-pointer text-[13px] font-semibold text-[#9b2f2a] focus:bg-[#fcf1f0] focus:text-[#9b2f2a]';

/** The Lista row's `Excluir`: `listActionButtonClass` geometry, destructive ink. */
export const listDangerActionButtonClass =
  'inline-flex items-center rounded-[9px] border border-[#dcdce2] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#9b2f2a] transition hover:border-[#c2413b] hover:bg-[#fcf1f0] disabled:cursor-not-allowed disabled:opacity-60';

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

/**
 * On a phone the label alone, slightly tighter, so `Quadro / Lista / Funil` fits
 * beside nothing on a 375px screen; the icon returns from `sm` up.
 */
export const segmentedButtonClass =
  'inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-2 text-[13px] font-bold text-[#6a6a72] transition-colors sm:px-[13px] [&>svg]:hidden sm:[&>svg]:block';

export const segmentedButtonActiveClass = 'bg-[#201f24] text-white';

export const avatarClass =
  'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f7e2a8] text-[10px] font-bold text-[#7a5a12]';

/**
 * The seller slot of a lead in the shared pool, in place of the avatar and name.
 * `h-6` is `avatarClass`'s height, so an unassigned card's footer is exactly as
 * tall as an assigned one's. The dashed border reads as an empty slot; the teal
 * (the fourth normal-stage hue) stays clear of the grey, amber and red
 * `dayBadgeTone` tiers it sits beside. The label goes in an inner `truncate`
 * span, because text-overflow does not apply to a flex container's own text.
 */
export const unassignedMarkerClass =
  'inline-flex h-6 min-w-0 items-center rounded-full border border-dashed border-[#9fd3cf] bg-[#eef8f7] px-2.5 text-[11px] font-semibold text-[#17706d]';

export const columnHeaderCardClass =
  'rounded-[13px] bg-white px-[14px] py-3 shadow-[0_1px_2px_rgba(32,31,36,0.05)]';

export const proportionTrackClass = 'h-[5px] w-full overflow-hidden rounded-full bg-[#eeeef1]';

export const iconButtonClass =
  'inline-flex h-7 w-7 items-center justify-center rounded-lg text-[#9b9ba3] hover:bg-[#f2f2f4]';

const phaseChipBaseClass =
  'inline-flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold';
const phaseChipIdleClass = 'border-[#e2e2e7] bg-white text-[#201f24]';
const phaseChipActiveClass = 'border-transparent bg-[#201f24] text-white';

/**
 * Idle and active colours are DISJOINT on purpose: two utilities for the same
 * property have equal specificity, so appending the active colours to the idle ones
 * let Tailwind's source order pick `bg-white` and the active chip read white on white.
 */
export function phaseChipClassName(active: boolean): string {
  return `${phaseChipBaseClass} ${active ? phaseChipActiveClass : phaseChipIdleClass}`;
}

export const listTableCardClass = 'overflow-x-auto rounded-[18px] border border-[#e8e8ec]';

export const listTheadClass =
  'bg-[#fafafb] text-[11.5px] font-bold uppercase tracking-[0.06em] text-[#8b8b92]';

export const listRowClass = 'border-t border-[#f0f0f3] hover:bg-[#fcfcfd]';

export const listFooterClass =
  'flex items-center justify-between border-t border-[#e8e8ec] bg-[#fafafb] px-4 py-3';

/** Semantic alias; `cardButtonClass` stays until the card slice drops it. */
export const listActionButtonClass = cardButtonClass;
