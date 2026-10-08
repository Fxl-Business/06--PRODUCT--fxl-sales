// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadCard } from '../LeadCard';
import { LeadsBoard } from '../LeadsBoard';
import { buildLabelLookups } from '../board-labels';
import type { LeadStageSummary, SalesOpsLead, SalesOpsLeadStage } from '../types';
import { formatMoneyBrl } from '../../calculations';
import type { SalesOpsClient } from '../../types';

/**
 * The leads edition's board (`fieldSet="contact"`): Nome & Cliente on the card,
 * contact data in the Lista, the same R$ figures as the full edition, and the
 * zero-etapas empty-state.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const PRIMEIRO_ID = 'cccccccc-0000-4000-8000-000000000001';
const RETORNO_ID = 'cccccccc-0000-4000-8000-000000000002';
const LEAD_ANA = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEAD_BRUNO = 'aaaaaaaa-0000-4000-8000-000000000002';
const LEAD_CAIO = 'aaaaaaaa-0000-4000-8000-000000000003';
const SELLER_ID = 'd0000000-0000-4000-8000-000000000001';
const CLIENT_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const UNKNOWN_CLIENT_ID = 'bbbbbbbb-0000-4000-8000-0000000000ff';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const LOOKUPS = buildLabelLookups({
  clients: [{ id: CLIENT_ID, name: 'Construbom Matriz' } as SalesOpsClient],
  people: [],
  products: [],
});
const brl0 = (cents: number) =>
  formatMoneyBrl(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

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

// Loaded totals: Primeiro contato 150_000 (2 leads), Retorno 300_000 (1 lead),
// all 450_000; shares 33% and 67%.
const LEADS = [
  lead(LEAD_ANA, PRIMEIRO_ID, {
    clientId: CLIENT_ID,
    clientNameSnapshot: 'Construbom (nome antigo)',
    estimatedValueBrl: 150_000,
  }),
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
    clientNameSnapshot: 'Obra Caio Ltda',
    estimatedValueBrl: 300_000,
  }),
];

// Summary totals: 9_300_000 and 13 leads; shares round to 97% and 3%.
const SUMMARY: LeadStageSummary = {
  stages: [
    { stageId: PRIMEIRO_ID, count: 12, estimatedValueBrl: 9_000_000 },
    { stageId: RETORNO_ID, count: 1, estimatedValueBrl: 300_000 },
  ],
};

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

const column = (id: string) => required(`[data-stage-column="${id}"]`);

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
  it('shows the name, the Cliente and the birthday on the card, and no contact line', async () => {
    await renderBoard();
    const card = required(`[data-lead-card="${LEAD_ANA}"]`);
    expect(card.textContent).toContain('Ana Construbom');
    // The live cadastro name beats the snapshot.
    expect(card.querySelector('[data-lead-client]')?.textContent).toBe('Construbom Matriz');
    expect(card.querySelector('[data-lead-birthday]')?.textContent).toBe('Aniversário 28/02/1990');
    expect(card.querySelector('[data-lead-contact]')).toBeNull();
    expect(card.textContent).not.toContain('(11) 98888-7777');
    expect(card.textContent).not.toContain('ana@construbom.com.br');
  });

  it('falls back to the snapshot, then to Sem cliente', async () => {
    await renderBoard();
    const caio = required(`[data-lead-card="${LEAD_CAIO}"]`);
    expect(caio.querySelector('[data-lead-client]')?.textContent).toBe('Obra Caio Ltda');
    const bruno = required(`[data-lead-card="${LEAD_BRUNO}"]`);
    expect(bruno.querySelector('[data-lead-client]')?.textContent).toBe('Sem cliente');
    expect(bruno.querySelector('[data-lead-birthday]')).toBeNull();
    expect(boardText()).not.toContain('Sem empresa');
    expect(boardText()).not.toContain('Sem contato');
  });

  it('shows the value beside the menu, formatted like the full card', async () => {
    await renderBoard({ onDeleteLead: vi.fn() });
    const ana = required(`[data-lead-card="${LEAD_ANA}"]`);
    const bruno = required(`[data-lead-card="${LEAD_BRUNO}"]`);
    const value = ana.querySelector<HTMLElement>('[data-lead-value]');
    expect(value?.textContent).toBe(brl0(150_000));
    expect(bruno.querySelector('[data-lead-value]')?.textContent).toBe(brl0(0));

    const group = value?.parentElement;
    expect(group?.querySelector('[data-lead-menu]')).not.toBeNull();
    expect(group?.className).toContain('shrink-0');

    const client = ana.querySelector<HTMLElement>('[data-lead-client]');
    expect(client?.className).toContain('truncate');
    expect(client?.parentElement?.className).toContain('min-w-0');
    expect(client?.parentElement?.className).toContain('flex-1');
  });

  it('shows the stage R$ total, % do total and the bar from the loaded cards', async () => {
    await renderBoard();
    const primeiro = column(PRIMEIRO_ID);
    const retorno = column(RETORNO_ID);
    expect(primeiro.querySelector('[data-stage-total]')?.textContent).toBe(brl0(150_000));
    expect(primeiro.textContent).toContain('33% do total');
    expect(retorno.querySelector('[data-stage-total]')?.textContent).toBe(brl0(300_000));
    expect(retorno.textContent).toContain('67% do total');
    expect(primeiro.querySelector<HTMLElement>('[data-stage-bar]')?.style.width).toBe('33%');
    expect(retorno.querySelector<HTMLElement>('[data-stage-bar]')?.style.width).toBe('67%');
    const counts = [...container.querySelectorAll('[data-stage-count]')].map((n) => n.textContent);
    expect(counts).toEqual(['2', '1']);
  });

  it('takes the column total, share and bar from the server summary', async () => {
    await renderBoard({ stageSummary: SUMMARY });
    const counts = [...container.querySelectorAll('[data-stage-count]')].map((n) => n.textContent);
    expect(counts).toEqual(['12', '1']);
    const primeiro = column(PRIMEIRO_ID);
    const retorno = column(RETORNO_ID);
    expect(primeiro.querySelector('[data-stage-total]')?.textContent).toBe(brl0(9_000_000));
    expect(primeiro.textContent).toContain('97% do total');
    expect(primeiro.querySelector<HTMLElement>('[data-stage-bar]')?.style.width).toBe('97%');
    expect(retorno.querySelector('[data-stage-total]')?.textContent).toBe(brl0(300_000));
    expect(retorno.textContent).toContain('3% do total');
    expect(retorno.querySelector<HTMLElement>('[data-stage-bar]')?.style.width).toBe('3%');
  });

  it('renders no raw id', async () => {
    await renderBoard();
    for (const id of [
      PRIMEIRO_ID,
      RETORNO_ID,
      LEAD_ANA,
      LEAD_BRUNO,
      LEAD_CAIO,
      SELLER_ID,
      CLIENT_ID,
    ]) {
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
  it('uses the contact headers plus Valor estimado before Ações', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const ths = [...container.querySelectorAll<HTMLElement>('[data-leads-list] th')];
    const headers = ths.map((n) => n.textContent?.trim());
    expect(headers).toEqual([
      'Lead',
      'Fase',
      'Aniversário',
      'Vendedor',
      'Na fase',
      'Valor estimado',
      'Ações',
    ]);
    const valueHeader = ths.find((n) => n.textContent?.trim() === 'Valor estimado');
    expect(valueHeader?.className).toContain('text-right');
    const list = required('[data-leads-list]').textContent ?? '';
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
    expect(row(LEAD_CAIO).querySelectorAll('td')).toHaveLength(7);
    // The Lista keeps the contact line, not the client.
    expect(row(LEAD_ANA).querySelectorAll('td')[0]?.textContent).not.toContain('Construbom Matriz');
  });

  it('shows the estimated value right-aligned before the actions', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const valueCell = (id: string) =>
      required(`[data-list-row="${id}"]`).querySelectorAll<HTMLElement>('td')[5];
    expect(valueCell(LEAD_ANA)?.textContent).toBe(brl0(150_000));
    expect(valueCell(LEAD_ANA)?.className).toContain('text-right');
    expect(valueCell(LEAD_BRUNO)?.textContent).toBe(brl0(0));
    expect(valueCell(LEAD_CAIO)?.textContent).toBe(brl0(300_000));
  });

  it('phase chips keep their counts and carry their R$', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const chips = [...container.querySelectorAll('[data-phase-chip]')];
    expect(chips).toHaveLength(3);
    for (const chip of chips) {
      expect(chip.querySelector('[data-phase-count]')).not.toBeNull();
    }
    const all = required('[data-phase-chip=""]');
    expect(all.textContent).toContain(brl0(450_000));
    expect(required('[data-phase-chip=""] [data-phase-count]').textContent).toBe('3');
    expect(required(`[data-phase-chip="${PRIMEIRO_ID}"]`).textContent).toContain(brl0(150_000));
    expect(required(`[data-phase-chip="${RETORNO_ID}"]`).textContent).toContain(brl0(300_000));
  });

  it('the footer counts leads and shows the TOTAL', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    const list = required('[data-leads-list]');
    expect(list.textContent).toContain('Todas as fases · 3 leads');
    expect(list.textContent).toContain('TOTAL');
    expect(required('[data-list-total]').textContent).toBe(brl0(450_000));

    await click(`[data-phase-chip="${RETORNO_ID}"]`);
    expect(required('[data-leads-list]').textContent).toContain('Retorno · 1 lead');
    expect(required('[data-list-total]').textContent).toBe(brl0(300_000));
  });

  it('takes the chips and the footer from the server summary', async () => {
    await renderBoard({ stageSummary: SUMMARY });
    await click('[data-view-option="list"]');
    const all = required('[data-phase-chip=""]');
    expect(all.textContent).toContain(brl0(9_300_000));
    expect(all.querySelector('[data-phase-count]')?.textContent).toBe('13');
    const primeiro = required(`[data-phase-chip="${PRIMEIRO_ID}"]`);
    expect(primeiro.textContent).toContain(brl0(9_000_000));
    expect(primeiro.querySelector('[data-phase-count]')?.textContent).toBe('12');
    expect(required('[data-list-total]').textContent).toBe(brl0(9_300_000));
    expect(required('[data-leads-list]').textContent).toContain('Todas as fases · 13 leads');
    expect(container.querySelectorAll('[data-list-row]')).toHaveLength(3);
  });

  it('an empty phase spans the seven contact columns', async () => {
    await renderBoard({ leads: [] });
    await click('[data-view-option="list"]');
    expect(required('[data-leads-list] td[colspan]').getAttribute('colspan')).toBe('7');
  });

  it('renders no raw id', async () => {
    await renderBoard();
    await click('[data-view-option="list"]');
    for (const id of [
      PRIMEIRO_ID,
      RETORNO_ID,
      LEAD_ANA,
      LEAD_BRUNO,
      LEAD_CAIO,
      SELLER_ID,
      CLIENT_ID,
    ]) {
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

describe('contact LeadCard header', () => {
  async function renderCard(row: SalesOpsLead) {
    await act(async () => {
      root.render(<LeadCard fieldSet="contact" lead={row} lookups={LOOKUPS} now={NOW} />);
    });
    return required(`[data-lead-card="${row.id}"]`);
  }

  it('never renders an unresolvable client id', async () => {
    const card = await renderCard(
      lead(LEAD_ANA, PRIMEIRO_ID, { clientId: UNKNOWN_CLIENT_ID, clientNameSnapshot: '' }),
    );
    expect(card.querySelector('[data-lead-client]')?.textContent).toBe('Sem cliente');
    expect(card.textContent).not.toContain(UNKNOWN_CLIENT_ID);
  });

  it('shows no product chip even when the row carries products', async () => {
    const card = await renderCard(
      lead(LEAD_ANA, PRIMEIRO_ID, {
        products: [{ productId: null, productNameSnapshot: 'Telha Colonial' }],
      }),
    );
    expect(card.textContent).not.toContain('Telha Colonial');
  });
});

describe('the full edition keeps its own card and Lista', () => {
  it('the full card keeps Sem empresa and gets no leads-edition hook', async () => {
    await act(async () => {
      root.render(<LeadCard lead={LEADS[1]!} lookups={LOOKUPS} now={NOW} />);
    });
    const card = required(`[data-lead-card="${LEAD_BRUNO}"]`);
    expect(card.textContent).toContain('Sem empresa');
    expect(card.textContent).toContain(brl0(0));
    expect(card.textContent).not.toContain('Sem cliente');
    expect(card.querySelector('[data-lead-client]')).toBeNull();
    expect(card.querySelector('[data-lead-value]')).toBeNull();
    expect(card.querySelector('[data-lead-contact]')).toBeNull();
    expect(card.querySelector('[data-lead-birthday]')).toBeNull();
  });

  it('the full Lista keeps Produtos, its seven headers and the company line', async () => {
    await renderBoard({ fieldSet: 'full' });
    await click('[data-view-option="list"]');
    const headers = [...container.querySelectorAll('[data-leads-list] th')].map((n) =>
      n.textContent?.trim(),
    );
    expect(headers).toEqual([
      'Lead',
      'Fase',
      'Produtos',
      'Vendedor',
      'Na fase',
      'Valor estimado',
      'Ações',
    ]);
    expect(container.querySelector('[data-row-contact]')).toBeNull();
    expect(container.querySelector('[data-row-birthday]')).toBeNull();
    const ana = required(`[data-list-row="${LEAD_ANA}"]`);
    expect(ana.querySelectorAll('td')[0]?.textContent).toContain('Construbom Matriz');
  });

  it('the full empty phase still spans seven columns', async () => {
    await renderBoard({ fieldSet: 'full', leads: [] });
    await click('[data-view-option="list"]');
    expect(required('[data-leads-list] td[colspan]').getAttribute('colspan')).toBe('7');
  });
});
