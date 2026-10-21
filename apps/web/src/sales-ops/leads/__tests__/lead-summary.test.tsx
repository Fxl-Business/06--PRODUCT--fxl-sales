// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadSummaryResponse } from '../crm-types';
import { LeadSummary } from '../LeadSummary';
import type { SalesOpsLead } from '../types';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const LEAD_ID = '0f6c2a8e-6f1d-4c1e-9a3b-2d5f7e8a9b10';
const NOW = new Date('2026-10-21T15:00:00.000Z');
const TODAY = '2026-10-21';

function lead(overrides: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id: LEAD_ID, stageId: 'stage-contato', position: 1, contactName: 'Ana Souza', clientId: null,
    clientNameSnapshot: 'Acme', estimatedValueBrl: 150_000, description: null, contactPhone: '11999990000',
    contactEmail: 'ana@example.com', contactBirthDate: null, sellerPersonId: null, sellerNameSnapshot: 'Marina',
    lostReason: null, stageChangedAt: '2026-10-18T12:00:00.000Z', saleId: null, saleStatus: null, saleCode: null,
    products: [], createdAt: '2026-10-01T12:00:00.000Z', updatedAt: null,
    fields: [],
    ...overrides,
  } as unknown as SalesOpsLead;
}

function summary(overrides: Partial<LeadSummaryResponse> = {}): LeadSummaryResponse {
  return {
    lead: lead(),
    pipeline: { id: 'pipe-1', name: 'Funil padrão' },
    stage: { id: 'stage-contato', name: 'Contato', type: 'normal', exitKind: null },
    nextStages: [{ id: 'stage-proposta', name: 'Proposta', type: 'normal', exitKind: null, requiresReason: false }],
    timeline: [
      { kind: 'note', at: '2026-10-19T10:00:00.000Z', actorName: 'Marina', body: 'Nota antiga' },
      { kind: 'stage_changed', at: '2026-10-20T10:00:00.000Z', actorName: null, fromStageName: null, toStageName: 'Contato' },
    ],
    followups: [
      { id: 'fu-2', nextStep: 'Mandar tabela', dueOn: '2026-10-25', ownerName: 'Marina', doneAt: null },
      { id: 'fu-1', nextStep: 'Ligar de novo', dueOn: '2026-10-19', ownerName: null, doneAt: null },
      { id: 'fu-3', nextStep: 'Já feito', dueOn: '2026-10-10', ownerName: null, doneAt: '2026-10-10T10:00:00.000Z' },
    ],
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root | null;

async function render(props: Partial<React.ComponentProps<typeof LeadSummary>> = {}) {
  root = createRoot(container);
  await act(async () => root?.render(
    <LeadSummary
      definitions={[]}
      now={NOW}
      onBack={vi.fn()}
      onEdit={vi.fn()}
      summary={summary()}
      today={TODAY}
      {...props}
    />,
  ));
}
const q = (selector: string) => container.querySelector(selector);

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
});

describe('LeadSummary', () => {
  it('shows the stage, the pipeline, the data rows, the open follow-ups and the newest-first timeline', async () => {
    await render();
    expect(q('[data-summary-stage]')?.textContent).toBe('Contato');
    expect(container.textContent).toContain('Funil padrão');
    expect(q('[data-summary-section="dados"]')?.textContent).toContain('Acme');
    expect(q('[data-summary-section="dados"]')?.textContent).toContain('R$ 1.500,00');
    expect(q('[data-summary-section="dados"]')?.textContent).toContain('Sem vendedor');

    const followups = [...container.querySelectorAll('[data-followup-state]')].map((node) => node.textContent);
    expect(followups).toEqual(['Atrasado', 'Agendado']);
    expect(container.textContent).not.toContain('Já feito');
    expect(q('[data-followup-state="overdue"]')?.textContent).toBe('Atrasado');

    const kinds = [...container.querySelectorAll('[data-timeline-kind]')].map((node) => node.getAttribute('data-timeline-kind'));
    expect(kinds).toEqual(['stage_changed', 'note']);
    expect(container.querySelector('[data-timeline-kind="note"]')?.textContent).toContain('Marina');
    expect(container.querySelector('[data-timeline-kind="stage_changed"]')?.textContent).toContain('Autor não identificado');
  });

  it('renders Avançar only with onAdvance, and disables it when there is no next stage', async () => {
    await render();
    expect(q('[data-summary-advance]')).toBeNull();

    await render({ onAdvance: vi.fn() });
    expect((q('[data-summary-advance]') as HTMLButtonElement).disabled).toBe(false);

    await act(async () => root?.render(
      <LeadSummary definitions={[]} now={NOW} onBack={vi.fn()} onEdit={vi.fn()} onAdvance={vi.fn()}
        summary={summary({ nextStages: [] })} today={TODAY} />,
    ));
    expect((q('[data-summary-advance]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows Abrir proposta, and neither Editar nor Avançar, for a converted lead', async () => {
    root = createRoot(container);
    await act(async () => root?.render(
      <LeadSummary
        definitions={[]} now={NOW} onBack={vi.fn()} onEdit={vi.fn()} onAdvance={vi.fn()} onOpenSale={vi.fn()}
        summary={summary({ lead: lead({ saleId: 'sale-1', saleCode: 'P-0042' }) })} today={TODAY}
      />,
    ));
    expect(q('[data-summary-open-sale]')?.textContent).toBe('Abrir proposta P-0042');
    expect(q('[data-summary-edit]')).toBeNull();
    expect(q('[data-summary-advance]')).toBeNull();
  });

  it('never renders a raw id as text', async () => {
    await render();
    expect(container.textContent).not.toContain(LEAD_ID);
    expect(container.textContent).not.toContain('stage-contato');
    expect(container.textContent).not.toContain('pipe-1');
  });
});
