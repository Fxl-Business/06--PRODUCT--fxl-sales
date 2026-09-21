// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsBoard } from '../LeadsBoard';
import { LeadCard } from '../LeadCard';
import { buildLabelLookups } from '../board-labels';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * THE DROP SURFACE, AND WHY THIS FILE EXISTS.
 *
 * The drag layer shipped fully broken and every test in this suite stayed green,
 * because the whole board was verified through the keyboard path and the sibling
 * file says outright that no drag is ever simulated. That reasoning was right
 * about happy-dom and wrong about coverage: it left the drag layer with NO
 * oracle at all, and a real browser on 2026-09-21 showed that dragging a card
 * onto the Proposta column did nothing whatsoever.
 *
 * The cause was structural, and structure is exactly what happy-dom CAN see.
 * Every droppable on the board was a CARD, registered by `useSortable`, so:
 *   - an empty column could never receive anything;
 *   - the CONVERSION column could never receive anything either, because its
 *     cards are converted, converted cards are excluded from `movableIds`, and
 *     a card outside `SortableContext` is not a droppable at all. The one column
 *     the feature exists to move leads into accepted nothing.
 *
 * So these oracles do not simulate a drag. They assert the DROP SURFACE exists,
 * which is the half of the drag layer that a DOM can answer for, and it is the
 * half that was missing. The keyboard oracles still pass with dnd-kit deleted;
 * these go red the moment a column stops registering itself.
 */

const NOVO_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const VAZIA_ID = 'bbbbbbbb-0000-4000-8000-000000000002';
const CONVERSAO_ID = 'bbbbbbbb-0000-4000-8000-000000000003';

const NOW = new Date('2026-09-21T12:00:00.000Z');

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

function stage(id: string, name: string, kind: SalesOpsLeadStage['kind']): SalesOpsLeadStage {
  return {
    id,
    name,
    kind,
    position: 0,
    status: 'active',
    isSystem: kind !== 'normal',
    archivedAt: null,
    orgId: 'org-1',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

const STAGES: SalesOpsLeadStage[] = [
  stage(NOVO_ID, 'Novo', 'normal'),
  stage(VAZIA_ID, 'Vazia', 'normal'),
  stage(CONVERSAO_ID, 'Proposta', 'conversion'),
];

const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });

function lead(id: string, stageId: string, patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id,
    stageId,
    position: 1,
    contactName: `Contato ${id}`,
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
  } as SalesOpsLead;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function dropzones(): string[] {
  return [...container.querySelectorAll('[data-stage-dropzone]')].map(
    (node) => node.getAttribute('data-stage-dropzone') ?? '',
  );
}

describe('the board drop surface', () => {
  it('registers a drop zone for EVERY stage, including one with no leads at all', async () => {
    await act(async () => {
      root.render(
        <LeadsBoard
          leads={[lead('l1', NOVO_ID)]}
          lookups={LOOKUPS}
          now={NOW}
          onMoveLead={vi.fn()}
          stages={STAGES}
        />,
      );
    });

    // The empty column is the simplest case the card-only surface got wrong.
    expect(dropzones().sort()).toEqual([NOVO_ID, VAZIA_ID, CONVERSAO_ID].sort());
  });

  it('registers one for the CONVERSION column even when its only card is converted', async () => {
    // The exact shape that was unreachable in production: the conversion column
    // holds a converted lead, which is not a drag source and therefore not a
    // droppable. Without a column-level zone the column had zero drop targets.
    const converted = lead('l2', CONVERSAO_ID, {
      saleId: 'sale-1',
      saleStatus: 'won',
      saleCode: '0001-1',
    });

    await act(async () => {
      root.render(
        <LeadsBoard
          leads={[lead('l1', NOVO_ID), converted]}
          lookups={LOOKUPS}
          now={NOW}
          onMoveLead={vi.fn()}
          onRequestConversion={vi.fn()}
          stages={STAGES}
        />,
      );
    });

    expect(dropzones()).toContain(CONVERSAO_ID);
    // and the converted card really is the only thing in it, i.e. the zone is
    // carrying the column on its own rather than riding a movable card.
    const column = container.querySelector(`[data-stage-column="${CONVERSAO_ID}"]`);
    expect(column?.querySelectorAll('[data-lead-card]')).toHaveLength(1);
    expect(column?.querySelector('[data-move-trigger]')).toBeNull();
  });
});

describe('a converted card names its proposta', () => {
  const converted = lead('l9', CONVERSAO_ID, {
    contactName: 'Renata Ipê',
    saleId: 'sale-1',
    saleStatus: 'won',
    saleCode: '0001-1',
  });

  it('renders the código and takes the operator to it', async () => {
    // A bare status chip was a dead end: the card is titled with the CONTACT
    // name while the propostas screen is keyed on the CLIENT, so `Ganha` alone
    // never told the operator WHICH proposta the lead became.
    const onOpenSale = vi.fn();
    await act(async () => {
      root.render(
        <LeadCard
          lead={converted}
          lookups={LOOKUPS}
          now={NOW}
          onOpenSale={onOpenSale}
        />,
      );
    });

    const link = container.querySelector('[data-open-sale]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('0001-1');
    expect(link?.textContent).toContain('Ganha');

    await act(async () => {
      (link as HTMLButtonElement).click();
    });
    expect(onOpenSale).toHaveBeenCalledWith('sale-1');
  });

  it('degrades to a plain chip when no handler is supplied, never a dead button', async () => {
    await act(async () => {
      root.render(<LeadCard lead={converted} lookups={LOOKUPS} now={NOW} />);
    });

    expect(container.querySelector('[data-open-sale]')).toBeNull();
    expect(container.querySelector('[data-sale-status]')?.textContent).toContain('Ganha');
  });
});
