// @vitest-environment happy-dom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadSummaryResponse } from '../crm-types';
import { LeadSummaryContainer } from '../LeadSummaryContainer';
import { LEAD_SUMMARY_OPENED_IN_APP } from '../lead-summary-nav';
import type { SalesOpsLead } from '../types';

const LEAD_ID = '0f6c2a8e-6f1d-4c1e-9a3b-2d5f7e8a9b10';
const DESC = { id: 'f-desc', key: 'descricao', label: 'Descrição', kind: 'text', referenceTarget: null, multiple: false, options: null, filterable: true, isSystem: false, removable: true, position: 1 };
const CLI = { id: 'f-cli', key: 'cliente', label: 'Cliente', kind: 'reference', referenceTarget: 'cliente', multiple: false, options: null, filterable: true, isSystem: true, removable: false, position: 0 };

const mocks = vi.hoisted(() => ({
  summary: null as LeadSummaryResponse | null,
  summaryState: { isPending: false, isError: false, error: null as unknown },
  definitions: [] as unknown[],
  mutateAsync: vi.fn(),
  deleteAsync: vi.fn(),
  advanceAsync: vi.fn(),
  addNoteAsync: vi.fn(),
  addFollowupAsync: vi.fn(),
  markDone: vi.fn(),
  moveAsync: vi.fn(),
  pipelines: [] as unknown[],
  roles: ['admin'] as string[],
}));

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({ roles: mocks.roles }),
  useSalesEdition: () => 'full',
  useAccessToken: () => ({ getToken: async () => 'token' }),
}));
vi.mock('../crm-hooks', () => ({
  useLeadSummary: () => ({
    ...mocks.summaryState,
    data: mocks.summaryState.isError ? undefined : (mocks.summary ?? undefined),
    refetch: async () => ({ data: mocks.summary }),
  }),
  useFieldDefinitions: () => ({ isPending: false, data: mocks.definitions }),
  usePipelines: () => ({ isPending: false, data: mocks.pipelines }),
  useAdvanceLead: () => ({ isPending: false, mutateAsync: mocks.advanceAsync }),
  useAddLeadNote: () => ({ isPending: false, mutateAsync: mocks.addNoteAsync }),
  useAddLeadFollowup: () => ({ isPending: false, mutateAsync: mocks.addFollowupAsync }),
  useMarkFollowupDone: () => ({ isPending: false, mutate: mocks.markDone }),
}));
vi.mock('../hooks', () => ({
  useSaveLead: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }),
  useDeleteLead: () => ({ isPending: false, mutateAsync: mocks.deleteAsync }),
  useMoveLead: () => ({ isPending: false, mutateAsync: mocks.moveAsync }),
}));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
let container: HTMLDivElement;
let root: Root | null;
const conversionDoor = vi.fn(async (_request: unknown): Promise<string | null> => null);

function lead(overrides: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id: LEAD_ID, stageId: 'stage-contato', position: 1, contactName: 'Ana', clientId: 'c1',
    clientNameSnapshot: 'Acme', estimatedValueBrl: 0, description: null, contactPhone: '11999990000',
    contactEmail: 'ana@example.com', contactBirthDate: null, sellerPersonId: null, sellerNameSnapshot: 'Marina',
    lostReason: null, stageChangedAt: '2026-10-18T12:00:00.000Z', saleId: null, saleStatus: null, saleCode: null,
    products: [], createdAt: '2026-10-01T12:00:00.000Z', updatedAt: null,
    fields: [
      { fieldId: 'f-cli', key: 'cliente', value: [{ id: 'c1', name: 'Acme' }] },
      { fieldId: 'f-desc', key: 'descricao', value: 'Antes' },
    ],
    ...overrides,
  } as unknown as SalesOpsLead;
}

function summaryOf(current: SalesOpsLead): LeadSummaryResponse {
  return {
    lead: current,
    pipeline: { id: 'pipe-1', name: 'Funil padrão' },
    stage: { id: 'stage-contato', name: 'Contato', type: 'normal', exitKind: null },
    nextStages: [
      { id: 'stage-proposta', name: 'Proposta', type: 'orcamento', exitKind: null, requiresReason: false },
      { id: 'stage-ganho', name: 'Ganho', type: 'saida', exitKind: 'ganho', requiresReason: false },
    ],
    timeline: [],
    followups: [
      { id: 'fu-1', nextStep: 'Ligar', dueOn: '2026-10-25', ownerName: null, doneAt: null },
    ],
  };
}

function Probe() {
  return <output data-path>{useLocation().pathname}</output>;
}

type Entry = string | { pathname: string; state?: unknown };
async function renderAt(entries: Entry[], index = entries.length - 1) {
  root = createRoot(container);
  await act(async () => root?.render(
    <MemoryRouter initialEntries={entries} initialIndex={index}>
      <Routes>
        <Route
          element={(
            <LeadSummaryContainer
              clients={[]}
              leadId={LEAD_ID}
              onOpenSale={vi.fn()}
              onRequestConversion={(request) => conversionDoor(request)}
              products={[]}
              sellers={[]}
              workspace="operacional"
            />
          )}
          path="/operacional/leads/:leadId"
        />
      </Routes>
      <Probe />
    </MemoryRouter>,
  ));
  await settle();
}

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}
async function click(target: string | Element) {
  // Dialogs portal to <body>, so the lookup is document-wide.
  const element = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!element) throw new Error(`Missing ${String(target)}`);
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
  await settle();
}
/** Dispatched with `bubbles: true`, exactly as a real key press is. */
async function escape(target: Element) {
  await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await settle();
}
function setInput(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement | null;
  if (!input) throw new Error(`Missing ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const path = () => container.querySelector('[data-path]')?.textContent;
function setTextarea(node: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(node, value);
  node.dispatchEvent(new Event('input', { bubbles: true }));
}
function dialogNode(): Element {
  const node = document.querySelector('[role="dialog"]');
  if (!node) throw new Error('dialog not rendered');
  return node;
}
/** Opens the stage picker of the dialog and returns the offered labels. */
async function openStagePicker(): Promise<string[]> {
  const trigger = [...dialogNode().querySelectorAll('[role="combobox"]')][0];
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('combobox trigger not found');
  await click(trigger);
  return [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((node) => node.textContent?.trim() ?? '');
}
async function clickOption(label: string) {
  const row = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find(
    (node) => node.textContent?.trim() === label,
  );
  if (!row) throw new Error(`option "${label}" not offered`);
  await click(row);
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  mocks.summary = summaryOf(lead());
  mocks.summaryState = { isPending: false, isError: false, error: null };
  mocks.definitions = [CLI, DESC];
  mocks.roles = ['admin'];
  mocks.mutateAsync.mockReset();
  mocks.deleteAsync.mockReset();
  mocks.deleteAsync.mockResolvedValue(undefined);
  mocks.advanceAsync.mockReset();
  mocks.addNoteAsync.mockReset();
  mocks.addFollowupAsync.mockReset();
  mocks.markDone.mockReset();
  mocks.moveAsync.mockReset();
  conversionDoor.mockReset();
  conversionDoor.mockResolvedValue(null);
  mocks.pipelines = [{
    id: 'pipe-1', name: 'Funil padrão', isDefault: true, position: 0, status: 'active', transitions: [],
    stages: [
      { id: 'stage-contato', name: 'Contato', position: 1, type: 'normal', behavior: 'none', exitKind: null, requiresReason: false, status: 'active' },
      { id: 'stage-proposta', name: 'Proposta', position: 2, type: 'orcamento', behavior: 'opens_orcamentos', exitKind: null, requiresReason: false, status: 'active' },
      { id: 'stage-ganho', name: 'Ganho', position: 3, type: 'saida', behavior: 'none', exitKind: 'ganho', requiresReason: false, status: 'active' },
    ],
  }];
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
});

describe('LeadSummaryContainer', () => {
  it('Editar opens the form seeded with the lead, saves with its id and offers the Lead editado undo', async () => {
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-edit]');
    expect((document.getElementById('lead-contact-name') as HTMLInputElement).value).toBe('Ana');

    mocks.mutateAsync.mockImplementation(async (payload: { id: string }) => {
      const updated = lead({ contactName: 'Ana Nova' });
      mocks.summary = summaryOf(updated);
      return { lead: updated, payloadId: payload.id };
    });
    setInput('lead-contact-name', 'Ana Nova');
    await click('[data-lead-save]');

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync.mock.calls[0]?.[0]).toMatchObject({ id: LEAD_ID, contactName: 'Ana Nova' });
    expect(document.querySelector('[data-undo-notice]')?.textContent).toContain('Lead editado');

    mocks.mutateAsync.mockClear();
    mocks.mutateAsync.mockResolvedValue({ lead: lead() });
    await click('[data-undo-action]');

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    const inverse = mocks.mutateAsync.mock.calls[0]?.[0] as { fields: Array<{ fieldId: string; value: unknown }> };
    expect(inverse.fields).toEqual([{ fieldId: 'f-desc', value: 'Antes' }]);
    expect(inverse.fields.some((entry) => entry.fieldId === 'f-cli')).toBe(false);
  });

  it('the undo of an edit to a contactless legacy lead sends no contact keys', async () => {
    mocks.summary = summaryOf(lead({ contactPhone: null, contactEmail: null }));
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-edit]');
    mocks.mutateAsync.mockImplementation(async () => {
      const updated = lead({ contactName: 'Ana Nova', contactPhone: null, contactEmail: null });
      mocks.summary = summaryOf(updated);
      return { lead: updated };
    });
    setInput('lead-contact-name', 'Ana Nova');
    await click('[data-lead-save]');
    expect(mocks.mutateAsync.mock.calls[0]?.[0]).not.toHaveProperty('contactPhone');

    mocks.mutateAsync.mockClear();
    mocks.mutateAsync.mockResolvedValue({ lead: lead({ contactPhone: null, contactEmail: null }) });
    await click('[data-undo-action]');

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    const inverse = mocks.mutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inverse).toMatchObject({ id: LEAD_ID, contactName: 'Ana' });
    expect(inverse).not.toHaveProperty('contactPhone');
    expect(inverse).not.toHaveProperty('contactEmail');
  });

  it('refuses the undo when the lead changed since the edit, with no second write', async () => {
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-edit]');
    mocks.mutateAsync.mockImplementation(async () => {
      const updated = lead({ contactName: 'Ana Nova' });
      mocks.summary = summaryOf(updated);
      return { lead: updated };
    });
    setInput('lead-contact-name', 'Ana Nova');
    await click('[data-lead-save]');
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);

    // Another actor edits the lead before the operator clicks Desfazer.
    mocks.summary = summaryOf(lead({ contactName: 'Outro ator' }));
    mocks.mutateAsync.mockClear();
    await click('[data-undo-action]');

    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('alterado');
  });

  it('the undo of an edit that added a field clears that field with an explicit null', async () => {
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-edit]');
    const ADDED = { fieldId: 'f-urg', key: 'urgencia', value: 'Alta' };
    mocks.mutateAsync.mockImplementation(async () => {
      const updated = lead({ fields: [...lead().fields!, ADDED] });
      mocks.summary = summaryOf(updated);
      return { lead: updated };
    });
    setInput('lead-contact-name', 'Ana Nova');
    await click('[data-lead-save]');

    mocks.mutateAsync.mockClear();
    mocks.mutateAsync.mockResolvedValue({ lead: lead() });
    await click('[data-undo-action]');

    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    const inverse = mocks.mutateAsync.mock.calls[0]?.[0] as { fields: Array<{ fieldId: string; value: unknown }> };
    expect(inverse.fields).toContainEqual({ fieldId: 'f-urg', value: null });
  });

  it('a 404 shows Lead não encontrado. with no id in the text', async () => {
    mocks.summaryState = { isPending: false, isError: true, error: { status: 404 } };
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    expect(container.querySelector('p')?.textContent).toBe('Lead não encontrado.');
    // The route probe beside the panel prints the path; only the panel itself is checked.
    expect(container.querySelector('p')?.parentElement?.textContent).not.toContain(LEAD_ID);
  });

  it('Voltar pops the history when the summary was opened in-app', async () => {
    // The previous entry is NOT the funil: a pop lands on /operacional/vendas, a replace with the funil would not.
    await renderAt([
      '/operacional/vendas',
      { pathname: `/operacional/leads/${LEAD_ID}`, state: LEAD_SUMMARY_OPENED_IN_APP },
    ]);
    await click('[data-summary-back]');
    expect(path()).toBe('/operacional/vendas');
  });

  it('Voltar replaces the entry with the funil when the summary was opened directly', async () => {
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-back]');
    expect(path()).toBe('/operacional/funil');
  });

  it('deleting from the form confirms, posts and navigates to the funil', async () => {
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-edit]');
    await click('[data-delete-lead-form]');
    await click('[data-confirm-delete]');

    expect(mocks.deleteAsync).toHaveBeenCalledWith(LEAD_ID);
    expect(path()).toBe('/operacional/funil');
  });

  it('Escape on the delete confirmation closes only the confirmation and keeps the edit form open', async () => {
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-edit]');
    await click('[data-delete-lead-form]');
    const confirmation = document.querySelector('[data-lead-delete-dialog]');
    if (!confirmation) throw new Error('delete confirmation not rendered');

    await escape(confirmation);

    expect(document.querySelector('[data-lead-delete-dialog]')).toBeNull();
    expect(document.getElementById('lead-contact-name')).not.toBeNull();
    expect(mocks.deleteAsync).not.toHaveBeenCalled();

    // POSITIVE CONTROL: with the confirmation gone, Escape reaches the edit form and closes it.
    const contactName = document.getElementById('lead-contact-name');
    if (!contactName) throw new Error('edit form input not rendered');
    await escape(contactName);
    expect(document.getElementById('lead-contact-name')).toBeNull();
  });

  it('a refused delete keeps the edit form and the confirmation open with the error', async () => {
    mocks.deleteAsync.mockRejectedValue({ status: 500, error: 'internal' });
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-edit]');
    await click('[data-delete-lead-form]');
    await click('[data-confirm-delete]');

    expect(mocks.deleteAsync).toHaveBeenCalledWith(LEAD_ID);
    expect(document.querySelector('[data-lead-delete-error]')).not.toBeNull();
    expect(document.getElementById('lead-contact-name')).not.toBeNull();
    expect(path()).toBe(`/operacional/leads/${LEAD_ID}`);
  });

  it('a converted lead offers no Editar', async () => {
    mocks.summary = summaryOf(lead({ saleId: 'sale-1', saleCode: 'P-0042' }));
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    expect(container.querySelector('[data-summary-edit]')).toBeNull();
    expect(container.querySelector('[data-summary-open-sale]')?.textContent).toBe('Abrir proposta P-0042');
  });

  it('Avançar offers only the summary destinations and posts the chosen exit with the lead id', async () => {
    mocks.advanceAsync.mockResolvedValue({ lead: lead() });
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-advance]');
    expect(await openStagePicker()).toEqual(['Proposta', 'Ganho']);
    await clickOption('Ganho');
    await click('[data-advance-confirm]');

    expect(mocks.advanceAsync).toHaveBeenCalledWith({ leadId: LEAD_ID, toStageId: 'stage-ganho' });
    expect(document.querySelector('[data-advance-confirm]')).toBeNull();
  });

  it('a conversion destination goes through the board door and then moves the lead with the sale id', async () => {
    mocks.moveAsync.mockResolvedValue({ lead: lead() });
    conversionDoor.mockResolvedValue('sale-1');
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-advance]');
    await openStagePicker();
    await clickOption('Proposta');
    await click('[data-advance-confirm]');

    expect(conversionDoor).toHaveBeenCalledWith({ lead: expect.objectContaining({ id: LEAD_ID }), toStageId: 'stage-proposta', toIndex: 0 });
    expect(mocks.moveAsync).toHaveBeenCalledWith({ leadId: LEAD_ID, toStageId: 'stage-proposta', toIndex: 0, saleId: 'sale-1' });
    expect(mocks.advanceAsync).not.toHaveBeenCalled();
    expect(document.querySelector('[data-advance-confirm]')).toBeNull();
  });

  it('a cancelled conversion writes nothing and keeps the dialog open', async () => {
    conversionDoor.mockResolvedValue(null);
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    await click('[data-summary-advance]');
    await openStagePicker();
    await clickOption('Proposta');
    await click('[data-advance-confirm]');

    expect(conversionDoor).toHaveBeenCalledTimes(1);
    expect(mocks.moveAsync).not.toHaveBeenCalled();
    expect(document.querySelector('[data-advance-confirm]')).not.toBeNull();
  });

  it('adding a note calls addLeadNote and a follow-up calls addLeadFollowup; Concluir marks it done', async () => {
    mocks.addNoteAsync.mockResolvedValue({});
    mocks.addFollowupAsync.mockResolvedValue({});
    await renderAt([`/operacional/leads/${LEAD_ID}`]);

    const note = document.getElementById('summary-note') as HTMLTextAreaElement;
    setTextarea(note, '  Cliente pediu desconto  ');
    await click('[data-note-add]');
    expect(mocks.addNoteAsync).toHaveBeenCalledWith({ leadId: LEAD_ID, body: 'Cliente pediu desconto' });

    setInput('summary-followup-step', 'Mandar proposta');
    setInput('summary-followup-due', '2026-10-30');
    await click('[data-followup-add]');
    expect(mocks.addFollowupAsync).toHaveBeenCalledWith({ leadId: LEAD_ID, nextStep: 'Mandar proposta', dueOn: '2026-10-30' });

    await click('[data-followup-done="fu-1"]');
    expect(mocks.markDone).toHaveBeenCalledWith('fu-1');
  });
});
