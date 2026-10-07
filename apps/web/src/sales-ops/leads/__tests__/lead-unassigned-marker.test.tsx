// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadFieldSet } from '@fxl-sales/shared-utils/sales-edition';
import { LeadCard } from '../LeadCard';
import { LeadsBoard } from '../LeadsBoard';
import { UNASSIGNED_LEAD_LABEL, buildLabelLookups } from '../board-labels';
import { avatarClass, daysBadgeClass, unassignedMarkerClass } from '../board-ui';
import { leadIsUnassigned } from '../calculations';
import { reconcileLeadRow } from '../optimistic';
import type { LeadsInfiniteData, SalesOpsLead, SalesOpsLeadStage } from '../types';
import type { SalesOpsPerson } from '../../types';

/**
 * AC9 of leads-sem-vendedor. A lead in the shared pool (no vendedor, not
 * converted) shows `Sem vendedor - disponível` on `[data-unassigned-lead]` in the
 * card footer and in the Lista's Vendedor cell, instead of the avatar and
 * `Sem vendedor`. An assigned lead renders exactly as before, and a CONVERTED
 * lead with no vendedor keeps the plain `Sem vendedor` line: it is read-only and
 * can never be claimed, so it is not "disponível".
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const NOVO_ID = 'cccccccc-0000-4000-8000-000000000001';
const CONV_ID = 'cccccccc-0000-4000-8000-000000000002';
const PERSON_ID = 'd0000000-0000-4000-8000-000000000001';
const LEAD_POOL = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEAD_OWNED = 'aaaaaaaa-0000-4000-8000-000000000002';
const LEAD_CONVERTED = 'aaaaaaaa-0000-4000-8000-000000000003';
const SALE_ID = 'eeeeeeee-0000-4000-8000-000000000001';

/** Spelled out here on purpose, so a drifted constant cannot pass by comparing to itself. */
const EXACT_LABEL = 'Sem vendedor - disponível';
const LAYOUTS: LeadFieldSet[] = ['full', 'contact'];

const NOW = new Date('2026-10-07T12:00:00.000Z');
const LOOKUPS = buildLabelLookups({
  clients: [],
  people: [{ id: PERSON_ID, displayName: 'Marina Souza' } as SalesOpsPerson],
  products: [],
});

function stage(
  id: string,
  name: string,
  kind: SalesOpsLeadStage['kind'],
  position: number,
): SalesOpsLeadStage {
  return {
    id,
    name,
    kind,
    position,
    status: 'active',
    isSystem: kind !== 'normal',
    archivedAt: null,
    orgId: 'org-1',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

const STAGES = [stage(NOVO_ID, 'Novo', 'normal', 1), stage(CONV_ID, 'Proposta', 'conversion', 2)];

function lead(id: string, patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id,
    stageId: NOVO_ID,
    position: 1,
    contactName: 'Helena Braga',
    clientId: null,
    clientNameSnapshot: 'Acme',
    estimatedValueBrl: 150_000,
    description: null,
    contactPhone: '(27) 99999-0000',
    contactEmail: 'helena@acme.com.br',
    contactBirthDate: null,
    sellerPersonId: null,
    sellerNameSnapshot: '',
    lostReason: null,
    stageChangedAt: '2026-09-25T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const POOL = lead(LEAD_POOL);
const OWNED = lead(LEAD_OWNED, {
  contactName: 'Bruno Lima',
  position: 2,
  sellerPersonId: PERSON_ID,
  sellerNameSnapshot: 'Marina Souza',
});
const CONVERTED = lead(LEAD_CONVERTED, {
  contactName: 'Caio Rocha',
  stageId: CONV_ID,
  saleId: SALE_ID,
  saleStatus: 'won',
  saleCode: '0001-1',
});
/** What the API answers after a vendedor's move or edit claimed POOL. */
const CLAIMED = { ...POOL, sellerPersonId: PERSON_ID, sellerNameSnapshot: 'Marina Souza' };

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
  document.body.innerHTML = '';
});

function required(scope: ParentNode, selector: string): HTMLElement {
  const node = scope.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`not rendered: ${selector}`);
  return node;
}

/** The avatar is the one span carrying exactly `avatarClass`. */
function hasAvatar(scope: Element): boolean {
  return [...scope.querySelectorAll('span')].some((node) => node.className === avatarClass);
}

describe('leadIsUnassigned', () => {
  it('is true for an open lead with no vendedor', () => {
    expect(leadIsUnassigned(POOL)).toBe(true);
  });

  it('is false once a vendedor owns the lead', () => {
    expect(leadIsUnassigned(OWNED)).toBe(false);
    expect(leadIsUnassigned(CLAIMED)).toBe(false);
  });

  it('is false for a converted lead, with or without a vendedor', () => {
    expect(leadIsUnassigned(CONVERTED)).toBe(false);
    expect(leadIsUnassigned({ ...CONVERTED, sellerPersonId: PERSON_ID })).toBe(false);
  });

  it('keys on sellerPersonId alone, never on the name snapshot', () => {
    expect(leadIsUnassigned(lead('x', { sellerNameSnapshot: 'Marina' }))).toBe(true);
    expect(leadIsUnassigned(lead('y', { sellerPersonId: PERSON_ID }))).toBe(false);
  });
});

describe('UNASSIGNED_LEAD_LABEL', () => {
  it('is the exact copy, with a plain hyphen and no em or en dash', () => {
    expect(UNASSIGNED_LEAD_LABEL).toBe(EXACT_LABEL);
    expect(UNASSIGNED_LEAD_LABEL).not.toContain('\u2014');
    expect(UNASSIGNED_LEAD_LABEL).not.toContain('\u2013');
  });
});

describe('footer geometry', () => {
  it('gives the marker the avatar height, so both footers are equally tall', () => {
    expect(unassignedMarkerClass.split(' ')).toContain('h-6');
    expect(avatarClass.split(' ')).toContain('h-6');
    expect(unassignedMarkerClass.split(' ')).toContain('min-w-0');
  });

  it('never lets the days badge shrink or wrap beside a long seller slot', () => {
    const tokens = daysBadgeClass.split(' ');
    expect(tokens).toContain('shrink-0');
    expect(tokens).toContain('whitespace-nowrap');
  });
});

describe.each(LAYOUTS)('LeadCard seller footer (%s layout)', (fieldSet) => {
  async function renderCard(value: SalesOpsLead) {
    await act(async () => {
      root.render(<LeadCard fieldSet={fieldSet} lead={value} lookups={LOOKUPS} now={NOW} />);
    });
    return required(container, `[data-lead-card="${value.id}"]`);
  }

  it('shows the marker instead of the avatar for an unassigned open lead', async () => {
    const card = await renderCard(POOL);
    const markers = card.querySelectorAll('[data-unassigned-lead]');
    expect(markers).toHaveLength(1);
    expect(markers[0]!.textContent).toBe(EXACT_LABEL);
    // The text is the accessible name: nothing hides it.
    expect(markers[0]!.closest('[aria-hidden="true"]')).toBeNull();
    expect(hasAvatar(card)).toBe(false);
    expect(card.textContent).not.toContain('SV');
    // The days badge still sits beside it.
    expect(card.querySelector('[data-days-in-stage]')).not.toBeNull();
  });

  it('renders an assigned lead exactly as before: avatar initials and name, no marker', async () => {
    const card = await renderCard(OWNED);
    expect(card.querySelector('[data-unassigned-lead]')).toBeNull();
    expect(hasAvatar(card)).toBe(true);
    expect(card.textContent).toContain('MS');
    expect(card.textContent).toContain('Marina Souza');
    expect(card.textContent).not.toContain('disponível');
  });

  it('keeps the plain Sem vendedor line on a converted lead with no vendedor', async () => {
    const card = await renderCard(CONVERTED);
    expect(card.querySelector('[data-unassigned-lead]')).toBeNull();
    expect(hasAvatar(card)).toBe(true);
    expect(card.textContent).toContain('SV');
    expect(card.textContent).toContain('Sem vendedor');
    expect(card.textContent).not.toContain('disponível');
  });

  it('drops the marker when the server row comes back claimed', async () => {
    await renderCard(POOL);
    expect(container.querySelector('[data-unassigned-lead]')).not.toBeNull();
    const card = await renderCard(CLAIMED);
    expect(card.querySelector('[data-unassigned-lead]')).toBeNull();
    expect(card.textContent).toContain('Marina Souza');
  });
});

describe('reconcileLeadRow carries the claim into the board cache', () => {
  it('replaces the whole cached row, seller fields included', () => {
    const snapshot: LeadsInfiniteData = {
      pages: [{ leads: [POOL, OWNED], nextCursor: null }],
      pageParams: [null],
    };
    const row = reconcileLeadRow(snapshot, CLAIMED).pages[0]!.leads.find(
      (candidate) => candidate.id === LEAD_POOL,
    );
    expect(row?.sellerPersonId).toBe(PERSON_ID);
    expect(row?.sellerNameSnapshot).toBe('Marina Souza');
    expect(row && leadIsUnassigned(row)).toBe(false);
  });
});

describe.each(LAYOUTS)('LeadsBoard (%s layout)', (fieldSet) => {
  async function renderBoard() {
    await act(async () => {
      root.render(
        <LeadsBoard
          fieldSet={fieldSet}
          leads={[POOL, OWNED, CONVERTED]}
          lookups={LOOKUPS}
          now={NOW}
          onEditLead={vi.fn()}
          onMoveLead={vi.fn()}
          onOpenSale={vi.fn()}
          stages={STAGES}
        />,
      );
    });
  }

  it('marks only the unassigned open card in the Quadro', async () => {
    await renderBoard();
    const card = (id: string) => required(container, `[data-lead-card="${id}"]`);
    expect(required(card(LEAD_POOL), '[data-unassigned-lead]').textContent).toBe(EXACT_LABEL);
    expect(card(LEAD_OWNED).querySelector('[data-unassigned-lead]')).toBeNull();
    expect(card(LEAD_CONVERTED).querySelector('[data-unassigned-lead]')).toBeNull();
  });

  it('shows the same marker in the Lista Vendedor cell, and only there', async () => {
    await renderBoard();
    const listToggle = required(container, '[data-view-option="list"]');
    await act(async () => {
      listToggle.click();
    });
    const row = (id: string) => required(container, `[data-list-row="${id}"]`);

    const markers = row(LEAD_POOL).querySelectorAll('[data-unassigned-lead]');
    expect(markers).toHaveLength(1);
    expect(markers[0]!.textContent).toBe(EXACT_LABEL);
    // Lead, Fase, Produtos|Aniversário, VENDEDOR: the fourth cell in both layouts.
    expect(markers[0]!.closest('td')?.cellIndex).toBe(3);
    expect(hasAvatar(row(LEAD_POOL))).toBe(false);

    expect(row(LEAD_OWNED).querySelector('[data-unassigned-lead]')).toBeNull();
    expect(hasAvatar(row(LEAD_OWNED))).toBe(true);
    expect(row(LEAD_OWNED).textContent).toContain('Marina Souza');

    expect(row(LEAD_CONVERTED).querySelector('[data-unassigned-lead]')).toBeNull();
    expect(row(LEAD_CONVERTED).textContent).toContain('Sem vendedor');
    expect(row(LEAD_CONVERTED).textContent).not.toContain('disponível');
  });
});
