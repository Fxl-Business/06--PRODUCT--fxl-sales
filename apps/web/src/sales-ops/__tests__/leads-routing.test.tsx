// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/auth/claims';
import { SalesOpsApp } from '../SalesOpsApp';
import type { SalesOpsFuncao } from '../types';

/**
 * THE MOUNT ORACLE.
 *
 * A dedicated file rather than an extension of `routing.test.tsx`, for one
 * concrete reason: that file replaces `'../hooks'` wholesale and renders with no
 * `QueryClientProvider`. The lead hooks live in a DIFFERENT module
 * (`../leads/hooks`), so a lead view rendered there would still need a query
 * client. Mocking the two CONTAINERS is what removes that requirement, and it is
 * the right seam: the question here is whether the SHELL mounts the right thing
 * with the right props at the right URL, which neither 05's nor 06's own suite
 * can answer.
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
}));

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

/** ACTIVE and carries `vendedor`: the only pessoa the seller options may contain. */
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

/** ACTIVE but carries only `finder`: what a derivation over every pessoa lets through. */
const finderOnlyFixture = {
  ...vendedorFixture,
  id: '33333333-3333-4333-8333-333333333333',
  displayName: 'Bia Indicadora',
  contactEmail: null,
  funcaoIds: [funcaoFinder.id],
  funcoes: [funcaoFinder],
};

/** Carries `vendedor` but is ARCHIVED: what a derivation ignoring `status` lets through. */
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
      people: [vendedorFixture, finderOnlyFixture, archivedVendedorFixture],
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
  useSetSalesOpsCadastroStatus: () => mutation,
}));

const containerProps = vi.hoisted(() => ({
  board: vi.fn(),
  stages: vi.fn(),
}));

vi.mock('../leads/LeadsBoardContainer', () => ({
  LeadsBoardContainer: (props: Record<string, unknown>) => {
    containerProps.board(props);
    return <div data-leads-board />;
  },
}));

vi.mock('../leads/LeadStagesContainer', () => ({
  LeadStagesContainer: (props: Record<string, unknown>) => {
    containerProps.stages(props);
    return <div data-lead-stages />;
  },
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
  vi.clearAllMocks();
});

async function renderRoute(path: string, roles: AppRole[]) {
  if (root) {
    await act(async () => root?.unmount());
  }
  containerProps.board.mockClear();
  containerProps.stages.mockClear();
  profileRoles = [...roles];
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
  await act(async () => Promise.resolve());
}

function boardProps(): Record<string, unknown> {
  const call = containerProps.board.mock.calls.at(-1);
  if (!call) throw new Error('LeadsBoardContainer was never rendered');
  return call[0] as Record<string, unknown>;
}

function headerText(): string {
  return container.querySelector('header')?.textContent ?? '';
}

describe('lead screens inside the Sales Ops shell', () => {
  it('mounts the leads board at operacional/leads with the seller filter offered', async () => {
    await renderRoute('/operacional/leads', ['admin']);

    expect(container.querySelector('[data-leads-board]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Prospecção');
    expect(boardProps().showSellerFilter).toBe(true);
    // Active AND carrying `vendedor`. The finder-only and the archived vendedor
    // fixtures are the two rows a wrong derivation lets through.
    expect(boardProps().sellers).toEqual([
      { value: vendedorFixture.id, label: vendedorFixture.displayName },
    ]);
  });

  it('mounts the same board at meus-dados/leads without the seller filter', async () => {
    await renderRoute('/meus-dados/leads', ['seller']);

    expect(container.querySelector('[data-leads-board]')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Minha prospecção');
    // The scope is the SERVER's. This boolean only decides whether an admin is
    // offered the narrowing picker; a constant `true` would hand a seller a
    // vendedor control over a board the server has already narrowed.
    expect(boardProps().showSellerFilter).toBe(false);
  });

  it('mounts the etapas cadastro at cadastros/etapas and nowhere else', async () => {
    await renderRoute('/cadastros/etapas', ['admin']);
    expect(container.querySelector('[data-lead-stages]')).not.toBeNull();
    expect(container.querySelector('[data-leads-board]')).toBeNull();
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Etapas do funil');

    // An unconditional mount is the mutation that would fire `useLeadStages()`
    // and `useLeadsBoard()` from the dashboard, which is why both containers exist.
    for (const path of ['/cadastros/produtos', '/tatico/dashboard']) {
      await renderRoute(path, ['admin']);
      expect(container.querySelector('[data-lead-stages]')).toBeNull();
      expect(container.querySelector('[data-leads-board]')).toBeNull();
    }
  });

  it('offers no proposta header action on either lead screen', async () => {
    await renderRoute('/operacional/leads', ['admin']);
    expect(headerText()).not.toContain('Nova proposta');
    expect(headerText()).not.toContain('Novo produto');
    expect(headerText()).not.toContain('Nova área');

    await renderRoute('/cadastros/etapas', ['admin']);
    expect(headerText()).not.toContain('Nova proposta');
    expect(headerText()).not.toContain('Novo produto');
    expect(headerText()).not.toContain('Nova área');

    // The non-vacuity control: without it the three assertions above pass over a
    // shell that renders no header at all.
    await renderRoute('/operacional/vendas', ['admin']);
    expect(headerText()).toContain('Nova proposta');
  });
});
