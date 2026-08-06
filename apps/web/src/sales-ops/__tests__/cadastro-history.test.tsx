// @vitest-environment happy-dom

/**
 * Slice 04 oracle - `Histórico de arquivamentos` in Cadastros > Configurações.
 *
 * What this file exists to prove, in order:
 *   A. the panel names the actor, the event, the cadastro and the instant, and NEVER
 *      prints a raw Hub account id or a raw entity uuid as a primary label - the
 *      CLAUDE.md UI-identifiers law, pinned in both of its branches;
 *   B. a restore issues slice 03's status-only PATCH back to `active` and refreshes the
 *      `['sales-ops']` prefix, so the history itself refetches;
 *   C. `Restaurar` is offered ONLY on an archive event whose entity is still archived
 *      and still restorable - never on a restore event, never on an already-active
 *      entity, never on a system função;
 *   D. the pure module's wire vocabulary matches slice 01/02 exactly.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type {
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsFuncao,
  SalesOpsPerson,
  SalesOpsProduct,
} from '../types';

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
}));

/*
  The CloseCtx version, copied from cadastro-archive.test.tsx: without it
  `AlertDialogCancel` renders as an inert button and "cancelling restores nothing"
  would pass even if the cancel never closed the confirmation.
*/
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
        <CloseCtx.Provider value={() => onOpenChange?.(false)}>{children}</CloseCtx.Provider>
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

vi.mock('../api', () => ({
  salesOpsApi: {
    cadastroHistory: vi.fn(),
    setCadastroStatus: vi.fn(),
  },
}));

import { salesOpsApi } from '../api';
import {
  CADASTRO_HISTORY_ACTIONS,
  CADASTRO_HISTORY_LIMIT,
  normalizeCadastroHistory,
  normalizeHistoryEntityKind,
  normalizeHistoryVerb,
  restoreStateFor,
  type CadastroHistoryEntryWire,
  type CadastroHistoryRow,
} from '../cadastro-history';
import { CadastroHistoryPanel, CadastroHistorySection } from '../CadastroHistoryPanel';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const orgId = 'org-test';
const AREA_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_ID = '22222222-2222-4222-8222-222222222222';
const FUNCAO_DESIGNER_ID = 'fc000009-0000-4000-8000-000000000009';
const FUNCAO_VENDEDOR_ID = 'fc000001-0000-4000-8000-000000000001';

const ACTOR_ID = 'acct_01HZQ9WV4TESTONLY';
const ACTOR_NAME = 'Cauet Pinciara';
/**
 * Midday-ish UTC on purpose, so the rendered pt-BR DATE is `05/08/2026` in every
 * plausible operator timezone. The tests assert the date only, never the hour.
 */
const TS = '2026-08-05T15:04:00.000Z';

const area = (patch: Partial<SalesOpsArea> = {}): SalesOpsArea => ({
  id: AREA_ID,
  orgId,
  name: 'FXL Tech',
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const funcao = (patch: Partial<SalesOpsFuncao> = {}): SalesOpsFuncao => ({
  id: FUNCAO_DESIGNER_ID,
  orgId,
  name: 'Designer',
  slug: 'designer',
  isSystem: false,
  status: 'archived',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const pessoa = (patch: Partial<SalesOpsPerson> = {}): SalesOpsPerson => ({
  id: PERSON_ID,
  orgId,
  displayName: 'Alex Silva',
  contactEmail: 'alex.silva@fxl.example',
  status: 'inactive',
  funcaoIds: [FUNCAO_DESIGNER_ID],
  funcoes: [{ id: FUNCAO_DESIGNER_ID, name: 'Designer', slug: 'designer', isSystem: false }],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: null,
  ...patch,
});

const product = (patch: Partial<SalesOpsProduct> = {}): SalesOpsProduct => ({
  id: PRODUCT_ID,
  orgId,
  name: 'FXL Finance',
  kind: 'product',
  codeSuffix: '7',
  areaId: AREA_ID,
  openPrice: false,
  setupBrl: 100000,
  hasMonthly: false,
  monthlyBrl: 0,
  recurringCommission: false,
  hasFinderCommission: false,
  sellerCommissionType: 'pct',
  sellerCommissionValue: '10.00',
  sellerWithFinderCommissionType: 'pct',
  sellerWithFinderCommissionValue: '7.00',
  finderCommissionType: 'pct',
  finderCommissionValue: '3.00',
  defaultPaymentMethod: 'pix',
  defaultEntradaMode: 'none',
  defaultEntradaPct: null,
  defaultEntradaBrl: null,
  defaultRemainingInstallments: 1,
  defaultRecurringCycles: null,
  modules: [],
  providers: [],
  status: 'archived',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});

function bootstrap(patch: Partial<SalesOpsBootstrap> = {}): SalesOpsBootstrap {
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
    ...patch,
  };
}

/** Slice 02's exact entry shape. See the plan's C3. */
function wire(patch: Partial<CadastroHistoryEntryWire> = {}): CadastroHistoryEntryWire {
  return {
    id: '1174',
    ts: TS,
    action: 'cadastro.archived',
    entityType: 'produto',
    entityId: PRODUCT_ID,
    entityLabel: 'FXL Finance',
    actorUserId: ACTOR_ID,
    actorDisplayName: ACTOR_NAME,
    ...patch,
  };
}

function rowsOf(...entries: CadastroHistoryEntryWire[]): CadastroHistoryRow[] {
  return normalizeCadastroHistory({ entries, nextCursor: null }).rows;
}

function rowOf(patch: Partial<CadastroHistoryEntryWire> = {}): CadastroHistoryRow {
  const row = rowsOf(wire(patch))[0];
  if (!row) throw new Error('the fixture entry was dropped by normalizeCadastroHistory');
  return row;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function text(): string {
  return container.textContent ?? '';
}

function restoreButtons(): HTMLButtonElement[] {
  return [...container.querySelectorAll('button')].filter((candidate) =>
    candidate.textContent?.includes('Restaurar'),
  );
}

/** The confirmation renders after the table, so its action is the LAST match. */
function confirmActionButton(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')]
    .filter((candidate) => candidate.textContent?.trim() === label)
    .at(-1);
  if (!(match instanceof HTMLButtonElement)) throw new Error(`confirm button not found: ${label}`);
  return match;
}

function elementWithExactText(value: string): HTMLElement {
  const match = [...container.querySelectorAll<HTMLElement>('span, div, td')].find(
    (candidate) => candidate.textContent?.trim() === value,
  );
  if (!match) throw new Error(`no element renders exactly: ${value}`);
  return match;
}

async function renderPanel(
  entries: CadastroHistoryRow[],
  data: SalesOpsBootstrap,
  patch: { hasMore?: boolean; isLoading?: boolean; isError?: boolean } = {},
) {
  await act(async () => {
    root.render(
      <CadastroHistoryPanel
        bootstrap={data}
        entries={entries}
        error={null}
        hasMore={patch.hasMore ?? false}
        isError={patch.isError ?? false}
        isLoading={patch.isLoading ?? false}
        onRestore={vi.fn()}
        restoringId={null}
      />,
    );
  });
}

// ───────────────────────── Block A - labels and identifiers ─────────────────────

describe('cadastro history rendering', () => {
  it('renders actor, action, entity and time without printing a bare id as a label', async () => {
    await renderPanel(rowsOf(wire()), bootstrap({ products: [product()], areas: [area()] }));

    expect(text()).toContain(ACTOR_NAME);
    expect(text()).toContain('Arquivou');
    expect(text()).toContain('FXL Finance');
    expect(text()).toContain('Produto');
    expect(text()).toContain('05/08/2026');
    // The account id is never printed when a name exists.
    expect(text()).not.toContain(ACTOR_ID);
    // The entity uuid is never printed when a name exists.
    expect(text()).not.toContain(PRODUCT_ID);
  });

  it('names the actor "Autor não identificado" and demotes the id to muted monospace', async () => {
    await renderPanel(
      rowsOf(wire({ actorDisplayName: null, actorUserId: 'acct_unnamed' })),
      bootstrap({ products: [product()], areas: [area()] }),
    );

    expect(text()).toContain('Autor não identificado');

    const idCell = elementWithExactText('acct_unnamed');
    expect(idCell.className).toContain('font-mono');
    expect(idCell.className).toContain('text-muted-foreground');

    // The two lines are genuinely primary and secondary, not one muted blob.
    expect(elementWithExactText('Autor não identificado').className).not.toContain('font-mono');

    // The row's headline is still the cadastro's name, never an id.
    expect(text()).toContain('FXL Finance');
  });

  it('shows the live name and discloses the name the cadastro had when archived', async () => {
    await renderPanel(
      rowsOf(wire({ entityLabel: 'FXL Finance' })),
      bootstrap({ products: [product({ name: 'FXL Finance Pro' })], areas: [area()] }),
    );

    expect(text()).toContain('FXL Finance Pro');
    expect(text()).toContain('antes: FXL Finance');
  });

  it('shows the empty panel when the org has no archive events', async () => {
    await renderPanel([], bootstrap());

    expect(text()).toContain('Nenhum arquivamento registrado');
    expect(container.querySelector('table')).toBeNull();
  });
});

// ───────────────────── Block C - when restore is offered ────────────────────────

describe('cadastro history restore affordance', () => {
  it('does not offer restore for an entity that is already active', async () => {
    await renderPanel(
      rowsOf(wire()),
      bootstrap({ products: [product({ status: 'active' })], areas: [area()] }),
    );

    expect(restoreButtons()).toHaveLength(0);
    expect(text()).toContain('Já restaurado');
    // The event itself is never hidden, only its action.
    expect(text()).toContain('FXL Finance');
  });

  it('never offers restore on a restore event', async () => {
    await renderPanel(
      rowsOf(wire({ action: 'cadastro.restored' })),
      bootstrap({ products: [product()], areas: [area()] }),
    );

    expect(restoreButtons()).toHaveLength(0);
    expect(text()).toContain('Restaurou');
  });
});

// ───────────────────────── Block B - the restore write ──────────────────────────

describe('cadastro history restore write', () => {
  function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
      resolve = promiseResolve;
    });
    return { promise, resolve };
  }

  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient['invalidateQueries']>;

  async function flushReact() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function renderSection(data: SalesOpsBootstrap) {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <CadastroHistorySection bootstrap={data} />
        </QueryClientProvider>,
      );
    });
    await flushReact();
  }

  it('restores an archived produto through a status-only PATCH and invalidates sales-ops', async () => {
    vi.mocked(salesOpsApi.cadastroHistory).mockResolvedValue({
      entries: [wire()],
      nextCursor: null,
    });
    const deferred = createDeferred<unknown>();
    vi.mocked(salesOpsApi.setCadastroStatus).mockReturnValue(deferred.promise);

    await renderSection(bootstrap({ products: [product()], areas: [area()] }));

    // The action set is actually sent - the contract with slice 02.
    expect(vi.mocked(salesOpsApi.cadastroHistory).mock.calls[0]).toEqual([
      50,
      ['cadastro.archived', 'cadastro.restored'],
      expect.any(String),
    ]);

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Restaurar Produto FXL Finance"]',
    );
    if (!trigger) throw new Error('the restore button was not rendered');
    await click(trigger);
    await flushReact();

    expect(text()).toContain('restaurar não apaga o evento anterior');
    expect(vi.mocked(salesOpsApi.setCadastroStatus)).not.toHaveBeenCalled();

    await click(confirmActionButton('Restaurar'));
    await flushReact();

    expect(vi.mocked(salesOpsApi.setCadastroStatus)).toHaveBeenCalledTimes(1);
    // `toEqual` on the whole object is exact: it asserts there is NO `name` key,
    // which is what stops a restore silently reverting someone else's rename.
    expect(vi.mocked(salesOpsApi.setCadastroStatus).mock.calls[0]?.[0]).toEqual({
      resource: 'products',
      id: PRODUCT_ID,
      status: 'active',
    });

    await act(async () => {
      deferred.resolve({});
    });
    await flushReact();

    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['sales-ops'] }),
    );
    // The behavioural half of the same claim: the history refetched, which is only
    // true because its key sits under the invalidated `['sales-ops']` prefix.
    expect(vi.mocked(salesOpsApi.cadastroHistory)).toHaveBeenCalledTimes(2);
  });

  it('restores a pessoa with status active, never archived', async () => {
    vi.mocked(salesOpsApi.cadastroHistory).mockResolvedValue({
      entries: [wire({ entityType: 'pessoa', entityId: PERSON_ID, entityLabel: 'Alex Silva' })],
      nextCursor: null,
    });
    vi.mocked(salesOpsApi.setCadastroStatus).mockResolvedValue({});

    await renderSection(bootstrap({ people: [pessoa()], funcoes: [funcao()] }));

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Restaurar Pessoa Alex Silva"]',
    );
    if (!trigger) throw new Error('the restore button was not rendered');
    await click(trigger);
    await flushReact();
    await click(confirmActionButton('Restaurar'));
    await flushReact();

    expect(vi.mocked(salesOpsApi.setCadastroStatus).mock.calls[0]?.[0]).toEqual({
      resource: 'people',
      id: PERSON_ID,
      status: 'active',
    });
  });
});

// ─────────────────────── Block D - the pure wire contract ───────────────────────

describe('cadastro-history pure functions', () => {
  it('recognizes exactly slice 01 entity vocabulary', () => {
    expect(normalizeHistoryEntityKind('produto')).toBe('produto');
    expect(normalizeHistoryEntityKind('pessoa')).toBe('pessoa');
    expect(normalizeHistoryEntityKind('funcao')).toBe('funcao');
    expect(normalizeHistoryEntityKind('area')).toBe('area');

    // The English, plural and table spellings were the old draft's guess. Pinning
    // them as unrecognized is what stops the tolerance creeping back.
    expect(normalizeHistoryEntityKind('product')).toBeNull();
    expect(normalizeHistoryEntityKind('products')).toBeNull();
    expect(normalizeHistoryEntityKind('sales_ops_products')).toBeNull();
    expect(normalizeHistoryEntityKind('cliente')).toBeNull();
    expect(normalizeHistoryEntityKind('área')).toBeNull();
    expect(normalizeHistoryEntityKind('')).toBeNull();
    expect(normalizeHistoryEntityKind(null)).toBeNull();
  });

  it('recognizes exactly slice 01 lifecycle actions', () => {
    expect(normalizeHistoryVerb('cadastro.archived')).toBe('archive');
    expect(normalizeHistoryVerb('cadastro.restored')).toBe('restore');

    expect(normalizeHistoryVerb('commission.approve')).toBeNull();
    expect(normalizeHistoryVerb('payout.mark_paid')).toBeNull();
    expect(normalizeHistoryVerb('produto.archived')).toBeNull();
    expect(normalizeHistoryVerb('cadastro.archive')).toBeNull();
  });

  it('reads hasMore from nextCursor and never from the page length', () => {
    const full = Array.from({ length: CADASTRO_HISTORY_LIMIT }, (_unused, index) =>
      wire({ id: String(2000 - index) }),
    );

    expect(normalizeCadastroHistory({ entries: full, nextCursor: null }).hasMore).toBe(false);
    expect(normalizeCadastroHistory({ entries: full, nextCursor: '1160' }).hasMore).toBe(true);
    expect(normalizeCadastroHistory(undefined)).toEqual({ rows: [], hasMore: false });
  });

  it('drops unusable entries and preserves the server order', () => {
    const page = normalizeCadastroHistory({
      entries: [
        wire({ id: '1174' }),
        wire({ id: '', entityId: 'x' }),
        wire({ id: '1170', ts: '' }),
        wire({ id: '1166' }),
      ],
      nextCursor: null,
    });

    expect(page.rows.map((row) => row.id)).toEqual(['1174', '1166']);
  });

  it('offers restore for a non-system archived função and refuses a system one', () => {
    const designer = funcao();
    const vendedor = funcao({
      id: FUNCAO_VENDEDOR_ID,
      name: 'Vendedor',
      slug: 'vendedor',
      isSystem: true,
      status: 'archived',
    });
    const data = bootstrap({ funcoes: [designer, vendedor] });

    expect(
      restoreStateFor(rowOf({ entityType: 'funcao', entityId: designer.id }), data),
    ).toEqual({
      state: 'available',
      target: { resource: 'funcoes', id: designer.id, status: 'active' },
    });

    expect(
      restoreStateFor(rowOf({ entityType: 'funcao', entityId: vendedor.id }), data),
    ).toEqual({ state: 'none' });
  });

  it('renders an unrecognized entity type read-only', () => {
    const data = bootstrap({
      clients: [
        {
          id: 'cl000001-0000-4000-8000-000000000001',
          orgId,
          name: 'SegPro',
          contact: null,
          legalName: null,
          document: null,
          address: null,
          legalRepName: null,
          legalRepDocument: null,
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: null,
        },
      ],
    });

    expect(
      restoreStateFor(
        rowOf({ entityType: 'cliente', entityId: 'cl000001-0000-4000-8000-000000000001' }),
        data,
      ),
    ).toEqual({ state: 'none' });
  });

  it('reports a missing live row and refuses an optimistic id', () => {
    expect(restoreStateFor(rowOf(), bootstrap())).toEqual({ state: 'missing' });
    expect(
      restoreStateFor(rowOf({ entityId: 'optimistic:areas:Nova', entityType: 'area' }), bootstrap()),
    ).toEqual({ state: 'none' });
  });

  it('exports the two actions the panel asks slice 02 for', () => {
    expect([...CADASTRO_HISTORY_ACTIONS]).toEqual(['cadastro.archived', 'cadastro.restored']);
    expect(CADASTRO_HISTORY_LIMIT).toBe(50);
  });
});
