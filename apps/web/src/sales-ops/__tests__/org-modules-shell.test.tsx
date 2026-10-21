// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgModules } from '@fxl-sales/shared-utils/crm-model';
import type { SalesEdition } from '@fxl-sales/shared-utils/sales-edition';
import type { AppRole } from '@/auth/claims';
import { SalesOpsApp } from '../SalesOpsApp';

/**
 * THE SHELL ON THE ORGANIZATION'S MODULES (slice 12b).
 *
 * The harness of `leads-routing.test.tsx`, with the bootstrap a variable the test sets:
 * its `orgModules`, its loading and its error state. The token edition is a separate
 * variable, so each case can prove which source the shell trusted.
 */

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

/** The org's modules, hand-written: the Construbom leads set (orcamentos off, clientes and importacao on). */
const LEADS_MODULES: OrgModules = {
  orcamentos: false,
  comissoes: false,
  financeiro: false,
  finders: false,
  catalogo: false,
  importacao: true,
  clientes: true,
};
const FULL_MODULES: OrgModules = {
  orcamentos: true,
  comissoes: true,
  financeiro: true,
  finders: true,
  catalogo: true,
  importacao: true,
  clientes: true,
};

let profileRoles: AppRole[] = [];
let profileEdition: SalesEdition | undefined;
let bootstrapState: {
  data: Record<string, unknown> | undefined;
  isLoading: boolean;
  isError: boolean;
};

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
    edition: profileEdition,
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
  useSalesEdition: () => profileEdition ?? 'full',
}));

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

vi.mock('../hooks', () => ({
  useSalesOpsBootstrap: () => bootstrapState,
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

vi.mock('../leads/LeadsBoardContainer', () => ({
  LeadsBoardContainer: () => <div data-leads-board />,
}));

vi.mock('../leads/hooks', () => ({
  useLeadStages: () => ({ data: [], isPending: false, isError: false }),
}));

vi.mock('../leads/LeadSummaryContainer', () => ({
  LeadSummaryContainer: () => <div data-lead-summary />,
}));

vi.mock('../leads/LeadStagesContainer', () => ({
  LeadStagesContainer: () => <div data-lead-stages />,
}));

vi.mock('../leads/DeletedLeadsContainer', () => ({
  DeletedLeadsContainer: () => <div data-deleted-leads-container />,
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
  bootstrapState = { data: undefined, isLoading: true, isError: false };
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container.remove();
  vi.clearAllMocks();
});

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location-path">{`${pathname}${search}`}</output>;
}

const locationPath = () =>
  container.querySelector('[data-testid="location-path"]')?.textContent;

/** A settled bootstrap that carries the organization's modules. */
function settled(orgModules: OrgModules | undefined) {
  bootstrapState = {
    data: {
      ...(orgModules ? { orgModules } : {}),
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
    },
    isLoading: false,
    isError: false,
  };
}

async function renderTree(path: string) {
  await act(async () => {
    root?.render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
        initialEntries={[path]}
      >
        <Routes>
          <Route element={<SalesOpsApp />} path="/" />
          <Route element={<SalesOpsApp />} path="/:workspace/:view" />
          <Route element={<SalesOpsApp />} path="/:workspace/:view/:saleId" />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  // Three ticks, as in no-role-redirect.test.tsx, so a `<Navigate>` hop settles.
  for (let index = 0; index < 3; index += 1) {
    await act(async () => Promise.resolve());
  }
}

/** A fresh mount at `path`. */
async function render(path: string, roles: AppRole[], edition?: SalesEdition) {
  if (root) {
    await act(async () => root?.unmount());
  }
  profileRoles = [...roles];
  profileEdition = edition;
  root = createRoot(container);
  await renderTree(path);
}

/** Re-renders the SAME mounted shell after the bootstrap state changed (no remount). */
async function refreshBootstrap(path: string) {
  await renderTree(path);
}

/** The sidebar's item labels in render order (the leads item is a labelled button too). */
function sidebarLabels(): string[] {
  return [...container.querySelectorAll('aside nav [aria-label]')]
    .map((node) => node.getAttribute('aria-label') ?? '')
    .filter((label) => !label.startsWith('Abrir etapa'));
}

describe('the shell reads the organization modules from the bootstrap', () => {
  it("the bootstrap's leads modules win over a full token hint", async () => {
    settled(LEADS_MODULES);
    await render('/tatico/dashboard', ['admin', 'seller', 'finder']);

    expect(locationPath()).toBe('/operacional/funil');
    expect(sidebarLabels()).toContain('Prospecção');
    expect(sidebarLabels()).not.toContain('Propostas');
  });

  it("the bootstrap's full modules win over a leads token hint: a deep link is not rewritten", async () => {
    settled(FULL_MODULES);
    await render('/operacional/vendas', ['admin'], 'leads');

    expect(locationPath()).toBe('/operacional/vendas');
    expect(sidebarLabels()).toContain('Propostas');
  });

  it('a toggled flag shows its entry before the rest of the workspace', async () => {
    settled({ ...LEADS_MODULES, comissoes: true });
    await render('/operacional/funil', ['admin']);

    const labels = sidebarLabels();
    expect(labels).toContain('Comissões');
    expect(labels.indexOf('Comissões')).toBeLessThan(labels.indexOf('Prospecção'));
  });

  it('no redirect while the bootstrap is loading, even for a URL the leads hint would rewrite', async () => {
    bootstrapState = { data: undefined, isLoading: true, isError: false };
    await render('/operacional/vendas', ['admin'], 'leads');
    expect(locationPath()).toBe('/operacional/vendas');

    // The bootstrap settles with the full modules: the same valid deep link still stands.
    settled(FULL_MODULES);
    await refreshBootstrap('/operacional/vendas');
    expect(locationPath()).toBe('/operacional/vendas');
  });

  it('no redirect while loading for the lead summary deep link with its stage query', async () => {
    bootstrapState = { data: undefined, isLoading: true, isError: false };
    const summary = '/operacional/leads/5b0e7c1e-3f4a-4c2d-9e8b-1a2b3c4d5e6f?etapa=stage-1';
    await render(summary, ['admin'], 'leads');
    expect(locationPath()).toBe(summary);
  });

  it('a failed bootstrap settles and falls back to the token hint', async () => {
    bootstrapState = { data: undefined, isLoading: false, isError: true };
    await render('/operacional/vendas', ['admin'], 'leads');

    expect(locationPath()).toBe('/operacional/funil');
  });

  it('a bootstrap without orgModules (a hand-written fixture) keeps the token hint', async () => {
    settled(undefined);
    await render('/operacional/vendas', ['admin'], 'leads');

    expect(locationPath()).toBe('/operacional/funil');
  });
});

/** Every button whose visible text is exactly `label` (the header and the sidebar both carry one). */
function buttonsLabelled(label: string): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter(
    (button) => button.textContent?.trim() === label,
  );
}

describe('the proposta and commission chrome follows the modules, not the edition hint', () => {
  it('orcamentos off: Comissoes shows no Nova proposta action', async () => {
    settled({ ...LEADS_MODULES, comissoes: true });
    await render('/operacional/comissoes', ['admin']);

    expect(locationPath()).toBe('/operacional/comissoes');
    expect(buttonsLabelled('Nova proposta')).toHaveLength(0);
  });

  it('orcamentos on: Comissoes keeps the Nova proposta action', async () => {
    settled(FULL_MODULES);
    await render('/operacional/comissoes', ['admin']);

    expect(locationPath()).toBe('/operacional/comissoes');
    expect(buttonsLabelled('Nova proposta').length).toBeGreaterThan(0);
  });

  it('comissoes on with orcamentos off: the commission balance card shows', async () => {
    settled({ ...LEADS_MODULES, comissoes: true });
    await render('/operacional/funil', ['admin']);

    expect(container.textContent).toContain('A pagar este mês');
  });

  it('comissoes off with orcamentos on: the commission balance card is hidden', async () => {
    settled({ ...FULL_MODULES, comissoes: false });
    await render('/operacional/funil', ['admin']);

    expect(container.textContent).not.toContain('A pagar este mês');
  });
});
