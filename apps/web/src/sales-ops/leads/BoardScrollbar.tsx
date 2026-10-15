import * as React from 'react';
import { BOARD_SCROLLBAR_LABEL } from './board-labels';
import {
  boardScrollbarClass,
  boardScrollbarThumbClass,
  boardScrollbarTrackClass,
} from './board-ui';

/**
 * The Quadro's horizontal scrollbar, ABOVE the columns.
 *
 * The board is as tall as the screen and its native scrollbar is hidden, so this
 * is the one visible scrollbar: the operator reaches it without scrolling down
 * and without shift+wheel. It is drawn by hand rather than mirrored from a native
 * strip because a native scrollbar is an invisible overlay on an iPad or a phone
 * and far too thin for a finger.
 *
 * THE SCROLLER IS THE ONLY SOURCE OF TRUTH. A drag, a press on the track or a
 * key only ever writes `scroller.scrollLeft`; the thumb is painted from the
 * scroller's `scroll` event, the same as for a wheel or a touch pan. Nothing is
 * mirrored back, so the two can never fight or drift.
 *
 * The thumb is positioned through its style, outside React, so scrolling a
 * board of a few hundred cards re-renders nothing but this component's
 * `aria-valuenow` when the whole percentage changes.
 *
 * The bar ALWAYS keeps its height and is only made invisible while every column
 * fits: the columns never jump by its height on load or when a resize crosses
 * the point where they start to overflow, and its track always has a width to
 * measure.
 */

const MIN_THUMB_PX = 48;
/** One 300px column plus the 16px gap. */
const KEY_STEP_PX = 316;

type Geometry = {
  maxScroll: number;
  thumbWidth: number;
  maxThumbOffset: number;
};

function scrollBehavior(): ScrollBehavior {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

export function BoardScrollbar({
  scrollerRef,
  controlsId,
}: {
  /**
   * The board's horizontal scroller. It mounts and unmounts together with this
   * bar (both exist only in the Quadro view), so it is attached by the time the
   * effect below subscribes to it.
   */
  scrollerRef: React.RefObject<HTMLDivElement | null>;
  /** The scroller's id, for `aria-controls`. */
  controlsId: string;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const thumbRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ pointerId: number; startX: number; startScroll: number } | null>(
    null,
  );
  const [overflowing, setOverflowing] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const [valueNow, setValueNow] = React.useState(0);

  const geometry = React.useCallback((): Geometry | null => {
    const scroller = scrollerRef.current;
    const track = trackRef.current;
    if (!scroller || !track) return null;
    const maxScroll = scroller.scrollWidth - scroller.clientWidth;
    const trackWidth = track.clientWidth;
    const thumbWidth =
      scroller.scrollWidth > 0
        ? Math.min(
            trackWidth,
            Math.max(MIN_THUMB_PX, (trackWidth * scroller.clientWidth) / scroller.scrollWidth),
          )
        : trackWidth;
    return { maxScroll, thumbWidth, maxThumbOffset: Math.max(0, trackWidth - thumbWidth) };
  }, [scrollerRef]);

  const paint = React.useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    // Sub-pixel layouts report a scroll width a fraction above the client width.
    const isOverflowing = scroller.scrollWidth - scroller.clientWidth > 1;
    setOverflowing(isOverflowing);
    const thumb = thumbRef.current;
    const g = geometry();
    if (!isOverflowing || !thumb || !g || g.maxScroll <= 0) return;
    const ratio = Math.min(1, Math.max(0, scroller.scrollLeft / g.maxScroll));
    thumb.style.width = `${g.thumbWidth}px`;
    thumb.style.transform = `translateX(${ratio * g.maxThumbOffset}px)`;
    setValueNow(Math.round(ratio * 100));
  }, [geometry, scrollerRef]);

  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        paint();
      });
    };
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // The scroller's own box (the window or the sidebar changed), the column
    // track inside it (a column appeared or left) and this bar's track.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(scroller);
    if (scroller.firstElementChild) observer?.observe(scroller.firstElementChild);
    if (trackRef.current) observer?.observe(trackRef.current);
    // The first paint rides the same frame as every later one.
    schedule();
    return () => {
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [paint, scrollerRef]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const scroller = scrollerRef.current;
    if (!scroller || event.button !== 0) return;
    const g = geometry();
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!g || !track || !thumb || g.maxThumbOffset <= 0) return;
    // No text selection, no compatibility mouse events, no page pan.
    event.preventDefault();
    const thumbBox = thumb.getBoundingClientRect();
    if (event.clientX < thumbBox.left || event.clientX > thumbBox.right) {
      // A press on the track centres the thumb under the pointer, and the same
      // press keeps dragging from there.
      const offset = Math.min(
        g.maxThumbOffset,
        Math.max(0, event.clientX - track.getBoundingClientRect().left - g.thumbWidth / 2),
      );
      scroller.scrollLeft = (offset / g.maxThumbOffset) * g.maxScroll;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: scroller.scrollLeft,
    };
    setDragging(true);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const scroller = scrollerRef.current;
    const active = drag.current;
    if (!scroller || !active || active.pointerId !== event.pointerId) return;
    const g = geometry();
    if (!g || g.maxThumbOffset <= 0) return;
    scroller.scrollLeft =
      active.startScroll + (event.clientX - active.startX) * (g.maxScroll / g.maxThumbOffset);
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const page = Math.max(KEY_STEP_PX, scroller.clientWidth * 0.9);
    const steps: Record<string, number> = {
      ArrowLeft: -KEY_STEP_PX,
      ArrowRight: KEY_STEP_PX,
      PageUp: -page,
      PageDown: page,
    };
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      scroller.scrollTo({
        left: event.key === 'Home' ? 0 : scroller.scrollWidth,
        behavior: scrollBehavior(),
      });
      return;
    }
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    scroller.scrollBy({ left: step, behavior: scrollBehavior() });
  }

  return (
    <div
      aria-controls={controlsId}
      aria-hidden={overflowing ? undefined : true}
      aria-label={BOARD_SCROLLBAR_LABEL}
      aria-orientation="horizontal"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={valueNow}
      className={`${boardScrollbarClass}${overflowing ? '' : ' invisible'}`}
      data-board-scrollbar=""
      data-dragging={dragging ? 'true' : 'false'}
      data-overflowing={overflowing ? 'true' : 'false'}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      role="scrollbar"
      tabIndex={overflowing ? 0 : -1}
    >
      <div className={boardScrollbarTrackClass} ref={trackRef}>
        <div className={boardScrollbarThumbClass} data-board-scrollbar-thumb="" ref={thumbRef} />
      </div>
    </div>
  );
}
