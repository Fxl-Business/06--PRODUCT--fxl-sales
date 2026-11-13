// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups } from '../board-labels';
import { stageIsLost } from '../board-ui';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * A lead that leaves Perdido keeps its stored lost reason (the server omits the key on any other
 * destination), so the card shows the reason only while it sits in a lost stage.
 */

const NOVO_ID = 'dddddddd-0000-4000-8000-000000000001';
const FATURADA_ID = 'dddddddd-0000-4000-8000-000000000002';
const PERDIDO_ID = 'dddddddd-0000-4000-8000-000000000003';

const NOW = new Date('2026-11-13T12:00:00.000Z');

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

function stage(
  id: string,
  name: string,
  kind: SalesOpsLeadStage['kind'],
  position: number,
  patch: Partial<SalesOpsLeadStage> = {},
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
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const STAGES: SalesOpsLeadStage[] = [
  stage(NOVO_ID, 'Novo', 'normal', 1),
  stage(FATURADA_ID, 'Venda faturada', 'normal', 2),
  stage(PERDIDO_ID, 'Perdido', 'lost', 3, { type: 'saida', exitKind: 'perdido' }),
];

function lead(id: string, stageId: string, lostReason: string | null): SalesOpsLead {
  return {
    id,
    stageId,
    position: 1,
    contactName: `Contato ${id}`,
    clientId: null,
    clientNameSnapshot: 'Acme',
    estimatedValueBrl: 100_000,
    description: null,
    contactPhone: null,
    contactEmail: null,
    contactBirthDate: null,
    sellerPersonId: null,
    sellerNameSnapshot: 'Marina Souza',
    lostReason,
    stageChangedAt: '2026-11-10T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-11-01T12:00:00.000Z',
    updatedAt: null,
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
  document.body.innerHTML = '';
});

const column = (id: string) =>
  container.querySelector<HTMLElement>(`[data-stage-column="${id}"]`) as HTMLElement;

describe('the stored lost reason on the card', () => {
  it('shows only in the lost column, not on a lead that left Perdido', async () => {
    await act(async () => {
      root.render(
        <LeadsBoard
          leads={[lead('l1', PERDIDO_ID, 'Sem orçamento'), lead('l2', FATURADA_ID, 'Escolheu outro fornecedor')]}
          lookups={buildLabelLookups({ clients: [], people: [], products: [] })}
          now={NOW}
          onMoveLead={vi.fn()}
          stages={STAGES}
        />,
      );
    });
    expect(column(PERDIDO_ID).querySelector('[data-lost-reason-note]')?.textContent).toBe('Sem orçamento');
    expect(column(FATURADA_ID).textContent).toContain('Contato l2');
    expect(column(FATURADA_ID).querySelector('[data-lost-reason-note]')).toBeNull();
    expect(container.textContent).not.toContain('Escolheu outro fornecedor');
  });

  it('stageIsLost reads the pipeline exit first and the legacy kind otherwise', () => {
    expect(stageIsLost({ kind: 'lost' })).toBe(true);
    expect(stageIsLost({ kind: 'normal', type: 'saida', exitKind: 'perdido' })).toBe(true);
    expect(stageIsLost({ kind: 'normal', type: 'saida', exitKind: 'ganho' })).toBe(false);
    expect(stageIsLost({ kind: 'normal', type: 'saida', exitKind: 'pausado' })).toBe(false);
    expect(stageIsLost({ kind: 'normal', type: 'normal' })).toBe(false);
    expect(stageIsLost({ kind: 'conversion', type: 'orcamento' })).toBe(false);
  });
});
