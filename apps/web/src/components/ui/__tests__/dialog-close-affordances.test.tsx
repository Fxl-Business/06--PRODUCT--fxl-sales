// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog, DialogContent, DialogTitle } from '../dialog';

/**
 * Behavioural half of this slice's oracle. Everything here drives the real
 * `@radix-ui/react-dialog`: an outside pointer down must not close the dialog,
 * while Esc and the `X` affordance still must. Being behavioural rather than
 * structural, these survive an upstream rename of `onPointerDownOutside`, which
 * the prop-contract tests in `dialog-outside-close.test.tsx` cannot.
 *
 * One subtlety worth recording, because it makes a naive probe look inert
 * rather than fail loudly: `DialogContentImpl` passes
 * `deferPointerDownOutside: true`, and `usePointerDownOutside` defers only when
 * `event.button === 0`. A lone button-0 `MouseEvent('pointerdown')` therefore
 * dismisses nothing by itself - it parks the dismissal on a follow-up `click`
 * that a probe never sends. Hence the two shapes exercised below: a plain
 * `Event('pointerdown')`, whose `button` is undefined and so takes the
 * synchronous branch, and a button-0 `MouseEvent` completed by a `click`. Both
 * dismiss an unguarded Radix dialog, so both invert when the guard is removed.
 */
const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

let container: HTMLDivElement;
let root: Root;
let outside: HTMLButtonElement;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  // A sibling of the portalled content, so interactions on it are genuinely outside.
  outside = document.createElement('button');
  outside.type = 'button';
  outside.textContent = 'fora';
  document.body.append(outside);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  outside.remove();
});

async function mountDialog(onOpenChange: (open: boolean) => void) {
  await act(async () => {
    root.render(
      <Dialog onOpenChange={onOpenChange} open>
        <DialogContent>
          <DialogTitle>Titulo</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
  });
  // DismissableLayer registers its listeners in a macrotask.
  await settle();
}

/** Lets any dismissal Radix deferred to a later task land before we assert. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  });
}

describe('dialogs never close on an outside pointer down', () => {
  it('stays open when a bare pointerdown lands outside the content', async () => {
    const onOpenChange = vi.fn();
    await mountDialog(onOpenChange);

    await act(async () => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    await settle();

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('stays open through a full outside primary-button click sequence', async () => {
    const onOpenChange = vi.fn();
    await mountDialog(onOpenChange);

    await act(async () => {
      outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
      outside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      outside.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    });
    await settle();

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
});

describe('dialog close affordances stay working', () => {
  it('closes on Escape', async () => {
    const onOpenChange = vi.fn();
    await mountDialog(onOpenChange);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on the X affordance', async () => {
    const onOpenChange = vi.fn();
    await mountDialog(onOpenChange);

    // The real primitive portals into document.body, not the createRoot container.
    const closeButton = document.body.querySelector('[role="dialog"] button');
    if (!(closeButton instanceof HTMLElement)) throw new Error('close affordance not found');

    await act(async () => {
      closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
