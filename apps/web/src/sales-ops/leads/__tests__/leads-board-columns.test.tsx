// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups, EMPTY_COLUMN_HINT } from '../board-labels';
import { stageColors } from '../board-ui';
import { boardStages } from '../calculations';
import { formatMoneyBrl } from '../../calculations';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

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

// Novo 300k (2 leads), Qualificado 300k (1 lead), Proposta empty: 50% / 50% / 0%.
const LEADS = [
  lead('l1', NOVO_ID, 100_000),
  lead('l2', NOVO_ID, 200_000, { position: 2 }),
  lead('l3', QUAL_ID, 300_000),
];

const brl0 = (c: number) =>
  formatMoneyBrl(c, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

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
  document.body.innerHTML = '';
});

async function renderBoard() {
  await act(async () => {
    root.render(
      <LeadsBoard
        leads={LEADS}
        lookups={LOOKUPS}
        now={NOW}
        onMoveLead={vi.fn()}
        stages={STAGES}
      />,
    );
  });
}

const column = (id: string) =>
  container.querySelector<HTMLElement>(`[data-stage-column="${id}"]`) as HTMLElement;

describe('board column headers', () => {
  it('shows the total and count of every column', async () => {
    await renderBoard();
    expect(column(NOVO_ID).querySelector('[data-stage-total]')?.textContent).toBe(brl0(300_000));
    expect(column(NOVO_ID).querySelector('[data-stage-count]')?.textContent).toBe('2');
    expect(column(QUAL_ID).querySelector('[data-stage-total]')?.textContent).toBe(brl0(300_000));
    expect(column(QUAL_ID).querySelector('[data-stage-count]')?.textContent).toBe('1');
    expect(column(CONV_ID).querySelector('[data-stage-total]')?.textContent).toBe(brl0(0));
    expect(column(CONV_ID).querySelector('[data-stage-count]')?.textContent).toBe('0');
  });

  it('sizes the proportion bar to the share of the total', async () => {
    await renderBoard();
    const width = (id: string) =>
      column(id).querySelector<HTMLElement>('[data-stage-bar]')?.style.width;
    expect(width(NOVO_ID)).toBe('50%');
    expect(width(QUAL_ID)).toBe('50%');
    expect(width(CONV_ID)).toBe('0%');
    expect(column(NOVO_ID).textContent).toContain('50% do total');
  });

  it('paints the dot and the bar with the stage colour', async () => {
    await renderBoard();
    const dot = stageColors(boardStages(STAGES)).get(QUAL_ID)?.dot as string;
    const probe = document.createElement('span');
    probe.style.backgroundColor = dot;
    const expected = probe.style.backgroundColor;
    expect(expected).not.toBe('');
    const bar = column(QUAL_ID).querySelector<HTMLElement>('[data-stage-bar]');
    expect(bar?.style.backgroundColor).toBe(expected);
    const dots = [...column(QUAL_ID).querySelectorAll<HTMLElement>('header span')];
    expect(dots.some((n) => n.style.backgroundColor === expected)).toBe(true);
  });

  it('shows the dashed hint in an empty column only', async () => {
    await renderBoard();
    const empty = column(CONV_ID).querySelector('[data-empty-column]');
    expect(empty?.textContent).toBe(EMPTY_COLUMN_HINT);
    expect(column(NOVO_ID).querySelector('[data-empty-column]')).toBeNull();
    expect(container.textContent).not.toContain('Nenhum lead nesta etapa');
  });

  it('opens the list filtered by the phase from "Ver em lista"', async () => {
    await renderBoard();
    const button = container.querySelector<HTMLElement>(`[data-view-in-list="${QUAL_ID}"]`);
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
    expect(container.querySelector('[data-leads-list]')).not.toBeNull();
    const chip = container.querySelector(`[data-phase-chip="${QUAL_ID}"]`);
    expect(chip?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector(`[data-phase-chip="${NOVO_ID}"]`)?.getAttribute('aria-pressed')).toBe('false');
  });
});
