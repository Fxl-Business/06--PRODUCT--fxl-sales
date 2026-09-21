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

export const cardDraggingClass = 'opacity-60 ring-2 ring-[#eaa81a]';

/**
 * Read-only is a property of the CARD (`leadIsConverted`) and never of a column,
 * which is why this constant is named for a card. No column is read-only: the
 * conversion column in particular is a drop target.
 */
export const readOnlyCardClass = 'border-dashed bg-[#fbfbfc]';

export const daysBadgeClass =
  'inline-flex items-center rounded-full bg-[#eeeef1] px-2 py-0.5 text-[11px] font-semibold text-[#6a6a72]';

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

