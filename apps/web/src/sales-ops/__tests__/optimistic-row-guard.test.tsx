// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveAreaPayload } from '../api';
import { isOptimisticId, optimisticId, withoutOptimisticRows } from '../optimistic';
import type {
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsPerson,
  SalesOpsProduct,
} from '../types';

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(async () => undefined),
}));

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: ['admin'],
    name: 'Test User',
    email: 'test.user@fxl.example',
  }),
  useLogout: () => authMocks.logout,
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className}>{children}</div>
  ),
  DialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
}));

vi.mock('../api', () => ({
  salesOpsApi: {
    bootstrap: vi.fn(),
    savePerson: vi.fn(),
    saveProduct: vi.fn(),
    saveClient: vi.fn(),
    saveArea: vi.fn(),
    createSale: vi.fn(),
    updateSale: vi.fn(),
    transitionSale: vi.fn(),
    cancelContract: vi.fn(),
    saveSettings: vi.fn(),
  },
}));

import { salesOpsApi } from '../api';
import { SalesOpsApp } from '../SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const orgId = '99999999-9999-4999-8999-999999999999';
const areaId = '66666666-6666-4666-8666-666666666666';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

type Deferred<T> = ReturnType<typeof createDeferred<T>>;

function snapshot(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
  return {
    sales: [],
    products: [],
    clients: [],
    areas: [],
    people: [],
    payables: [],
    saleItems: [],
    receivables: [],
    saleProfessionals: [],
    settings: null,
    ...patch,
  };
}

const existingArea: SalesOpsArea = {
  id: areaId,
  orgId,
  name: 'FXL Tech',
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};

const persistedArea: SalesOpsArea = {
  id: '12121212-1212-4121-8121-121212121212',
  orgId,
  name: 'FXL BPO Sales',
  status: 'active',
  createdAt: '2026-07-29T12:05:00.000Z',
  updatedAt: null,
};

const persistedClient: SalesOpsClient = {
  id: '14141414-1414-4141-8141-141414141414',
  orgId,
  name: 'Cliente Persistido',
  contact: null,
  legalName: null,
  document: null,
  address: null,
  legalRepName: null,
  legalRepDocument: null,
  createdAt: '2026-07-29T12:05:00.000Z',
  updatedAt: null,
};

const persistedPerson: SalesOpsPerson = {
  id: '15151515-1515-4151-8151-151515151515',
  orgId,
  displayName: 'Pessoa Persistida',
  contactEmail: null,
  status: 'active',
  isSeller: true,
  isFinder: false,
  isCollaborator: true,
  createdAt: '2026-07-29T12:05:00.000Z',
  updatedAt: null,
};

const persistedProduct: SalesOpsProduct = {
  id: '13131313-1313-4131-8131-131313131313',
  orgId,
  name: 'FXL Produto Novo',
  type: '',
  codeSuffix: '0',
  areaId,
  openPrice: false,
  setupBrl: 0,
  hasMonthly: false,
  monthlyBrl: 0,
  recurringCommission: false,
  hasFinderCommission: false,
  sellerCommissionType: 'pct',
  sellerCommissionValue: '10.00',
  sellerWithFinderCommissionType: 'pct',
  sellerWithFinderCommissionValue: '7.00',
  finderCommissionType: 'pct',
  finderCommissionValue: '3.00',
  modules: [],
  providers: [],
  status: 'active',
  createdAt: '2026-07-29T12:05:00.000Z',
  updatedAt: null,
};

let container: HTMLDivElement;
let root: Root | null;
let bootstrapCalls: Array<Deferred<SalesOpsBootstrap>>;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  bootstrapCalls = [];
  vi.mocked(salesOpsApi.bootstrap).mockImplementation(() => {
    const deferred = createDeferred<SalesOpsBootstrap>();
    bootstrapCalls.push(deferred);
    return deferred.promise;
  });
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container.remove();
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
  vi.clearAllMocks();
});

async function flushReact() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderApp(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          initialEntries={[path]}
        >
          <Routes>
            <Route element={<SalesOpsApp />} path="/" />
            <Route element={<SalesOpsApp />} path="/:workspace/:view" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flushReact();
}

async function resolveBootstrap(index: number, data: SalesOpsBootstrap) {
  const deferred = bootstrapCalls[index];
  if (!deferred) throw new Error(`bootstrap call ${index} was never issued`);
  await act(async () => {
    deferred.resolve(data);
  });
  await flushReact();
}

function text() {
  return container.textContent ?? '';
}

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function requireButtonByAriaLabel(label: string): HTMLButtonElement {
  const match = container.querySelector(`button[aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await flushReact();
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flushReact();
}

function requireInput(selector: string): HTMLInputElement {
  const match = container.querySelector(selector);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input not found: ${selector}`);
  return match;
}

function requireSelect(selector: string): HTMLSelectElement {
  const match = container.querySelector(selector);
  if (!(match instanceof HTMLSelectElement)) throw new Error(`select not found: ${selector}`);
  return match;
}

async function submitDialogForm() {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('dialog form not found');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flushReact();
}

describe('an optimistic row is visible but never actionable', () => {
  it('disables the área edit affordance while the create POST is in flight', async () => {
    const saveAreaDeferred = createDeferred<{ area: SalesOpsArea }>();
    vi.mocked(salesOpsApi.saveArea).mockReturnValueOnce(saveAreaDeferred.promise);

    await renderApp('/cadastros/areas');
    await resolveBootstrap(0, snapshot());

    await click(buttonByText('Nova área'));
    await changeInput(requireInput('form input'), 'FXL BPO Sales');
    await submitDialogForm();

    expect(text()).toContain('FXL BPO Sales');
    const pendingButton = requireButtonByAriaLabel('Salvando FXL BPO Sales');
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute('title')).toBe('Salvando...');
    expect(container.querySelector('button[aria-label="Editar FXL BPO Sales"]')).toBeNull();
  });

  it('keeps the área edit affordance blocked after the create dialog is dismissed mid-POST', async () => {
    const saveAreaDeferred = createDeferred<{ area: SalesOpsArea }>();
    vi.mocked(salesOpsApi.saveArea).mockReturnValueOnce(saveAreaDeferred.promise);

    await renderApp('/cadastros/areas');
    await resolveBootstrap(0, snapshot());

    await click(buttonByText('Nova área'));
    await changeInput(requireInput('form input'), 'FXL BPO Sales');
    await submitDialogForm();

    await click(buttonByText('Cancelar'));

    // The create dialog really is gone while the POST is still in flight.
    expect(container.querySelector('form')).toBeNull();
    expect(text()).toContain('FXL BPO Sales');

    const pendingButton = requireButtonByAriaLabel('Salvando FXL BPO Sales');
    expect(pendingButton.disabled).toBe(true);

    await click(pendingButton);

    // No edit dialog opened, so no request can carry the placeholder id.
    expect(container.querySelector('form')).toBeNull();
    expect(vi.mocked(salesOpsApi.saveArea)).toHaveBeenCalledTimes(1);
  });

  it('disables the cliente edit affordance while the create POST is in flight', async () => {
    const saveClientDeferred = createDeferred<{ client: SalesOpsClient }>();
    vi.mocked(salesOpsApi.saveClient).mockReturnValueOnce(saveClientDeferred.promise);

    await renderApp('/cadastros/clientes');
    await resolveBootstrap(0, snapshot());

    await click(buttonByText('Novo cliente'));
    await changeInput(requireInput('form input'), 'Cliente Optimista');
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.saveClient)).toHaveBeenCalledTimes(1);
    const pendingButton = requireButtonByAriaLabel('Salvando Cliente Optimista');
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute('title')).toBe('Salvando...');
    expect(container.querySelector('button[aria-label="Editar Cliente Optimista"]')).toBeNull();
  });

  it('disables the pessoa edit affordance while the create POST is in flight', async () => {
    const savePersonDeferred = createDeferred<{ person: SalesOpsPerson }>();
    vi.mocked(salesOpsApi.savePerson).mockReturnValueOnce(savePersonDeferred.promise);

    await renderApp('/cadastros/vendedores');
    await resolveBootstrap(0, snapshot());

    await click(buttonByText('Novo vendedor'));
    await changeInput(requireInput('form input'), 'Pessoa Optimista');
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.savePerson)).toHaveBeenCalledTimes(1);
    const pendingButton = requireButtonByAriaLabel('Salvando Pessoa Optimista');
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute('title')).toBe('Salvando...');
    expect(container.querySelector('button[aria-label="Editar Pessoa Optimista"]')).toBeNull();
  });

  it('re-enables the área edit affordance for a persisted row', async () => {
    await renderApp('/cadastros/areas');
    await resolveBootstrap(0, snapshot({ areas: [persistedArea] }));

    const editButton = requireButtonByAriaLabel('Editar FXL BPO Sales');
    expect(editButton.disabled).toBe(false);
    expect(editButton.getAttribute('title')).toBe('Editar');
    expect(container.querySelector('button[aria-label="Salvando FXL BPO Sales"]')).toBeNull();

    await click(editButton);
    expect(container.querySelector('form')).not.toBeNull();
    expect(requireInput('form input').value).toBe('FXL BPO Sales');
  });
});

describe('the onSuccess reconcile is observable', () => {
  it('edits the persisted uuid, not the optimistic id, once the create POST resolves', async () => {
    const createDeferredCall = createDeferred<{ area: SalesOpsArea }>();
    const editDeferredCall = createDeferred<{ area: SalesOpsArea }>();
    vi.mocked(salesOpsApi.saveArea)
      .mockReturnValueOnce(createDeferredCall.promise)
      .mockReturnValueOnce(editDeferredCall.promise);

    await renderApp('/cadastros/areas');
    await resolveBootstrap(0, snapshot());

    await click(buttonByText('Nova área'));
    await changeInput(requireInput('form input'), 'FXL BPO Sales');
    await submitDialogForm();

    await act(async () => {
      createDeferredCall.resolve({ area: persistedArea });
    });
    await flushReact();

    // The invalidated refetch is deliberately left in flight, so the only thing
    // that can have put the persisted uuid into the cache is the onSuccess reconcile.
    expect(vi.mocked(salesOpsApi.bootstrap)).toHaveBeenCalledTimes(2);
    expect(text()).toContain('FXL BPO Sales');

    const editButton = requireButtonByAriaLabel('Editar FXL BPO Sales');
    expect(editButton.disabled).toBe(false);

    await click(editButton);
    await changeInput(requireInput('form input'), 'FXL BPO Sales Editado');
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.saveArea)).toHaveBeenCalledTimes(2);
    const editPayload = vi.mocked(salesOpsApi.saveArea).mock.calls[1]?.[0] as SaveAreaPayload;
    expect(editPayload).toEqual({
      id: persistedArea.id,
      name: 'FXL BPO Sales Editado',
      status: 'active',
    });
    expect(String(editPayload.id)).not.toMatch(/^optimistic:/);
  });
});

describe('withoutOptimisticRows', () => {
  it('returns the same snapshot reference when no row is optimistic', () => {
    const snap = snapshot({
      areas: [persistedArea],
      clients: [persistedClient],
      people: [persistedPerson],
    });
    expect(withoutOptimisticRows(snap)).toBe(snap);
  });

  it('strips optimistic áreas, clientes and pessoas and keeps every other collection by reference', () => {
    const snap = snapshot({
      areas: [
        persistedArea,
        { ...persistedArea, id: optimisticId('areas', 'Nova'), name: 'Nova' },
      ],
      clients: [
        persistedClient,
        { ...persistedClient, id: optimisticId('clients', 'Novo'), name: 'Novo' },
      ],
      people: [
        persistedPerson,
        {
          ...persistedPerson,
          id: optimisticId('people', 'Nova Pessoa'),
          displayName: 'Nova Pessoa',
        },
      ],
      products: [persistedProduct],
    });

    const result = withoutOptimisticRows(snap);

    expect(result).not.toBe(snap);
    expect(result.areas).toHaveLength(1);
    expect(result.clients).toHaveLength(1);
    expect(result.people).toHaveLength(1);
    expect(result.areas[0]?.id).toBe(persistedArea.id);
    expect(result.clients[0]?.id).toBe(persistedClient.id);
    expect(result.people[0]?.id).toBe(persistedPerson.id);
    expect(
      [...result.areas, ...result.clients, ...result.people].some((row) =>
        isOptimisticId(row.id),
      ),
    ).toBe(false);

    expect(result.sales).toBe(snap.sales);
    expect(result.products).toBe(snap.products);
    expect(result.payables).toBe(snap.payables);
    expect(result.saleItems).toBe(snap.saleItems);
    expect(result.receivables).toBe(snap.receivables);
    expect(result.saleProfessionals).toBe(snap.saleProfessionals);
  });
});

describe('an unsaved row is never offered to a picker', () => {
  it('keeps an unsaved área out of the produto área picker', async () => {
    const saveAreaDeferred = createDeferred<{ area: SalesOpsArea }>();
    vi.mocked(salesOpsApi.saveArea).mockReturnValueOnce(saveAreaDeferred.promise);

    await renderApp('/cadastros/areas');
    await resolveBootstrap(0, snapshot({ areas: [existingArea] }));

    await click(buttonByText('Nova área'));
    await changeInput(requireInput('form input'), 'AAA Área Nova');
    await submitDialogForm();
    expect(text()).toContain('AAA Área Nova');

    await click(buttonByText('Cancelar'));

    const produtosNav = container.querySelector('nav button[aria-label="Produtos"]');
    if (!(produtosNav instanceof HTMLButtonElement)) throw new Error('nav Produtos not found');
    await click(produtosNav);

    // The create POST is still in flight, so the optimistic área is still cached.
    expect(vi.mocked(salesOpsApi.saveArea)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(salesOpsApi.bootstrap)).toHaveBeenCalledTimes(1);

    await click(buttonByText('Novo produto'));
    const areaSelect = requireSelect('select[aria-label="Área do produto"]');
    const options = [...areaSelect.querySelectorAll('option')];
    const values = options.map((option) => option.value);

    // Positive control: the persisted área is offered.
    expect(values).toContain(existingArea.id);
    expect(values.some((value) => value.startsWith('optimistic:'))).toBe(false);
    expect(options.map((option) => option.textContent?.trim())).not.toContain('AAA Área Nova');
  });
});
