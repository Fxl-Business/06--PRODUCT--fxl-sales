// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeadsBoard } from '../LeadsBoard';
import { LeadsFunnelView } from '../LeadsFunnelView';
import { buildLabelLookups } from '../board-labels';
import { buildLeadFunnel } from '../calculations';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * The sales funnel: the pure `buildLeadFunnel` derivation, the presentational
 * `LeadsFunnelView`, and the third view toggle on the board. Volume and value
 * per stage, with the value share driving the proportion bar.
 */

const NOVO_ID = 'cccccccc-0000-4000-8000-000000000001';
const QUAL_ID = 'cccccccc-0000-4000-8000-000000000002';
const CONV_ID = 'cccccccc-0000-4000-8000-000000000003';
const NOW = new Date('2026-09-21T12:00:00.000Z');

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

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

const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });

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

// Novo 300k (2 leads), Qualificado 300k (1 lead), Proposta empty.
const LEADS = [
  lead('l1', NOVO_ID, 100_000),
  lead('l2', NOVO_ID, 200_000, { position: 2 }),
  lead('l3', QUAL_ID, 300_000),
];

describe('buildLeadFunnel', () => {
  it('counts leads and sums value per stage, with value shares', () => {
    const funnel = buildLeadFunnel(LEADS, STAGES);
    expect(funnel.rows.map((row) => [row.name, row.count, row.totalBrl, row.share])).toEqual([
      ['Novo', 2, 300_000, 50],
      ['Qualificado', 1, 300_000, 50],
      ['Proposta', 0, 0, 0],
    ]);
    expect(funnel.totalCount).toBe(3);
    expect(funnel.totalBrl).toBe(600_000);
  });

  it('drops archived stages and keeps board order', () => {
    const withArchived = [...STAGES, stage('zzz', 'Antiga', 'normal', 0)].map((s) =>
      s.id === 'zzz' ? { ...s, status: 'archived' as const } : s,
    );
    const funnel = buildLeadFunnel(LEADS, withArchived);
    expect(funnel.rows.map((row) => row.name)).toEqual(['Novo', 'Qualificado', 'Proposta']);
  });

  it('shares are all zero when no lead carries a value (volume still counts)', () => {
    const noValue = LEADS.map((row) => ({ ...row, estimatedValueBrl: 0 }));
    const funnel = buildLeadFunnel(noValue, STAGES);
    expect(funnel.rows.every((row) => row.share === 0)).toBe(true);
    expect(funnel.totalCount).toBe(3);
    expect(funnel.totalBrl).toBe(0);
  });
});

describe('LeadsFunnelView', () => {
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
  });

  async function render(node: React.ReactElement) {
    await act(async () => root.render(node));
  }

  async function click(el: Element) {
    await act(async () =>
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    );
  }

  it('defaults to Faturamento: bar width tapers by the largest stage value', async () => {
    await render(<LeadsFunnelView leads={LEADS} stages={STAGES} />);
    expect(container.querySelector('[data-leads-funnel]')?.getAttribute('data-funnel-metric')).toBe(
      'value',
    );
    expect([...container.querySelectorAll('[data-funnel-row]')]).toHaveLength(3);

    const novo = container.querySelector(`[data-funnel-row="${NOVO_ID}"]`)!;
    // Largest value stage (300k of a 300k max) => full-width bar; share is of the sum.
    expect((novo.querySelector('[data-funnel-bar]') as HTMLElement).style.width).toBe('100%');
    expect(novo.querySelector('[data-funnel-share]')?.textContent).toBe('50% do total');
    expect(novo.querySelector('[data-funnel-primary]')?.textContent).toContain('3.000');
    expect(novo.querySelector('[data-funnel-secondary]')?.textContent).toContain('2 leads');

    const conv = container.querySelector(`[data-funnel-row="${CONV_ID}"]`)!;
    expect((conv.querySelector('[data-funnel-bar]') as HTMLElement).style.width).toBe('0%');
    expect(conv.querySelector('[data-funnel-share]')?.textContent).toBe('0% do total');
  });

  it('switches to Volume: bars and shares size by lead count', async () => {
    await render(<LeadsFunnelView leads={LEADS} stages={STAGES} />);
    await click(container.querySelector('[data-funnel-metric-option="volume"]')!);
    expect(container.querySelector('[data-leads-funnel]')?.getAttribute('data-funnel-metric')).toBe(
      'volume',
    );

    const novo = container.querySelector(`[data-funnel-row="${NOVO_ID}"]`)!;
    // Max count is 2 (Novo) => full width; Qualificado has 1 => 50%.
    expect((novo.querySelector('[data-funnel-bar]') as HTMLElement).style.width).toBe('100%');
    expect(novo.querySelector('[data-funnel-primary]')?.textContent).toBe('2 leads');
    expect(novo.querySelector('[data-funnel-share]')?.textContent).toBe('67% do total');

    const qual = container.querySelector(`[data-funnel-row="${QUAL_ID}"]`)!;
    expect((qual.querySelector('[data-funnel-bar]') as HTMLElement).style.width).toBe('50%');
  });

  it('shows the funnel grand totals in the footer', async () => {
    await render(<LeadsFunnelView leads={LEADS} stages={STAGES} />);
    expect(container.querySelector('[data-funnel-grand-count]')?.textContent).toBe('3 leads');
    expect(container.querySelector('[data-funnel-grand-total]')?.textContent).toContain('6.000');
  });

  it('shows an empty-state when there are no stages', async () => {
    await render(<LeadsFunnelView leads={[]} stages={[]} />);
    expect(container.querySelector('[data-funnel-row]')).toBeNull();
    expect(container.textContent).toContain('Nenhuma etapa no funil.');
  });
});

describe('LeadsBoard funnel toggle', () => {
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
  });

  it('switches to the funnel view and back', async () => {
    await act(async () =>
      root.render(
        <LeadsBoard
          leads={LEADS}
          lookups={LOOKUPS}
          now={NOW}
          onMoveLead={() => undefined}
          stages={STAGES}
        />,
      ),
    );
    // Board first: no funnel surface.
    expect(container.querySelector('[data-leads-funnel]')).toBeNull();

    const funnelTab = container.querySelector('[data-view-option="funnel"]');
    expect(funnelTab?.textContent).toContain('Funil');
    await act(async () =>
      funnelTab!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector('[data-leads-funnel]')).not.toBeNull();
    expect(container.querySelector('[data-funnel-footer]')).not.toBeNull();

    const boardTab = container.querySelector('[data-view-option="board"]');
    await act(async () =>
      boardTab!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    );
    expect(container.querySelector('[data-leads-funnel]')).toBeNull();
  });
});
