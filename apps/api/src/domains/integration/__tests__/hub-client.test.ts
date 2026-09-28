import { describe, expect, it, vi } from 'vitest';
import {
  consumerPullPairs,
  createRealIntegrationAuthority,
  discoverActivations,
  discoverAllActivations,
  discoverContracts,
  organizationForFeedRead,
  peerEndpointForRole,
  producerActivations,
} from '../hub-client.js';

const config = {
  hubApiUrl: 'http://hub.test/',
  applicationId: 'app.fxl-sales',
  clientId: 'pk_id',
  clientSecret: 'sk_secret',
  environment: 'development' as const,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('hub client', () => {
  it('constructs the authority with zero network', () => {
    const fetchImpl = vi.fn();
    const a = createRealIntegrationAuthority(config, { fetchImpl: fetchImpl as never });
    expect(a.ticketClient.get).toBeTypeOf('function');
    expect(a.verifier.verify).toBeTypeOf('function');
    expect(a.reporter.report).toBeTypeOf('function');
    expect(a.discovery.activations).toBeTypeOf('function');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(organizationForFeedRead).toBeTypeOf('function');
  });

  it('GETs contracts with Basic auth and trimmed base', async () => {
    const fetchImpl = vi.fn(async () => json(200, { applicationId: 'app.fxl-sales', contracts: [] }));
    const out = await discoverContracts(config, { fetchImpl: fetchImpl as never });
    expect(out.status).toBe('ok');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://hub.test/integration/contracts');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('pk_id:sk_secret').toString('base64')}`,
    );
  });

  it('classifies outcomes', async () => {
    const seam = (r: () => Promise<Response>) => ({ fetchImpl: r as never });
    expect(await discoverActivations(config, {}, seam(async () => json(404, { code: 'nope' })))).toEqual({
      status: 'refused', httpStatus: 404, code: 'nope',
    });
    expect(await discoverActivations(config, {}, seam(async () => json(503, {})))).toMatchObject({
      status: 'unavailable', reason: 'server',
    });
    expect(
      await discoverActivations(config, {}, seam(async () => { throw new TypeError('x'); })),
    ).toEqual({ status: 'unavailable', reason: 'network' });
    expect(
      await discoverActivations(config, {}, seam(async () => {
        throw Object.assign(new Error('t'), { name: 'TimeoutError' });
      })),
    ).toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('401 throws a config error without leaking the secret', async () => {
    const err = await discoverContracts(config, { fetchImpl: (async () => json(401, {})) as never }).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain('sk_secret');
  });

  it('pages activations to exhaustion and derives pairs', async () => {
    const pages = [
      { activations: [{ activationId: 'a1', organizationId: 'o1', role: 'consumer', counterpartApplicationId: 'app.fxl-finance', createdAt: 'x' }], nextCursor: 'c1' },
      { activations: [{ activationId: 'a2', organizationId: 'o2', role: 'producer', counterpartApplicationId: 'app.fxl-finance', createdAt: 'x' }] },
    ];
    const fetchImpl = vi.fn(async (url: string) =>
      json(200, url.includes('cursor=c1') ? pages[1] : pages[0]),
    );
    const out = await discoverAllActivations(config, undefined, { fetchImpl: fetchImpl as never });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    if (out.status !== 'ok') throw new Error('expected ok');
    expect(consumerPullPairs(out.value)).toEqual([
      { producerApplicationId: 'app.fxl-finance', organizationId: 'o1' },
    ]);
    expect(producerActivations(out.value).map((a) => a.organizationId)).toEqual(['o2']);
  });

  it('derives the peer endpoint from discovery, never hardcoded', () => {
    const d = {
      applicationId: 'app.fxl-sales',
      environment: 'development' as const,
      contracts: [
        { role: 'consumer', counterpart: { applicationId: 'app.fxl-finance', apiUrl: 'http://peer', webUrl: null } },
      ],
    };
    expect(peerEndpointForRole(d as never, 'consumer')).toEqual({
      applicationId: 'app.fxl-finance', apiUrl: 'http://peer', webUrl: null,
    });
    expect(peerEndpointForRole(d as never, 'producer')).toBeNull();
  });
});
