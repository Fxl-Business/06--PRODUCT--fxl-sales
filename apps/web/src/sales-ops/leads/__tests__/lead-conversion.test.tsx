// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HTMLAttributes } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE CONVERSION ORACLE: acceptance 11, 12 and 13.
 *
 * The whole claim under test is WHICH HTTP REQUESTS ARE ISSUED AND IN WHAT
 * ORDER, so `../api`, `../hooks`, `../../api`, `../../hooks` and
 * `@/lib/api-client` are ALL unmocked and the real `apiFetch` runs against a
 * stubbed global `fetch`. A mocked hook lets the ordering bug pass, which is
 * precisely the bug this file exists to catch.
 *
 * The card is moved through the KEYBOARD `Mover para` dialog and never through a
 * simulated drag: happy-dom runs neither pointer capture nor activation
 * behaviour, so a simulated drag would prove nothing, and the drag layer ends in
 * the same `emitMove` anyway.
 *
 * `@/components/ui/dialog` is reduced to plain divs, as
 * `entitlement-dead-end.test.tsx` does. Two Radix dialogs briefly overlap during
 * a conversion (the move dialog closes as the wizard opens) and their portals,
 * focus traps and body locks are not what is being asserted here. The Escape
 * protection those dialogs carry has its own oracle in
 * `move-dialog-inline-layer.test.tsx`.
 */

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(async () => 'hub-access-token'),
  logout: vi.fn(async () => undefined),
  setActive: vi.fn(async () => undefined),
  checkoutUrl: vi.fn(async () => 'https://hub.example/checkout'),
}));

const organizations = [{ id: 'org-a', name: 'Alfa Consultoria' }];
const hubClient = { checkoutUrl: mocks.checkoutUrl };
const organizationSeam = {
  active: organizations[0],
  activeName: 'Alfa Consultoria',
  organizations,
  others: [],
  setActive: mocks.setActive,
  client: hubClient,
};

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
  useOrganizations: () => organizationSeam,
}));

vi.mock('@/components/ui/dialog', () => ({
  /*
    `Fechar` reproduces the real `DialogContent`'s own close affordance (an X
    carrying an `sr-only` "Fechar"), which is what an operator clicks to abandon
    the wizard. Without it the cancel path would have no control to drive and the
    cancellation oracle could not exist at all.
  */
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: HTMLAttributes<HTMLDivElement> & {
    open?: boolean;
    onOpenChange?: (next: boolean) => void;
  }) =>
    open === false ? null : (
      <div>
        <button onClick={() => onOpenChange?.(false)} type="button">
          Fechar
        </button>
        {children}
      </div>
    ),
  DialogContent: ({ children, className }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className} role="dialog">
      {children}
    </div>
  ),
  DialogDescription: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
  DialogFooter: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogTitle: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props}>{children}</h2>
  ),
}));

import { SalesOpsApp } from '../../SalesOpsApp';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

// ── fixtures ────────────────────────────────────────────────────────────────

const STAGE_NOVO = 'aaaaaaaa-0000-4000-8000-000000000001';
const STAGE_CONVERSAO = 'aaaaaaaa-0000-4000-8000-000000000003';
const STAGE_PERDIDO = 'aaaaaaaa-0000-4000-8000-000000000004';

const LEAD_ID = 'bbbbbbbb-0000-4000-8000-00000000000a';
const CLIENT_ID = 'cccccccc-0000-4000-8000-000000000001';
const CREATED_CLIENT_ID = 'cccccccc-0000-4000-8000-0000000000ff';
const PERSON_ID = 'pppppppp-0000-4000-8000-000000000001';
const PRODUCT_ID = 'dddddddd-0000-4000-8000-000000000001';
const AREA_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const AREA_OUTRA_ID = 'eeeeeeee-0000-4000-8000-000000000002';
const FUNCAO_VENDEDOR_ID = 'ffffffff-0000-4000-8000-000000000001';
const SALE_ID = '99999999-0000-4000-8000-000000000001';

type Stage = {
  id: string;
  name: string;
  kind: 'normal' | 'conversion' | 'lost';
  position: number;
};

const STAGES: Stage[] = [
  { id: STAGE_NOVO, name: 'Novo', kind: 'normal', position: 1 },
  { id: STAGE_CONVERSAO, name: 'Proposta enviada', kind: 'conversion', position: 2 },
  { id: STAGE_PERDIDO, name: 'Perdido', kind: 'lost', position: 3 },
];

function stageRow(stage: Stage) {
  return {
    ...stage,
    orgId: 'org-a',
    isSystem: stage.kind !== 'normal',
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  };
}

type LeadPatch = Partial<{
  clientId: string | null;
  clientNameSnapshot: string;
  products: Array<{ productId: string | null; productNameSnapshot: string }>;
  estimatedValueBrl: number;
  saleId: string | null;
  saleStatus: string | null;
  saleCode: string | null;
  stageId: string;
}>;

function leadRow(patch: LeadPatch = {}) {
  return {
    id: LEAD_ID,
    stageId: STAGE_NOVO,
    position: 1,
    contactName: 'Ana Souza',
    clientId: CLIENT_ID,
    clientNameSnapshot: 'Construtora Ipê',
    estimatedValueBrl: 0,
    description: 'duas frentes',
    sellerPersonId: PERSON_ID,
    sellerNameSnapshot: 'Marina Lopes',
    lostReason: null,
    stageChangedAt: '2026-09-15T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [{ productId: PRODUCT_ID, productNameSnapshot: 'FXL Custom' }],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

const BOOTSTRAP = {
  sales: [],
  products: [
    {
      id: PRODUCT_ID,
      orgId: 'org-a',
      name: 'FXL Custom',
      kind: 'product',
      codeSuffix: '01',
      areaId: AREA_ID,
      openPrice: false,
      setupBrl: 2_000_000,
      hasMonthly: false,
      monthlyBrl: 0,
      recurringCommission: false,
      hasFinderCommission: false,
      sellerCommissionType: 'pct',
      sellerCommissionValue: '5',
      sellerWithFinderCommissionType: 'pct',
      sellerWithFinderCommissionValue: '3',
      finderCommissionType: 'pct',
      finderCommissionValue: '2',
      modules: [],
      providers: [],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    },
  ],
  productFuncaoCosts: [],
  clients: [
    {
      id: CLIENT_ID,
      orgId: 'org-a',
      name: 'Construtora Ipê',
      contact: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    },
  ],
  areas: [
    {
      id: AREA_ID,
      orgId: 'org-a',
      name: 'Tecnologia',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    },
    {
      id: AREA_OUTRA_ID,
      orgId: 'org-a',
      name: 'Consultoria',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    },
  ],
  funcoes: [
    {
      id: FUNCAO_VENDEDOR_ID,
      orgId: 'org-a',
      name: 'Vendedor',
      slug: 'vendedor',
      isSystem: true,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    },
  ],
  people: [
    {
      id: PERSON_ID,
      orgId: 'org-a',
      displayName: 'Marina Lopes',
      contactEmail: null,
      status: 'active',
      funcaoIds: [FUNCAO_VENDEDOR_ID],
      funcoes: [{ id: FUNCAO_VENDEDOR_ID, name: 'Vendedor', slug: 'vendedor', isSystem: true }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    },
  ],
  payables: [],
  saleItems: [],
  receivables: [],
  saleProfessionals: [],
  settings: null,
};

// ── the fetch router ────────────────────────────────────────────────────────

type Write = { method: string; url: string; body: Record<string, unknown> };

type Scenario = {
  /** The one lead on the board. */
  lead: ReturnType<typeof leadRow>;
  /** Resolves the `POST /sales` response; `undefined` answers 201 immediately. */
  saleGate?: { promise: Promise<Response>; resolve: (value: Response) => void };
  /** Status for `POST /sales` when no gate is used. */
  saleStatus?: number;
  /** Status for `POST /leads/:id/move`. */
  moveStatus?: number;
};

function json(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

let writes: Write[];
let scenario: Scenario;
let container: HTMLDivElement;
let root: Root | null;

function route(input: string, init?: RequestInit): Promise<Response> {
  const url = String(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    } catch {
      body = {};
    }
    writes.push({ method, url, body });
  }

  if (url.includes('/sales-ops/bootstrap')) return Promise.resolve(json(200, BOOTSTRAP));
  if (url.includes('/sales-ops/lead-stages')) {
    return Promise.resolve(json(200, { stages: STAGES.map(stageRow) }));
  }
  if (url.includes('/sales-ops/leads?')) {
    const stageId = new URL(url).searchParams.get('stageId');
    const leads = scenario.lead.stageId === stageId ? [scenario.lead] : [];
    return Promise.resolve(json(200, { leads, nextCursor: null }));
  }
  if (method === 'POST' && /\/sales-ops\/leads\/[^/]+\/move$/.test(url)) {
    const status = scenario.moveStatus ?? 200;
    if (status >= 400) return Promise.resolve(json(status, { error: 'server_error' }));
    const body = JSON.parse(String(init?.body ?? '{}')) as { stageId?: string; saleId?: string };
    scenario.lead = {
      ...scenario.lead,
      stageId: body.stageId ?? scenario.lead.stageId,
      saleId: body.saleId ?? null,
      saleStatus: body.saleId ? 'draft' : null,
      saleCode: body.saleId ? '0001-1' : null,
    };
    return Promise.resolve(json(200, { lead: scenario.lead }));
  }
  if (method === 'POST' && url.endsWith('/sales-ops/clients')) {
    return Promise.resolve(
      json(201, {
        client: {
          id: CREATED_CLIENT_ID,
          orgId: 'org-a',
          name: 'Nova Empresa',
          contact: null,
          createdAt: '2026-09-18T12:00:00.000Z',
          updatedAt: null,
        },
      }),
    );
  }
  if (method === 'POST' && url.endsWith('/sales-ops/sales')) {
    if (scenario.saleGate) return scenario.saleGate.promise;
    const status = scenario.saleStatus ?? 201;
    if (status >= 400) return Promise.resolve(json(status, { error: 'validation_error' }));
    return Promise.resolve(
      json(201, { sale: { id: SALE_ID, code: 'V-0001', status: 'draft' }, ledger: {} }),
    );
  }
  return Promise.resolve(json(200, {}));
}

// ── harness ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = null;
  writes = [];
  scenario = { lead: leadRow() };
  vi.stubGlobal('fetch', vi.fn(route));
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function settle(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
}

async function renderApp() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          initialEntries={['/operacional/leads']}
        >
          <Routes>
            <Route element={<SalesOpsApp />} path="/:workspace/:view" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
}

function required(selector: string): Element {
  const node = container.querySelector(selector);
  if (!node) throw new Error(`not found: ${selector}`);
  return node;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await settle(2);
}

function buttonLabelled(label: string): HTMLButtonElement {
  const node = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!node) throw new Error(`button not found: ${label}`);
  return node;
}

/** The lead ids rendered under `stageId`, in DOM order. */
function columnOrder(stageId: string): string[] {
  const column = required(`[data-stage-column="${stageId}"]`);
  return [...column.querySelectorAll('[data-lead-card]')].map(
    (node) => node.getAttribute('data-lead-card') ?? '',
  );
}

/** Non-GET requests only. GETs are background refetches and prove nothing here. */
function nonGetWrites(): Write[] {
  return writes;
}

function moveRequests(): Write[] {
  return writes.filter((write) => /\/leads\/[^/]+\/move$/.test(write.url));
}

/** Opens the `Mover para` dialog and drives it to the conversion column. */
async function moveIntoConversionColumn() {
  await click(required(`[data-move-trigger="${LEAD_ID}"]`));
  const trigger = container.querySelector('[aria-labelledby="move-lead-stage-label"]');
  if (!trigger) throw new Error('destination picker not found');
  await click(trigger);
  const row = [...container.querySelectorAll('[role="option"]')].find(
    (node) => node.textContent?.trim() === 'Proposta enviada',
  );
  if (!row) throw new Error('conversion stage not offered as a move target');
  await click(row);
  await click(required('[data-move-confirm]'));
}

/**
 * The wizard's own DialogDescription, which nothing else in the shell renders.
 * `Nova proposta` would NOT do: it is also the shell's header action label, so a
 * closed wizard would still read as open and every cancellation assertion would
 * be vacuous.
 */
function wizardIsOpen(): boolean {
  return (container.textContent ?? '').includes('Cliente, itens, pagamento e custos');
}

describe('a lead becomes a proposta, and the card moves only afterwards', () => {
  it('issues no request at all when the conversion wizard is cancelled, and leaves the card in its column', async () => {
    await renderApp();
    writes = [];

    await moveIntoConversionColumn();
    expect(wizardIsOpen()).toBe(true);
    // Not one request has been issued by opening the wizard - the cliente
    // resolve-or-create has not run, and no lead move exists.
    expect(nonGetWrites()).toEqual([]);

    await click(buttonLabelled('Fechar'));

    expect(wizardIsOpen()).toBe(false);
    expect(nonGetWrites()).toEqual([]);
    expect(columnOrder(STAGE_NOVO)).toEqual([LEAD_ID]);
    expect(columnOrder(STAGE_CONVERSAO)).toEqual([]);
  });

  it('refuses to convert a lead whose only produto is free text, so an incomplete lead cannot become a ghost card', async () => {
    scenario.lead = leadRow({
      products: [{ productId: null, productNameSnapshot: 'Consultoria avulsa' }],
      estimatedValueBrl: 250_000,
    });
    await renderApp();
    writes = [];

    await moveIntoConversionColumn();
    expect(wizardIsOpen()).toBe(true);

    // A free row seeds `areaId: ''` on purpose, and `draftValid` requires one.
    expect(buttonLabelled('Salvar rascunho').disabled).toBe(true);
    expect(nonGetWrites()).toEqual([]);
    expect(columnOrder(STAGE_NOVO)).toEqual([LEAD_ID]);
    expect(columnOrder(STAGE_CONVERSAO)).toEqual([]);

    // THE NON-VACUITY CONTROL. Without it this test passes against a wizard that
    // renders nothing at all: pick an área on the item and the very same button
    // becomes enabled.
    const areaTrigger = [...container.querySelectorAll('[role="combobox"]')].find(
      (node) => node.getAttribute('aria-label') === 'Área do item 1',
    );
    if (!areaTrigger) throw new Error('item área picker not found');
    await click(areaTrigger);
    const areaRow = [...container.querySelectorAll('[role="option"]')].find(
      (node) => node.textContent?.trim() === 'Tecnologia',
    );
    if (!areaRow) throw new Error('área option not offered');
    await click(areaRow);

    expect(buttonLabelled('Salvar rascunho').disabled).toBe(false);
    // And still nothing has been written: enabling a button is not a request.
    expect(nonGetWrites()).toEqual([]);
  });

  it('moves the card only after POST /sales resolves 201, and never while it is in flight', async () => {
    let releaseSale: (value: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => {
      releaseSale = resolve;
    });
    scenario.saleGate = { promise: gate, resolve: releaseSale };

    await renderApp();
    writes = [];

    await moveIntoConversionColumn();
    await click(buttonLabelled('Salvar rascunho'));

    // IN FLIGHT. The proposta does not exist yet, so the card has not moved and
    // no move request exists.
    expect(writes.some((write) => write.url.endsWith('/sales-ops/sales'))).toBe(true);
    expect(moveRequests()).toEqual([]);
    expect(columnOrder(STAGE_NOVO)).toEqual([LEAD_ID]);
    expect(columnOrder(STAGE_CONVERSAO)).toEqual([]);

    await act(async () => {
      scenario.saleGate?.resolve(
        json(201, { sale: { id: SALE_ID, code: 'V-0001', status: 'draft' }, ledger: {} }),
      );
    });
    await settle(6);

    const moves = moveRequests();
    expect(moves).toHaveLength(1);
    // The WIRE names, per the shipped `.strict()` MoveLeadSchema.
    expect(moves[0]?.body).toMatchObject({ stageId: STAGE_CONVERSAO, saleId: SALE_ID });
    expect(moves[0]?.url).toContain(`/leads/${LEAD_ID}/move`);
    expect(columnOrder(STAGE_CONVERSAO)).toEqual([LEAD_ID]);
    expect(columnOrder(STAGE_NOVO)).toEqual([]);
  });

  it('leaves the card in place and issues no lead move when POST /sales fails', async () => {
    scenario.saleStatus = 400;
    await renderApp();
    writes = [];

    await moveIntoConversionColumn();
    await click(buttonLabelled('Salvar rascunho'));
    await settle(6);

    expect(writes.some((write) => write.url.endsWith('/sales-ops/sales'))).toBe(true);
    expect(moveRequests()).toEqual([]);
    expect(columnOrder(STAGE_NOVO)).toEqual([LEAD_ID]);
    expect(columnOrder(STAGE_CONVERSAO)).toEqual([]);
    // The wizard stays open so the operator can fix and retry.
    expect(wizardIsOpen()).toBe(true);
  });

  it('creates the cliente only when the conversion is saved, and never when the wizard opens', async () => {
    scenario.lead = leadRow({ clientId: null, clientNameSnapshot: 'Nova Empresa' });
    await renderApp();
    writes = [];

    await moveIntoConversionColumn();
    expect(wizardIsOpen()).toBe(true);
    // ACCEPTANCE 12: opening the wizard creates nothing.
    expect(nonGetWrites()).toEqual([]);

    await click(buttonLabelled('Salvar rascunho'));
    await settle(6);

    expect(writes[0]?.url).toContain('/sales-ops/clients');
    expect(writes[0]?.method).toBe('POST');
    expect(writes[1]?.url).toContain('/sales-ops/sales');
    expect(writes[1]?.body.clientId).toBe(CREATED_CLIENT_ID);
    expect(moveRequests()).toHaveLength(1);
  });

  it('reuses an existing cliente by name instead of creating a second one', async () => {
    // The lead carries no id, and its snapshot name folds onto the cadastro row.
    scenario.lead = leadRow({ clientId: null, clientNameSnapshot: '  construtora ipe  ' });
    await renderApp();
    writes = [];

    await moveIntoConversionColumn();
    await click(buttonLabelled('Salvar rascunho'));
    await settle(6);

    expect(writes.some((write) => write.url.includes('/sales-ops/clients'))).toBe(false);
    const sale = writes.find((write) => write.url.endsWith('/sales-ops/sales'));
    expect(sale?.body.clientId).toBe(CLIENT_ID);
  });

  it('converts once and retries only the move, never a second proposta', async () => {
    scenario.moveStatus = 500;
    await renderApp();
    writes = [];

    await moveIntoConversionColumn();
    await click(buttonLabelled('Salvar rascunho'));
    await settle(6);

    expect(writes.filter((write) => write.url.endsWith('/sales-ops/sales'))).toHaveLength(1);
    expect(moveRequests()).toHaveLength(1);
    // The move failed, so the optimistic patch rolled back and the card is home.
    expect(columnOrder(STAGE_NOVO)).toEqual([LEAD_ID]);

    scenario.moveStatus = 200;
    await moveIntoConversionColumn();
    await settle(6);

    // The SECOND attempt never re-opens the wizard and never POSTs a second
    // proposta: a proposta carries a code and a sequence and cannot be
    // un-created, because `salesOpsRouter` has no DELETE verb.
    expect(writes.filter((write) => write.url.endsWith('/sales-ops/sales'))).toHaveLength(1);
    const moves = moveRequests();
    expect(moves).toHaveLength(2);
    expect(moves[1]?.body.saleId).toBe(SALE_ID);
  });

  it('never reaches a sale transition endpoint, and renders a converted card read-only', async () => {
    scenario.lead = leadRow({
      stageId: STAGE_CONVERSAO,
      saleId: SALE_ID,
      saleStatus: 'won',
      saleCode: '0001-1',
    });
    await renderApp();

    expect(container.querySelector(`[data-move-trigger="${LEAD_ID}"]`)).toBeNull();
    expect(container.querySelector('[data-read-only-card]')).not.toBeNull();
    expect(columnOrder(STAGE_CONVERSAO)).toEqual([LEAD_ID]);
    expect(required('[data-conversion-column]').textContent).toContain('Ganha');
    expect(
      writes.some(
        (write) => write.url.includes('/transition') || write.url.includes('cancel-contract'),
      ),
    ).toBe(false);
  });
});
