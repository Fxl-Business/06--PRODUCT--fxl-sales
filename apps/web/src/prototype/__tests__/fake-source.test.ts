// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeadsPage } from '@/sales-ops/leads/types';
import type { SalesOpsBootstrap } from '@/sales-ops/types';
import { installFakeSource } from '../fake-source';

const API = 'http://localhost:3006/api/v1/sales-ops';
const realFetch = globalThis.fetch;
const realEventSource = globalThis.EventSource;

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A hand-built token with the claims the fake network reads; the real dev identity mints the same shape. */
function token(sub: string, workspaceId: string, name = sub): string {
  return `${b64url({ alg: 'none' })}.${b64url({ sub, workspaceId, name })}.sig`;
}

const ANA = token('user_fake_ana', 'org_fake_norte', 'Ana Diretora');
const LARA = token('user_fake_lara', 'org_fake_leads', 'Lara Gestora');
const LEO = token('user_fake_leo', 'org_fake_leads', 'Leo Vendedor');

const call = (path: string, bearer: string | null, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
  });

async function leadsOf(bearer: string, stageId: string): Promise<LeadsPage> {
  return (await call(`/leads?stageId=${stageId}&limit=100`, bearer)).json();
}

describe('the prototype fake network', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installFakeSource();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    globalThis.EventSource = realEventSource;
    vi.restoreAllMocks();
  });

  it('answers the bootstrap in the real route shape for the full organization', async () => {
    const res = await call('/bootstrap', ANA);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SalesOpsBootstrap;
    expect(body.orgModules?.orcamentos).toBe(true);
    expect(body.sales.map((sale) => sale.status)).toEqual(expect.arrayContaining(['won', 'open', 'lost']));
    expect(body.people.some((person) => person.contactEmail === 'ana@fake.local')).toBe(true);
  });

  it('answers the compact profile (orcamentos off, no propostas) for the leads organization', async () => {
    const body = (await (await call('/bootstrap', LARA)).json()) as SalesOpsBootstrap;
    expect(body.orgModules?.orcamentos).toBe(false);
    expect(body.sales).toEqual([]);
    const stages = (await (await call('/lead-stages', LARA)).json()) as {
      stages: Array<{ kind: string; type?: string }>;
    };
    // The orcamento etapa is an ordinary one while the module is off.
    expect(stages.stages.find((stage) => stage.type === 'orcamento')?.kind).toBe('normal');
  });

  it('requires a bearer token, like the real API', async () => {
    const res = await call('/bootstrap', null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('a write changes the world the next read sees, and a reload seeds it again', async () => {
    const pipelines = (await (await call('/pipelines', ANA)).json()) as {
      pipelines: Array<{ stages: Array<{ id: string; name: string }> }>;
    };
    const novo = pipelines.pipelines[0]!.stages.find((stage) => stage.name === 'Novo')!;
    const before = (await leadsOf(ANA, novo.id)).leads.length;

    const created = await call('/leads', ANA, {
      method: 'POST',
      body: JSON.stringify({
        contactName: 'Nova Pessoa',
        contactEmail: 'nova@example.com',
        clientId: null,
        clientName: 'Empresa Nova',
        estimatedValueBrl: 120_000,
        fields: [],
      }),
    });
    expect(created.status).toBe(201);
    expect((await leadsOf(ANA, novo.id)).leads.map((lead) => lead.contactName)).toContain('Nova Pessoa');
    expect((await leadsOf(ANA, novo.id)).leads).toHaveLength(before + 1);

    const archived = await call('/areas/' + (await bootstrapAreaId()), ANA, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(archived.status).toBe(200);
    const history = (await (await call('/history?limit=10&action=cadastro.archived', ANA)).json()) as {
      entries: Array<{ entityType: string }>;
    };
    expect(history.entries[0]?.entityType).toBe('area');

    installFakeSource(); // a reload runs the entry again
    expect((await leadsOf(ANA, novo.id)).leads).toHaveLength(before);
  });

  it('moves a lead only along the pipeline graph and reports the refusal', async () => {
    const { pipelines } = (await (await call('/pipelines', ANA)).json()) as {
      pipelines: Array<{ stages: Array<{ id: string; name: string }> }>;
    };
    const stage = (name: string) => pipelines[0]!.stages.find((row) => row.name === name)!.id;
    const [lead] = (await leadsOf(ANA, stage('Novo'))).leads;
    const refused = await call(`/leads/${lead!.id}/move`, ANA, {
      method: 'POST',
      body: JSON.stringify({ stageId: stage('Proposta'), position: 0 }),
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: 'transition_not_allowed' });
    const allowed = await call(`/leads/${lead!.id}/move`, ANA, {
      method: 'POST',
      body: JSON.stringify({ stageId: stage('Qualificação'), position: 0 }),
    });
    expect(allowed.status).toBe(200);
  });

  it('scopes a vendedor to own and unassigned leads', async () => {
    const { pipelines } = (await (await call('/pipelines', LEO)).json()) as {
      pipelines: Array<{ stages: Array<{ id: string; name: string }> }>;
    };
    const novo = pipelines[0]!.stages.find((row) => row.name === 'Novo')!.id;
    const names = (await leadsOf(LEO, novo)).leads.map((lead) => lead.contactName);
    expect(names).toEqual(['Eduardo Faria', 'Sônia Pinheiro']);
    const admin = (await leadsOf(LARA, novo)).leads.map((lead) => lead.contactName);
    expect(admin).toHaveLength(2);
    expect((await call('/followups?scope=team&status=open', LEO)).status).toBe(403);
  });

  it('names the method, path, query and identity when a combination is not in the fixtures', async () => {
    const res = await call('/sales?year=2026', ANA, { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('not_in_prototype');
    expect(body.message).toContain('POST /api/v1/sales-ops/sales?year=2026');
    expect(body.message).toContain('user_fake_ana');

    const stranger = await call('/bootstrap', token('user_fake_other', 'org_fake_norte', 'Outra Pessoa'));
    const strangerBody = (await stranger.json()) as { message: string };
    expect(strangerBody.message).toContain('user_fake_other');
    expect(strangerBody.message).toContain('GET /api/v1/sales-ops/bootstrap');
  });

  it('names an auth route it does not seed, and blocks a request that would leave the page', async () => {
    const auth = await fetch('http://localhost:8006/auth/refresh', { method: 'POST' });
    expect(auth.status).toBe(404);
    expect(((await auth.json()) as { message: string }).message).toContain('POST /auth/refresh');
    const outside = await fetch('https://hub.example.com/v1/x');
    expect(outside.status).toBe(404);
    expect(((await outside.json()) as { message: string }).message).toContain('/v1/x');
  });

  it('replaces EventSource with one that fails by naming the stream', async () => {
    const source = new EventSource('http://localhost:3006/api/v1/sales-ops/stream?since=3');
    const failed = new Promise<void>((resolve) => {
      source.onerror = () => resolve();
    });
    await failed;
    expect(source.readyState).toBe(2);
    const logged = vi.mocked(console.error).mock.calls.flat().join(' ');
    expect(logged).toContain('GET /api/v1/sales-ops/stream?since=3');
  });
});

async function bootstrapAreaId(): Promise<string> {
  const body = (await (await call('/bootstrap', ANA)).json()) as SalesOpsBootstrap;
  return body.areas[0]!.id;
}
