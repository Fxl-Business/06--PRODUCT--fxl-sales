// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/i18n';
import ptBR from '@/i18n/pt-BR.json';
import en from '@/i18n/en.json';

/**
 * Slice 09 oracle: the admin sellers page surfaces the Hub invitation.
 *
 * `@/lib/api-client` and the hooks are NOT mocked: the real `apiFetch` runs
 * against a stubbed global `fetch`, so the oracle sees the exact method, path and
 * bearer of every request the page issues. Only the token seam and the Radix
 * dialog shells are replaced (their portals and focus traps are not under test).
 *
 * Every invite warning and error is asserted by the COPY its code maps to, and a
 * server `message` is deliberately made unrecognisable so a page that echoed it
 * would fail.
 */

const TOKEN = 'admin-hub-access-token';

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => TOKEN }),
  useSalesEdition: () => 'full',
}));

/*
  A context-aware stand-in: the trigger stays rendered and opens its dialog, the
  content renders only while open, the same contract as the Radix primitive.
*/
vi.mock('@/components/ui/dialog', () => {
  const OpenCtx = React.createContext<{ open: boolean; set: (open: boolean) => void }>({
    open: false,
    set: () => undefined,
  });
  return {
    Dialog: ({
      children,
      open,
      onOpenChange,
    }: {
      children: ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => (
      <OpenCtx.Provider value={{ open: open === true, set: (next) => onOpenChange?.(next) }}>
        {children}
      </OpenCtx.Provider>
    ),
    DialogTrigger: ({ children }: { children: ReactNode }) => {
      const ctx = React.useContext(OpenCtx);
      return <span onClick={() => ctx.set(true)}>{children}</span>;
    },
    DialogContent: ({ children }: HTMLAttributes<HTMLDivElement>) => {
      const ctx = React.useContext(OpenCtx);
      return ctx.open ? <div role="dialog">{children}</div> : null;
    },
    DialogHeader: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
    DialogFooter: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
    DialogTitle: ({ children }: HTMLAttributes<HTMLHeadingElement>) => <h2>{children}</h2>,
    DialogDescription: ({ children }: HTMLAttributes<HTMLParagraphElement>) => <p>{children}</p>,
  };
});

/* The CloseCtx version from cadastro-history.test.tsx, so Cancel really closes. */
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
        <CloseCtx.Provider value={() => onOpenChange?.(false)}>
          <div role="alertdialog">{children}</div>
        </CloseCtx.Provider>
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

import { AdminSellersPage } from '../AdminSellersPage';
import { inviteLocaleOf } from '../hooks/useSellers';

const act = (React as typeof React & { act: typeof import('react-dom/test-utils').act }).act;

// ── fixtures ────────────────────────────────────────────────────────────────

const ACCEPT_URL = 'https://hub.example/invitations/accept?token=single-use-secret-token';
const RAW_SERVER_PROSE = 'RAW-SERVER-PROSE-NEVER-RENDER';

type Status = 'pending' | 'accepted' | 'expired' | 'revoked' | null;

function seller(id: string, name: string, invitationStatus: Status) {
  return {
    id,
    accountId: null,
    displayName: name,
    contactEmail: `${name.toLowerCase()}@fxl.example`,
    status: 'active',
    createdAt: '2026-09-30T12:00:00.000Z',
    updatedAt: null,
    invitationId: invitationStatus ? `inv-${id}` : null,
    invitationStatus,
    invitedOrgId: invitationStatus ? 'org-a' : null,
  };
}

const PENDING = seller('11111111-0000-4000-8000-000000000001', 'Paula', 'pending');
const ACCEPTED = seller('11111111-0000-4000-8000-000000000002', 'Aline', 'accepted');
const EXPIRED = seller('11111111-0000-4000-8000-000000000003', 'Edu', 'expired');
const REVOKED = seller('11111111-0000-4000-8000-000000000004', 'Rita', 'revoked');
const UNINVITED = seller('11111111-0000-4000-8000-000000000005', 'Nina', null);
const CREATED = seller('11111111-0000-4000-8000-0000000000ff', 'Carla', 'pending');

function invitation() {
  return {
    id: `inv-${CREATED.id}`,
    organizationId: 'org-a',
    applicationId: 'app-sales',
    email: CREATED.contactEmail,
    status: 'pending',
    appRoles: ['seller'],
    invitedByAccountId: 'acc-admin',
    expiresAt: '2026-10-08T12:00:00.000Z',
    createdAt: '2026-10-01T12:00:00.000Z',
    acceptedAt: null,
  };
}

function delivery(
  warnings: Array<'application_url_missing' | 'email_not_configured' | 'email_failed'>,
  emailStatus: 'sent' | 'not_configured' | 'failed' = 'sent',
) {
  return {
    invitation: invitation(),
    acceptUrl: ACCEPT_URL,
    emailDelivery: { status: emailStatus },
    warnings: warnings.map((code) => ({ code })),
  };
}

// ── fetch stub ──────────────────────────────────────────────────────────────

type Reply = { status: number; body: unknown; headers?: Record<string, string> };
type Call = { method: string; path: string; auth: string | null; body: unknown };

let listed: unknown[];
let calls: Call[];
let createReply: Reply;
let resendReply: Reply;
let revokeReply: Reply;
let inviteReply: Reply;

function json(reply: Reply): Response {
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { 'Content-Type': 'application/json', ...(reply.headers ?? {}) },
  });
}

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input.toString());
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path: url.pathname, auth: headers.get('Authorization'), body });

      if (method === 'GET' && url.pathname === '/api/v1/admin/sellers') {
        return json({ status: 200, body: { sellers: listed } });
      }
      if (method === 'POST' && url.pathname === '/api/v1/admin/sellers') {
        return json(createReply);
      }
      if (method === 'POST' && url.pathname.endsWith('/resend')) return json(resendReply);
      if (method === 'POST' && url.pathname.endsWith('/revoke')) return json(revokeReply);
      if (method === 'POST' && url.pathname.endsWith('/invite')) return json(inviteReply);
      return json({ status: 404, body: { error: 'not_found' } });
    }),
  );
}

// ── harness ─────────────────────────────────────────────────────────────────

let container: HTMLDivElement;
let root: Root;
let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  listed = [PENDING, ACCEPTED, EXPIRED, REVOKED, UNINVITED];
  calls = [];
  createReply = { status: 201, body: { seller: CREATED, ...delivery([]) } };
  resendReply = { status: 200, body: { seller: PENDING, ...delivery([]) } };
  revokeReply = { status: 200, body: { seller: { ...PENDING, invitationStatus: 'revoked' } } };
  inviteReply = {
    status: 200,
    body: { seller: { ...UNINVITED, invitationId: 'inv-new', invitationStatus: 'pending' }, ...delivery([]) },
  };
  installFetch();
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await act(async () => {
    await i18n.changeLanguage('pt-BR');
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <AdminSellersPage />
      </QueryClientProvider>,
    );
  });
  await flush();
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
}

function text(): string {
  return container.textContent ?? '';
}

function buttons(label: string, scope: ParentNode = container): HTMLButtonElement[] {
  return [...scope.querySelectorAll('button')].filter(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const match = buttons(label, scope).at(-1);
  if (!match) throw new Error(`button not found: ${label}`);
  return match;
}

function rowOf(name: string): HTMLTableRowElement {
  const row = [...container.querySelectorAll('tbody tr')].find((candidate) =>
    candidate.textContent?.includes(name),
  );
  if (!(row instanceof HTMLTableRowElement)) throw new Error(`row not found: ${name}`);
  return row;
}

function dialog(): HTMLElement {
  const match = [...container.querySelectorAll('[role="dialog"]')].at(-1);
  if (!(match instanceof HTMLElement)) throw new Error('no dialog open');
  return match;
}

async function typeInto(id: string, value: string) {
  const input = container.querySelector(`#${id}`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`input not found: ${id}`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function createSeller() {
  await click(button('Convidar vendedor'));
  await typeInto('seller-name', CREATED.displayName);
  await typeInto('seller-email', CREATED.contactEmail);
  await click(button('Convidar vendedor', dialog()));
}

function posts(suffix: string): Call[] {
  return calls.filter((call) => call.method === 'POST' && call.path.endsWith(suffix));
}

function expectNothingLogged(secret: string) {
  for (const spy of consoleSpies) {
    for (const args of spy.mock.calls) {
      expect(JSON.stringify(args)).not.toContain(secret);
    }
  }
}

// ── the list ────────────────────────────────────────────────────────────────

describe('invitation state per row', () => {
  it('renders the list status of every row as a badge, never computing it', async () => {
    await mount();

    expect(rowOf('Paula').textContent).toContain('Pendente');
    expect(rowOf('Aline').textContent).toContain('Aceito');
    expect(rowOf('Edu').textContent).toContain('Expirado');
    expect(rowOf('Rita').textContent).toContain('Revogado');
    expect(rowOf('Nina').textContent).toContain('Sem convite');
    expect([...container.querySelectorAll('thead th')].map((th) => th.textContent)).toContain(
      'Convite',
    );
  });

  it('offers resend on pending and expired rows and revoke only on pending ones', async () => {
    await mount();

    expect(buttons('Reenviar', rowOf('Paula'))).toHaveLength(1);
    expect(buttons('Revogar', rowOf('Paula'))).toHaveLength(1);
    expect(buttons('Reenviar', rowOf('Edu'))).toHaveLength(1);
    expect(buttons('Revogar', rowOf('Edu'))).toHaveLength(0);
    for (const name of ['Aline', 'Rita', 'Nina']) {
      expect(buttons('Reenviar', rowOf(name)), name).toHaveLength(0);
      expect(buttons('Revogar', rowOf(name)), name).toHaveLength(0);
    }
  });

  it('offers Enviar convite only on rows with no invitation or a revoked one', async () => {
    await mount();

    expect(buttons('Enviar convite', rowOf('Nina'))).toHaveLength(1);
    expect(buttons('Enviar convite', rowOf('Rita'))).toHaveLength(1);
    for (const name of ['Paula', 'Aline', 'Edu']) {
      expect(buttons('Enviar convite', rowOf(name)), name).toHaveLength(0);
    }
    // Enviar convite never shares a row with Reenviar or Revogar.
    for (const name of ['Nina', 'Rita']) {
      expect(buttons('Reenviar', rowOf(name)), name).toHaveLength(0);
      expect(buttons('Revogar', rowOf(name)), name).toHaveLength(0);
    }
  });

  it('styles Enviar convite exactly like Reenviar inside the fixed-height actions cell', async () => {
    await mount();

    const send = button('Enviar convite', rowOf('Nina'));
    const resend = button('Reenviar', rowOf('Paula'));
    expect(send.className).toBe(resend.className);
    expect(send.type).toBe(resend.type);
    expect(send.parentElement?.className).toBe(resend.parentElement?.className);
    expect(send.parentElement?.className).toContain('h-9');
    // A row with no action at all keeps the same fixed-height cell.
    const empty = rowOf('Aline').querySelector('td:last-child > div');
    expect(empty?.className).toBe(resend.parentElement?.className);
  });

  it('never renders a raw invitation or organization id', async () => {
    await mount();

    expect(text()).not.toContain('inv-');
    expect(text()).not.toContain('org-a');
  });
});

// ── create outcome ──────────────────────────────────────────────────────────

describe('create outcome', () => {
  it('keeps the create validation (name >= 2 chars, email with @)', async () => {
    await mount();
    await click(button('Convidar vendedor'));
    const submit = () => button('Convidar vendedor', dialog());

    expect(submit().disabled).toBe(true);
    await typeInto('seller-name', 'C');
    await typeInto('seller-email', 'carla@fxl.example');
    expect(submit().disabled).toBe(true);
    await typeInto('seller-name', 'Carla');
    await typeInto('seller-email', 'carla.fxl.example');
    expect(submit().disabled).toBe(true);
    await typeInto('seller-email', 'carla@fxl.example');
    expect(submit().disabled).toBe(false);
  });

  it('posts the create with the bearer and confirms a sent invitation', async () => {
    await mount();
    await createSeller();

    const [create] = posts('/api/v1/admin/sellers');
    expect(create?.auth).toBe(`Bearer ${TOKEN}`);
    expect(create?.body).toEqual({
      displayName: CREATED.displayName,
      contactEmail: CREATED.contactEmail,
      locale: 'pt-BR',
    });
    expect(text()).toContain(`Convite enviado para ${CREATED.contactEmail}.`);
    expect(text()).not.toContain(ACCEPT_URL);
  });

  it('email_not_configured shows the acceptUrl with a copy action and never logs it', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    createReply = {
      status: 201,
      body: { seller: CREATED, ...delivery(['email_not_configured'], 'not_configured') },
    };
    await mount();
    await createSeller();

    expect(text()).toContain(ptBR.admin.sellers.invitation.warnings.email_not_configured);
    expect(dialog().textContent).toContain(ACCEPT_URL);
    await click(button('Copiar link'));
    expect(writeText).toHaveBeenCalledWith(ACCEPT_URL);
    expect(text()).toContain('Copiado');
    expectNothingLogged('single-use-secret-token');
  });

  it('email_failed offers a resend that posts to the resend endpoint', async () => {
    createReply = {
      status: 201,
      body: { seller: CREATED, ...delivery(['email_failed'], 'failed') },
    };
    resendReply = { status: 200, body: { seller: CREATED, ...delivery([]) } };
    await mount();
    await createSeller();

    expect(text()).toContain(ptBR.admin.sellers.invitation.warnings.email_failed);
    expect(dialog().textContent).not.toContain(ACCEPT_URL);
    await click(button('Reenviar', dialog()));

    const [resend] = posts('/resend');
    expect(resend?.path).toBe(`/api/v1/admin/sellers/${CREATED.id}/resend`);
    expect(resend?.auth).toBe(`Bearer ${TOKEN}`);
    expect(text()).toContain(`Convite enviado para ${CREATED.contactEmail}.`);
  });

  it('application_url_missing informs the operator', async () => {
    createReply = {
      status: 201,
      body: { seller: CREATED, ...delivery(['application_url_missing']) },
    };
    await mount();
    await createSeller();

    expect(text()).toContain(ptBR.admin.sellers.invitation.warnings.application_url_missing);
  });

  it('an inviteError renders the copy of its code, never the server message', async () => {
    createReply = {
      status: 201,
      body: {
        seller: CREATED,
        inviteError: {
          status: 403,
          error: 'forbidden',
          code: 'application_not_granted',
          message: RAW_SERVER_PROSE,
        },
      },
    };
    await mount();
    await createSeller();

    expect(text()).toContain(ptBR.admin.sellers.invitation.errors.application_not_granted);
    expect(text()).toContain(ptBR.admin.sellers.invitation.outcome.sellerSaved.replace('{{name}}', 'Carla'));
    expect(text()).not.toContain(RAW_SERVER_PROSE);
  });

  it('hub_auth_not_configured is an operator item and the new seller row stays', async () => {
    createReply = {
      status: 201,
      body: {
        seller: { ...CREATED, invitationId: null, invitationStatus: null, invitedOrgId: null },
        inviteError: { status: 503, error: 'unavailable', code: 'hub_auth_not_configured' },
      },
    };
    await mount();
    listed = [{ ...CREATED, invitationId: null, invitationStatus: null, invitedOrgId: null }, ...listed];
    await createSeller();

    expect(text()).toContain(ptBR.admin.sellers.invitation.errors.hub_auth_not_configured);
    expect(text()).not.toContain(ptBR.admin.sellers.invitation.errors.unknown);
    expect(rowOf('Carla').textContent).toContain('Sem convite');
    // The copy points to the row action that exists, never to resending a
    // non-existent invitation.
    expect(ptBR.admin.sellers.invitation.errors.hub_auth_not_configured).toContain('Enviar convite');
    expect(ptBR.admin.sellers.invitation.errors.hub_auth_not_configured).not.toMatch(/reenvi/i);
    expect(en.admin.sellers.invitation.errors.hub_auth_not_configured).toContain(
      en.admin.sellers.invitation.actions.send,
    );
    expect(en.admin.sellers.invitation.errors.hub_auth_not_configured).not.toMatch(/resend/i);
    expect(buttons('Enviar convite', rowOf('Carla'))).toHaveLength(1);
  });

  it('rate_limited shows the retry wait', async () => {
    createReply = {
      status: 201,
      body: {
        seller: CREATED,
        inviteError: {
          status: 429,
          error: 'rate_limited',
          code: 'rate_limited',
          message: RAW_SERVER_PROSE,
          retryAfterSeconds: 42,
        },
      },
    };
    await mount();
    await createSeller();

    expect(text()).toContain(
      ptBR.admin.sellers.invitation.rateLimitedWait.replace('{{seconds}}', '42'),
    );
  });

  it('an unrecognised code falls back to the unknown copy, never the server message', async () => {
    createReply = {
      status: 201,
      body: {
        seller: CREATED,
        inviteError: { status: 500, error: 'x', code: 'brand_new_code', message: RAW_SERVER_PROSE },
      },
    };
    await mount();
    await createSeller();

    expect(text()).toContain(ptBR.admin.sellers.invitation.errors.unknown);
    expect(text()).not.toContain(RAW_SERVER_PROSE);
  });
});

// ── row actions ─────────────────────────────────────────────────────────────

describe('row resend and revoke', () => {
  it('resend posts to the row endpoint with the bearer and shows the outcome', async () => {
    resendReply = {
      status: 200,
      body: { seller: PENDING, ...delivery(['email_not_configured'], 'not_configured') },
    };
    await mount();
    await click(button('Reenviar', rowOf('Paula')));

    expect(posts('/resend')).toEqual([
      expect.objectContaining({
        path: `/api/v1/admin/sellers/${PENDING.id}/resend`,
        auth: `Bearer ${TOKEN}`,
      }),
    ]);
    expect(text()).toContain(ptBR.admin.sellers.invitation.warnings.email_not_configured);
    expect(dialog().textContent).toContain(ACCEPT_URL);
  });

  it('disables the row actions while a resend is in flight', async () => {
    let release: (() => void) | undefined;
    const fetchStub = vi.mocked(globalThis.fetch);
    const original = fetchStub.getMockImplementation();
    fetchStub.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/resend')) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return original!(input, init);
    });
    await mount();
    await click(button('Reenviar', rowOf('Paula')));

    expect(button('Reenviar', rowOf('Paula')).disabled).toBe(true);
    expect(button('Revogar', rowOf('Paula')).disabled).toBe(true);
    expect(button('Reenviar', rowOf('Edu')).disabled).toBe(false);
    release?.();
    await flush();
  });

  it('resend errors render by code: no Hub, not invited, rate limited', async () => {
    await mount();

    resendReply = { status: 503, body: { error: 'unavailable', code: 'hub_auth_not_configured' } };
    await click(button('Reenviar', rowOf('Paula')));
    expect(text()).toContain(ptBR.admin.sellers.invitation.hubNotConfiguredRetry);
    await click(button('Fechar', dialog()));

    resendReply = { status: 409, body: { error: 'conflict', code: 'seller_not_invited' } };
    await click(button('Reenviar', rowOf('Paula')));
    expect(text()).toContain(ptBR.admin.sellers.invitation.errors.seller_not_invited);
    await click(button('Fechar', dialog()));

    resendReply = {
      status: 429,
      body: { error: 'rate_limited', code: 'rate_limited', message: RAW_SERVER_PROSE },
      headers: { 'Retry-After': '17' },
    };
    await click(button('Reenviar', rowOf('Paula')));
    expect(text()).toContain(
      ptBR.admin.sellers.invitation.rateLimitedWait.replace('{{seconds}}', '17'),
    );
    expect(text()).not.toContain(RAW_SERVER_PROSE);
  });

  it('a 429 whose retryAfterSeconds is only in the body renders that exact wait', async () => {
    await mount();
    resendReply = {
      status: 429,
      body: { error: 'rate_limited', code: 'rate_limited', retryAfterSeconds: 23 },
    };
    await click(button('Reenviar', rowOf('Paula')));

    expect(text()).toContain(
      ptBR.admin.sellers.invitation.rateLimitedWait.replace('{{seconds}}', '23'),
    );
    expect(text()).not.toContain(ptBR.admin.sellers.invitation.errors.rate_limited);
  });

  it('a body retryAfterSeconds of 0 is kept, never replaced by the header', async () => {
    await mount();
    resendReply = {
      status: 429,
      body: { error: 'rate_limited', code: 'rate_limited', retryAfterSeconds: 0 },
      headers: { 'Retry-After': '17' },
    };
    await click(button('Reenviar', rowOf('Paula')));

    expect(text()).toContain(
      ptBR.admin.sellers.invitation.rateLimitedWait.replace('{{seconds}}', '0'),
    );
    expect(text()).not.toContain(
      ptBR.admin.sellers.invitation.rateLimitedWait.replace('{{seconds}}', '17'),
    );
  });

  it('revoke asks for confirmation; cancel sends nothing', async () => {
    await mount();
    await click(button('Revogar', rowOf('Paula')));

    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('Paula');
    await click(button('Voltar'));
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(posts('/revoke')).toEqual([]);
  });

  it('confirmed revoke posts to the revoke endpoint and refreshes the list', async () => {
    await mount();
    await click(button('Revogar', rowOf('Paula')));
    listed = [{ ...PENDING, invitationStatus: 'revoked' }, ACCEPTED];
    await click(button('Revogar convite'));

    expect(posts('/revoke')).toEqual([
      expect.objectContaining({
        path: `/api/v1/admin/sellers/${PENDING.id}/revoke`,
        auth: `Bearer ${TOKEN}`,
      }),
    ]);
    expect(rowOf('Paula').textContent).toContain('Revogado');
    expect(buttons('Revogar', rowOf('Paula'))).toHaveLength(0);
  });

  it('a revoke error renders by code', async () => {
    revokeReply = {
      status: 409,
      body: { error: 'conflict', code: 'invitation_not_pending', message: RAW_SERVER_PROSE },
    };
    await mount();
    await click(button('Revogar', rowOf('Paula')));
    await click(button('Revogar convite'));

    expect(text()).toContain(ptBR.admin.sellers.invitation.errors.invitation_not_pending);
    expect(text()).not.toContain(RAW_SERVER_PROSE);
  });
});

// ── send a new invitation ───────────────────────────────────────────────────

describe('row Enviar convite', () => {
  it('posts to the invite endpoint with the bearer and the locale, and shows the outcome like create', async () => {
    inviteReply = {
      status: 200,
      body: {
        seller: { ...UNINVITED, invitationId: 'inv-new', invitationStatus: 'pending' },
        ...delivery(['email_not_configured'], 'not_configured'),
      },
    };
    await mount();
    listed = [PENDING, ACCEPTED, EXPIRED, REVOKED, { ...UNINVITED, invitationStatus: 'pending' }];
    await click(button('Enviar convite', rowOf('Nina')));

    expect(posts('/invite')).toEqual([
      expect.objectContaining({
        path: `/api/v1/admin/sellers/${UNINVITED.id}/invite`,
        auth: `Bearer ${TOKEN}`,
        body: { locale: 'pt-BR' },
      }),
    ]);
    expect(posts('/resend')).toEqual([]);
    expect(dialog().textContent).toContain(ptBR.admin.sellers.invitation.outcome.invitedTitle);
    expect(text()).toContain(ptBR.admin.sellers.invitation.warnings.email_not_configured);
    expect(dialog().textContent).toContain(ACCEPT_URL);
    expectNothingLogged('single-use-secret-token');
    // The list refreshed: the row now reads Pendente with Reenviar, no Enviar convite.
    expect(rowOf('Nina').textContent).toContain('Pendente');
    expect(buttons('Enviar convite', rowOf('Nina'))).toHaveLength(0);
  });

  it('sends a new invitation from a revoked row', async () => {
    await mount();
    await click(button('Enviar convite', rowOf('Rita')));

    expect(posts('/invite')[0]?.path).toBe(`/api/v1/admin/sellers/${REVOKED.id}/invite`);
    expect(text()).toContain(`Convite enviado para ${UNINVITED.contactEmail}.`);
  });

  it('sends locale en when the UI is in English', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    await mount();
    await click(button(en.admin.sellers.invitation.actions.send, rowOf('Nina')));

    expect(posts('/invite')[0]?.body).toEqual({ locale: 'en' });
  });

  it('disables the row action and shows a spinner while the request is in flight', async () => {
    let release: (() => void) | undefined;
    const fetchStub = vi.mocked(globalThis.fetch);
    const original = fetchStub.getMockImplementation();
    fetchStub.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/invite')) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return original!(input, init);
    });
    await mount();
    await click(button('Enviar convite', rowOf('Nina')));

    const sending = button('Enviar convite', rowOf('Nina'));
    expect(sending.disabled).toBe(true);
    expect(sending.getAttribute('aria-busy')).toBe('true');
    expect(sending.querySelector('.animate-spin')).not.toBeNull();
    expect(button('Enviar convite', rowOf('Rita')).disabled).toBe(false);
    expect(button('Reenviar', rowOf('Paula')).disabled).toBe(false);
    release?.();
    await flush();
  });

  it('errors render by code, never the server message', async () => {
    await mount();

    inviteReply = {
      status: 503,
      body: { error: 'unavailable', code: 'hub_auth_not_configured', message: RAW_SERVER_PROSE },
    };
    await click(button('Enviar convite', rowOf('Nina')));
    expect(dialog().textContent).toContain(ptBR.admin.sellers.invitation.outcome.inviteFailedTitle);
    expect(text()).toContain(ptBR.admin.sellers.invitation.errors.hub_auth_not_configured);
    expect(text()).not.toContain(RAW_SERVER_PROSE);
    await click(button('Fechar', dialog()));

    inviteReply = { status: 409, body: { error: 'conflict', code: 'seller_already_invited' } };
    await click(button('Enviar convite', rowOf('Nina')));
    expect(text()).toContain(ptBR.admin.sellers.invitation.errors.seller_already_invited);
    expect(text()).not.toContain(ptBR.admin.sellers.invitation.errors.unknown);
    await click(button('Fechar', dialog()));

    inviteReply = {
      status: 429,
      body: { error: 'rate_limited', code: 'rate_limited', retryAfterSeconds: 9 },
    };
    await click(button('Enviar convite', rowOf('Nina')));
    expect(text()).toContain(ptBR.admin.sellers.invitation.rateLimitedWait.replace('{{seconds}}', '9'));
  });

  it('a 503 on a seller that HAS an invitation does not point to Enviar convite', async () => {
    await mount();
    resendReply = { status: 503, body: { error: 'unavailable', code: 'hub_auth_not_configured' } };
    await click(button('Reenviar', rowOf('Paula')));

    expect(text()).toContain(ptBR.admin.sellers.invitation.hubNotConfiguredRetry);
    expect(text()).not.toContain(ptBR.admin.sellers.invitation.errors.hub_auth_not_configured);
  });
});

// ── invite locale ───────────────────────────────────────────────────────────

describe('invite locale follows the active UI language', () => {
  async function useLanguage(language: string) {
    await act(async () => {
      await i18n.changeLanguage(language);
    });
  }

  function expectNoActWarning() {
    const errorSpy = consoleSpies[3];
    for (const args of errorSpy?.mock.calls ?? []) {
      expect(String(args[0])).not.toContain('not wrapped in act');
    }
  }

  it('pt-BR: create and resend send locale pt-BR', async () => {
    await mount();
    await createSeller();
    await click(button('Fechar', dialog()));
    await click(button('Reenviar', rowOf('Paula')));

    expect(posts('/api/v1/admin/sellers')[0]?.body).toEqual({
      displayName: CREATED.displayName,
      contactEmail: CREATED.contactEmail,
      locale: 'pt-BR',
    });
    expect(posts('/resend')[0]?.body).toEqual({ locale: 'pt-BR' });
    expectNoActWarning();
  });

  it('en: create and resend send locale en', async () => {
    await useLanguage('en');
    await mount();
    await click(button(en.admin.sellers.invite));
    await typeInto('seller-name', CREATED.displayName);
    await typeInto('seller-email', CREATED.contactEmail);
    await click(button(en.admin.sellers.invite, dialog()));
    await click(button(en.admin.sellers.invitation.actions.close, dialog()));
    await click(button(en.admin.sellers.invitation.actions.resend, rowOf('Paula')));

    expect(posts('/api/v1/admin/sellers')[0]?.body).toEqual({
      displayName: CREATED.displayName,
      contactEmail: CREATED.contactEmail,
      locale: 'en',
    });
    expect(posts('/resend')[0]?.body).toEqual({ locale: 'en' });
    expectNoActWarning();
  });

  it('en-US: create and resend send the mapped locale en, never the raw language', async () => {
    await useLanguage('en-US');
    await mount();
    await click(button(en.admin.sellers.invite));
    await typeInto('seller-name', CREATED.displayName);
    await typeInto('seller-email', CREATED.contactEmail);
    await click(button(en.admin.sellers.invite, dialog()));
    await click(button(en.admin.sellers.invitation.actions.close, dialog()));
    await click(button(en.admin.sellers.invitation.actions.resend, rowOf('Paula')));

    expect(posts('/api/v1/admin/sellers')[0]?.body).toEqual({
      displayName: CREATED.displayName,
      contactEmail: CREATED.contactEmail,
      locale: 'en',
    });
    expect(posts('/resend')[0]?.body).toEqual({ locale: 'en' });
    expectNoActWarning();
  });

  it('a switch after mount is honoured by the next request', async () => {
    await mount();
    await useLanguage('en');
    await click(button(en.admin.sellers.invitation.actions.resend, rowOf('Paula')));
    await click(button(en.admin.sellers.invitation.actions.close, dialog()));
    await useLanguage('pt-BR');
    await click(button('Reenviar', rowOf('Paula')));

    expect(posts('/resend').map((call) => call.body)).toEqual([
      { locale: 'en' },
      { locale: 'pt-BR' },
    ]);
    expectNoActWarning();
  });

  it.each([
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['pt-BR', 'pt-BR'],
    ['pt', 'pt-BR'],
    ['es', 'pt-BR'],
    ['', 'pt-BR'],
    [undefined, 'pt-BR'],
  ] as const)('maps the UI language %s to %s', (language, expected) => {
    expect(inviteLocaleOf(language)).toBe(expected);
  });
});

// ── copy coverage ───────────────────────────────────────────────────────────

describe('copy by code', () => {
  const CODES = [
    'actor_not_member',
    'application_not_granted',
    'invalid_app_roles',
    'invitation_not_found',
    'invitation_not_pending',
    'invalid_actor_token',
    'rate_limited',
    'network_error',
    'unexpected_response',
    'invalid_client',
    'application_mismatch',
    'not_an_application',
    'invalid_request',
    'discovery_missing_api_url',
    'discovery_insecure_api_url',
    'hub_auth_not_configured',
    'seller_not_invited',
    'seller_already_invited',
    'not_found',
    'unknown',
  ];
  const WARNINGS = ['application_url_missing', 'email_not_configured', 'email_failed'];

  it.each(CODES)('error code %s has copy in both locales', (code) => {
    for (const locale of [ptBR, en]) {
      const errors = locale.admin.sellers.invitation.errors as Record<string, string>;
      expect(errors[code], code).toBeTruthy();
    }
  });

  it.each(WARNINGS)('warning code %s has copy in both locales', (code) => {
    for (const locale of [ptBR, en]) {
      const warnings = locale.admin.sellers.invitation.warnings as Record<string, string>;
      expect(warnings[code], code).toBeTruthy();
    }
  });
});
