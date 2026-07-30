import * as React from 'react';

/**
 * The seam that lets an INLINE LAYER swallow its own Escape.
 *
 * `Combobox` and `InfoHint` both render a non-portalled panel inside their own
 * `relative` wrapper. That is deliberate and stays - it keeps the whole control
 * reachable from a plain DOM query and needs no popover dependency - but it also
 * means neither is a Radix `DismissableLayer`, so neither appears on the layer
 * stack Radix consults before dismissing the dialog around them.
 *
 * The obvious fix does not work. Radix's `useEscapeKeydown` registers
 * `document.addEventListener('keydown', handler, { capture: true })`, so it runs
 * on the way DOWN, before the event has reached React's root container at all.
 * No handler inside the React tree - `stopPropagation`, `stopImmediatePropagation`
 * or otherwise - can pre-empt it, because none of them has run yet.
 *
 * So the guard lives at the only place that is upstream of that listener: the
 * `DialogContent` seam. `DialogContent` owns one registry, publishes it through
 * this context, and `preventDefault`s Radix's own `onEscapeKeyDown` while any
 * inline layer says it is open. Escape then closes the innermost open thing and
 * nothing else, and with nothing inner open it still closes the dialog, which
 * `dialog.tsx` documents as a deliberate affordance.
 *
 * The count is a ref rather than state on purpose: opening a picker inside a
 * dialog must not re-render the dialog, and the value is only ever read inside
 * an event handler, where a ref is always current.
 */
export type InlineLayerRegistry = {
  /** Called by a layer as it opens. Returns the release for when it closes. */
  register: () => () => void;
  /** Read by the host at Escape time. */
  hasOpenLayer: () => boolean;
};

export const InlineLayerContext = React.createContext<InlineLayerRegistry | null>(null);

/** Host side. One registry per `DialogContent`. */
export function useInlineLayerHost(): InlineLayerRegistry {
  const openCount = React.useRef(0);
  return React.useMemo(
    () => ({
      register: () => {
        openCount.current += 1;
        let released = false;
        return () => {
          // Idempotent: React may run an effect cleanup more than once under
          // StrictMode, and a double decrement would strand the count below zero
          // and silently disarm the guard for every later layer.
          if (released) return;
          released = true;
          openCount.current -= 1;
        };
      },
      hasOpenLayer: () => openCount.current > 0,
    }),
    [],
  );
}

/**
 * Layer side. Call with the layer's own open state.
 *
 * A no-op outside a dialog, which is the common case on a page: there is nothing
 * to protect there, because Escape has nothing to close.
 */
export function useInlineLayer(open: boolean): void {
  const registry = React.useContext(InlineLayerContext);
  React.useEffect(() => {
    if (!open || !registry) return;
    return registry.register();
  }, [open, registry]);
}
