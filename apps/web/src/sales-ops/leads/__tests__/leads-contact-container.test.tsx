// @vitest-environment happy-dom

import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LeadsBoardContainer } from '../LeadsBoardContainer';
import type { SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * The container's leads-edition wiring: it reads the edition once, hands the
 * board `fieldSet`, withholds the conversion door, renders the zero-etapas
 * board instead of a Skeleton forever, mounts the contact dialog and surfaces
 * a rejected contact save inline.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const STAGE_ID = 'cccccccc-0000-4000-8000-000000000001';
const LEAD_ID = 'aaaaaaaa-0000-4000-8000-000000000001';

const mocks = vi.hoisted(() => ({
  edition: 'leads' as 'full' | 'leads',
  roles: ['admin', 'seller'] as string[],
  stages: [] as unknown[],
  leads: [] as unknown[],
  boardProps: [] as Record<string, unknown>[],
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock('@/auth/react', () => ({
  useSalesEdition: () => mocks.edition,
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: mocks.roles,
    name: 'Gestor',
    email: 'gestor@example.com',
  }),
  useAccessToken: () => ({ getToken: async () => 'token' }),
}));

vi.mock('../hooks', () => ({
  useLeadStages: () => ({ isPending: false, isError: false, data: mocks.stages }),
  useLeadsBoard: () => ({
    // Pending with zero stages reproduces the real query, disabled without stage rows.
    isPending: mocks.stages.length === 0,
    isError: false,
    data: mocks.stages.length ? { leads: mocks.leads, hasMore: false } : undefined,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
  useMoveLead: () => ({ mutate: vi.fn(), isPending: false }),
  useSaveLead: () => ({
    mutate: mocks.mutate,
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));

vi.mock('../LeadsBoard', async () => {
  const ReactModule = await import('react');
  return {
    LeadsBoard: (props: Record<string, unknown>) => {
      mocks.boardProps.push(props);
      const call = (name: string, ...args: unknown[]) => () =>
        (props[name] as ((...a: unknown[]) => void) | undefined)?.(...args);
      return ReactModule.createElement(
        'div',
        { 'data-board-stub': 'true' },
        ReactModule.createElement(
          'button',
          { 'data-stub': 'create', onClick: call('onCreateLead'), type: 'button' },
          'stub-create',
        ),
        ReactModule.createElement(
          'button',
          { 'data-stub': 'edit', onClick: call('onEditLead', mocks.leads[0]), type: 'button' },
          'stub-edit',
        ),
        ReactModule.createElement(
          'button',
          { 'data-stub': 'stages', onClick: call('onOpenStagesCadastro'), type: 'button' },
          'stub-stages',
        ),
      );
    },
  };
});

function stageRow(): SalesOpsLeadStage {
  return {
    id: STAGE_ID,
    orgId: 'org-1',
    name: 'Primeiro contato',
    position: 1,
    kind: 'normal',
    isSystem: false,
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

function leadRow(): SalesOpsLead {
  return {
    id: LEAD_ID,
    stageId: STAGE_ID,
    position: 1,
    contactName: 'Ana Construbom',
    clientId: null,
    clientNameSnapshot: '',
    estimatedValueBrl: 0,
    description: null,
    contactPhone: '(11) 98888-7777',
    contactEmail: 'ana@construbom.com.br',
    contactBirthDate: '1990-02-28',
    sellerPersonId: null,
    sellerNameSnapshot: '',
    lostReason: null,
    stageChangedAt: '2026-10-01T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

let container: HTMLDivElement;
let root: Root;
const onRequestConversion = vi.fn(async () => null);
const onOpenSale = vi.fn();

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.edition = 'leads';
  mocks.roles = ['admin', 'seller'];
  mocks.stages = [stageRow()];
  mocks.leads = [leadRow()];
  mocks.boardProps = [];
  mocks.mutate.mockReset();
  mocks.mutateAsync.mockReset();
  mocks.mutateAsync.mockResolvedValue({ lead: leadRow() });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  });
}

function PathEcho() {
  return <span data-path={useLocation().pathname} />;
}

async function renderContainer() {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/operacional/leads']}>
        <Routes>
          <Route
            element={
              <>
                <LeadsBoardContainer
                  clients={[]}
                  onOpenSale={onOpenSale}
                  onRequestConversion={onRequestConversion}
                  people={[]}
                  products={[]}
                  sellers={[]}
                />
                <PathEcho />
              </>
            }
            path="/operacional/leads"
          />
          <Route element={<PathEcho />} path="*" />
        </Routes>
      </MemoryRouter>,
    );
  });
  await settle();
}

function lastBoardProps(): Record<string, unknown> {
  const props = mocks.boardProps.at(-1);
  if (!props) throw new Error('board not rendered');
  return props;
}

async function clickSelector(selector: string) {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`not rendered: ${selector}`);
  await act(async () => {
    node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function typeInto(id: string, value: string) {
  const field = document.getElementById(id);
  if (!(field instanceof HTMLInputElement)) throw new Error(`input not found: ${id}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}

function saveErrorText(): string | null {
  return document.querySelector('[data-lead-save-error]')?.textContent ?? null;
}

describe('LeadsBoardContainer, leads edition', () => {
  it('hands the board the contact field set and no conversion door', async () => {
    await renderContainer();
    const props = lastBoardProps();
    expect(props.fieldSet).toBe('contact');
    expect(props.onRequestConversion).toBeUndefined();
    expect(props.onOpenSale).toBeUndefined();
  });

  it('renders the board, not the Skeleton, with zero etapas', async () => {
    mocks.stages = [];
    mocks.leads = [];
    await renderContainer();
    expect(document.querySelector('[data-board-stub]')).not.toBeNull();
    expect(lastBoardProps().stages).toEqual([]);
  });

  it('the empty-state action navigates to Etapas do funil', async () => {
    await renderContainer();
    await clickSelector('[data-stub="stages"]');
    expect(document.querySelector('[data-path]')?.getAttribute('data-path')).toBe(
      '/cadastros/etapas',
    );
  });

  it('lets only an admin manage etapas', async () => {
    await renderContainer();
    expect(lastBoardProps().canManageStages).toBe(true);

    await act(async () => root.unmount());
    root = createRoot(container);
    mocks.roles = ['seller'];
    await renderContainer();
    expect(lastBoardProps().canManageStages).toBe(false);
  });

  it('Novo lead mounts the contact dialog', async () => {
    await renderContainer();
    await clickSelector('[data-stub="create"]');
    expect(document.getElementById('lead-birth-date')).not.toBeNull();
    expect(document.getElementById('lead-company-text')).toBeNull();
  });

  it('editing seeds the contact dialog and saves with the lead id', async () => {
    await renderContainer();
    await clickSelector('[data-stub="edit"]');
    const phone = document.getElementById('lead-phone') as HTMLInputElement | null;
    expect(phone?.value).toBe('(11) 98888-7777');

    await clickSelector('[data-lead-save]');
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync.mock.calls[0]?.[0]).toMatchObject({
      id: LEAD_ID,
      contactName: 'Ana Construbom',
      contactPhone: '(11) 98888-7777',
    });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('a 400 no_open_stage renders the inline no-etapa notice', async () => {
    mocks.mutateAsync.mockRejectedValue({
      status: 400,
      error: 'validation_error',
      reason: 'no_open_stage',
    });
    await renderContainer();
    await clickSelector('[data-stub="create"]');
    await typeInto('lead-contact-name', 'Ana');
    await clickSelector('[data-lead-save]');

    expect(saveErrorText()).toBe('Nenhuma etapa ativa no funil. O lead não foi salvo.');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('any other failure renders the generic notice, cleared by reopening', async () => {
    mocks.mutateAsync.mockRejectedValue({ status: 500 });
    await renderContainer();
    await clickSelector('[data-stub="create"]');
    await typeInto('lead-contact-name', 'Ana');
    await clickSelector('[data-lead-save]');
    expect(saveErrorText()).toBe('Não foi possível salvar o lead. Tente novamente.');

    await clickSelector('[data-stub="create"]');
    expect(saveErrorText()).toBeNull();
  });
});

describe('LeadsBoardContainer, full edition', () => {
  beforeEach(() => {
    mocks.edition = 'full';
  });

  it('hands the board the full field set and the conversion door', async () => {
    await renderContainer();
    const props = lastBoardProps();
    expect(props.fieldSet).toBe('full');
    expect(props.onRequestConversion).toBe(onRequestConversion);
    expect(props.onOpenSale).toBe(onOpenSale);
  });

  it('Novo lead mounts LeadDialog', async () => {
    await renderContainer();
    await clickSelector('[data-stub="create"]');
    expect(document.getElementById('lead-company-text')).not.toBeNull();
    expect(document.getElementById('lead-birth-date')).toBeNull();
  });

  it('saves through mutate and never renders the save notice', async () => {
    await renderContainer();
    await clickSelector('[data-stub="create"]');
    await typeInto('lead-contact-name', 'Ana');
    await typeInto('lead-company-text', 'Acme');
    await clickSelector('[data-lead-save]');

    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(document.querySelector('[data-lead-save-error]')).toBeNull();
  });
});
