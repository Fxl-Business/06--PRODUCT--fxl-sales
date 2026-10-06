// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadCard } from '../LeadCard';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups } from '../board-labels';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * The leads edition's contact board (`fieldSet="contact"`): contact data on the
 * card and in the Lista, no R$ figure anywhere, and the zero-etapas empty-state.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const PRIMEIRO_ID = 'cccccccc-0000-4000-8000-000000000001';
const RETORNO_ID = 'cccccccc-0000-4000-8000-000000000002';
const LEAD_ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEAD_BRUNO = 'aaaaaaaa-0000-4000-8000-000000000002';
const LEAD_CAIO = 'aaaaaaaa-0000-4000-8000-000000000003';
const SELLER_ID = 'd0000000-0000-4000-8000-000000000001';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });

function stage(
  id: string,
  name: string,
  position: number,
  status: SalesOpsLeadStage['status'] = 'active',
): SalesOpsLeadStage {
  return {
    id,
    name,
    kind: 'normal',
    position,
    status,
    isSystem: false,
    archivedAt: status === 'archived' ? '2026-09-30T12:00:00.000Z' : null,
    orgId: 'org-1',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

const STAGES = [stage(PRIMEIRO_ID, 'Primeiro contato', 1), stage(RETORNO_ID, 'Retorno', 2)];

function lead(id: string, stageId: string, patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id,
    stageId,
    position: 1,
    contactName: 'Ana Construbom',
    clientId: null,
    clientNameSnapshot: '',
    estimatedValueBrl: 0,
    description: null,
    contactPhone: '(11) 98888-7777',
    contactEmail: 'ana@construbom.com.br',
    contactBirthDate: '1990-02-28',
    sellerPersonId: SELLER_ID,
    sellerNameSnapshot: 'Rafael Lima',
    lostReason: null,
    stageChangedAt: '2026-10-01T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const LEADS = [
  lead(LEAD_ANA, PRIMEIRO_ID),
  lead(LEAD_BRUNO, PRIMEIRO_ID, {
    position: 2,
    contactName: 'Bruno Sem Contato',
    contactPhone: null,
    contactEmail: null,
    contactBirthDate: null,
  }),
  lead(LEAD_CAIO, RETORNO_ID, {
    contactName: 'Caio Retorno',
    contactPhone: null,
    contactEmail: 'caio@x.com',
    contactBirthDate: '1985-12-01',
  }),
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

type BoardOverrides = Partial<React.ComponentProps<typeof LeadsBoard>>;

async function renderBoard(overrides: BoardOverrides = {}) {
  await act(async () => {
    root.render(
      <LeadsBoard
        fieldSet="contact"
        leads={LEADS}
        lookups={LOOKUPS}
        now={NOW}
        onCreateLead={vi.fn()}
        onEditLead={vi.fn()}
        onMoveLead={vi.fn()}
        stages={STAGES}
        {...overrides}
      />,
    );
  });
}

function required(selector: string): HTMLElement {
  const node = container.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`not rendered: ${selector}`);
  return node;
}

async function click(selector: string) {
  const node = required(selector);
  await act(async () => {
    node.click();
  });
}

function newLeadButton(): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === 'Novo lead',
  );
  if (!match) throw new Error('Novo lead not rendered');
  return match;
}

function boardText(): string {
  return container.textContent ?? '';
}

describe('contact board, Quadro', () => {
  it('shows phone, email and birthday on the card', async () => {
    await renderBoard();
    const card = required(`[data-lead-card="${LEAD_ANA}"]`);
    expect(card.querySelector('[data-lead-contact]')?.textContent).toBe(
      '(11) 98888-7777 · ana@construbom.com.br',
    );
    expect(card.querySelector('[data-lead-birthday]')?.textContent).toBe('Aniversário 28/02/1990');
  });

  it('says Sem contato and shows no birthday for a lead without contact data', async () => {
    await renderBoard();
    const card = required(`[data-lead-card="${LEAD_BRUNO}"]`);
    expect(card.querySelector('[data-lead-contact]')?.textContent).toBe('Sem contato');
    expect(card.querySelector('[data-lead-birthday]')).toBeNull();
  });

  it('shows no money, share or empresa anywhere', async () => {
    await renderBoard();
    expect(boardText()).not.toContain('R$');
    expect(boardText()).not.toContain('% do total');
    expect(boardText()).not.toContain('Sem empresa');
    expect(container.querySelector('[data-stage-total]')).toBeNull();
    expect(container.querySelector('[data-stage-bar]')).toBeNull();
    const counts = [...container.querySelectorAll('[data-stage-count]')].map((n) => n.textContent);
    expect(counts).toEqual(['2', '1']);
  });

  it('renders no raw id', async () => {
    await renderBoard();
    for (const id of [PRIMEIRO_ID, RETORNO_ID, LEAD_ANA, LEAD_BRUNO, LEAD_CAIO, SELLER_ID]) {
      expect(boardText()).not.toContain(id);
    }
  });

  it('enables Novo lead and shows no empty-state while etapas exist', async () => {
    await renderBoard();
    expect(newLeadButton().disabled).toBe(false);
    expect(container.querySelector('[data-no-stages]')).toBeNull();
  });
});

describe('contact board, Lista', () => {
  it('uses the contact headers', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const headers = [...container.querySelectorAll('[data-leads-list] th')].map((n) =>
      n.textContent?.trim(),
    );
    expect(headers).toEqual(['Lead', 'Fase', 'Aniversário', 'Vendedor', 'Na fase', 'Ações']);
    const list = required('[data-leads-list]').textContent ?? '';
    expect(list).not.toContain('Valor estimado');
    expect(list).not.toContain('Produtos');
  });

  it('shows the contact line and the birthday per row', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const row = (id: string) => required(`[data-list-row="${id}"]`);
    expect(row(LEAD_ANA).querySelector('[data-row-contact]')?.textContent).toBe(
      '(11) 98888-7777 · ana@construbom.com.br',
    );
    expect(row(LEAD_ANA).querySelector('[data-row-birthday]')?.textContent).toBe('28/02/1990');
    expect(row(LEAD_BRUNO).querySelector('[data-row-contact]')?.textContent).toBe('Sem contato');
    expect(row(LEAD_BRUNO).querySelector('[data-row-birthday]')?.textContent).toBe('-');
    expect(row(LEAD_CAIO).querySelector('[data-row-contact]')?.textContent).toBe('caio@x.com');
    expect(row(LEAD_CAIO).querySelectorAll('td')).toHaveLength(6);
  });

  it('phase chips keep their counts and lose their R$', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const chips = [...container.querySelectorAll('[data-phase-chip]')];
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip.querySelector('[data-phase-count]')).not.toBeNull();
      expect(chip.textContent).not.toContain('R$');
    }
    expect(required('[data-phase-chip=""] [data-phase-count]').textContent).toBe('3');
  });

  it('the footer counts leads and shows no total', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const list = required('[data-leads-list]');
    expect(list.textContent).toContain('Todas as fases · 3 leads');
    expect(list.textContent).not.toContain('TOTAL');
    expect(list.querySelector('[data-list-total]')).toBeNull();
    expect(boardText()).not.toContain('R$');
  });

  it('an empty phase spans the six contact columns', async () => {
    await renderBoard({ leads: [] });
    await click('[data-view-option="list"]');
    expect(required('[data-leads-list] td[colspan]').getAttribute('colspan')).toBe('6');
  });

  it('renders no raw id', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    for (const id of [PRIMEIRO_ID, RETORNO_ID, LEAD_ANA, LEAD_BRUNO, LEAD_CAIO, SELLER_ID]) {
      expect(boardText()).not.toContain(id);
    }
  });
});

describe('contact board with no active etapa', () => {
  it('shows the gestor empty-state with the Etapas action', async () => {
    const onOpenStagesCadastro = vi.fn();
    await renderBoard({ stages: [], leads: [], canManageStages: true, onOpenStagesCadastro });

    expect(required('[data-no-stages="admin"]').textContent).toContain(
      'Nenhuma etapa configurada. Crie as etapas do funil em Cadastros.',
    );
    expect(container.querySelector('[data-stage-column]')).toBeNull();
    expect(newLeadButton().disabled).toBe(true);

    const action = required('[data-open-stages-cadastro]');
    expect(action.textContent).toBe('Ir para Etapas do funil');
    await click('[data-open-stages-cadastro]');
    expect(onOpenStagesCadastro).toHaveBeenCalledTimes(1);
  });

  it('shows the vendedor copy with no action', async () => {
    await renderBoard({
      stages: [],
      leads: [],
      canManageStages: false,
      onOpenStagesCadastro: vi.fn(),
    });
    expect(required('[data-no-stages="seller"]').textContent).toBe(
      'Nenhuma etapa configurada. Fale com o gestor.',
    );
    expect(container.querySelector('[data-open-stages-cadastro]')).toBeNull();
    expect(newLeadButton().disabled).toBe(true);
  });

  it('treats only archived etapas as none', async () => {
    await renderBoard({
      stages: [stage(PRIMEIRO_ID, 'Primeiro contato', 1, 'archived')],
      leads: [],
      canManageStages: true,
    });
    expect(container.querySelector('[data-no-stages="admin"]')).not.toBeNull();
    expect(newLeadButton().disabled).toBe(true);
  });

  it('keeps the empty-state in the Lista too', async () => {
    await renderBoard({ stages: [], leads: [], canManageStages: true });
    await click('[data-view-option="list"]');
    expect(container.querySelector('[data-no-stages]')).not.toBeNull();
    expect(container.querySelector('[data-leads-list]')).toBeNull();
  });
});

describe('contact LeadCard keeps the drag guard', () => {
  async function renderCard(onEdit: ReturnType<typeof vi.fn>) {
    await act(async () => {
      root.render(
        <LeadCard fieldSet="contact" lead={LEADS[0]!} lookups={LOOKUPS} now={NOW} onEdit={onEdit} />,
      );
    });
    return required(`[data-lead-card="${LEAD_ANA}"]`);
  }

  async function pointer(card: HTMLElement, type: 'pointerdown' | 'click', x: number) {
    await act(async () => {
      card.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: x }));
    });
  }

  it('a click after a drag does not edit', async () => {
    const onEdit = vi.fn();
    const card = await renderCard(onEdit);
    await pointer(card, 'pointerdown', 0);
    await pointer(card, 'click', 20);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('a click in place edits once', async () => {
    const onEdit = vi.fn();
    const card = await renderCard(onEdit);
    await pointer(card, 'pointerdown', 0);
    await pointer(card, 'click', 0);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
