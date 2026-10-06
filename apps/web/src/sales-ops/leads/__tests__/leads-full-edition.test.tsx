// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadCard } from '../LeadCard';
import { LeadDialog } from '../LeadDialog';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups } from '../board-labels';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * FXL ORACLES. The full edition renders exactly today's UI: the leads board and
 * card produce IDENTICAL markup with `fieldSet` omitted and `fieldSet="full"`,
 * and every money figure, product chip and empresa label is still there.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const NOVO_ID = 'cccccccc-0000-4000-8000-000000000001';
const QUAL_ID = 'cccccccc-0000-4000-8000-000000000002';
const CONV_ID = 'cccccccc-0000-4000-8000-000000000003';
const PRODUCT_ID = 'e0000000-0000-4000-8000-000000000001';

const NOW = new Date('2026-09-21T12:00:00.000Z');
const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });

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

const STAGES: SalesOpsLeadStage[] = [
  stage(NOVO_ID, 'Novo', 'normal', 1),
  stage(QUAL_ID, 'Qualificado', 'normal', 2),
  stage(CONV_ID, 'Proposta', 'conversion', 3),
];

function lead(id: string, stageId: string, value: number, patch: Partial<SalesOpsLead> = {}) {
  return {
    id,
    stageId,
    position: 1,
    contactName: `Contato ${id}`,
    clientId: null,
    clientNameSnapshot: 'Acme',
    estimatedValueBrl: value,
    description: null,
    contactPhone: null,
    contactEmail: null,
    contactBirthDate: null,
    sellerPersonId: null,
    sellerNameSnapshot: 'Marina Souza',
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

const LEADS = [
  lead('l1', NOVO_ID, 100_000, {
    products: [{ productId: PRODUCT_ID, productNameSnapshot: 'FXL Custom' }],
  }),
  lead('l2', NOVO_ID, 200_000, { position: 2 }),
  lead('l3', QUAL_ID, 500_000),
  lead('l4', CONV_ID, 900_000, { saleId: 'sale-1', saleStatus: 'won', saleCode: '0001-1' }),
];

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

// Stable callbacks, so both renders hand the board the same props.
const handlers = {
  onCreateLead: vi.fn(),
  onEditLead: vi.fn(),
  onMoveLead: vi.fn(),
  onOpenSale: vi.fn(),
  onRequestConversion: vi.fn(async () => null),
};

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

async function click(selector: string) {
  const node = container.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`not rendered: ${selector}`);
  await act(async () => {
    node.click();
  });
}

/**
 * dnd-kit numbers its accessibility nodes per mount (`DndDescribedBy-0`, then
 * `-1`), so two mounts differ in that counter alone. It is not markup we own.
 */
function normalized(html: string): string {
  return html.replace(/(DndDescribedBy|DndLiveRegion)-\d+/g, '$1-N');
}

async function boardMarkup(fieldSet: 'full' | undefined, stages = STAGES) {
  await render(
    <LeadsBoard
      key={String(fieldSet)}
      leads={LEADS}
      lookups={LOOKUPS}
      now={NOW}
      stages={stages}
      {...handlers}
      {...(fieldSet ? { fieldSet } : {})}
    />,
  );
  const board = normalized(container.innerHTML);
  await click('[data-view-option="list"]');
  const list = normalized(container.innerHTML);
  return { board, list };
}

describe('full edition renders today markup', () => {
  it('LeadsBoard is identical with fieldSet omitted and full, in the Quadro and the Lista', async () => {
    const omitted = await boardMarkup(undefined);
    const full = await boardMarkup('full');
    expect(full.board).toBe(omitted.board);
    expect(full.list).toBe(omitted.list);
    expect(omitted.board).not.toBe(omitted.list);
  });

  it('LeadCard is identical with fieldSet omitted and full', async () => {
    await render(<LeadCard key="a" lead={LEADS[0]!} lookups={LOOKUPS} now={NOW} />);
    const omitted = container.innerHTML;
    await render(<LeadCard fieldSet="full" key="b" lead={LEADS[0]!} lookups={LOOKUPS} now={NOW} />);
    expect(container.innerHTML).toBe(omitted);
  });

  it('keeps every money figure, share bar, empresa and product chip', async () => {
    await render(
      <LeadsBoard leads={LEADS} lookups={LOOKUPS} now={NOW} stages={STAGES} {...handlers} />,
    );
    const text = container.textContent ?? '';
    expect(container.querySelector('[data-stage-total]')?.textContent).toContain('R$');
    expect(text).toContain('% do total');
    expect(container.querySelector('[data-stage-bar]')).not.toBeNull();
    expect(text).toContain('Acme');
    expect(text).toContain('FXL Custom');
    expect(container.querySelector('[data-lead-contact]')).toBeNull();

    await click('[data-view-option="list"]');
    const headers = [...container.querySelectorAll('[data-leads-list] th')].map((n) =>
      n.textContent?.trim(),
    );
    expect(headers).toContain('Produtos');
    expect(headers).toContain('Valor estimado');
    expect(container.querySelector('[data-phase-chip=""]')?.textContent).toContain('R$');
    expect(container.querySelector('[data-leads-list]')?.textContent).toContain('TOTAL');
    expect(container.querySelector('[data-list-total]')).not.toBeNull();
  });

  it('with zero etapas shows no empty-state and keeps Novo lead enabled', async () => {
    await render(
      <LeadsBoard leads={[]} lookups={LOOKUPS} now={NOW} stages={[]} {...handlers} />,
    );
    expect(container.querySelector('[data-no-stages]')).toBeNull();
    const create = [...container.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === 'Novo lead',
    );
    expect(create?.disabled).toBe(false);
    expect(create?.hasAttribute('disabled')).toBe(false);
  });

  it('LeadDialog still asks for empresa, produtos and valor', async () => {
    await render(
      <LeadDialog
        clients={[]}
        initial={null}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        products={[]}
        sellers={[]}
      />,
    );
    const text = document.querySelector('[role="dialog"]')?.textContent ?? '';
    expect(text).toContain('Empresa (texto livre)');
    expect(text).toContain('Produtos em negociação');
    expect(text).toContain('Valor estimado (R$)');
  });
});
