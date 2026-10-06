// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MoveLeadDialog } from '../MoveLeadDialog';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * D-07.1d: the move dialog shows no validation error before the operator
 * interacts. A lead alone in its own column opens with no slot to pick, so the
 * form is incomplete (Mover stays disabled) but nothing is WRONG yet; the red
 * refusal appears only once a field is changed and the result is still invalid.
 * Driven through the REAL `Dialog` and the REAL `Combobox`.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const NOVO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const NEGOCIACAO_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const PERDIDO_ID = 'aaaaaaaa-0000-4000-8000-000000000003';

function stage(id: string, name: string, position: number, kind: SalesOpsLeadStage['kind']) {
  return {
    id,
    orgId: 'org-test',
    name,
    position,
    kind,
    isSystem: kind !== 'normal',
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  } satisfies SalesOpsLeadStage;
}

const STAGES: SalesOpsLeadStage[] = [
  stage(NOVO_ID, 'Novo', 1, 'normal'),
  stage(NEGOCIACAO_ID, 'Negociação', 2, 'normal'),
  stage(PERDIDO_ID, 'Perdido', 3, 'lost'),
];

const LEAD: SalesOpsLead = {
  id: 'bbbbbbbb-0000-4000-8000-00000000000a',
  stageId: NOVO_ID,
  position: 1,
  contactName: 'Ana',
  clientId: null,
  clientNameSnapshot: '',
  estimatedValueBrl: 0,
  description: null,
  contactPhone: null,
  contactEmail: null,
  contactBirthDate: null,
  sellerPersonId: null,
  sellerNameSnapshot: '',
  lostReason: null,
  stageChangedAt: '2026-09-15T12:00:00.000Z',
  saleId: null,
  saleStatus: null,
  saleCode: null,
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

function dialogNode(): Element {
  const node = document.querySelector('[role="dialog"]');
  if (!node) throw new Error('dialog not rendered');
  return node;
}

function comboboxTrigger(index: number): HTMLButtonElement {
  const match = [...dialogNode().querySelectorAll('[role="combobox"]')][index];
  if (!(match instanceof HTMLButtonElement)) throw new Error('combobox trigger not found');
  return match;
}

async function pick(index: number, label: string) {
  await click(comboboxTrigger(index));
  const row = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!row) throw new Error(`option "${label}" not offered`);
  await click(row);
}

function blockedText(): string | null {
  return dialogNode().querySelector('[data-move-blocked]')?.textContent ?? null;
}

function confirmButton(): HTMLButtonElement {
  const node = dialogNode().querySelector('[data-move-confirm]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('confirm button not found');
  return node;
}

async function typeReason(value: string) {
  const field = dialogNode().querySelector('[data-lost-reason]');
  if (!(field instanceof HTMLTextAreaElement)) throw new Error('reason textarea not found');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      field,
      value,
    );
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

async function mount(props: Partial<React.ComponentProps<typeof MoveLeadDialog>> = {}) {
  const onSubmit = vi.fn();
  await act(async () => {
    root.render(
      <MoveLeadDialog
        lead={LEAD}
        leads={[LEAD]}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        targets={STAGES}
        {...props}
      />,
    );
  });
  await settle();
  return onSubmit;
}

describe('MoveLeadDialog validation timing (D-07.1d)', () => {
  it('shows no refusal on open when the lead is alone in its own column', async () => {
    await mount();
    expect(blockedText()).toBeNull();
    // Still incomplete: there is no slot to move to, so Mover stays disabled.
    expect(confirmButton().disabled).toBe(true);
  });

  it('shows the position refusal once the operator picks a destination that is still invalid', async () => {
    await mount();
    await pick(0, 'Negociação');
    expect(blockedText()).toBeNull();
    await pick(0, 'Novo');
    expect(blockedText()).toBe('Escolha a posição na coluna.');
    expect(confirmButton().disabled).toBe(true);
  });

  it('a drag handed to Perdido shows the reason hint but no refusal until the operator types', async () => {
    const onSubmit = await mount({ initialStageId: PERDIDO_ID });
    expect(dialogNode().textContent).toContain('Uma etapa de perda exige o motivo.');
    expect(blockedText()).toBeNull();
    expect(confirmButton().disabled).toBe(true);

    await typeReason('x');
    await typeReason('   ');
    expect(blockedText()).toBe('Informe o motivo da perda.');

    await typeReason(' sem verba ');
    expect(blockedText()).toBeNull();
    await click(confirmButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      leadId: LEAD.id,
      toStageId: PERDIDO_ID,
      toIndex: 0,
      reason: 'sem verba',
    });
  });

  it('a valid move still emits exactly one payload', async () => {
    const onSubmit = await mount();
    await pick(0, 'Negociação');
    await click(confirmButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      leadId: LEAD.id,
      toStageId: NEGOCIACAO_ID,
      toIndex: 0,
      reason: null,
    });
  });
});
