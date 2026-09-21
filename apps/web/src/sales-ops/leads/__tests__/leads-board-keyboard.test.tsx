// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups } from '../board-labels';
import type { SalesOpsLead, SalesOpsLeadStage, LeadStageKind } from '../types';

/**
 * THE KEYBOARD PATH IS THE REAL CONTROL.
 *
 * Every oracle here drives the REAL `LeadsBoard`, the REAL `MoveLeadDialog` and
 * the REAL `Combobox` through clicks on the `Mover para…` trigger and the picker
 * rows. NO DRAG IS EVER SIMULATED - happy-dom runs neither pointer capture nor
 * activation behaviour, so a simulated drag would prove nothing.
 *
 * The design claim is real: the drag layer calls the same `emitMove` the dialog
 * does and installs no keyboard sensor, so deleting the whole dnd-kit layer
 * leaves every oracle in this file green and the board fully operable. If one of
 * these ever needs a drag to go red, the design has been inverted.
 *
 * WHAT THIS FILE USED TO CLAIM, AND WHY THAT WAS WRONG. It said the absence of
 * drag oracles "is not a gap in the coverage". It was. The board shipped with NO
 * column registered as a droppable, so a drag could only ever land on another
 * card: an empty column accepted nothing, and the CONVERSION column accepted
 * nothing either, because its cards are converted and a converted card is not a
 * drag source. The one column the feature exists to move leads into was
 * unreachable by drag, and every test here stayed green.
 *
 * The lesson is narrower than "simulate drags in happy-dom", which still proves
 * nothing. It is that the drop SURFACE is structure, and structure is exactly
 * what a DOM can answer for. That half now has its own oracles in
 * `leads-board-dropzones.test.tsx`; this file keeps owning the behaviour.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const NOVO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const NEGOCIACAO_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const CONVERSAO_ID = 'aaaaaaaa-0000-4000-8000-000000000003';
const PERDIDO_ID = 'aaaaaaaa-0000-4000-8000-000000000004';

const LEAD_A = 'bbbbbbbb-0000-4000-8000-00000000000a';
const LEAD_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const LEAD_C = 'bbbbbbbb-0000-4000-8000-00000000000c';
const CONVERTED_ID = 'bbbbbbbb-0000-4000-8000-00000000000d';
const SALE_ID = 'cccccccc-0000-4000-8000-00000000000f';

function stage(id: string, name: string, kind: LeadStageKind, position: number): SalesOpsLeadStage {
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
  };
}

const NOVO = stage(NOVO_ID, 'Novo', 'normal', 1);
const NEGOCIACAO = stage(NEGOCIACAO_ID, 'Negociação', 'normal', 2);
const CONVERSAO = stage(CONVERSAO_ID, 'Proposta enviada', 'conversion', 3);
const PERDIDO = stage(PERDIDO_ID, 'Perdido', 'lost', 4);
const STAGES = [NOVO, NEGOCIACAO, CONVERSAO, PERDIDO];

function lead(
  id: string,
  contactName: string,
  stageId: string,
  patch: Partial<SalesOpsLead> = {},
): SalesOpsLead {
  return {
    id,
    stageId,
    position: 1,
    contactName,
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
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });
const NOW = new Date('2026-09-18T12:00:00.000Z');

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

function query(selector: string): Element | null {
  return document.querySelector(selector);
}

function required(selector: string): Element {
  const node = query(selector);
  if (!node) throw new Error(`not found: ${selector}`);
  return node;
}

/** The dialog is portalled, so every lookup below is document-wide. */
function dialogNode(): Element {
  return required('[role="dialog"]');
}

/** The dialog's pickers in render order: destination, then position. */
function comboboxTriggers(): HTMLButtonElement[] {
  return [...dialogNode().querySelectorAll('[role="combobox"]')].filter(
    (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
  );
}

function optionRows(): HTMLElement[] {
  return [...document.querySelectorAll('[role="listbox"] [role="option"]')].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  );
}

/** Opens the picker at `index` and clicks the row whose label is `label`. */
async function pick(index: number, label: string) {
  const trigger = comboboxTriggers()[index];
  if (!trigger) throw new Error(`no combobox at index ${index}`);
  await click(trigger);
  const row = optionRows().find((node) => node.textContent?.trim() === label);
  if (!row) {
    throw new Error(
      `option "${label}" not offered; got ${optionRows()
        .map((node) => node.textContent)
        .join(' | ')}`,
    );
  }
  await click(row);
}

/** The labels the destination picker currently offers. */
async function destinationOptions(): Promise<string[]> {
  const trigger = comboboxTriggers()[0];
  if (!trigger) throw new Error('no destination picker');
  await click(trigger);
  const labels = optionRows().map((node) => node.textContent?.trim() ?? '');
  await click(trigger);
  return labels;
}

type BoardOverrides = Partial<React.ComponentProps<typeof LeadsBoard>>;

async function renderBoard(leads: SalesOpsLead[], overrides: BoardOverrides = {}) {
  const onMoveLead = vi.fn();
  await act(async () => {
    root.render(
      <LeadsBoard
        leads={leads}
        lookups={LOOKUPS}
        now={NOW}
        onMoveLead={onMoveLead}
        stages={STAGES}
        {...overrides}
      />,
    );
  });
  await settle();
  return { onMoveLead };
}

async function openMoveDialog(leadId: string) {
  await click(required(`[data-move-trigger="${leadId}"]`));
}

function textarea(): HTMLTextAreaElement {
  const node = dialogNode().querySelector('[data-lost-reason]');
  if (!(node instanceof HTMLTextAreaElement)) throw new Error('lost reason field not found');
  return node;
}

async function type(field: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

function confirmButton(): HTMLButtonElement {
  const node = dialogNode().querySelector('[data-move-confirm]');
  if (!(node instanceof HTMLButtonElement)) throw new Error('confirm button not found');
  return node;
}

/** The lead ids currently rendered under `stageId`, in DOM order. */
function columnOrder(stageId: string): string[] {
  const column = required(`[data-stage-column="${stageId}"]`);
  return [...column.querySelectorAll('[data-lead-card]')].map(
    (node) => node.getAttribute('data-lead-card') ?? '',
  );
}

describe('LeadsBoard, driven by the keyboard Mover para dialog alone', () => {
  it('moves a card to another column through the keyboard dialog alone, with no pointer drag', async () => {
    const { onMoveLead } = await renderBoard([lead(LEAD_A, 'Ana', NOVO_ID)]);

    await openMoveDialog(LEAD_A);
    await pick(0, 'Negociação');
    await pick(1, 'Início da coluna');
    await click(confirmButton());

    expect(onMoveLead).toHaveBeenCalledTimes(1);
    expect(onMoveLead).toHaveBeenCalledWith({
      leadId: LEAD_A,
      toStageId: NEGOCIACAO_ID,
      toIndex: 0,
      reason: null,
    });
  });

  it('reorders a card inside its own column through the same dialog', async () => {
    const { onMoveLead } = await renderBoard([
      lead(LEAD_A, 'Ana', NOVO_ID, { position: 1 }),
      lead(LEAD_B, 'Bruno', NOVO_ID, { position: 2 }),
      lead(LEAD_C, 'Carla', NOVO_ID, { position: 3 }),
    ]);

    await openMoveDialog(LEAD_A);
    // The destination stays the lead's OWN column; only the slot changes. Same
    // dialog, same payload, same emitter.
    await pick(1, 'Depois de Carla');
    await click(confirmButton());

    expect(onMoveLead).toHaveBeenCalledTimes(1);
    expect(onMoveLead).toHaveBeenCalledWith({
      leadId: LEAD_A,
      toStageId: NOVO_ID,
      toIndex: 2,
      reason: null,
    });
  });

  it('emits exactly one move payload per confirmation', async () => {
    const { onMoveLead } = await renderBoard([lead(LEAD_A, 'Ana', NOVO_ID)]);

    await openMoveDialog(LEAD_A);
    await pick(0, 'Negociação');
    await click(confirmButton());

    expect(onMoveLead).toHaveBeenCalledTimes(1);
  });

  it('blocks the confirm button until a lost reason is typed, and sends it trimmed', async () => {
    const { onMoveLead } = await renderBoard([lead(LEAD_A, 'Ana', NOVO_ID)]);

    await openMoveDialog(LEAD_A);
    await pick(0, 'Perdido');

    expect(confirmButton().disabled).toBe(true);
    expect(dialogNode().textContent).toContain('Informe o motivo da perda.');
    await click(confirmButton());
    expect(onMoveLead).not.toHaveBeenCalled();

    await type(textarea(), '  orçamento apertado  ');
    expect(confirmButton().disabled).toBe(false);
    await click(confirmButton());

    expect(onMoveLead).toHaveBeenCalledTimes(1);
    expect(onMoveLead.mock.calls[0]?.[0]).toMatchObject({
      toStageId: PERDIDO_ID,
      reason: 'orçamento apertado',
    });
  });

  it('renders no move trigger and no drag handle on a converted card, and shows its sale status', async () => {
    await renderBoard([
      lead(CONVERTED_ID, 'Dora', CONVERSAO_ID, { saleId: SALE_ID, saleStatus: 'won' }),
    ]);

    const card = required(`[data-lead-card="${CONVERTED_ID}"]`);
    expect(query(`[data-move-trigger="${CONVERTED_ID}"]`)).toBeNull();
    expect(card.getAttribute('data-read-only-card')).toBe('true');
    expect(card.getAttribute('role')).toBeNull();
    expect(card.textContent).toContain('Ganha');
    // The mirrored status is a badge and never a control.
    expect(card.querySelectorAll('button')).toHaveLength(0);
  });

  it('keeps the conversion column a drop target for a card that is not converted', async () => {
    await renderBoard(
      [
        lead(LEAD_A, 'Ana', NOVO_ID),
        lead(CONVERTED_ID, 'Dora', CONVERSAO_ID, { saleId: SALE_ID, saleStatus: 'won' }),
      ],
      { onRequestConversion: vi.fn(async () => null) },
    );

    await openMoveDialog(LEAD_A);

    // Read-only is a property of the CARD, so the column is still a destination.
    expect(await destinationOptions()).toContain('Proposta enviada');
  });

  it('keeps a NON-converted card in the conversion column fully movable', async () => {
    // The DOM-level pair to the two roles of the one conversion stage, and the
    // ONLY oracle here that separates "this CARD is read-only" from "this COLUMN
    // is read-only": both cards below sit in the same column and only the
    // converted one is inert.
    await renderBoard(
      [
        lead(LEAD_B, 'Bruno', CONVERSAO_ID),
        lead(CONVERTED_ID, 'Dora', CONVERSAO_ID, { saleId: SALE_ID, saleStatus: 'won' }),
      ],
      { onRequestConversion: vi.fn(async () => null) },
    );

    expect(query(`[data-move-trigger="${CONVERTED_ID}"]`)).toBeNull();
    expect(query(`[data-move-trigger="${LEAD_B}"]`)).not.toBeNull();

    await openMoveDialog(LEAD_B);
    expect(await destinationOptions()).toEqual([
      'Novo',
      'Negociação',
      'Proposta enviada',
      'Perdido',
    ]);
  });

  it('renders the vendedor filter without filtering its own leads', async () => {
    const onChange = vi.fn();
    const PERSON = 'dddddddd-0000-4000-8000-000000000001';
    await renderBoard(
      [
        lead(LEAD_A, 'Ana', NOVO_ID, { sellerPersonId: PERSON }),
        lead(LEAD_B, 'Bruno', NOVO_ID, { sellerPersonId: null }),
      ],
      {
        sellerFilter: {
          value: PERSON,
          options: [{ value: PERSON, label: 'Marina Souza' }],
          onChange,
        },
      },
    );

    // The narrowing is SERVER-applied; a client-side `.filter()` here would be a
    // second, weaker answer and would drop Bruno.
    expect(query(`[data-lead-card="${LEAD_A}"]`)).not.toBeNull();
    expect(query(`[data-lead-card="${LEAD_B}"]`)).not.toBeNull();

    const trigger = document.querySelector('[role="combobox"]');
    if (!trigger) throw new Error('filter picker not rendered');
    await click(trigger);
    const row = optionRows().find((node) => node.textContent?.trim() === 'Todos os vendedores');
    if (!row) throw new Error('all-sellers row missing');
    await click(row);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('never calls onMoveLead when the conversion handler resolves null', async () => {
    const onRequestConversion = vi.fn(async () => null);
    const { onMoveLead } = await renderBoard([lead(LEAD_A, 'Ana', NOVO_ID)], {
      onRequestConversion,
    });

    await openMoveDialog(LEAD_A);
    await pick(0, 'Proposta enviada');
    expect(dialogNode().textContent).toContain(
      'Esta etapa abre o wizard de proposta. O card só muda de etapa depois que a proposta for criada.',
    );
    await click(confirmButton());

    expect(onRequestConversion).toHaveBeenCalledTimes(1);
    expect(onMoveLead).not.toHaveBeenCalled();
    // Cancelled: the card is exactly where it was, with nothing persisted.
    expect(columnOrder(NOVO_ID)).toEqual([LEAD_A]);
    expect(columnOrder(CONVERSAO_ID)).toEqual([]);
  });

  it('calls onMoveLead once the conversion handler resolves a sale id', async () => {
    const onRequestConversion = vi.fn(async () => SALE_ID);
    const { onMoveLead } = await renderBoard([lead(LEAD_A, 'Ana', NOVO_ID)], {
      onRequestConversion,
    });

    await openMoveDialog(LEAD_A);
    await pick(0, 'Proposta enviada');
    await click(confirmButton());

    expect(onRequestConversion).toHaveBeenCalledWith({
      lead: expect.objectContaining({ id: LEAD_A }),
      toStageId: CONVERSAO_ID,
      toIndex: 0,
    });
    expect(onMoveLead).toHaveBeenCalledTimes(1);
    // The resolved id RIDES the move; the API refuses a conversion move without it.
    expect(onMoveLead).toHaveBeenCalledWith({
      leadId: LEAD_A,
      toStageId: CONVERSAO_ID,
      toIndex: 0,
      reason: null,
      saleId: SALE_ID,
    });
  });

  it('does not offer the conversion door at all when no conversion handler is attached', async () => {
    await renderBoard([lead(LEAD_A, 'Ana', NOVO_ID)]);

    await openMoveDialog(LEAD_A);

    expect(await destinationOptions()).not.toContain('Proposta enviada');
  });

  it('holds no local copy of the lead list, so a rejected move reverts with the cache', async () => {
    const original = [
      lead(LEAD_A, 'Ana', NOVO_ID, { position: 1 }),
      lead(LEAD_B, 'Bruno', NOVO_ID, { position: 2 }),
    ];
    const { onMoveLead } = await renderBoard(original);

    await openMoveDialog(LEAD_A);
    await pick(1, 'Depois de Bruno');
    await click(confirmButton());
    expect(onMoveLead).toHaveBeenCalledTimes(1);

    // The move was emitted and the cache rejected it, so the SAME array comes
    // back. A `useState` mirror inside the board would have kept the optimistic
    // order and this assertion would fail.
    await act(async () => {
      root.render(
        <LeadsBoard
          leads={original}
          lookups={LOOKUPS}
          now={NOW}
          onMoveLead={onMoveLead}
          stages={STAGES}
        />,
      );
    });
    await settle();

    expect(columnOrder(NOVO_ID)).toEqual([LEAD_A, LEAD_B]);
  });
});
