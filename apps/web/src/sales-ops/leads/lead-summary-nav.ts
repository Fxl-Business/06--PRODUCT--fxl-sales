/**
 * The router state marker of an in-app open of the lead summary. It decides the
 * history mechanics only (`Voltar` pops history instead of replacing the URL); it
 * never decides what is on screen.
 */
export const LEAD_SUMMARY_OPENED_IN_APP = { leadSummaryOpenedInApp: true } as const;

export function isLeadSummaryOpenedInApp(state: unknown): boolean {
  return typeof state === 'object' && state !== null
    && (state as { leadSummaryOpenedInApp?: unknown }).leadSummaryOpenedInApp === true;
}
