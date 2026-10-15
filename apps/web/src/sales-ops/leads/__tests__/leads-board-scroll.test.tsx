// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsBoard } from '../LeadsBoard';
import { BOARD_SCROLLBAR_LABEL, buildLabelLookups } from '../board-labels';
import { DRAG_ACTIVATION } from '../board-move';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * THE QUADRO IS AS TALL AS THE SCREEN AND NO TALLER.
 *
 * Measured on 2026-10-15 with 31 cards in one column: the board was 4144px tall
 * on a 900px screen, every column was stretched to the longest one, and the
 * only horizontal scrollbar sat under all of it. These oracles pin the structure
 * that fixes it (a board that fills its parent, a scroller per column, a
 * scrollbar ABOVE the columns) and the gestures that keep it usable by touch.
 *
 * happy-dom has no layout, so the real heights were validated in Chromium at
 * 1440, 820 and 390px; what is pinned here is what a DOM can answer for. The
 * gestures ARE real events through dnd-kit's real sensors.
 */

const NOVO_ID = 'cccccccc-0000-4000-8000-000000000001';
const NEGOCIACAO_ID = 'cccccccc-0000-4000-8000-000000000002';

const NOW = new Date('2026-10-15T12:00:00.000Z');

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

function stage(id: string, name: string): SalesOpsLeadStage {
  return {
    id,
    name,
    kind: 'normal',
    position: 0,
    status: 'active',
    isSystem: false,
    archivedAt: null,
    orgId: 'org-1',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

const STAGES: SalesOpsLeadStage[] = [stage(NOVO_ID, 'Novo'), stage(NEGOCIACAO_ID, 'Negociação')];

const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });

function lead(id: string, stageId: string): SalesOpsLead {
  return {
    id,
    stageId,
    position: 1,
    contactName: `Contato ${id}`,
    clientId: null,
    clientNameSnapshot: 'Acme',
    estimatedValueBrl: 150_000,
    description: null,
    contactPhone: null,
    contactEmail: null,
    contactBirthDate: null,
    sellerPersonId: null,
    sellerNameSnapshot: 'Marina',
    lostReason: null,
    stageChangedAt: '2026-10-10T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  } as SalesOpsLead;
}

const LEADS = [lead('l1', NOVO_ID), lead('l2', NOVO_ID), lead('l3', NEGOCIACAO_ID)];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function renderBoard() {
  await act(async () => {
    root.render(
      <LeadsBoard
        leads={LEADS}
        lookups={LOOKUPS}
        now={NOW}
        onDeleteLead={vi.fn()}
        onMoveLead={vi.fn()}
        stages={STAGES}
      />,
    );
  });
}

const q = <T extends Element = HTMLElement>(selector: string) =>
  container.querySelector<T & Element>(selector);

/**
 * happy-dom lays nothing out, so every box is 0px wide. This hands the board's
 * scroller and the scrollbar's track the sizes a 1440px screen gave them in
 * Chromium (six 300px columns in a 1120px wide board).
 */
function stubBoardGeometry({ scrollWidth = 1880, clientWidth = 1120 } = {}) {
  // Stubbed on HTMLElement, where happy-dom declares `clientWidth`, so the stub
  // shadows it for every element of the board.
  const proto = HTMLElement.prototype;
  const original = {
    scrollWidth: Object.getOwnPropertyDescriptor(proto, 'scrollWidth'),
    clientWidth: Object.getOwnPropertyDescriptor(proto, 'clientWidth'),
  };
  Object.defineProperty(proto, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-board-scroller') ? scrollWidth : 0;
    },
  });
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-board-scroller')) return clientWidth;
      // the scrollbar's track spans the board's width
      if (this.parentElement?.hasAttribute('data-board-scrollbar')) return clientWidth;
      return 0;
    },
  });
  return () => {
    for (const [key, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(proto, key, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[key];
    }
  };
}

async function nextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
  });
}

describe('the Quadro fills the screen instead of growing with its cards', () => {
  it('fills its parent in the Quadro view and only there', async () => {
    await renderBoard();
    const board = q('[data-leads-board]');
    expect(board?.getAttribute('data-board-fills-viewport')).toBe('true');
    expect(board?.className).toContain('flex-1');

    // The Lista and the Funil are pages that scroll as a whole.
    await act(async () => q<HTMLButtonElement>('[data-view-option="list"]')?.click());
    expect(q('[data-leads-board]')?.hasAttribute('data-board-fills-viewport')).toBe(false);
    expect(q('[data-board-scrollbar]')).toBeNull();
  });

  it('gives every column its own vertical scroller under a header that stays put', async () => {
    await renderBoard();
    for (const id of [NOVO_ID, NEGOCIACAO_ID]) {
      const column = q(`[data-stage-column="${id}"]`);
      const scroll = column?.querySelector<HTMLElement>(`[data-stage-scroll="${id}"]`);
      expect(scroll, `column ${id} needs its own scroller`).not.toBeNull();
      expect(scroll?.className).toContain('overflow-y-auto');
      expect(scroll?.className).toContain('min-h-0');
      // the header is OUTSIDE the scroller, the drop zone and the cards inside it
      expect(scroll?.querySelector('header')).toBeNull();
      expect(column?.querySelector(':scope > header')).not.toBeNull();
      expect(scroll?.querySelector(`[data-stage-dropzone="${id}"]`)).not.toBeNull();
    }
    expect(
      q(`[data-stage-scroll="${NOVO_ID}"]`)?.querySelectorAll('[data-lead-card]'),
    ).toHaveLength(2);
  });

  it('scrolls the board sideways only, never down', async () => {
    await renderBoard();
    const scroller = q('[data-board-scroller]');
    expect(scroller?.className).toContain('overflow-x-auto');
    expect(scroller?.className).toContain('overflow-y-hidden');
  });
});

describe('the horizontal scrollbar sits above the columns', () => {
  it('is rendered BEFORE the columns and controls the board scroller', async () => {
    const restore = stubBoardGeometry();
    try {
      await renderBoard();
      const bar = q('[role="scrollbar"]');
      const scroller = q('[data-board-scroller]');
      expect(bar).not.toBeNull();
      expect(bar?.getAttribute('aria-label')).toBe(BOARD_SCROLLBAR_LABEL);
      expect(bar?.getAttribute('aria-orientation')).toBe('horizontal');
      expect(bar?.getAttribute('aria-controls')).toBe(scroller?.id);
      expect(scroller?.id).not.toBe('');
      expect(
        bar!.compareDocumentPosition(scroller!) & Node.DOCUMENT_POSITION_FOLLOWING,
        'the scrollbar must come before (above) the columns',
      ).toBeTruthy();
      await nextFrame();
      expect(bar?.getAttribute('data-overflowing')).toBe('true');
      expect(bar?.className.split(' ')).not.toContain('invisible');
      expect(bar?.getAttribute('tabindex')).toBe('0');
    } finally {
      restore();
    }
  });

  it('is invisible while every column fits, keeping its height so nothing jumps', async () => {
    const restore = stubBoardGeometry({ scrollWidth: 1120, clientWidth: 1120 });
    try {
      await renderBoard();
      await nextFrame();
      const bar = q('[data-board-scrollbar]');
      expect(bar?.getAttribute('data-overflowing')).toBe('false');
      expect(bar?.className.split(' ')).toContain('invisible');
      expect(bar?.hidden, 'never display:none: its height stays reserved').toBe(false);
      expect(bar?.getAttribute('aria-hidden')).toBe('true');
      expect(bar?.getAttribute('tabindex')).toBe('-1');
    } finally {
      restore();
    }
  });

  it('sizes its thumb to the visible share and follows the board as it scrolls', async () => {
    const restore = stubBoardGeometry();
    try {
      await renderBoard();
      await nextFrame();
      const scroller = q('[data-board-scroller]')!;
      const thumb = q('[data-board-scrollbar-thumb]')!;
      // 1120 of 1880 visible on a 1120px track
      expect(parseFloat(thumb.style.width)).toBeCloseTo((1120 * 1120) / 1880, 1);
      expect(thumb.style.transform).toBe('translateX(0px)');

      // A wheel, a trackpad or a finger scrolls the board itself.
      scroller.scrollLeft = 760; // the end
      scroller.dispatchEvent(new Event('scroll'));
      await nextFrame();
      const maxThumbOffset = 1120 - (1120 * 1120) / 1880;
      expect(parseFloat(thumb.style.transform.replace('translateX(', ''))).toBeCloseTo(
        maxThumbOffset,
        1,
      );
      expect(q('[data-board-scrollbar]')?.getAttribute('aria-valuenow')).toBe('100');
    } finally {
      restore();
    }
  });

  it('scrolls the board when its thumb is dragged, by pointer of any kind', async () => {
    const restore = stubBoardGeometry();
    try {
      await renderBoard();
      const scroller = q('[data-board-scroller]')!;
      const bar = q('[data-board-scrollbar]')!;
      const init = { bubbles: true, cancelable: true, button: 0, pointerId: 7 };
      await act(async () => {
        bar.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: 0, pointerType: 'touch' }));
        bar.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: 100, pointerType: 'touch' }));
      });
      // 100px of thumb travel is 100 * maxScroll / maxThumbOffset px of board
      const maxThumbOffset = 1120 - (1120 * 1120) / 1880;
      expect(scroller.scrollLeft).toBeCloseTo((100 * 760) / maxThumbOffset, 1);
      expect(bar.getAttribute('data-dragging')).toBe('true');

      await act(async () => {
        bar.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: 100, pointerType: 'touch' }));
        bar.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: 400, pointerType: 'touch' }));
      });
      expect(bar.getAttribute('data-dragging')).toBe('false');
      expect(scroller.scrollLeft, 'a released thumb no longer drives the board').toBeCloseTo(
        (100 * 760) / maxThumbOffset,
        1,
      );
    } finally {
      restore();
    }
  });

  it('jumps to where the track is pressed', async () => {
    const restore = stubBoardGeometry();
    try {
      await renderBoard();
      const scroller = q('[data-board-scroller]')!;
      const bar = q('[data-board-scrollbar]')!;
      const thumb = q('[data-board-scrollbar-thumb]')!;
      const thumbWidth = (1120 * 1120) / 1880;
      vi.spyOn(thumb, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, thumbWidth, 8),
      );
      await act(async () => {
        bar.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 1,
            clientX: 1100,
          }),
        );
      });
      expect(scroller.scrollLeft).toBeCloseTo(760, 1);
    } finally {
      restore();
    }
  });

  it('scrolls one column per arrow key and to either end with Home and End', async () => {
    const restore = stubBoardGeometry();
    try {
      await renderBoard();
      const scroller = q('[data-board-scroller]')!;
      const bar = q('[data-board-scrollbar]')!;
      const scrollBy = vi.fn();
      const scrollTo = vi.fn();
      Object.assign(scroller, { scrollBy, scrollTo });
      const key = (k: string) =>
        act(async () => {
          bar.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        });
      await key('ArrowRight');
      await key('ArrowLeft');
      await key('End');
      expect(scrollBy.mock.calls.map(([options]) => options.left)).toEqual([316, -316]);
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 1880 }));
    } finally {
      restore();
    }
  });
});

/**
 * THE GESTURES, through dnd-kit's real `MouseSensor` and `TouchSensor`. A lifted
 * card is visible as a SECOND `[data-lead-card]`: the copy riding the overlay.
 */
describe('a swipe scrolls, a hold drags', () => {
  const lifted = () => container.querySelectorAll('[data-lead-card]').length > LEADS.length;

  /** A real `TouchEvent`: dnd-kit reads coordinates only from one. */
  function touchEvent(type: string, target: Element, x: number, y: number) {
    const touch = new Touch({ identifier: 0, target, clientX: x, clientY: y });
    return new TouchEvent(type, {
      bubbles: true,
      cancelable: true,
      touches: type === 'touchend' ? [] : [touch],
      changedTouches: [touch],
    });
  }

  it('lifts a card after a short mouse drag', async () => {
    await renderBoard();
    const card = q('[data-lead-card="l1"]')!;
    await act(async () => {
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 10 }));
    });
    expect(lifted()).toBe(true);
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 40, clientY: 10 }));
    });
  });

  it('never lifts a card from its menu trigger', async () => {
    await renderBoard();
    const trigger = q('[data-lead-card="l1"] [data-lead-menu]')!;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 60, clientY: 10 }));
    });
    expect(lifted()).toBe(false);
  });

  it('lets a finger swipe across a card without lifting it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await renderBoard();
    const card = q('[data-lead-card="l1"]')!;
    // One act per event, as the browser delivers them: inside a single act the
    // drag start is not committed yet and a lifting sensor would read as idle.
    await act(async () => {
      card.dispatchEvent(touchEvent('touchstart', card, 50, 50));
    });
    await act(async () => {
      // A 20px swipe before the hold delay is up. A literal, never derived from
      // `DRAG_ACTIVATION`: a gesture computed from the config under test goes
      // NaN, and silently idle, the moment that config changes shape.
      card.dispatchEvent(touchEvent('touchmove', card, 50, 70));
    });
    await act(async () => {
      vi.advanceTimersByTime(DRAG_ACTIVATION.touch.delay + 100);
    });
    expect(lifted()).toBe(false);
    await act(async () => {
      card.dispatchEvent(touchEvent('touchend', card, 50, 70));
    });
  });

  it('lifts a card after a press and hold', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await renderBoard();
    const card = q('[data-lead-card="l1"]')!;
    await act(async () => {
      card.dispatchEvent(touchEvent('touchstart', card, 50, 50));
      vi.advanceTimersByTime(DRAG_ACTIVATION.touch.delay + 10);
    });
    await act(async () => {
      card.dispatchEvent(touchEvent('touchmove', card, 90, 50));
    });
    expect(lifted()).toBe(true);
    await act(async () => {
      card.dispatchEvent(touchEvent('touchend', card, 90, 50));
    });
  });
});
