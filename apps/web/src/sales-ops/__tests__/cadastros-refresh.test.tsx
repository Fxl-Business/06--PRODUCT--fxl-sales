// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsFuncao,
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
    saveFuncao: vi.fn(),
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
    funcoes: [],
    people: [],
    payables: [],
    saleItems: [],
    receivables: [],
    productFuncaoCosts: [],
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

const existingFuncao: SalesOpsFuncao = {
  id: '16161616-1616-4161-8161-161616161616',
  orgId,
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};

const persistedFuncao: SalesOpsFuncao = {
  id: '17171717-1717-4171-8171-171717171717',
  orgId,
  name: 'Designer',
  slug: 'designer',
  isSystem: false,
  status: 'active',
  createdAt: '2026-07-29T12:05:00.000Z',
  updatedAt: null,
};

const persistedProduct: SalesOpsProduct = {
  id: '13131313-1313-4131-8131-131313131313',
  orgId,
  name: 'FXL Produto Novo',
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

function headerText() {
  return container.querySelector('header')?.textContent ?? '';
}

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
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

function comboboxTrigger(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return match;
}

function comboboxText(ariaLabel: string): string {
  return comboboxTrigger(ariaLabel).textContent?.trim() ?? '';
}

async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().startsWith(optionLabel),
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
}

function requireInput(selector: string): HTMLInputElement {
  const match = container.querySelector(selector);
  if (!(match instanceof HTMLInputElement)) throw new Error(`input not found: ${selector}`);
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

describe('cadastros list refresh after a create', () => {
  it('shows a new área in the list before the create POST resolves', async () => {
    const saveAreaDeferred = createDeferred<{ area: SalesOpsArea }>();
    vi.mocked(salesOpsApi.saveArea).mockReturnValueOnce(saveAreaDeferred.promise);

    await renderApp('/cadastros/areas');
    await resolveBootstrap(0, snapshot());
    expect(text()).toContain('Nenhuma área cadastrada');

    await click(buttonByText('Nova área'));
    await changeInput(requireInput('form input'), 'FXL BPO Sales');
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.saveArea)).toHaveBeenCalledTimes(1);
    expect(text()).toContain('FXL BPO Sales');
    expect(text()).not.toContain('Nenhuma área cadastrada');
  });

  it('keeps exactly one row for the new área after the POST and the refetch resolve', async () => {
    const saveAreaDeferred = createDeferred<{ area: SalesOpsArea }>();
    vi.mocked(salesOpsApi.saveArea).mockReturnValueOnce(saveAreaDeferred.promise);

    await renderApp('/cadastros/areas');
    await resolveBootstrap(0, snapshot());

    await click(buttonByText('Nova área'));
    await changeInput(requireInput('form input'), 'FXL BPO Sales');
    await submitDialogForm();

    await act(async () => {
      saveAreaDeferred.resolve({ area: persistedArea });
    });
    await flushReact();

    await resolveBootstrap(1, snapshot({ areas: [persistedArea] }));

    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(text()).toContain('FXL BPO Sales');
    expect(text()).not.toContain('optimistic:');
  });

  it('removes the optimistic área row when the create request fails', async () => {
    const saveAreaDeferred = createDeferred<{ area: SalesOpsArea }>();
    vi.mocked(salesOpsApi.saveArea).mockReturnValueOnce(saveAreaDeferred.promise);

    await renderApp('/cadastros/areas');
    await resolveBootstrap(0, snapshot());

    await click(buttonByText('Nova área'));
    await changeInput(requireInput('form input'), 'FXL BPO Sales');
    await submitDialogForm();
    expect(text()).toContain('FXL BPO Sales');

    await act(async () => {
      saveAreaDeferred.reject(new Error('network failed'));
    });
    await flushReact();

    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(text()).toContain('Nenhuma área cadastrada');
    // The dialog stays open so the operator does not lose the typed name.
    expect(requireInput('form input').value).toBe('FXL BPO Sales');
  });

  it('shows a new produto in the list once the create POST resolves, with no further user action', async () => {
    const saveProductDeferred = createDeferred<{ product: SalesOpsProduct }>();
    vi.mocked(salesOpsApi.saveProduct).mockReturnValueOnce(saveProductDeferred.promise);

    await renderApp('/cadastros/produtos');
    await resolveBootstrap(0, snapshot({ areas: [existingArea] }));
    expect(text()).not.toContain('FXL Produto Novo');

    await click(buttonByText('Novo produto'));
    await changeInput(requireInput('input[placeholder="Nome"]'), 'FXL Produto Novo');
    await pickOption('Área do produto', existingArea.name);
    expect(comboboxText('Área do produto')).toBe(existingArea.name);
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.saveProduct)).toHaveBeenCalledTimes(1);

    await act(async () => {
      saveProductDeferred.resolve({ product: persistedProduct });
    });
    await flushReact();

    await resolveBootstrap(1, snapshot({ areas: [existingArea], products: [persistedProduct] }));

    expect(text()).toContain('FXL Produto Novo');
    expect(vi.mocked(salesOpsApi.bootstrap)).toHaveBeenCalledTimes(2);
  });

  it('sends funcaoIds when creating a pessoa and shows her before the POST resolves', async () => {
    const savePersonDeferred = createDeferred<{ person: SalesOpsPerson }>();
    vi.mocked(salesOpsApi.savePerson).mockReturnValueOnce(savePersonDeferred.promise);

    await renderApp('/cadastros/pessoas');
    await resolveBootstrap(0, snapshot({ funcoes: [existingFuncao] }));
    expect(text()).toContain('Nenhuma pessoa cadastrada');

    await click(buttonByText('Nova pessoa'));
    await changeInput(requireInput('form input'), 'Sig');
    await pickOption('Função da pessoa', existingFuncao.name);
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.savePerson)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(salesOpsApi.savePerson).mock.calls[0]?.[0]).toEqual({
      displayName: 'Sig',
      contactEmail: undefined,
      status: 'active',
      funcaoIds: [existingFuncao.id],
      id: undefined,
    });

    // The optimistic row resolves its badge from the cached função catalogue.
    // Scoped to the table, because the still-open dialog also says "Vendedor".
    const row = container.querySelector('tbody tr');
    expect(row?.textContent).toContain('Sig');
    expect(row?.textContent).toContain('Vendedor');
    expect(text()).not.toContain('Nenhuma pessoa cadastrada');
  });

  it('shows a new função in the list before the create POST resolves', async () => {
    const saveFuncaoDeferred = createDeferred<{ funcao: SalesOpsFuncao }>();
    vi.mocked(salesOpsApi.saveFuncao).mockReturnValueOnce(saveFuncaoDeferred.promise);

    await renderApp('/cadastros/funcoes');
    await resolveBootstrap(0, snapshot());
    expect(text()).toContain('Nenhuma função cadastrada');

    await click(buttonByText('Nova função'));
    await changeInput(requireInput('form input'), 'Designer');
    await submitDialogForm();

    // The POST is still in flight and the refetch has not been resolved, so the only
    // thing that can have put the row on screen is the optimistic write.
    expect(vi.mocked(salesOpsApi.saveFuncao)).toHaveBeenCalledTimes(1);
    const row = container.querySelector('tbody tr');
    expect(row?.textContent).toContain('Designer');
    expect(row?.textContent).toContain('Personalizada');
    expect(text()).not.toContain('Nenhuma função cadastrada');
  });

  it('shows a new função in the list once the create POST resolves, with no further user action', async () => {
    const saveFuncaoDeferred = createDeferred<{ funcao: SalesOpsFuncao }>();
    vi.mocked(salesOpsApi.saveFuncao).mockReturnValueOnce(saveFuncaoDeferred.promise);

    await renderApp('/cadastros/funcoes');
    await resolveBootstrap(0, snapshot());
    expect(text()).toContain('Nenhuma função cadastrada');

    await click(buttonByText('Nova função'));
    await changeInput(requireInput('form input'), 'Designer');
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.saveFuncao)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(salesOpsApi.saveFuncao).mock.calls[0]?.[0]).toEqual({
      name: 'Designer',
      status: 'active',
    });

    await act(async () => {
      saveFuncaoDeferred.resolve({ funcao: persistedFuncao });
    });
    await flushReact();

    await resolveBootstrap(1, snapshot({ funcoes: [persistedFuncao] }));

    expect(text()).toContain('Designer');
    expect(text()).toContain('Personalizada');
    expect(text()).not.toContain('Nenhuma função cadastrada');
    expect(vi.mocked(salesOpsApi.bootstrap)).toHaveBeenCalledTimes(2);
  });

  it('discloses the pending refresh while the bootstrap refetch is in flight', async () => {
    const saveProductDeferred = createDeferred<{ product: SalesOpsProduct }>();
    vi.mocked(salesOpsApi.saveProduct).mockReturnValueOnce(saveProductDeferred.promise);

    await renderApp('/cadastros/produtos');
    await resolveBootstrap(0, snapshot({ areas: [existingArea] }));
    expect(headerText()).not.toContain('Atualizando');

    await click(buttonByText('Novo produto'));
    await changeInput(requireInput('input[placeholder="Nome"]'), 'FXL Produto Novo');
    await pickOption('Área do produto', existingArea.name);
    expect(comboboxText('Área do produto')).toBe(existingArea.name);
    await submitDialogForm();

    await act(async () => {
      saveProductDeferred.resolve({ product: persistedProduct });
    });
    await flushReact();

    expect(headerText()).toContain('Atualizando');

    await resolveBootstrap(1, snapshot({ areas: [existingArea], products: [persistedProduct] }));
    expect(headerText()).not.toContain('Atualizando');
  });
});
