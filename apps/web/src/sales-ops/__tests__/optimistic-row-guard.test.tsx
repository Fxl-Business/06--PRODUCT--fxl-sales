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

/**
 * Funções replace the three removed `is_seller` / `is_finder` / `is_collaborator`
 * mirrors on a pessoa. `vendedor` is one of the two predefined system funções;
 * `prestador` is an ordinary custom one, which is what makes a pessoa a prestador.
 */
const funcaoVendedor: SalesOpsFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  orgId,
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
};
const funcaoPrestador: SalesOpsFuncao = {
  ...funcaoVendedor,
  id: 'fc000003-0000-4000-8000-000000000003',
  name: 'Prestador',
  slug: 'prestador',
  isSystem: false,
};
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
  funcaoIds: [funcaoVendedor.id, funcaoPrestador.id],
  funcoes: [funcaoVendedor, funcaoPrestador],
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

function comboboxTrigger(ariaLabel: string): HTMLButtonElement {
  const match = container.querySelector(`button[role="combobox"][aria-label="${ariaLabel}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`combobox not found: ${ariaLabel}`);
  return match;
}

/** Open the picker and commit the row whose visible label starts with `optionLabel`. */
async function pickOption(ariaLabel: string, optionLabel: string) {
  await click(comboboxTrigger(ariaLabel));
  const row = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
    candidate.textContent?.trim().startsWith(optionLabel),
  );
  if (!(row instanceof HTMLElement)) throw new Error(`option not found: ${optionLabel}`);
  await click(row);
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

    await renderApp('/cadastros/pessoas');
    await resolveBootstrap(0, snapshot({ funcoes: [funcaoVendedor] }));

    await click(buttonByText('Nova pessoa'));
    await changeInput(requireInput('form input'), 'Pessoa Optimista');
    await pickOption('Função da pessoa', funcaoVendedor.name);
    await click(buttonByText('Adicionar função'));
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.savePerson)).toHaveBeenCalledTimes(1);
    const pendingButton = requireButtonByAriaLabel('Salvando Pessoa Optimista');
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute('title')).toBe('Salvando...');
    expect(container.querySelector('button[aria-label="Editar Pessoa Optimista"]')).toBeNull();
  });

  it('disables the função edit affordance while the create POST is in flight', async () => {
    const saveFuncaoDeferred = createDeferred<{ funcao: SalesOpsFuncao }>();
    vi.mocked(salesOpsApi.saveFuncao).mockReturnValueOnce(saveFuncaoDeferred.promise);

    await renderApp('/cadastros/funcoes');
    await resolveBootstrap(0, snapshot());

    await click(buttonByText('Nova função'));
    await changeInput(requireInput('form input'), 'Função Optimista');
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.saveFuncao)).toHaveBeenCalledTimes(1);
    const pendingButton = requireButtonByAriaLabel('Salvando Função Optimista');
    expect(pendingButton.disabled).toBe(true);
    expect(pendingButton.getAttribute('title')).toBe('Salvando...');
    expect(container.querySelector('button[aria-label="Editar Função Optimista"]')).toBeNull();
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
      funcoes: [funcaoVendedor, funcaoPrestador],
      clients: [persistedClient],
      people: [persistedPerson],
    });
    expect(withoutOptimisticRows(snap)).toBe(snap);
  });

  it('strips optimistic áreas, clientes, funções and pessoas and keeps every other collection by reference', () => {
    const snap = snapshot({
      areas: [
        persistedArea,
        { ...persistedArea, id: optimisticId('areas', 'Nova'), name: 'Nova' },
      ],
      clients: [
        persistedClient,
        { ...persistedClient, id: optimisticId('clients', 'Novo'), name: 'Novo' },
      ],
      funcoes: [
        funcaoPrestador,
        { ...funcaoPrestador, id: optimisticId('funcoes', 'Nova'), name: 'Nova' },
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
    expect(result.funcoes).toHaveLength(1);
    expect(result.people).toHaveLength(1);
    expect(result.areas[0]?.id).toBe(persistedArea.id);
    expect(result.clients[0]?.id).toBe(persistedClient.id);
    expect(result.funcoes[0]?.id).toBe(funcaoPrestador.id);
    expect(result.people[0]?.id).toBe(persistedPerson.id);
    expect(
      [...result.areas, ...result.clients, ...result.funcoes, ...result.people].some((row) =>
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

    const produtosNav = container.querySelector(
      'nav button[aria-label="Produtos & Serviços"]',
    );
    if (!(produtosNav instanceof HTMLButtonElement)) {
      throw new Error('nav Produtos & Serviços not found');
    }
    await click(produtosNav);

    // The create POST is still in flight, so the optimistic área is still cached.
    expect(vi.mocked(salesOpsApi.saveArea)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(salesOpsApi.bootstrap)).toHaveBeenCalledTimes(1);

    await click(buttonByText('Novo produto'));
    await click(comboboxTrigger('Área do produto'));
    const rows = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
    const offered = rows.map((row) => row.textContent?.trim());

    // Positive control: the persisted área is offered, and it is the only one.
    expect(offered).toEqual([existingArea.name]);
    expect(offered).not.toContain('AAA Área Nova');

    // And the id the picker hands to a real request is the persisted uuid, never the
    // placeholder. Asserting the payload rather than a DOM attribute keeps the id-level
    // guarantee the `option[value]` check used to give.
    await click(rows[0]!);
    await changeInput(requireInput('input[placeholder="Nome"]'), 'FXL Produto Novo');
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.saveProduct)).toHaveBeenCalledTimes(1);
    const productPayload = vi.mocked(salesOpsApi.saveProduct).mock.calls[0]?.[0];
    expect(productPayload?.areaId).toBe(existingArea.id);
    expect(String(productPayload?.areaId)).not.toMatch(/^optimistic:/);
  });

  it('keeps an unsaved função out of the pessoa função picker', async () => {
    const saveFuncaoDeferred = createDeferred<{ funcao: SalesOpsFuncao }>();
    vi.mocked(salesOpsApi.saveFuncao).mockReturnValueOnce(saveFuncaoDeferred.promise);

    await renderApp('/cadastros/funcoes');
    await resolveBootstrap(0, snapshot({ funcoes: [funcaoPrestador] }));

    await click(buttonByText('Nova função'));
    await changeInput(requireInput('form input'), 'AAA Função Nova');
    await submitDialogForm();
    expect(text()).toContain('AAA Função Nova');

    await click(buttonByText('Cancelar'));

    const pessoasNav = container.querySelector('nav button[aria-label="Pessoas"]');
    if (!(pessoasNav instanceof HTMLButtonElement)) throw new Error('nav Pessoas not found');
    await click(pessoasNav);

    // The create POST is still in flight, so the optimistic função is still cached.
    expect(vi.mocked(salesOpsApi.saveFuncao)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(salesOpsApi.bootstrap)).toHaveBeenCalledTimes(1);

    await click(buttonByText('Nova pessoa'));
    await changeInput(requireInput('form input'), 'Pessoa Nova');
    await click(comboboxTrigger('Função da pessoa'));
    const rows = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
    const offered = rows.map((row) => row.textContent?.trim());

    // Positive control: the persisted função is offered, and it is the only one.
    expect(offered).toEqual([funcaoPrestador.name]);
    expect(offered).not.toContain('AAA Função Nova');

    await click(rows[0]!);
    await click(buttonByText('Adicionar função'));
    await submitDialogForm();

    expect(vi.mocked(salesOpsApi.savePerson)).toHaveBeenCalledTimes(1);
    const personPayload = vi.mocked(salesOpsApi.savePerson).mock.calls[0]?.[0];
    expect(personPayload?.funcaoIds).toEqual([funcaoPrestador.id]);
    expect(String(personPayload?.funcaoIds[0])).not.toMatch(/^optimistic:/);
  });
});

/**
 * A produto default cost now keys on a FUNÇÃO rather than a free-text person name, so
 * the pool the app hands `ProductDialog` is `bootstrap.funcoes`, not a filtered slice
 * of `people`. This pins that wiring contract, which no ProductDialog-level test can
 * see, and replaces the old prestador-pool test whose editor this screen removed.
 */
describe('the produto função cost pool', () => {
  const funcaoArquivada: SalesOpsFuncao = {
    ...funcaoPrestador,
    id: 'fc000004-0000-4000-8000-000000000004',
    name: 'Função Arquivada',
    slug: 'funcao-arquivada',
    status: 'archived',
  };

  it('offers the org custom funções, and never a system função or an archived one', async () => {
    await renderApp('/cadastros/produtos');
    await resolveBootstrap(
      0,
      snapshot({
        areas: [existingArea],
        funcoes: [funcaoVendedor, funcaoPrestador, funcaoArquivada],
        people: [persistedPerson],
      }),
    );

    await click(buttonByText('Novo produto'));

    const addCost = [...container.querySelectorAll('button')].find(
      (candidate) =>
        candidate.textContent?.trim() === 'Adicionar' &&
        candidate.closest('div.border-t')?.textContent?.includes('Custos padrão por função'),
    );
    if (!(addCost instanceof HTMLButtonElement)) {
      throw new Error('Adicionar custo padrão button not found');
    }
    await click(addCost);

    await click(comboboxTrigger('Função do custo padrão 1'));
    const offered = [...container.querySelectorAll<HTMLElement>('[role="option"]')].map((row) =>
      row.textContent?.trim(),
    );

    // Positive control: the org's custom função really does reach the picker, so a pool
    // that had collapsed to empty could not pass this test.
    expect(offered).toContain('Prestador');
    // A vendedor is already paid by the Comissionamento padrão block; offering it here
    // would create two competing ways to pay the same role.
    expect(offered).not.toContain('Vendedor');
    expect(offered).not.toContain('Função Arquivada');
  });
});
