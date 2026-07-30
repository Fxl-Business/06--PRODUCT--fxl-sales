import * as React from 'react';
import { Info } from 'lucide-react';

import { cn } from '@/lib/utils';

import { useInlineLayer } from './inline-layer';

export type InfoHintProps = {
  /** The hint body. Plain text in every current call site. */
  children: React.ReactNode;
  /**
   * What the hint is about, e.g. 'Profissionais alocados'. Used to build the
   * trigger's accessible name: `Mais informações sobre ${label}`. Required,
   * because four unlabelled `i` buttons on one screen are four identical
   * announcements.
   */
  label: string;
  /**
   * Panel edge alignment. 'start' pins the panel's left edge to the trigger,
   * 'end' its right edge. Use 'end' whenever the trigger sits in the right half
   * of its container, or the panel will overflow the dialog.
   */
  align?: 'start' | 'end';
  /** Merged onto the trigger through `cn`. */
  className?: string;
};

/**
 * On-demand explanatory hint: a small info button that discloses one paragraph.
 *
 * Deliberately a click/keyboard DISCLOSURE and not a hover tooltip. Hover alone
 * is unreachable by touch and by keyboard, and a hover-opened panel inside a
 * scrolling dialog body flickers as the pointer crosses it. A real `<button>`
 * gets Enter/Space, focus-visible and touch for free.
 *
 * The panel is inline, non-portalled and absolutely positioned inside the
 * component's own `relative` wrapper, exactly like `Combobox` and for the same
 * two reasons: it stays reachable from a plain DOM query, both for assistive
 * tech and for the test harness, and it avoids pulling in a popover dependency.
 *
 * This exists so first-run explanatory copy stops occupying layout forever. It
 * is only ever for advice: a block whose appearance is itself the message (a
 * field's current value, a data warning, an action-required bar) must stay
 * inline, because hiding it would hide state rather than a lesson.
 */
export function InfoHint({ children, label, align = 'start', className }: InfoHintProps) {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLSpanElement | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const panelId = `${React.useId()}-hint`;

  /*
    Tells a surrounding `DialogContent` that something inner is open, so its
    Escape is spent on this panel instead of on the whole dialog. A no-op on a
    plain page. This is the ONLY thing standing between an Escape and the
    operator's typed work: see `inline-layer.ts` for why no handler inside the
    React tree can do it.
  */
  useInlineLayer(open);

  /*
    Outside dismissal. `mousedown` rather than `pointerdown`, so this never races
    the pointerdown dismissal machinery of a surrounding Radix Dialog.
  */
  React.useEffect(() => {
    if (!open) return;
    function handleDocumentMouseDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [open]);

  return (
    <span className="relative inline-flex" ref={wrapperRef}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-label={`Mais informações sobre ${label}`}
        className={cn(
          /*
            `#8b8b92` is the app's muted helper tone, and it is the FLOOR here,
            not a preference: at 3.39:1 on white it clears WCAG 1.4.11's 3:1 for
            a meaningful non-text graphic, which the lighter `#b0b0b8` this
            started as (2.15:1) did not.
          */
          'inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full text-[#8b8b92] transition hover:text-[#9c7210] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#eaa81a] focus-visible:ring-offset-1',
          open && 'text-[#9c7210]',
          className,
        )}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !open) return;
          /*
            These two keep Escape from reaching a React handler ABOVE this one.
            They do NOT protect a surrounding Radix Dialog and cannot: Radix
            listens on `document` in the CAPTURE phase, which has already run by
            the time this handler is reached. `useInlineLayer` above is what
            guards the dialog.
          */
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }}
        ref={triggerRef}
        type="button"
      >
        <Info aria-hidden="true" className="h-[15px] w-[15px]" />
      </button>
      {open ? (
        <span
          className={cn(
            'absolute top-full z-50 mt-1.5 block w-[min(280px,calc(100vw-64px))] rounded-[10px] border border-[#f0dfae] bg-[#fdf0cf] px-3 py-2 text-[12.5px] font-medium leading-snug text-[#57575f] shadow-[0_10px_30px_rgba(0,0,0,.12)]',
            align === 'end' ? 'right-0' : 'left-0',
          )}
          id={panelId}
        >
          {children}
        </span>
      ) : null}
    </span>
  );
}
