// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppAuthProvider } from '@/auth/react';
import '@/i18n';
import { setDevIdentitySession } from '@/dev/dev-identity-registry';
import { installDevIdentityIfEnabled } from '@/dev/install-dev-identity';
import { routes } from '@/router';
import { installFakeSource } from '../fake-source';

/**
 * The prototype page's whole path, in one test: the real routes and screens, the REAL dev identity
 * (installed the way `src/prototype/main.tsx` installs it), and the fake network. Nothing here is
 * mocked: a screen that shows a fixture row proves the page opens signed in with no Hub, no API and
 * no database.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;
const realFetch = globalThis.fetch;
const realEventSource = globalThis.EventSource;
let host: HTMLElement;
let root: Root;

async function waitForText(text: string, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (document.body.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  throw new Error(`"${text}" never rendered. Body: ${document.body.textContent?.slice(0, 600)}`);
}

async function openPrototype(identity: string, entry: string): Promise<void> {
  localStorage.setItem('fxl-sales.dev-identity', identity);
  vi.stubEnv('VITE_AUTH_FAKE', '1');
  installFakeSource();
  await installDevIdentityIfEnabled();
  const router = createMemoryRouter(routes, { initialEntries: [entry] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AppAuthProvider>
          <RouterProvider router={router} />
        </AppAuthProvider>
      </QueryClientProvider>,
    );
  });
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setDevIdentitySession(null);
  localStorage.removeItem('fxl-sales.dev-identity');
  globalThis.fetch = realFetch;
  globalThis.EventSource = realEventSource;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the prototype page', () => {
  it('opens the propostas of the full organization signed in, from the fixtures', async () => {
    await openPrototype('team-owner', '/operacional/vendas');
    await waitForText('Padaria Estrela');
    expect(document.body.textContent).toContain('Clínica Vida');
  });

  it('opens the lead board of the compact organization for its gestora', async () => {
    await openPrototype('leads-owner', '/operacional/leads');
    await waitForText('Eduardo Faria');
    expect(document.body.textContent).toContain('Vera Campos');
  });

  it('opens a vendedor on own and unassigned leads only', async () => {
    await openPrototype('leads-seller', '/meus-dados/leads');
    await waitForText('Eduardo Faria');
    expect(document.body.textContent).toContain('Sônia Pinheiro');
    expect(document.body.textContent).not.toContain('Vera Campos');
  });
});
