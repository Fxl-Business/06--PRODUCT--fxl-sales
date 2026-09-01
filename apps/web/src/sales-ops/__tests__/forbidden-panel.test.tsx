// @vitest-environment happy-dom

/**
 * The panel-level oracle for the 403 half of the deny taxonomy.
 *
 * `entitlement-dead-end.test.tsx` proves a 403 reaches this panel through the
 * SHELL. This file covers what that one cannot: the panel's own copy decisions,
 * and the SECOND host, `CadastroHistoryPanel`, whose `/sales-ops/history` request
 * `requireAdmin` can 403 on its own while the shell's bootstrap succeeds.
 */
import * as React from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesOpsBootstrap } from '../types';

/*
  `CadastroHistoryPanel` is prop-driven, but its MODULE imports `./hooks`, which
  pulls in `@tanstack/react-query` and `@/auth/react` transitively, and it renders
  Radix's alert dialog. Both mocks are copied from `cadastro-history.test.tsx` for
  exactly that reason. `ForbiddenPanel` itself needs neither.
*/
vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  AlertDialogAction: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <button type="button">{children}</button>,
}));

import { CadastroHistoryPanel } from '../CadastroHistoryPanel';
import { ForbiddenPanel } from '../ForbiddenPanel';
import { FORBIDDEN_COPY } from '../forbidden-copy';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const emptyBootstrap: SalesOpsBootstrap = {
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

function text() {
  return container.textContent ?? '';
}

describe('ForbiddenPanel', () => {
  it('renders the ask-an-administrator copy and no sign-in affordance', async () => {
    await act(async () => root.render(<ForbiddenPanel />));

    expect(text()).toContain(FORBIDDEN_COPY.title);
    expect(text()).toContain(FORBIDDEN_COPY.body);
    /*
      A 403 is not a dead session. These three negatives are what fail if a later
      change routes it into `SignedOutPanel`, `SessionRecoveryPanel` or the
      generic API-fault copy: the first two both render an `Entrar` button.
    */
    expect(text()).not.toContain('Entrar');
    expect(text()).not.toContain('Sessão expirada');
    expect(text()).not.toContain('Não foi possível carregar');
  });

  it('names no module, no role and no raw identifier', async () => {
    await act(async () => root.render(<ForbiddenPanel />));

    // The pin on the copy decision: a 403 body is machine vocabulary and a
    // Hub-internal identifier, and the identifier law keeps both out of the UI.
    for (const token of ['missing_module', 'missing_role', 'forbidden', '403']) {
      expect(text()).not.toContain(token);
    }
  });

  it('renders the same forbidden panel from the cadastro history panel', async () => {
    await act(async () =>
      root.render(
        <CadastroHistoryPanel
          bootstrap={emptyBootstrap}
          entries={[]}
          error={{ error: 'forbidden', code: 'missing_role', status: 403 }}
          hasMore={false}
          isError
          isLoading={false}
          onRestore={vi.fn()}
          restoringId={null}
        />,
      ),
    );

    expect(container.querySelector('[data-forbidden]')).not.toBeNull();
    expect(text()).toContain(FORBIDDEN_COPY.title);
    expect(text()).not.toContain('Não foi possível carregar o histórico');
  });
});
