// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdvanceDialog } from '../AdvanceDialog';
import type { LeadNextStage } from '../crm-types';

/**
 * Same trap as `move-dialog-inline-layer.test.tsx`: Radix dismisses on `document`
 * in the capture phase, so the only honest assertion is on `onOpenChange` of the
 * REAL `Dialog`. The positive control proves the dialog would close without the
 * inline-layer guard, so the negative assertion is not vacuous.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const NORMAL: LeadNextStage = {
  id: 'stage-prop',
  name: 'Proposta enviada',
  type: 'normal',
  exitKind: null,
  requiresReason: false,
};
const GANHO: LeadNextStage = {
  id: 'stage-ganho',
  name: 'Ganho',
  type: 'saida',
  exitKind: 'ganho',
  requiresReason: false,
};

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

async function settle() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle();
}

/** Dispatched with `bubbles: true`, exactly as a real key press is. */
async function escape(element: Element) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

function destinationTrigger(): HTMLButtonElement {
  const match = document.querySelector('[role="dialog"] [role="combobox"]');
  if (!(match instanceof HTMLButtonElement)) throw new Error('destination picker not found');
  return match;
}

function pickerSearch(): HTMLInputElement {
  const listbox = document.querySelector('[role="listbox"]');
  const search = listbox?.parentElement?.querySelector('input[type="text"]');
  if (!(search instanceof HTMLInputElement)) throw new Error('picker search not found');
  return search;
}

async function mountAdvanceDialog() {
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <AdvanceDialog
        leadName="Ana Souza"
        nextStages={[NORMAL, GANHO]}
        onConvert={vi.fn(async () => true)}
        onOpenChange={onOpenChange}
        onSubmit={vi.fn(async () => ({}))}
        open
        opensConversionIds={new Set()}
        today="2026-10-20"
      />,
    );
  });
  await settle();
  return onOpenChange;
}

describe('Escape closes the innermost inline layer, never the Avançar dialog under it', () => {
  it('keeps the Avançar dialog open when Escape puts away the destination picker', async () => {
    const onOpenChange = await mountAdvanceDialog();

    await click(destinationTrigger());
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    await escape(pickerSearch());

    expect(document.querySelector('[role="listbox"]')).toBeNull();
    // The decisive assertion. A spy on a React sibling's onKeyDown would pass
    // here even with the protection deleted.
    expect(onOpenChange).not.toHaveBeenCalled();

    // POSITIVE CONTROL, same test on purpose: with no inline layer open, Escape
    // must reach the real Dialog and close it. Without this, a dialog that never
    // registers Radix's listener would pass the assertion above vacuously.
    await escape(destinationTrigger());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
