/**
 * Below Tailwind's `lg` breakpoint: a phone, or a tablet held upright.
 *
 * The Sales Ops shell uses it for one decision only: such a screen starts with
 * the sidebar as its icon rail. Expanded, the 244px sidebar left a 390px phone
 * about 70px for the page and an upright iPad room for a column and a half of
 * the Quadro.
 */
export const NARROW_VIEWPORT_QUERY = '(max-width: 1023px)';

function narrowQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(NARROW_VIEWPORT_QUERY);
}

export function isNarrowViewport(): boolean {
  return narrowQuery()?.matches ?? false;
}

/**
 * Calls `onChange(narrow)` each time the viewport crosses the breakpoint (a
 * tablet rotated, a window resized). Returns the unsubscribe.
 */
export function subscribeNarrowViewport(onChange: (narrow: boolean) => void): () => void {
  const query = narrowQuery();
  if (!query || typeof query.addEventListener !== 'function') return () => undefined;
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
