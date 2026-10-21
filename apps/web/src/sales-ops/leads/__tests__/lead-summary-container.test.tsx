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
}));
vi.mock('../hooks', () => ({
  useSaveLead: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }),
  useDeleteLead: () => ({ isPending: false, mutateAsync: mocks.deleteAsync }),
}));

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
let container: HTMLDivElement;
let root: Root | null;

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
    nextStages: [{ id: 'stage-proposta', name: 'Proposta', type: 'normal', exitKind: null, requiresReason: false }],
    timeline: [],
    followups: [],
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
          element={<LeadSummaryContainer clients={[]} leadId={LEAD_ID} onOpenSale={vi.fn()} products={[]} sellers={[]} workspace="operacional" />}
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
async function click(selector: string) {
  // Dialogs portal to <body>, so the lookup is document-wide.
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })));
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

  it('a 404 shows Lead não encontrado. with no id in the text', async () => {
    mocks.summaryState = { isPending: false, isError: true, error: { status: 404 } };
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    expect(container.querySelector('p')?.textContent).toBe('Lead não encontrado.');
    // The route probe beside the panel prints the path; only the panel itself is checked.
    expect(container.querySelector('p')?.parentElement?.textContent).not.toContain(LEAD_ID);
  });

  it('Voltar pops history when opened in-app and replaces with the funil otherwise', async () => {
    await renderAt([
      '/operacional/funil',
      { pathname: `/operacional/leads/${LEAD_ID}`, state: LEAD_SUMMARY_OPENED_IN_APP },
    ]);
    await click('[data-summary-back]');
    expect(path()).toBe('/operacional/funil');

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

  it('a converted lead offers no Editar', async () => {
    mocks.summary = summaryOf(lead({ saleId: 'sale-1', saleCode: 'P-0042' }));
    await renderAt([`/operacional/leads/${LEAD_ID}`]);
    expect(container.querySelector('[data-summary-edit]')).toBeNull();
    expect(container.querySelector('[data-summary-open-sale]')?.textContent).toBe('Abrir proposta P-0042');
  });
});
