// @vitest-environment happy-dom

import * as React from 'react';
import type { HTMLAttributes } from 'react';
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

vi.mock('../hooks', () => ({
  useSalesOpsBootstrap: () => ({
    data: {
      sales: [],
      products: [],
      clients: [],
      people: [],
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
      <MemoryRouter initialEntries={[path]}>
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

async function renderHistory(entries: string[], roles: AppRole[]) {
  if (root) {
    await act(async () => root?.unmount());
  }
  profileRoles = [...roles];
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
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
});
