/*
  Intentional local copies of the `leads/board-ui.ts` dialog classes (which copy
  `SalesOpsApp.tsx`'s): `SalesOpsApp.tsx` imports this subtree, so it cannot
  import back. Class names only, and no component export, so
  `react-refresh/only-export-components` stays quiet.
*/

export const formInputClass =
  'h-11 rounded-[10px] border-[#dcdce2] bg-[#fafafb] px-3 text-sm text-[#201f24] shadow-none outline-none ring-0 transition focus-visible:border-[#eaa81a] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:bg-[#f4f4f6] disabled:text-[#9b9ba3] disabled:opacity-100';

export const formTextareaClass =
  'min-h-[88px] w-full rounded-[10px] border border-[#dcdce2] bg-[#fafafb] px-3 py-2 text-sm text-[#201f24] outline-none transition focus-visible:border-[#eaa81a]';

export const fieldLabelClass =
  'text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]';

export const primaryButtonClass =
  'inline-flex items-center justify-center rounded-[10px] bg-[#eaa81a] px-4 py-2 text-sm font-semibold text-[#201f24] transition hover:bg-[#d79a16] disabled:cursor-not-allowed disabled:opacity-60';

export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-[10px] border border-[#dcdce2] bg-white px-4 py-2 text-sm font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:text-[#9c7210]';

export const mutedStateClass = 'text-[13px] text-[#8b8b92]';

export const blockedNoticeClass = 'text-[13px] font-medium text-[#a5341c]';

/** The compact per-row action in a ledger table. */
export const rowActionButtonClass =
  'inline-flex h-8 items-center whitespace-nowrap rounded-lg border border-[#dcdce2] bg-white px-2.5 text-[12.5px] font-semibold text-[#201f24] outline-none transition hover:bg-[#fafafb] focus-visible:border-[#eaa81a] disabled:opacity-60';

/** `Pago em DD/MM/AAAA` under a status badge. */
export const paidOnNoteClass = 'mt-1 block whitespace-nowrap text-[12px] text-[#57575f]';

export const historyBadgeBaixaClass = 'bg-[#c9e7cf] text-[#1f7d43]';
export const historyBadgeEstornoClass = 'bg-[#eeeef1] text-[#6a6a72]';
