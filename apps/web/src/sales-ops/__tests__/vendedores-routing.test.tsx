// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
import type { AppRole } from '@/auth/claims';
import { SalesOpsApp } from '../SalesOpsApp';
import type { SalesOpsFuncao } from '../types';

/**
 * THE ORACLE of slice 07: the same URL, `/cadastros/pessoas`, in both editions.
 *
 * The full edition must keep today's Pessoas screen and the real `PersonDialog`
 * (função picker, Salvar locked without a função); the leads edition must mount the
 * Vendedores screen and dialog instead. Scaffolding copied from
 * `leads-routing.test.tsx`, with the alert dialog mocked so the confirmation click is
 * deterministic.
 */

const funcaoVendedor: SalesOpsFuncao = {
  id: 'fc000001-0000-4000-8000-000000000001',
  orgId: '22222222-2222-4222-8222-222222222222',
  name: 'Vendedor',
  slug: 'vendedor',
  isSystem: true,
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
};
const funcaoFinder: SalesOpsFuncao = {
  ...funcaoVendedor,
  id: 'fc000002-0000-4000-8000-000000000002',
  name: 'Finder',
  slug: 'finder',
};

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

let profileRoles: AppRole[] = [];
let edition: SalesEdition = 'full';

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(async () => undefined),
  setActive: vi.fn(async (_organizationId: string) => undefined),
  checkoutUrl: vi.fn(async () => 'https://hub.example/checkout'),
}));

const hubClient = { checkoutUrl: authMocks.checkoutUrl };
const primaryOrganization = { id: 'org-primary', name: 'FXL Matriz' };

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: profileRoles,
    edition,
    name: 'Test User',
    email: 'test.user@fxl.example',
  }),
  useLogout: () => authMocks.logout,
  useOrganizations: () => ({
    active: primaryOrganization,
    activeName: primaryOrganization.name,
    organizations: [primaryOrganization],
    others: [],
    setActive: authMocks.setActive,
    client: hubClient,
  }),
  useSalesEdition: () => edition,
}));

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

const statusMutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

const vendedorFixture = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Alex Silva',
  contactEmail: 'alex.silva@fxl.example',
  status: 'active' as const,
  funcaoIds: [funcaoVendedor.id],
  funcoes: [funcaoVendedor],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
};

const finderOnlyFixture = {
  ...vendedorFixture,
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Bia Indicadora',
  contactEmail: null,
  funcaoIds: [funcaoFinder.id],
  funcoes: [funcaoFinder],
};

const archivedVendedorFixture = {
  ...vendedorFixture,
  id: '44444444-4444-4444-8444-444444444444',
  displayName: 'Caio Arquivado',
  contactEmail: null,
  status: 'inactive' as const,
};

vi.mock('../hooks', () => ({
  useSalesOpsBootstrap: () => ({
    data: {
      sales: [],
      products: [],
      clients: [],
      areas: [],
      funcoes: [funcaoVendedor, funcaoFinder],
      people: [archivedVendedorFixture, vendedorFixture, finderOnlyFixture],
      payables: [],
      saleItems: [],
      receivables: [],
      productFuncaoCosts: [],
      saleProfessionals: [],
      settings: null,
    },
    isLoading: false,
    isError: false,
  }),
  useCreateSalesOpsSale: () => mutation,
  useUpdateSalesOpsSale: () => mutation,
  useTransitionSalesOpsSale: () => mutation,
  useCancelSalesOpsContract: () => mutation,
  useSaveSalesOpsArea: () => mutation,
  useSaveSalesOpsClient: () => mutation,
  useSaveSalesOpsFuncao: () => mutation,
  useSaveSalesOpsPerson: () => mutation,
  useSaveSalesOpsProduct: () => mutation,
  useSaveSalesOpsSettings: () => mutation,
  useSetSalesOpsCadastroStatus: () => statusMutation,
}));

vi.mock('../leads/LeadsBoardContainer', () => ({
  LeadsBoardContainer: () => <div data-leads-board />,
}));

vi.mock('../leads/LeadStagesContainer', () => ({
  LeadStagesContainer: () => <div data-lead-stages />,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DialogContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
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

/* The CloseCtx version from cadastro-history.test.tsx, so the confirmation click is deterministic. */
vi.mock('@/components/ui/alert-dialog', () => {
  const CloseCtx = React.createContext<() => void>(() => undefined);
  return {
    AlertDialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open: boolean;
      onOpenChange?: (open: boolean) => void;
    }) =>
      open ? (
        <CloseCtx.Provider value={() => onOpenChange?.(false)}>
          <div data-alert-dialog>{children}</div>
        </CloseCtx.Provider>
      ) : null,
    AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    AlertDialogAction: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
      <button onClick={onClick} type="button">
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children }: { children: ReactNode }) => {
      const close = React.useContext(CloseCtx);
      return (
        <button onClick={close} type="button">
          {children}
        </button>
      );
    },
  };
});

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container.remove();
  mutation.mutate.mockReset();
  statusMutation.mutate.mockReset();
  vi.clearAllMocks();
});

async function renderRoute(path: string, roles: AppRole[], nextEdition: SalesEdition) {
  if (root) {
    await act(async () => root?.unmount());
  }
  profileRoles = [...roles];
  edition = nextEdition;
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[path]}
      >
        <Routes>
          <Route element={<SalesOpsApp />} path="/" />
          <Route element={<SalesOpsApp />} path="/:workspace/:view" />
        </Routes>
      </MemoryRouter>,
    );
  });
  for (let index = 0; index < 3; index += 1) {
    await act(async () => Promise.resolve());
  }
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('form not found');
  await act(async () =>
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

function header(): HTMLElement {
  const match = container.querySelector('header');
  if (!(match instanceof HTMLElement)) throw new Error('header not found');
  return match;
}

function headerButton(label: string): HTMLButtonElement | null {
  return (
    [...header().querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    ) ?? null
  );
}

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function buttonByAriaLabel(label: string): HTMLButtonElement {
  const match = container.querySelector(`button[aria-label="${label}"]`);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function columnHeaders(): string[] {
  return [...container.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
}

function rowNames(): string[] {
  return [...container.querySelectorAll('tbody tr')].map(
    (row) => row.querySelector('td')?.firstChild?.textContent ?? '',
  );
}

describe('/cadastros/pessoas in the full edition', () => {
  it('full edition keeps the Pessoas screen with funções', async () => {
    await renderRoute('/cadastros/pessoas', ['admin'], 'full');

    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Pessoas');
    expect(headerButton('Nova pessoa')).not.toBeNull();
    expect(headerButton('Novo vendedor')).toBeNull();
    expect(columnHeaders()).toContain('Funções');
    const badges = [...container.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(badges).toContain('Vendedor');
    expect(badges).toContain('Finder');
    expect(container.querySelector('[data-vendedores-view]')).toBeNull();
  });

  it('full edition PersonDialog still requires a função', async () => {
    await renderRoute('/cadastros/pessoas', ['admin'], 'full');
    const action = headerButton('Nova pessoa');
    if (!action) throw new Error('Nova pessoa not found');
    await click(action);

    const titles = [...container.querySelectorAll('h2')].map((h2) => h2.textContent);
    expect(titles).toContain('Pessoa');
    expect(
      container.querySelector('button[role="combobox"][aria-label="Função da pessoa"]'),
    ).not.toBeNull();

    const nameInput = container.querySelector('form input');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await change(nameInput, 'Halland');
    expect(buttonByText('Salvar').disabled).toBe(true);
    expect(container.textContent).toContain('Atribua ao menos uma função.');
    await submit();
    expect(mutation.mutate).not.toHaveBeenCalled();
  });

  it('full edition still hides inactive pessoas', async () => {
    await renderRoute('/cadastros/pessoas', ['admin'], 'full');
    expect(container.textContent).not.toContain('Caio Arquivado');
  });

});

describe('/cadastros/pessoas in the leads edition', () => {
  it('leads edition mounts Vendedores without funções', async () => {
    await renderRoute('/cadastros/pessoas', ['admin'], 'leads');

    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Vendedores');
    expect(header().textContent).toContain(
      'Vendedores da equipe que podem receber leads na prospecção',
    );
    expect(headerButton('Novo vendedor')).not.toBeNull();
    expect(headerButton('Nova pessoa')).toBeNull();
    expect(columnHeaders()).not.toContain('Funções');
    expect(container.querySelector('[data-vendedores-view]')).not.toBeNull();

    expect(rowNames()).toEqual(['Alex Silva', 'Bia Indicadora', 'Caio Arquivado']);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows[0]?.querySelector('[data-vendedor-status-badge]')).toBeNull();
    expect(rows[1]?.querySelector('[data-vendedor-status-badge]')).toBeNull();
    expect(rows[2]?.querySelector('[data-vendedor-status-badge]')?.textContent).toBe('Inativo');
    expect(buttonByAriaLabel('Reativar vendedor Caio Arquivado')).not.toBeNull();
  });

  it('leads edition dialog saves a vendedor by name', async () => {
    await renderRoute('/cadastros/pessoas', ['admin'], 'leads');
    const action = headerButton('Novo vendedor');
    if (!action) throw new Error('Novo vendedor not found');
    await click(action);

    const titles = [...container.querySelectorAll('h2')].map((h2) => h2.textContent);
    expect(titles).toContain('Vendedor');
    expect(
      container.querySelector('button[role="combobox"][aria-label="Função da pessoa"]'),
    ).toBeNull();
    expect(container.textContent).toContain(
      'Use o mesmo e-mail com que o vendedor entra no sistema.',
    );

    const nameInput = container.querySelector('input[name="displayName"]');
    if (!(nameInput instanceof HTMLInputElement)) throw new Error('name input not found');
    await change(nameInput, 'Ana Lima');
    await submit();

    expect(mutation.mutate).toHaveBeenCalledTimes(1);
    expect(mutation.mutate.mock.calls[0]?.[0]).toEqual({
      id: undefined,
      displayName: 'Ana Lima',
      contactEmail: undefined,
      status: 'active',
      funcaoIds: [funcaoVendedor.id],
    });
  });

  it('leads edition inactivates through the people resource', async () => {
    await renderRoute('/cadastros/pessoas', ['admin'], 'leads');
    await click(buttonByAriaLabel('Inativar vendedor Alex Silva'));
    await click(buttonByText('Inativar vendedor'));

    expect(statusMutation.mutate).toHaveBeenCalledTimes(1);
    expect(statusMutation.mutate.mock.calls[0]?.[0]).toEqual({
      resource: 'people',
      id: vendedorFixture.id,
      status: 'inactive',
    });
  });

  it('leads edition reactivates through the people resource', async () => {
    await renderRoute('/cadastros/pessoas', ['admin'], 'leads');
    await click(buttonByAriaLabel('Reativar vendedor Caio Arquivado'));

    expect(container.querySelector('[data-alert-dialog]')).toBeNull();
    expect(statusMutation.mutate).toHaveBeenCalledTimes(1);
    expect(statusMutation.mutate.mock.calls[0]?.[0]).toEqual({
      resource: 'people',
      id: archivedVendedorFixture.id,
      status: 'active',
    });
  });
});
