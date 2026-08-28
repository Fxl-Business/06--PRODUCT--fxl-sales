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
 * The locked oracle for the sales-ops account dropdown's Organization switcher.
 *
 * A separate file from `routing.test.tsx` on purpose: this needs a per-test
 * `organizations` fixture and a `setActive` spy, and `routing.test.tsx`'s closed
 * module-level `vi.mock` factory cannot vary either without disturbing every routing
 * assertion in it.
 */

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

type Organization = { id: string; name?: string; products?: string[] };

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(async () => undefined),
  setActive: vi.fn(async (_organizationId: string) => undefined),
  checkoutUrl: vi.fn(async () => 'https://hub.example/checkout'),
}));

let profileRoles: AppRole[] = ['admin'];
let active: Organization | null = null;
let organizations: Organization[] = [];
let others: Organization[] = [];

/**
 * Allocated ONCE at module scope. A fresh object literal per render allocates a new
 * `client` every time, and any effect that depends on it then re-runs forever.
 */
const hubClient = { checkoutUrl: authMocks.checkoutUrl };

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
    active,
    activeName: active?.name,
    organizations,
    others,
    setActive: authMocks.setActive,
    client: hubClient,
  }),
}));

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

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

vi.mock('../hooks', () => ({
  useSalesOpsBootstrap: () => ({
    data: {
      sales: [],
      products: [],
      clients: [],
      areas: [],
      funcoes: [funcaoVendedor, funcaoFinder],
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

const alfa: Organization = { id: 'org-a', name: 'Alfa Consultoria' };
const beta: Organization = { id: 'org-b', name: 'Beta Engenharia' };
const nameless: Organization = { id: 'org-c' };

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  profileRoles = ['admin'];
  active = alfa;
  organizations = [alfa, beta, nameless];
  others = [beta, nameless];
  authMocks.setActive.mockImplementation(async () => undefined);
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
  await act(async () => Promise.resolve());
}

async function renderRoute(path: string) {
  if (root) {
    await act(async () => root?.unmount());
  }
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
  await flushReact();
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await flushReact();
}

function sidebar(): HTMLElement | null {
  return container.querySelector('aside');
}

function byName(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

function buttonByTextOrNull(label: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    ) ?? null
  );
}

async function openAccountMenu() {
  const trigger = byName('Abrir menu da conta');
  if (!trigger) throw new Error('account menu trigger not found');
  await click(trigger);
}

describe('sales-ops account dropdown Organization switcher', () => {
  it('lists the account other Organizations beside Sair', async () => {
    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    expect(sidebar()?.textContent).toContain('Organização');
    expect(byName('Trocar para Beta Engenharia')).not.toBeNull();
    expect(byName('Organização atual: Alfa Consultoria')).not.toBeNull();
    expect(buttonByTextOrNull('Sair')).not.toBeNull();
  });

  it('does not offer the active Organization as a switch target', async () => {
    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    expect(byName('Trocar para Alfa Consultoria')).toBeNull();
    const activeRow = byName('Organização atual: Alfa Consultoria');
    expect(activeRow?.closest('[role="menuitem"]')?.hasAttribute('data-disabled')).toBe(true);
  });

  it('calls setActive with the chosen Organization id', async () => {
    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    await click(byName('Trocar para Beta Engenharia')!);

    expect(authMocks.setActive).toHaveBeenCalledTimes(1);
    expect(authMocks.setActive).toHaveBeenCalledWith('org-b');
  });

  it('renders no Organization section and still offers Sair when the account has a single Organization', async () => {
    active = alfa;
    organizations = [alfa];
    others = [];
    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    expect(sidebar()?.textContent).not.toContain('Organização');
    expect(container.querySelector('button[aria-label^="Trocar para"]')).toBeNull();
    expect(buttonByTextOrNull('Sair')).not.toBeNull();
  });

  it('renders no Organization section when the workspaces preview is empty', async () => {
    active = alfa;
    organizations = [];
    others = [];
    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    expect(sidebar()?.textContent).not.toContain('Organização');
    expect(container.querySelector('button[aria-label^="Trocar para"]')).toBeNull();
    expect(buttonByTextOrNull('Sair')).not.toBeNull();
  });

  it('offers the single other Organization when the preview lists one that is not active', async () => {
    active = alfa;
    organizations = [beta];
    others = [beta];
    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    expect(byName('Trocar para Beta Engenharia')).not.toBeNull();
  });

  it('still logs out from the same dropdown', async () => {
    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    await click(buttonByTextOrNull('Sair')!);
    expect(authMocks.logout).toHaveBeenCalledTimes(1);
  });

  it('shows the raw id as muted monospace only, never as the primary label', async () => {
    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    const row = byName('Trocar para org-c');
    expect(row).not.toBeNull();
    expect(row?.querySelector('span.font-mono')?.textContent).toBe('org-c');
  });

  it('disables every row while a switch is in flight and never reloads the page', async () => {
    let release: (() => void) | null = null;
    authMocks.setActive.mockImplementation(
      async () =>
        new Promise<undefined>((resolve) => {
          release = () => resolve(undefined);
        }),
    );

    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    const target = byName('Trocar para Beta Engenharia')!;
    await click(target);

    const section = container.querySelector('[data-testid="account-organization-section"]');
    expect(section).not.toBeNull();
    const items = [...(section?.querySelectorAll('[role="menuitem"]') ?? [])];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.hasAttribute('data-disabled')).toBe(true);
    expect(byName('Trocar para Beta Engenharia')?.getAttribute('aria-busy')).toBe('true');

    await act(async () => {
      release?.();
    });
    await flushReact();

    expect(reload).not.toHaveBeenCalled();
  });

  it('shows a retryable failure line when setActive rejects and keeps the menu open', async () => {
    authMocks.setActive.mockImplementation(async () => {
      throw new Error('switch failed');
    });

    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    await click(byName('Trocar para Beta Engenharia')!);
    await flushReact();

    expect(container.textContent).toContain(
      'Não foi possível trocar de organização. Tente novamente.',
    );
    const row = byName('Trocar para Beta Engenharia');
    expect(row).not.toBeNull();
    expect(row?.closest('[role="menuitem"]')?.hasAttribute('data-disabled')).toBe(false);
    expect(buttonByTextOrNull('Sair')).not.toBeNull();
  });

  it('no longer labels the Sales view group with the word that now means Organization', async () => {
    await renderRoute('/tatico/dashboard');

    expect(container.querySelector('button[title="Trocar painel"]')).not.toBeNull();
    expect(container.querySelector('button[title="Trocar workspace"]')).toBeNull();
    expect(sidebar()?.textContent).toContain('Painel');
    expect(sidebar()?.textContent).not.toContain('Workspace');

    await click(container.querySelector<HTMLButtonElement>('button[title="Trocar painel"]')!);
    expect(sidebar()?.textContent).toContain('Painéis');
    expect(sidebar()?.textContent).not.toContain('Workspaces');

    await click(buttonByTextOrNull('Cadastros')!);
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Produtos & Serviços');
  });

  it('renders every Organization above the scroll threshold and truncates none away', async () => {
    const many: Organization[] = [
      alfa,
      { id: 'org-b', name: 'Beta Engenharia' },
      { id: 'org-c', name: 'Gama Estudio' },
      { id: 'org-d', name: 'Delta Log' },
      { id: 'org-e', name: 'Epsilon Saude' },
      { id: 'org-f', name: 'Zeta Midia' },
      { id: 'org-g', name: 'Eta Servicos' },
      { id: 'org-h', name: 'Teta Digital' },
      { id: 'org-i', name: 'Iota Industria' },
    ];
    active = alfa;
    organizations = many;
    others = many.slice(1);

    await renderRoute('/tatico/dashboard');
    await openAccountMenu();

    expect(container.querySelectorAll('button[aria-label^="Trocar para"]')).toHaveLength(8);
    expect(byName('Trocar para Iota Industria')).not.toBeNull();
    const scroller = container.querySelector('.max-h-\\[240px\\]');
    expect(scroller?.className).toContain('overflow-y-auto');
  });
});
