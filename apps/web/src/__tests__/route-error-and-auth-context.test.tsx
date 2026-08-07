// @vitest-environment happy-dom

import * as React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteErrorPage } from '../pages/errors/RouteErrorPage';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const webRoot = path.resolve(__dirname, '../..');
const readSource = (relative: string) => readFileSync(path.join(webRoot, relative), 'utf8');

describe('RouteErrorPage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders the friendly error page with a reload button when a route element throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = () => {
      throw new Error('Hub auth context is missing');
    };
    const router = createMemoryRouter(
      [{ path: '/', element: <Boom />, errorElement: <RouteErrorPage /> }],
      { initialEntries: ['/'] },
    );

    await act(async () => {
      root.render(<RouterProvider router={router} />);
    });

    expect(container.textContent).toContain('Algo deu errado');
    expect(container.textContent).toContain('Hub auth context is missing');
    const button = Array.from(container.querySelectorAll('button')).find((el) =>
      el.textContent?.includes('Recarregar'),
    );
    expect(button).toBeTruthy();
  });
});

describe('dev-race regression contract', () => {
  it('router.tsx uses the @ alias for auth and mounts errorElement on every top-level route', () => {
    const source = readSource('src/router.tsx');
    expect(source).toContain("from '@/auth/react'");
    expect(source).not.toContain("from './auth/react'");
    const topLevelRoutes = (source.match(/^\s{2}\{\s*$|^\s{2}\{ path:/gm) ?? []).length;
    const errorElements = (source.match(/errorElement:/g) ?? []).length;
    expect(errorElements).toBeGreaterThanOrEqual(6);
    expect(topLevelRoutes).toBeGreaterThanOrEqual(errorElements);
  });

  it('vite.config.ts pins dep optimization so auth modules cannot be served twice', () => {
    const source = readSource('vite.config.ts');
    expect(source).toContain('dedupe');
    expect(source).toContain("'react-router-dom'");
    expect(source).toContain('optimizeDeps');
    expect(source).toContain("'@radix-ui/react-dropdown-menu'");
    expect(source).toContain('warmup');
  });

  /**
   * The structural precondition that makes `useQueryClient()` inside `HubAuthProvider`
   * legal, and therefore what makes the identity flush on logout, on an in-page
   * signed-out to signed-in transition and on a workspace switch possible at all.
   *
   * Reverting the nesting also reddens the auth tests, but only because their harness
   * happens to wrap them, which reads as a test-setup failure rather than as the
   * contract violation it is. A source pin says what the invariant is.
   */
  it('App.tsx mounts QueryClientProvider outside AppAuthProvider', () => {
    const source = readSource('src/App.tsx');
    const queryProvider = source.indexOf('<QueryClientProvider');
    const authProvider = source.indexOf('<AppAuthProvider');
    expect(queryProvider).toBeGreaterThanOrEqual(0);
    expect(authProvider).toBeGreaterThanOrEqual(0);
    expect(queryProvider).toBeLessThan(authProvider);
  });

  it('HubAuthContext is a globalThis singleton so duplicated modules share one context', () => {
    const source = readSource('src/auth/react.tsx');
    expect(source).toContain('__fxlHubAuthContext');
    expect(source).toMatch(/__fxlHubAuthContext\s*\?\?=/);
  });
});
