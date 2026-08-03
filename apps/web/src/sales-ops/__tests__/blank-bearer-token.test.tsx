// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsBootstrap } from '../types';

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
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
  useLogout: () => mocks.logout,
  useAccessToken: () => ({ getToken: mocks.getToken }),
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

// NOT mocked on purpose: '../api' and '@/lib/api-client'. Mocking either would
// remove the exact code path under test, which is what reaches `fetch`.
import { SalesOpsApp } from '../SalesOpsApp';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

function emptyBootstrapPayload(): SalesOpsBootstrap {
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
  };
}

let container: HTMLDivElement;
let root: Root | null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container.remove();
  vi.unstubAllGlobals();
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
            <Route element={<SalesOpsApp />} path="/:workspace/:view" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flushReact();
  await flushReact();
}

describe('a null access token never becomes an anonymous request', () => {
  it('does not issue a request when getToken resolves null', async () => {
    mocks.getToken.mockResolvedValue(null);

    await renderApp('/tatico/dashboard');

    expect(fetchMock).not.toHaveBeenCalled();
    // Proves the "no fetch" result is not vacuous: the query really ran.
    expect(mocks.getToken).toHaveBeenCalled();
  });

  it('renders a session-expired panel, not the generic API fault', async () => {
    mocks.getToken.mockResolvedValue(null);

    await renderApp('/tatico/dashboard');

    expect(container.textContent ?? '').toContain('Sessão expirada');
    expect(container.textContent ?? '').not.toContain(
      'A API de vendas não respondeu corretamente',
    );
  });

  it('sends the Bearer header when a token IS available', async () => {
    mocks.getToken.mockResolvedValue('hub-access-token');
    fetchMock.mockResolvedValue({ ok: true, json: async () => emptyBootstrapPayload() });

    await renderApp('/tatico/dashboard');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/api/v1/sales-ops/bootstrap');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer hub-access-token',
    );
  });
});
