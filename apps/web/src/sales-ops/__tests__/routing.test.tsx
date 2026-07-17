// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppRole } from '@/auth/claims';
import { SalesOpsApp } from '../SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

let profileRoles: AppRole[] = [];

const authMocks = vi.hoisted(() => ({
  logout: vi.fn(async () => undefined),
}));

vi.mock('@/auth/react', () => ({
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: profileRoles,
    name: 'Test User',
    email: 'test.user@fxl.example',
  }),
  useLogout: () => authMocks.logout,
}));

const mutation = {
  isPending: false,
  mutate: vi.fn(),
};

const personFixture = {
  id: '11111111-1111-4111-8111-111111111111',
  orgId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Alex Silva',
  contactEmail: 'alex.silva@fxl.example',
  status: 'active' as const,
  isSeller: true,
  isFinder: true,
  isCollaborator: false,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
};

vi.mock('../hooks', () => ({
  useSalesOpsBootstrap: () => ({
    data: {
      sales: [],
      products: [],
      clients: [],
      people: [personFixture],
      payables: [],
      saleItems: [],
      settings: null,
    },
    isLoading: false,
    isError: false,
  }),
  useCreateSalesOpsSale: () => mutation,
  useSaveSalesOpsClient: () => mutation,
  useSaveSalesOpsPerson: () => mutation,
  useSaveSalesOpsProduct: () => mutation,
  useSaveSalesOpsSettings: () => mutation,
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

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <output data-testid="location-path">{location.pathname}</output>
      <button onClick={() => navigate(-1)} type="button">
        Back
      </button>
      <button onClick={() => navigate(1)} type="button">
        Forward
      </button>
    </div>
  );
}

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
  document.body.querySelectorAll('[data-radix-portal]').forEach((portal) => portal.remove());
  vi.clearAllMocks();
});

async function renderRoute(path: string, roles: AppRole[]) {
  if (root) {
    await act(async () => root?.unmount());
  }
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
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  await flushReact();
}

async function renderHistory(
  entries: string[],
  roles: AppRole[],
  startTransition = true,
) {
  if (root) {
    await act(async () => root?.unmount());
  }
  profileRoles = [...roles];
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter
        future={{ v7_relativeSplatPath: true, v7_startTransition: startTransition }}
        initialEntries={entries}
        initialIndex={entries.length - 1}
      >
        <Routes>
          <Route element={<SalesOpsApp />} path="/" />
          <Route element={<SalesOpsApp />} path="/:workspace/:view" />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  await flushReact();
}

async function flushReact() {
  await act(async () => Promise.resolve());
}

function buttonByText(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLButtonElement)) throw new Error(`button not found: ${label}`);
  return match;
}

function buttonByTextOrNull(label: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label,
    ) ?? null
  );
}

function workspaceButton(): HTMLButtonElement {
  const match = container.querySelector('button[title="Trocar workspace"]');
  if (!(match instanceof HTMLButtonElement)) throw new Error('workspace button not found');
  return match;
}

function pathname() {
  return container.querySelector('[data-testid="location-path"]')?.textContent;
}

function expectHeading(title: string) {
  expect(container.querySelector('h1')?.textContent?.trim()).toBe(title);
}

function expectWorkspace(label: string) {
  expect(workspaceButton().textContent).toContain(label);
}

function mainRegion(): HTMLElement {
  const match = container.querySelector('main');
  if (!(match instanceof HTMLElement)) throw new Error('main region not found');
  return match;
}

function buttonByAccessibleName(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

async function click(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await flushReact();
}

describe('Sales Ops canonical routing', () => {
  it('renders a canonical deep link and drives shell navigation through the URL', async () => {
    await renderRoute('/operacional/vendas', ['admin']);
    expect(pathname()).toBe('/operacional/vendas');
    expectWorkspace('Operacional');
    expectHeading('Vendas');

    await click(buttonByText('Comissões'));
    expect(pathname()).toBe('/operacional/comissoes');
    expectHeading('Comissões');

    await click(workspaceButton());
    await click(buttonByText('Cadastros'));
    expect(pathname()).toBe('/cadastros/produtos');
    expectWorkspace('Cadastros');
    expectHeading('Produtos');
  });

  it('restores the visible workspace and page through browser history', async () => {
    await renderRoute('/tatico/dashboard', ['admin']);
    expectHeading('Visão geral');
    expectWorkspace('Tático');

    await click(workspaceButton());
    await click(buttonByText('Operacional'));
    expect(pathname()).toBe('/operacional/vendas');
    expectHeading('Vendas');
    expectWorkspace('Operacional');

    await click(buttonByText('Comissões'));
    expect(pathname()).toBe('/operacional/comissoes');
    expectHeading('Comissões');

    await click(buttonByText('Back'));
    expect(pathname()).toBe('/operacional/vendas');
    expectHeading('Vendas');
    expectWorkspace('Operacional');

    await click(buttonByText('Back'));
    expect(pathname()).toBe('/tatico/dashboard');
    expectHeading('Visão geral');
    expectWorkspace('Tático');

    await click(buttonByText('Forward'));
    expect(pathname()).toBe('/operacional/vendas');
    expectHeading('Vendas');
    expectWorkspace('Operacional');
  });

  it('replaces invalid and role-forbidden routes with the role default', async () => {
    await renderRoute('/', ['admin']);
    expect(pathname()).toBe('/tatico/dashboard');
    expectHeading('Visão geral');

    await renderRoute('/cadastros/produtos', ['seller']);
    expect(pathname()).toBe('/meus-dados/vendedores');
    expectWorkspace('Meus dados');
    expectHeading('Meu painel');

    await renderRoute('/operacional/vendas', ['finder']);
    expect(pathname()).toBe('/meus-dados/finders');
    expectWorkspace('Meus dados');
    expectHeading('Meu painel');
  });

  it('does not restore a role-forbidden route after canonical replacement', async () => {
    await renderHistory(['/meus-dados/vendas', '/cadastros/produtos'], ['finder']);
    expect(pathname()).toBe('/meus-dados/finders');
    expectHeading('Meu painel');

    await click(buttonByText('Back'));
    expect(pathname()).toBe('/meus-dados/vendas');
    expectHeading('Minhas indicações');
    expectWorkspace('Meus dados');
  });

  it('lands seller-only users in Meus dados and blocks team workspaces', async () => {
    await renderRoute('/', ['seller']);
    expect(pathname()).toBe('/meus-dados/vendedores');
    expectWorkspace('Meus dados');
    expectHeading('Meu painel');

    await renderRoute('/operacional/vendas', ['seller']);
    expect(pathname()).toBe('/meus-dados/vendedores');
  });

  it('no longer renders the viewing-level switcher', async () => {
    await renderRoute('/tatico/dashboard', ['admin', 'seller', 'finder']);
    expect(container.querySelector('button[title="Trocar visualização"]')).toBeNull();
    expect(container.textContent).not.toContain('Nível de visualização');
  });

  it('keeps account identity and logout inside the sidebar account menu', async () => {
    await renderRoute('/tatico/dashboard', ['admin']);

    const sidebar = container.querySelector('aside');
    const header = container.querySelector('header');
    const accountButton = sidebar?.querySelector<HTMLButtonElement>(
      'button[aria-label="Abrir menu da conta"]',
    );

    expect(accountButton).not.toBeNull();
    expect(sidebar?.textContent).toContain('Test User');
    expect(sidebar?.textContent).toContain('Equipe');
    expect(header?.textContent).not.toContain('Test User');
    expect(header?.querySelector('button[aria-label="Sair"]')).toBeNull();
    expect(container.querySelector('button[aria-label="Sair"]')).toBeNull();

    await click(accountButton!);

    expect(sidebar?.textContent).toContain('test.user@fxl.example');
    await click(buttonByText('Sair'));
    expect(authMocks.logout).toHaveBeenCalledTimes(1);
  });

  it('shows all four workspaces for team plus personal roles', async () => {
    await renderRoute('/tatico/dashboard', ['admin', 'seller', 'finder']);
    await click(workspaceButton());
    buttonByText('Tático');
    buttonByText('Operacional');
    buttonByText('Cadastros');
    buttonByText('Meus dados');
  });

  it('navigates from the dashboard sales card to operational sales', async () => {
    await renderRoute('/tatico/dashboard', ['admin']);
    await click(buttonByText('Ver todas'));
    expect(pathname()).toBe('/operacional/vendas');
    expectWorkspace('Operacional');
    expectHeading('Vendas');
  });

  it('keeps people management in Cadastros and personal people panels read-only', async () => {
    await renderRoute('/tatico/dashboard', ['admin']);
    const tacticalNavigation = container.querySelector('aside nav');
    expect(
      [...(tacticalNavigation?.querySelectorAll('button') ?? [])].map((item) =>
        item.getAttribute('aria-label'),
      ),
    ).toEqual(['Visão geral']);
    expect(mainRegion().querySelector('button[aria-label="Vendedores"]')).toBeNull();
    expect(mainRegion().querySelector('button[aria-label="Finders"]')).toBeNull();
    expect(buttonByTextOrNull('Novo vendedor')).toBeNull();
    expect(buttonByTextOrNull('Novo finder')).toBeNull();

    await renderRoute('/tatico/vendedores', ['admin']);
    expect(pathname()).toBe('/tatico/dashboard');
    expectHeading('Visão geral');

    await renderRoute('/cadastros/vendedores', ['admin']);
    expectWorkspace('Cadastros');
    expectHeading('Vendedores');
    buttonByText('Novo vendedor');
    const editSeller = buttonByAccessibleName('Editar Alex Silva');
    expect(editSeller).not.toBeNull();
    await click(editSeller!);
    expect(container.querySelector('h2')?.textContent).toBe('Pessoa');

    await renderRoute('/cadastros/finders', ['admin']);
    expectWorkspace('Cadastros');
    expectHeading('Finders');
    buttonByText('Novo finder');
    expect(buttonByAccessibleName('Editar Alex Silva')).not.toBeNull();

    for (const personal of [
      { path: '/meus-dados/vendedores', roles: ['seller'] as AppRole[] },
      { path: '/meus-dados/finders', roles: ['finder'] as AppRole[] },
      { path: '/meus-dados/vendedores', roles: ['admin', 'seller'] as AppRole[] },
    ]) {
      await renderRoute(personal.path, personal.roles);
      expectWorkspace('Meus dados');
      expectHeading('Meu painel');
      expect(mainRegion().textContent).toContain('0 vendas no período');
      const personalCard = mainRegion().querySelector('article');
      expect(personalCard?.textContent).toContain('Alex Silva');
      await click(personalCard!);
      expect(buttonByTextOrNull('Novo vendedor')).toBeNull();
      expect(buttonByTextOrNull('Novo finder')).toBeNull();
      expect(buttonByAccessibleName('Editar Alex Silva')).toBeNull();
      expect(container.querySelector('h2')?.textContent).not.toBe('Pessoa');
    }
  });

  it('closes people management when the mounted app leaves Cadastros', async () => {
    await renderRoute('/cadastros/vendedores', ['admin', 'seller']);
    await click(buttonByText('Novo vendedor'));
    expect(container.querySelector('h2')?.textContent).toBe('Pessoa');
    expect(buttonByTextOrNull('Salvar')).not.toBeNull();

    await click(workspaceButton());
    await click(buttonByText('Tático'));
    expect(pathname()).toBe('/tatico/dashboard');
    expectHeading('Visão geral');
    expect(container.querySelector('h2')).toBeNull();
    expect(buttonByTextOrNull('Salvar')).toBeNull();

    await click(workspaceButton());
    await click(buttonByText('Cadastros'));
    expect(pathname()).toBe('/cadastros/produtos');
    await click(buttonByAccessibleName('Vendedores')!);
    expect(pathname()).toBe('/cadastros/vendedores');
    expect(container.querySelector('h2')).toBeNull();

    await click(buttonByAccessibleName('Editar Alex Silva')!);
    expect(container.querySelector('h2')?.textContent).toBe('Pessoa');

    await click(workspaceButton());
    await click(buttonByText('Meus dados'));
    expect(pathname()).toBe('/meus-dados/vendedores');
    expectHeading('Meu painel');
    expect(container.querySelector('h2')).toBeNull();
    expect(buttonByTextOrNull('Salvar')).toBeNull();

    const personalCard = mainRegion().querySelector('article');
    expect(personalCard?.textContent).toContain('Alex Silva');
    await click(personalCard!);
    expect(container.querySelector('h2')).toBeNull();
    expect(mutation.mutate).not.toHaveBeenCalled();

    await click(workspaceButton());
    await click(buttonByText('Cadastros'));
    await click(buttonByAccessibleName('Vendedores')!);
    expect(pathname()).toBe('/cadastros/vendedores');
    expect(container.querySelector('h2')).toBeNull();
  });

  it('does not restore a stale people dialog through browser history', async () => {
    await renderHistory(['/tatico/dashboard', '/cadastros/vendedores'], ['admin']);
    await click(buttonByText('Novo vendedor'));
    expect(container.querySelector('h2')?.textContent).toBe('Pessoa');

    await click(buttonByText('Back'));
    expect(pathname()).toBe('/tatico/dashboard');
    expect(container.querySelector('h2')).toBeNull();

    await click(buttonByText('Forward'));
    expect(pathname()).toBe('/cadastros/vendedores');
    expect(container.querySelector('h2')).toBeNull();
    expect(buttonByTextOrNull('Salvar')).toBeNull();
  });

  it('closes route-specific people dialogs when history switches people pages', async () => {
    await renderHistory(['/cadastros/finders', '/cadastros/vendedores'], ['admin']);
    await click(buttonByText('Novo vendedor'));
    expect(container.querySelector('h2')?.textContent).toBe('Pessoa');

    await click(buttonByText('Back'));
    expect(pathname()).toBe('/cadastros/finders');
    expectHeading('Finders');
    expect(container.querySelector('h2')).toBeNull();
    expect(buttonByTextOrNull('Salvar')).toBeNull();

    await click(buttonByText('Forward'));
    expect(pathname()).toBe('/cadastros/vendedores');
    expect(container.querySelector('h2')).toBeNull();

    await click(buttonByText('Back'));
    await click(buttonByText('Novo finder'));
    expect(container.querySelector('h2')?.textContent).toBe('Pessoa');

    await click(buttonByText('Forward'));
    expect(pathname()).toBe('/cadastros/vendedores');
    expectHeading('Vendedores');
    expect(container.querySelector('h2')).toBeNull();
    expect(buttonByTextOrNull('Salvar')).toBeNull();

    await click(buttonByText('Back'));
    expect(pathname()).toBe('/cadastros/finders');
    expect(container.querySelector('h2')).toBeNull();
  });

  it('irrevocably clears people dialogs during rapid browser history transitions', async () => {
    await renderHistory(['/tatico/dashboard', '/cadastros/vendedores'], ['admin'], false);
    await click(buttonByText('Novo vendedor'));
    expect(container.querySelector('h2')?.textContent).toBe('Pessoa');

    const queuedMicrotasks: Array<() => void> = [];
    const queueMicrotaskSpy = vi
      .spyOn(globalThis, 'queueMicrotask')
      .mockImplementation((callback) => queuedMicrotasks.push(callback));

    try {
      await act(async () => {
        flushSync(() =>
          buttonByText('Back').dispatchEvent(new MouseEvent('click', { bubbles: true })),
        );
        expect(pathname()).toBe('/tatico/dashboard');
        expect(queuedMicrotasks).toHaveLength(1);

        flushSync(() =>
          buttonByText('Forward').dispatchEvent(new MouseEvent('click', { bubbles: true })),
        );
      });
      expect(pathname()).toBe('/cadastros/vendedores');
      expect(queuedMicrotasks).toHaveLength(1);

      await act(async () => {
        queuedMicrotasks.forEach((callback) => callback());
      });

      expect(container.querySelector('h2')).toBeNull();
      expect(buttonByTextOrNull('Salvar')).toBeNull();
    } finally {
      queueMicrotaskSpy.mockRestore();
    }
  });
});
