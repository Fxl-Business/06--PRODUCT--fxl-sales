// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '@/lib/query-keys';
import { ContactLeadDialog } from '../ContactLeadDialog';
import { LeadCard } from '../LeadCard';
import { LeadDialog } from '../LeadDialog';
import { LeadsBoardContainer } from '../LeadsBoardContainer';
import { buildLabelLookups } from '../board-labels';
import { MUTATION_ERROR_COPY } from '../../mutation-error-copy';
import { LEAD_DELETE_COPY, LEAD_DELETE_ERROR_COPY, leadDeleteErrorCopy } from '../delete-copy';
import { flattenLeadPages } from '../optimistic';
import type { LeadsInfiniteData, SalesOpsLead, SalesOpsLeadStage } from '../types';

/**
 * THE LEAD DELETE ORACLE (lixeira slice 03): AC1 to AC5 and AC7 in the UI.
 *
 * Two halves. The first renders `LeadCard` alone and pins the STRUCTURE of the
 * card menu: which cards carry it, and that neither the kebab nor the portalled
 * menu ever reaches the dnd-kit activator or the editor. The second drives the
 * REAL container, hooks, board, dialogs and `apiFetch` against a stubbed global
 * `fetch`, because the claims there are about requests and the cache: a mocked
 * hook would let a 204 that `apiFetch` cannot parse pass as a success.
 *
 * No drag is simulated: happy-dom runs no pointer capture, so a drag proves
 * nothing. "Never starts a drag" is asserted at the only door dnd-kit has into a
 * card, the `onPointerDown` it hands the card through `dragHandleProps`.
 *
 * `@/components/ui/dialog` and `@/components/ui/alert-dialog` are REAL on
 * purpose: Escape on the confirmation must close only the confirmation, and that
 * is decided by Radix's layer stack, which a mocked dialog does not have.
 */

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

const mocks = vi.hoisted(() => ({
  edition: 'full' as 'full' | 'leads',
  roles: ['admin', 'seller'] as string[],
}));

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'hub-access-token' }),
  useSalesEdition: () => mocks.edition,
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: mocks.roles,
    name: 'Gestor',
    email: 'gestor@example.com',
  }),
}));

// ── fixtures ────────────────────────────────────────────────────────────────

const NOVO_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const PROPOSTA_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const PERDIDO_ID = 'aaaaaaaa-0000-4000-8000-000000000003';

const ANA = 'bbbbbbbb-0000-4000-8000-00000000000a';
const BRUNO = 'bbbbbbbb-0000-4000-8000-00000000000b';
const CARLA = 'bbbbbbbb-0000-4000-8000-00000000000c';
const SALE_ID = 'cccccccc-0000-4000-8000-00000000000f';

function stage(id: string, name: string, kind: SalesOpsLeadStage['kind'], position: number) {
  return {
    id,
    orgId: 'org-a',
    name,
    position,
    kind,
    isSystem: kind !== 'normal',
    status: 'active',
    archivedAt: null,
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
  } satisfies SalesOpsLeadStage;
}

const STAGES = [
  stage(NOVO_ID, 'Novo', 'normal', 1),
  stage(PROPOSTA_ID, 'Proposta enviada', 'conversion', 2),
  stage(PERDIDO_ID, 'Perdido', 'lost', 3),
];

function lead(id: string, contactName: string, patch: Partial<SalesOpsLead> = {}): SalesOpsLead {
  return {
    id,
    stageId: NOVO_ID,
    position: 0,
    contactName,
    clientId: null,
    clientNameSnapshot: 'CENTRAIS DE ABASTECIMENTO DO ESP SANTO',
    estimatedValueBrl: 150_000,
    description: null,
    contactPhone: '(11) 98888-7777',
    contactEmail: null,
    contactBirthDate: null,
    sellerPersonId: null,
    sellerNameSnapshot: 'Marina',
    lostReason: null,
    stageChangedAt: '2026-09-15T12:00:00.000Z',
    saleId: null,
    saleStatus: null,
    saleCode: null,
    products: [],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: null,
    ...patch,
  };
}

function seedLeads(): SalesOpsLead[] {
  return [
    lead(ANA, 'Ana Souza', { position: 0 }),
    lead(BRUNO, 'Bruno Lima', { position: 1 }),
    lead(CARLA, 'Carla Dias', {
      stageId: PROPOSTA_ID,
      saleId: SALE_ID,
      saleStatus: 'draft',
      saleCode: '0001-1',
    }),
  ];
}

// ── the fetch router ────────────────────────────────────────────────────────

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };

function json(status: number, body: unknown): FakeResponse {
  return { ok: status < 400, status, json: async () => body };
}

/** What a real 204 does: there is no body, so `json()` rejects. */
function noContent(): FakeResponse {
  return {
    ok: true,
    status: 204,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  };
}

type DeleteAnswer = { kind: 'ok' } | { kind: 'fail'; status: number; body: unknown } | {
  kind: 'gate';
  promise: Promise<FakeResponse>;
};

let serverLeads: SalesOpsLead[];
let deleteAnswer: DeleteAnswer;
let deleteCalls: Array<{ url: string; method: string; body: unknown; auth: string | null }>;

function route(input: string, init?: RequestInit): Promise<FakeResponse> {
  const url = new URL(String(input));
  const method = (init?.method ?? 'GET').toUpperCase();
  if (url.pathname.endsWith('/sales-ops/lead-stages')) {
    return Promise.resolve(json(200, { stages: STAGES }));
  }
  if (method === 'GET' && url.pathname.endsWith('/sales-ops/leads')) {
    const stageId = url.searchParams.get('stageId');
    return Promise.resolve(
      json(200, { leads: serverLeads.filter((row) => row.stageId === stageId), nextCursor: null }),
    );
  }
  const deleteMatch = /\/sales-ops\/leads\/([^/]+)\/delete$/.exec(url.pathname);
  if (method === 'POST' && deleteMatch) {
    const headers = new Headers(init?.headers);
    deleteCalls.push({
      url: url.pathname,
      method,
      body: init?.body ?? null,
      auth: headers.get('Authorization'),
    });
    if (deleteAnswer.kind === 'gate') return deleteAnswer.promise;
    if (deleteAnswer.kind === 'fail') {
      return Promise.resolve(json(deleteAnswer.status, deleteAnswer.body));
    }
    serverLeads = serverLeads.filter((row) => row.id !== deleteMatch[1]);
    return Promise.resolve(noContent());
  }
  return Promise.resolve(json(404, { error: 'not_found' }));
}

// ── harness ─────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mocks.edition = 'full';
  mocks.roles = ['admin', 'seller'];
  serverLeads = seedLeads();
  deleteAnswer = { kind: 'ok' };
  deleteCalls = [];
  vi.stubGlobal('fetch', vi.fn(route));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lets Radix's macrotask-registered listeners and the query round trips land. */
async function settle(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

async function renderContainer() {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
          initialEntries={['/operacional/leads']}
        >
          <Routes>
            <Route
              element={
                <LeadsBoardContainer clients={[]} people={[]} products={[]} sellers={[]} />
              }
              path="/operacional/leads"
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await settle();
}

function query(selector: string): Element | null {
  return document.querySelector(selector);
}

function required(selector: string): Element {
  const node = query(selector);
  if (!node) throw new Error(`not found: ${selector}`);
  return node;
}

async function click(element: Element, init: MouseEventInit = {}) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  });
  await settle(1);
}

/** Radix opens a menu on a primary-button pointerdown, so a click alone would not. */
async function press(element: Element) {
  await act(async () => {
    element.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, ctrlKey: false }),
    );
  });
  await click(element);
}

async function rightClick(element: Element): Promise<MouseEvent> {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
  await act(async () => {
    element.dispatchEvent(event);
  });
  await settle(1);
  return event;
}

async function escape(element: Element) {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  });
  await settle();
}

function buttonLabelled(label: string): HTMLButtonElement {
  const node = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!node) throw new Error(`button not found: ${label}`);
  return node;
}

function cardIds(): string[] {
  return [...document.querySelectorAll('[data-lead-card]')].map(
    (node) => node.getAttribute('data-lead-card') ?? '',
  );
}

function confirmDialog(): Element | null {
  return query('[role="alertdialog"]');
}

function editDialog(): Element | null {
  return query('[role="dialog"]');
}

async function openCardMenuDelete(leadId: string) {
  await press(required(`[data-lead-menu="${leadId}"]`));
  await click(required(`[role="menu"] [data-delete-lead="${leadId}"]`));
}

async function confirmDelete() {
  await click(required('[data-confirm-delete]'));
  await settle();
}

// ── the card, alone ─────────────────────────────────────────────────────────

const LOOKUPS = buildLabelLookups({ clients: [], people: [], products: [] });
const NOW = new Date('2026-09-18T12:00:00.000Z');

async function renderCard(props: Partial<React.ComponentProps<typeof LeadCard>> & { lead: SalesOpsLead }) {
  const handlers = {
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    dragPointerDown: vi.fn(),
  };
  await act(async () => {
    root.render(
      <LeadCard
        dragHandleProps={{ onPointerDown: handlers.dragPointerDown }}
        lookups={LOOKUPS}
        now={NOW}
        onDelete={handlers.onDelete}
        onEdit={handlers.onEdit}
        {...props}
      />,
    );
  });
  await settle(1);
  return handlers;
}

describe('the card menu, structurally', () => {
  it('a non-converted card carries a keyboard-reachable kebab; a converted card and a card without onDelete do not', async () => {
    await renderCard({ lead: lead(ANA, 'Ana Souza') });
    const trigger = required(`[data-lead-card="${ANA}"] [data-lead-menu="${ANA}"]`);
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('tabindex')).not.toBe('-1');
    expect(trigger.getAttribute('aria-label')).toBe(`${LEAD_DELETE_COPY.menuTrigger}: Ana Souza`);

    await renderCard({ lead: lead(CARLA, 'Carla Dias', { saleId: SALE_ID, saleStatus: 'won' }) });
    expect(query('[data-lead-menu]')).toBeNull();
    expect(required(`[data-lead-card="${CARLA}"]`).querySelectorAll('button')).toHaveLength(0);

    await renderCard({ lead: lead(ANA, 'Ana Souza'), onDelete: undefined });
    expect(query('[data-lead-menu]')).toBeNull();
  });

  it('the contact-edition card carries the same kebab', async () => {
    await renderCard({ lead: lead(ANA, 'Ana Souza'), fieldSet: 'contact' });
    expect(query(`[data-lead-menu="${ANA}"]`)).not.toBeNull();
  });

  it('a pointerdown on the kebab never reaches the drag activator; one on the card body does', async () => {
    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });

    await press(required(`[data-lead-menu="${ANA}"]`));
    expect(handlers.dragPointerDown).not.toHaveBeenCalled();

    // The positive control: the guard is not a blanket block on the card.
    await act(async () => {
      required(`[data-lead-card="${ANA}"]`).dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
      );
    });
    expect(handlers.dragPointerDown).toHaveBeenCalledTimes(1);
  });

  it('clicking the kebab opens the menu and never the editor', async () => {
    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });

    await press(required(`[data-lead-menu="${ANA}"]`));

    expect(query('[role="menu"]')).not.toBeNull();
    expect(required('[role="menu"] [data-delete-lead]').textContent).toBe(
      LEAD_DELETE_COPY.menuLabel,
    );
    expect(handlers.onEdit).not.toHaveBeenCalled();
    expect(handlers.dragPointerDown).not.toHaveBeenCalled();
  });

  it('a right-click on the card opens the same menu instead of the browser one, and never the editor', async () => {
    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });

    const event = await rightClick(required(`[data-lead-card="${ANA}"] span`));

    expect(event.defaultPrevented).toBe(true);
    expect(query('[role="menu"] [data-delete-lead]')).not.toBeNull();
    expect(handlers.onEdit).not.toHaveBeenCalled();
  });

  it('a right-click on a converted card keeps the browser menu', async () => {
    await renderCard({ lead: lead(CARLA, 'Carla Dias', { saleId: SALE_ID, saleStatus: 'won' }) });

    const event = await rightClick(required(`[data-lead-card="${CARLA}"]`));

    expect(event.defaultPrevented).toBe(false);
    expect(query('[role="menu"]')).toBeNull();
  });

  it('Excluir asks for this lead and neither edits nor reaches the drag activator', async () => {
    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });

    await press(required(`[data-lead-menu="${ANA}"]`));
    const item = required(`[role="menu"] [data-delete-lead="${ANA}"]`);
    await act(async () => {
      item.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    });
    await click(item);

    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete.mock.calls[0]?.[0]).toMatchObject({ id: ANA });
    expect(handlers.onEdit).not.toHaveBeenCalled();
    expect(handlers.dragPointerDown).not.toHaveBeenCalled();
    expect(query('[role="menu"]')).toBeNull();
  });

  it('a plain click on the card body still opens the editor', async () => {
    const handlers = await renderCard({ lead: lead(ANA, 'Ana Souza') });

    await click(required(`[data-lead-card="${ANA}"]`), { clientX: 0, clientY: 0 });

    expect(handlers.onEdit).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });
});

// ── the real flow ───────────────────────────────────────────────────────────

describe('deleting from the Quadro card menu', () => {
  it('confirms in-app, posts once with the bearer and removes the card', async () => {
    const nativeConfirm = vi.spyOn(window, 'confirm');
    await renderContainer();
    expect(cardIds()).toEqual([ANA, BRUNO, CARLA]);

    await openCardMenuDelete(ANA);

    expect(confirmDialog()?.textContent).toContain(LEAD_DELETE_COPY.dialogBody('Ana Souza'));
    expect(deleteCalls).toHaveLength(0);

    await confirmDelete();

    expect(deleteCalls).toEqual([
      {
        url: `/api/v1/sales-ops/leads/${ANA}/delete`,
        method: 'POST',
        body: null,
        auth: 'Bearer hub-access-token',
      },
    ]);
    expect(cardIds()).toEqual([BRUNO, CARLA]);
    expect(confirmDialog()).toBeNull();
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('Cancelar changes nothing', async () => {
    await renderContainer();
    await openCardMenuDelete(ANA);

    const cancel = [...required('[role="alertdialog"]').querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === LEAD_DELETE_COPY.cancel,
    );
    if (!cancel) throw new Error('Cancelar not rendered');
    await click(cancel);

    expect(confirmDialog()).toBeNull();
    expect(deleteCalls).toHaveLength(0);
    expect(cardIds()).toEqual([ANA, BRUNO, CARLA]);
  });

  it('removes the card optimistically and puts it back exactly when the API refuses', async () => {
    let answer!: (response: FakeResponse) => void;
    deleteAnswer = { kind: 'gate', promise: new Promise((resolve) => (answer = resolve)) };
    await renderContainer();
    const filtered = queryKeys.leads.board({ sellerPersonId: 'p-1' });
    const filteredSnapshot: LeadsInfiniteData = {
      pages: [{ leads: seedLeads(), nextCursor: null }],
      pageParams: [null],
    };
    queryClient.setQueryData(filtered, filteredSnapshot);

    await openCardMenuDelete(ANA);
    await click(required('[data-confirm-delete]'));

    // Optimistic: gone from the board AND from every other cached board.
    expect(cardIds()).toEqual([BRUNO, CARLA]);
    expect(required('[data-confirm-delete]').textContent).toBe(LEAD_DELETE_COPY.pending);
    expect((required('[data-confirm-delete]') as HTMLButtonElement).disabled).toBe(true);
    const removed = flattenLeadPages(queryClient.getQueryData<LeadsInfiniteData>(filtered));
    expect(removed.map((row) => row.id)).toEqual([BRUNO, CARLA]);
    expect(removed.find((row) => row.id === BRUNO)?.position).toBe(0);

    await act(async () => {
      answer(json(500, { error: 'internal' }));
    });
    await settle(1);

    // Exact revert: each board gets its own snapshot back (order and positions).
    expect(queryClient.getQueryData(filtered)).toEqual(filteredSnapshot);
    expect(cardIds()).toEqual([ANA, BRUNO, CARLA]);
    expect(confirmDialog()?.querySelector('[data-lead-delete-error]')?.textContent).toBe(
      'Não foi possível concluir a ação. Tente novamente.',
    );
  });

  it('Escape cannot close the confirmation while the delete is on the wire', async () => {
    let answer!: (response: FakeResponse) => void;
    deleteAnswer = { kind: 'gate', promise: new Promise((resolve) => (answer = resolve)) };
    await renderContainer();
    await openCardMenuDelete(ANA);
    await click(required('[data-confirm-delete]'));

    await escape(required('[role="alertdialog"]'));
    expect(confirmDialog()).not.toBeNull();

    // The server really deleted it, so the settle-time refetch agrees.
    serverLeads = serverLeads.filter((row) => row.id !== ANA);
    await act(async () => {
      answer(noContent());
    });
    await settle();
    expect(confirmDialog()).toBeNull();
    expect(cardIds()).toEqual([BRUNO, CARLA]);
  });

  it('a converted lead refused with 409 comes back and the confirmation says why', async () => {
    deleteAnswer = {
      kind: 'fail',
      status: 409,
      body: { error: 'conflict', reason: 'lead_already_converted' },
    };
    await renderContainer();
    await openCardMenuDelete(ANA);
    await confirmDelete();

    expect(cardIds()).toContain(ANA);
    expect(confirmDialog()?.querySelector('[data-lead-delete-error]')?.textContent).toBe(
      LEAD_DELETE_ERROR_COPY.converted,
    );
  });

  it('a 404 means already gone: the card stays removed and nothing scary shows', async () => {
    deleteAnswer = { kind: 'fail', status: 404, body: { error: 'not_found' } };
    await renderContainer();
    await openCardMenuDelete(ANA);
    serverLeads = serverLeads.filter((row) => row.id !== ANA);
    await confirmDelete();

    expect(cardIds()).toEqual([BRUNO, CARLA]);
    expect(confirmDialog()).toBeNull();
    expect(query('[data-lead-delete-error]')).toBeNull();
  });

  it('works the same in the leads edition', async () => {
    mocks.edition = 'leads';
    mocks.roles = ['seller'];
    await renderContainer();

    await openCardMenuDelete(BRUNO);
    await confirmDelete();

    expect(deleteCalls.map((call) => call.url)).toEqual([`/api/v1/sales-ops/leads/${BRUNO}/delete`]);
    expect(cardIds()).not.toContain(BRUNO);
  });
});

describe('deleting from the Lista', () => {
  it('offers Excluir beside Mover and Editar on an open row only, through the same confirmation', async () => {
    await renderContainer();
    await click(required('[data-view-option="list"]'));

    const row = required(`[data-list-row="${ANA}"]`);
    expect(row.querySelector(`[data-move-trigger="${ANA}"]`)).not.toBeNull();
    expect(row.querySelector(`[data-edit-lead="${ANA}"]`)).not.toBeNull();
    expect(row.querySelector(`[data-delete-lead="${ANA}"]`)?.textContent).toBe(
      LEAD_DELETE_COPY.menuLabel,
    );
    expect(query(`[data-list-row="${CARLA}"] [data-delete-lead]`)).toBeNull();

    await click(required(`[data-list-row="${ANA}"] [data-delete-lead="${ANA}"]`));
    expect(confirmDialog()?.textContent).toContain(LEAD_DELETE_COPY.dialogBody('Ana Souza'));
    await confirmDelete();

    expect(deleteCalls).toHaveLength(1);
    expect(query(`[data-list-row="${ANA}"]`)).toBeNull();
  });
});

describe('deleting from the edit form', () => {
  for (const edition of ['full', 'leads'] as const) {
    it(`${edition} edition: Excluir lead shows on edit only, and a confirmed delete closes the form`, async () => {
      mocks.edition = edition;
      await renderContainer();

      await click(buttonLabelled('Novo lead'));
      expect(editDialog()).not.toBeNull();
      expect(query('[data-delete-lead-form]')).toBeNull();
      await escape(editDialog() as Element);

      await click(required(`[data-lead-card="${ANA}"]`), { clientX: 0, clientY: 0 });
      expect(required('[data-delete-lead-form]').textContent).toContain(LEAD_DELETE_COPY.formButton);

      await click(required('[data-delete-lead-form]'));
      expect(confirmDialog()?.textContent).toContain(LEAD_DELETE_COPY.dialogBody('Ana Souza'));
      await confirmDelete();

      expect(deleteCalls).toHaveLength(1);
      expect(confirmDialog()).toBeNull();
      expect(editDialog()).toBeNull();
      expect(cardIds()).not.toContain(ANA);
    });
  }

  it('both forms render Excluir lead in edit mode only, even when handed onDelete', async () => {
    const onDelete = vi.fn();
    const forms = (initialId: string | undefined) => [
      <LeadDialog
        clients={[]}
        initial={initialId ? { id: initialId, contactName: 'Ana Souza', clientName: 'Acme' } : null}
        key="full"
        onDelete={onDelete}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        products={[]}
        sellers={[]}
      />,
      <ContactLeadDialog
        initial={
          initialId
            ? {
                id: initialId,
                contactName: 'Ana Souza',
                contactPhone: null,
                contactEmail: null,
                contactBirthDate: null,
                description: null,
              }
            : null
        }
        key="contact"
        onDelete={onDelete}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        sellers={[]}
        today="2026-10-07"
      />,
    ];

    for (const form of forms(undefined)) {
      await act(async () => root.render(form));
      await settle(1);
      expect(editDialog()).not.toBeNull();
      expect(query('[data-delete-lead-form]')).toBeNull();
    }
    for (const form of forms(ANA)) {
      await act(async () => root.render(form));
      await settle(1);
      await click(required('[data-delete-lead-form]'));
    }
    expect(onDelete).toHaveBeenCalledTimes(2);
  });

  it('a converted lead opened from the Lista gets no Excluir lead', async () => {
    await renderContainer();
    await click(required('[data-view-option="list"]'));
    await click(required(`[data-edit-lead="${CARLA}"]`));

    expect(editDialog()).not.toBeNull();
    expect(query('[data-delete-lead-form]')).toBeNull();
  });

  it('a refused delete keeps the form open behind the confirmation', async () => {
    deleteAnswer = { kind: 'fail', status: 500, body: { error: 'internal' } };
    await renderContainer();
    await click(required(`[data-lead-card="${ANA}"]`), { clientX: 0, clientY: 0 });
    await click(required('[data-delete-lead-form]'));
    await confirmDelete();

    expect(confirmDialog()?.querySelector('[data-lead-delete-error]')).not.toBeNull();
    expect(editDialog()).not.toBeNull();
  });

  it('Escape on the confirmation closes only the confirmation, never the form under it', async () => {
    await renderContainer();
    await click(required(`[data-lead-card="${ANA}"]`), { clientX: 0, clientY: 0 });
    // A keyboard operator: focus the button, then activate it (happy-dom's click
    // does not move focus the way a browser's does).
    const formButton = required('[data-delete-lead-form]') as HTMLButtonElement;
    await act(async () => formButton.focus());
    await click(formButton);
    expect(confirmDialog()).not.toBeNull();

    await escape(required('[role="alertdialog"]'));

    expect(confirmDialog()).toBeNull();
    expect(editDialog()).not.toBeNull();
    expect(deleteCalls).toHaveLength(0);
    // Focus goes back to the button that opened it, never to <body> under an open form.
    expect(document.activeElement).toBe(formButton);

    // The positive control: with nothing above it, Escape still closes the form,
    // so the assertion above is about the layer stack and not a dead listener.
    await escape(editDialog() as Element);
    expect(editDialog()).toBeNull();
  });
});

describe('leadDeleteErrorCopy', () => {
  it('names the converted refusal and hands everything else to the sales-ops mutation copy', () => {
    expect(leadDeleteErrorCopy({ status: 409, reason: 'lead_already_converted' })).toBe(
      LEAD_DELETE_ERROR_COPY.converted,
    );
    expect(leadDeleteErrorCopy({ status: 409, reason: 'something_else' })).toBe(
      MUTATION_ERROR_COPY.generic,
    );
    expect(leadDeleteErrorCopy({ status: 403, error: 'forbidden' })).toBe(
      MUTATION_ERROR_COPY.adminRequired,
    );
    expect(leadDeleteErrorCopy(new Error('network'))).toBe(MUTATION_ERROR_COPY.generic);
  });
});
