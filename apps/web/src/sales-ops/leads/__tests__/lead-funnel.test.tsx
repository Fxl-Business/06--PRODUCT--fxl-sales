// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LeadsBoard } from '../LeadsBoard';
import { LeadsFunnelView } from '../LeadsFunnelView';
import { buildLabelLookups } from '../board-labels';
import { aggregatesFromLeads, buildCumulativeFunnel, buildLeadFunnel } from '../calculations';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * The sales funnel: the pure `buildLeadFunnel` derivation, the presentational
 * `LeadsFunnelView`, and the third view toggle on the board. Volume and value
 * per stage, with the value share driving the proportion bar.
 *
 * The builders read per-stage aggregates. These cases feed them `aggregatesFromLeads`,
 * the board's loaded-cards fallback, so every number below is also the fallback's
 * number; the server-summary path is pinned by `lead-board-totals.test.tsx`.
 */

const NOVO_ID = 'cccccccc-0000-4000-8000-000000000001';
const QUAL_ID = 'cccccccc-0000-4000-8000-000000000002';
const CONV_ID = 'cccccccc-0000-4000-8000-000000000003';
const LOST_ID = 'cccccccc-0000-4000-8000-000000000004';
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
    const funnel = buildLeadFunnel(aggregatesFromLeads(LEADS), STAGES);
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
    const funnel = buildLeadFunnel(aggregatesFromLeads(LEADS), withArchived);
    expect(funnel.rows.map((row) => row.name)).toEqual(['Novo', 'Qualificado', 'Proposta']);
  });

  it('ignores aggregates for a stage the board does not draw', () => {
    const aggregates = aggregatesFromLeads(LEADS);
    aggregates.set('zzz', { count: 9, totalBrl: 900_000 });
    const funnel = buildLeadFunnel(aggregates, STAGES);
    expect(funnel.totalCount).toBe(3);
    expect(funnel.totalBrl).toBe(600_000);
    expect(funnel.rows.some((row) => row.stageId === 'zzz')).toBe(false);
  });

  it('shares are all zero when no lead carries a value (volume still counts)', () => {
    const noValue = LEADS.map((row) => ({ ...row, estimatedValueBrl: 0 }));
    const funnel = buildLeadFunnel(aggregatesFromLeads(noValue), STAGES);
    expect(funnel.rows.every((row) => row.share === 0)).toBe(true);
    expect(funnel.totalCount).toBe(3);
    expect(funnel.totalBrl).toBe(0);
  });
});

// A board with a terminal lost stage after the conversion stage.
const STAGES_WITH_LOST: SalesOpsLeadStage[] = [
  stage(NOVO_ID, 'Novo', 'normal', 1),
  stage(QUAL_ID, 'Qualificado', 'normal', 2),
  stage(CONV_ID, 'Proposta', 'conversion', 3),
  stage(LOST_ID, 'Perdido', 'lost', 4),
];

describe('buildCumulativeFunnel', () => {
  it('accumulates a lead into every earlier stage, tapering monotonically from the top', () => {
    const funnel = buildCumulativeFunnel(aggregatesFromLeads(LEADS), STAGES);
    // Novo = 2+1+0, Qualificado = 1+0, Proposta = 0.
    expect(funnel.rows.map((row) => [row.name, row.count, row.totalBrl])).toEqual([
      ['Novo', 3, 600_000],
      ['Qualificado', 1, 300_000],
      ['Proposta', 0, 0],
    ]);
    expect(funnel.topCount).toBe(3);
    expect(funnel.topBrl).toBe(600_000);
    expect(funnel.lost).toBeNull();
    // The whole point of a funnel: never wider as you go down.
    const counts = funnel.rows.map((row) => row.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    const values = funnel.rows.map((row) => row.totalBrl);
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('keeps Perdido out of the progression and surfaces it as a separate aside', () => {
    const leadsWithLost = [
      lead('l1', NOVO_ID, 100_000),
      lead('l2', NOVO_ID, 200_000, { position: 2 }),
      lead('l3', QUAL_ID, 300_000),
      lead('l5', CONV_ID, 80_000, { saleId: 'sale-1', saleStatus: 'won' }),
      lead('l4', LOST_ID, 500_000, { lostReason: 'Sem orçamento' }),
    ];
    const funnel = buildCumulativeFunnel(aggregatesFromLeads(leadsWithLost), STAGES_WITH_LOST);
    // Progression excludes Perdido; the converted lead sits in the bottom row.
    expect(funnel.rows.map((row) => [row.name, row.count, row.totalBrl])).toEqual([
      ['Novo', 4, 680_000],
      ['Qualificado', 2, 380_000],
      ['Proposta', 1, 80_000],
    ]);
    expect(funnel.rows.some((row) => row.kind === 'lost')).toBe(false);
    expect(funnel.lost).toEqual({
      stageId: LOST_ID,
      name: 'Perdido',
      count: 1,
      totalBrl: 500_000,
    });
    expect(funnel.topCount).toBe(4);
    expect(funnel.topBrl).toBe(680_000);
  });

  it('drops archived stages and keeps board order', () => {
    const withArchived = [...STAGES, stage('zzz', 'Antiga', 'normal', 0)].map((s) =>
      s.id === 'zzz' ? { ...s, status: 'archived' as const } : s,
    );
    const funnel = buildCumulativeFunnel(aggregatesFromLeads(LEADS), withArchived);
    expect(funnel.rows.map((row) => row.name)).toEqual(['Novo', 'Qualificado', 'Proposta']);
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

  it('defaults to the cumulative (Acumulado) shape, tapering from a full-width top', async () => {
    await render(<LeadsFunnelView aggregates={aggregatesFromLeads(LEADS)} stages={STAGES} />);
    expect(container.querySelector('[data-leads-funnel]')?.getAttribute('data-funnel-shape')).toBe(
      'cumulative',
    );
    expect(container.querySelector('[data-leads-funnel]')?.getAttribute('data-funnel-metric')).toBe(
      'value',
    );
    expect([...container.querySelectorAll('[data-funnel-row]')]).toHaveLength(3);

    const novo = container.querySelector(`[data-funnel-row="${NOVO_ID}"]`)!;
    // Cumulative top (600k of a 600k top) => full width; share is of the top.
    expect((novo.querySelector('[data-funnel-bar]') as HTMLElement).style.width).toBe('100%');
    expect(novo.querySelector('[data-funnel-share]')?.textContent).toBe('100% do topo');
    expect(novo.querySelector('[data-funnel-primary]')?.textContent).toContain('6.000');
    expect(novo.querySelector('[data-funnel-secondary]')?.textContent).toContain('3 leads');

    // Qualificado carries 300k of the 600k top => half the funnel still open.
    const qual = container.querySelector(`[data-funnel-row="${QUAL_ID}"]`)!;
    expect((qual.querySelector('[data-funnel-bar]') as HTMLElement).style.width).toBe('50%');
    expect(qual.querySelector('[data-funnel-share]')?.textContent).toBe('50% do topo');
  });

  it('switches to the composition (Composição) shape: each stage sized by its own value', async () => {
    await render(<LeadsFunnelView aggregates={aggregatesFromLeads(LEADS)} stages={STAGES} />);
    await click(container.querySelector('[data-funnel-shape-option="composition"]')!);
    expect(container.querySelector('[data-leads-funnel]')?.getAttribute('data-funnel-shape')).toBe(
      'composition',
    );

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

  it('applies Volume to the cumulative shape: bars and shares size by cumulative lead count', async () => {
    await render(<LeadsFunnelView aggregates={aggregatesFromLeads(LEADS)} stages={STAGES} />);
    await click(container.querySelector('[data-funnel-metric-option="volume"]')!);
    expect(container.querySelector('[data-leads-funnel]')?.getAttribute('data-funnel-metric')).toBe(
      'volume',
    );

    const novo = container.querySelector(`[data-funnel-row="${NOVO_ID}"]`)!;
    // Cumulative top count is 3 (Novo) => full width; Qualificado carries 1 => 33%.
    expect((novo.querySelector('[data-funnel-bar]') as HTMLElement).style.width).toBe('100%');
    expect(novo.querySelector('[data-funnel-primary]')?.textContent).toBe('3 leads');
    expect(novo.querySelector('[data-funnel-share]')?.textContent).toBe('100% do topo');

    const qual = container.querySelector(`[data-funnel-row="${QUAL_ID}"]`)!;
    expect((qual.querySelector('[data-funnel-bar]') as HTMLElement).style.width).toBe('33%');
  });

  it('shows Perdido as an aside in Acumulado and as an ordinary row in Composição', async () => {
    const leadsWithLost = [
      lead('l1', NOVO_ID, 100_000),
      lead('l2', NOVO_ID, 200_000, { position: 2 }),
      lead('l3', QUAL_ID, 300_000),
      lead('l5', CONV_ID, 80_000, { saleId: 'sale-1', saleStatus: 'won' }),
      lead('l4', LOST_ID, 500_000, { lostReason: 'Sem orçamento' }),
    ];
    await render(<LeadsFunnelView aggregates={aggregatesFromLeads(leadsWithLost)} stages={STAGES_WITH_LOST} />);

    // Acumulado (default): Perdido is set apart, never in the taper.
    const aside = container.querySelector('[data-funnel-lost]')!;
    expect(aside).not.toBeNull();
    expect(aside.textContent).toContain('Perdido');
    expect(aside.textContent).toContain('1 lead');
    expect(aside.textContent).toContain('5.000');
    expect(container.querySelector(`[data-funnel-row="${LOST_ID}"]`)).toBeNull();

    // Composição: Perdido returns to the list of stages, aside gone.
    await click(container.querySelector('[data-funnel-shape-option="composition"]')!);
    expect(container.querySelector('[data-funnel-lost]')).toBeNull();
    expect(container.querySelector(`[data-funnel-row="${LOST_ID}"]`)).not.toBeNull();
  });

  it('keeps the funnel grand totals (all leads, Perdido included) across both shapes', async () => {
    const leadsWithLost = [
      lead('l1', NOVO_ID, 100_000),
      lead('l2', NOVO_ID, 200_000, { position: 2 }),
      lead('l3', QUAL_ID, 300_000),
      lead('l5', CONV_ID, 80_000, { saleId: 'sale-1', saleStatus: 'won' }),
      lead('l4', LOST_ID, 500_000, { lostReason: 'Sem orçamento' }),
    ];
    await render(<LeadsFunnelView aggregates={aggregatesFromLeads(leadsWithLost)} stages={STAGES_WITH_LOST} />);
    expect(container.querySelector('[data-funnel-grand-count]')?.textContent).toBe('5 leads');
    expect(container.querySelector('[data-funnel-grand-total]')?.textContent).toContain('11.800');

    await click(container.querySelector('[data-funnel-shape-option="composition"]')!);
    expect(container.querySelector('[data-funnel-grand-count]')?.textContent).toBe('5 leads');
    expect(container.querySelector('[data-funnel-grand-total]')?.textContent).toContain('11.800');
  });

  it('shows the funnel grand totals in the footer', async () => {
    await render(<LeadsFunnelView aggregates={aggregatesFromLeads(LEADS)} stages={STAGES} />);
    expect(container.querySelector('[data-funnel-grand-count]')?.textContent).toBe('3 leads');
    expect(container.querySelector('[data-funnel-grand-total]')?.textContent).toContain('6.000');
  });

  it('shows an empty-state when there are no stages', async () => {
    await render(<LeadsFunnelView aggregates={new Map()} stages={[]} />);
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
