// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Combobox } from '../combobox';
import { Dialog, DialogContent, DialogTitle } from '../dialog';
import { InfoHint } from '../info-hint';

/**
 * Escape must put away the INNERMOST thing that is open, and nothing more.
 *
 * `Combobox` and `InfoHint` both render an inline, non-portalled panel, so
 * neither is a Radix `DismissableLayer` and neither is on the layer stack that
 * Radix consults before dismissing a dialog. Worse, Radix's `useEscapeKeydown`
 * registers `document.addEventListener('keydown', handler, { capture: true })`,
 * which runs before the event has reached React's root container at all - so no
 * `stopPropagation` from inside the React tree can pre-empt it, however early it
 * looks in the JSX.
 *
 * Everything here therefore drives the REAL `@radix-ui/react-dialog`. A probe
 * against a mocked dialog, or against a plain `<div onKeyDown>` wrapper, tests
 * React's synthetic bubbling and cannot observe the capture-phase listener that
 * is the actual hazard.
 */
const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const HINT_TEXT = 'Esta é uma previsão.';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
  vi.restoreAllMocks();
});

/** Lets Radix's macrotask-registered dismissal listeners land before we assert. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  });
}

async function mount(children: React.ReactNode) {
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <Dialog onOpenChange={onOpenChange} open>
        <DialogContent>
          <DialogTitle>Proposta</DialogTitle>
          {children}
        </DialogContent>
      </Dialog>,
    );
  });
  await settle();
  return onOpenChange;
}

/** The content is portalled, so every query below is document-wide. */
function dialogText(): string {
  const content = document.querySelector('[role="dialog"]');
  return content?.textContent ?? '';
}

function hintTrigger(): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((candidate) =>
    candidate.getAttribute('aria-label')?.startsWith('Mais informações sobre'),
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error('hint trigger not found');
  return match;
}

function comboboxTrigger(): HTMLButtonElement {
  const match = document.querySelector('[role="combobox"]');
  if (!(match instanceof HTMLButtonElement)) throw new Error('combobox trigger not found');
  return match;
}

function comboboxSearch(): HTMLInputElement {
  const match = document.querySelector('input[type="text"]');
  if (!(match instanceof HTMLInputElement)) throw new Error('combobox search not found');
  return match;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/**
 * Dispatched on the focused element with `bubbles: true`, which is what a real
 * key press produces: the document capture listener sees it on the way down and
 * React's root sees it on the way back up.
 */
async function escape(element: Element) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

describe('Escape closes the innermost inline layer, never the dialog under it', () => {
  it('closes an open InfoHint and leaves the dialog open', async () => {
    const onOpenChange = await mount(<InfoHint label="previsão">{HINT_TEXT}</InfoHint>);

    await click(hintTrigger());
    expect(dialogText()).toContain(HINT_TEXT);

    await escape(hintTrigger());

    expect(dialogText()).not.toContain(HINT_TEXT);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('still closes the dialog on the next Escape, once the hint is away', async () => {
    const onOpenChange = await mount(<InfoHint label="previsão">{HINT_TEXT}</InfoHint>);

    await click(hintTrigger());
    await escape(hintTrigger());
    expect(onOpenChange).not.toHaveBeenCalled();

    // The guard is not a blanket disable: with nothing inner open, Escape is
    // still the dialog-close affordance `dialog.tsx` deliberately keeps working.
    await escape(hintTrigger());

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes the dialog on the first Escape when no hint was ever opened', async () => {
    const onOpenChange = await mount(<InfoHint label="previsão">{HINT_TEXT}</InfoHint>);

    await escape(hintTrigger());

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes an open Combobox panel and leaves the dialog open', async () => {
    const onOpenChange = await mount(
      <Combobox
        aria-label="Área"
        onChange={vi.fn()}
        options={[{ value: 'a', label: 'FXL Tech' }]}
        value={null}
      />,
    );

    await click(comboboxTrigger());
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    await escape(comboboxSearch());

    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('still closes the dialog on the next Escape, once the Combobox panel is away', async () => {
    const onOpenChange = await mount(
      <Combobox
        aria-label="Área"
        onChange={vi.fn()}
        options={[{ value: 'a', label: 'FXL Tech' }]}
        value={null}
      />,
    );

    await click(comboboxTrigger());
    await escape(comboboxSearch());
    expect(onOpenChange).not.toHaveBeenCalled();

    await escape(comboboxTrigger());

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
