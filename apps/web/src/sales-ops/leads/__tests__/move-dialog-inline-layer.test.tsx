// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadDialog } from '../LeadDialog';
import { MoveLeadDialog } from '../MoveLeadDialog';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * THE FALSE-POSITIVE TRAP, recorded because it already shipped once in this repo.
 *
 * Radix registers `useEscapeKeydown` on `document` with `{capture: true}`, so it
 * runs BEFORE the event has reached React's root container at all. A spy on a
 * React sibling's `onKeyDown` therefore passes with the protection fully
 * deleted, and so does a probe against a mocked dialog. The assertion has to be
 * on `onOpenChange`, and the `Dialog` has to be the REAL one - which is why this
 * file deliberately does NOT `vi.mock('@/components/ui/dialog', ...)` the way
 * most sales-ops tests do.
 *
 * What is protected is the operator's typed work: without the guard, an Escape
 * aimed at an open `Combobox` panel discards the whole dialog.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const NOVO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const NEGOCIACAO_ID = 'aaaaaaaa-0000-4000-8000-000000000002';

const STAGES: SalesOpsLeadStage[] = [
  {
    id: NOVO_ID,
    orgId: 'org-test',
    name: 'Novo',
    position: 1,
    kind: 'normal',
    isSystem: false,
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  },
  {
    id: NEGOCIACAO_ID,
    orgId: 'org-test',
    name: 'Negociação',
    position: 2,
    kind: 'normal',
    isSystem: false,
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  },
];

const LEAD: SalesOpsLead = {
  id: 'bbbbbbbb-0000-4000-8000-00000000000a',
  stageId: NOVO_ID,
  position: 1,
  contactName: 'Ana',
  clientId: null,
  clientNameSnapshot: 'Acme',
  estimatedValueBrl: 150_000,
  description: null,
  sellerPersonId: null,
  sellerNameSnapshot: 'Marina',
  lostReason: null,
  stageChangedAt: '2026-09-15T12:00:00.000Z',
  saleId: null,
  saleStatus: null,
  products: [],
  createdAt: '2026-09-01T12:00:00.000Z',
  updatedAt: null,
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

/** Lets Radix's macrotask-registered dismissal listeners land before we assert. */
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

function comboboxTrigger(index = 0): HTMLButtonElement {
  const match = [...document.querySelectorAll('[role="combobox"]')][index];
  if (!(match instanceof HTMLButtonElement)) throw new Error('combobox trigger not found');
  return match;
}

function comboboxSearch(): HTMLInputElement {
  const match = document.querySelector('[role="listbox"]');
  const search = match?.parentElement?.querySelector('input[type="text"]');
  if (!(search instanceof HTMLInputElement)) throw new Error('combobox search not found');
  return search;
}

async function mountMoveDialog() {
  const onOpenChange = vi.fn();
  await act(async () => {
    root.render(
      <MoveLeadDialog
        lead={LEAD}
        leads={[LEAD]}
        onOpenChange={onOpenChange}
        onSubmit={vi.fn()}
        open
        targets={STAGES}
      />,
    );
  });
  await settle();
  return onOpenChange;
}

describe('Escape closes the innermost inline layer, never the lead dialog under it', () => {
  it('keeps the move dialog open when Escape puts away the destination picker', async () => {
    const onOpenChange = await mountMoveDialog();

    await click(comboboxTrigger(0));
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    await escape(comboboxSearch());

    expect(document.querySelector('[role="listbox"]')).toBeNull();
    // The decisive assertion. A spy on a React sibling's onKeyDown would pass
    // here even with the protection deleted.
    expect(onOpenChange).not.toHaveBeenCalled();

    // And the POSITIVE CONTROL, in the same test on purpose: without it, a
    // hand-rolled `<div role="dialog">` in place of `DialogContent` registers no
    // Radix listener at all, `onOpenChange` is never called, and the assertion
    // above passes with the whole protection gone. Measured, not hypothesised.
    await escape(comboboxTrigger(0));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('still closes the move dialog when Escape arrives with nothing inner open', async () => {
    const onOpenChange = await mountMoveDialog();

    // The guard is not a blanket disable: Escape remains the dialog's own close
    // affordance whenever no inline layer is open.
    await escape(comboboxTrigger(0));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the lead dialog open when Escape puts away the vendedor picker', async () => {
    const onOpenChange = vi.fn();
    await act(async () => {
      root.render(
        <LeadDialog
          clients={[{ value: 'c1', label: 'Acme' }]}
          initial={null}
          onOpenChange={onOpenChange}
          onSubmit={vi.fn()}
          open
          products={[]}
          sellers={[{ value: 'p1', label: 'Marina Souza' }]}
        />,
      );
    });
    await settle();

    const triggers = [...document.querySelectorAll('[role="combobox"]')];
    const sellerTrigger = triggers[triggers.length - 1];
    if (!sellerTrigger) throw new Error('vendedor picker missing');

    await click(sellerTrigger);
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();

    await escape(comboboxSearch());

    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(onOpenChange).not.toHaveBeenCalled();

    // Same positive control, same reason.
    await escape(sellerTrigger);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
