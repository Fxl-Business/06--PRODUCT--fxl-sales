import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

const m = vi.hoisted(() => ({
  publisherStop: vi.fn(async () => {}),
  pullerStop: vi.fn(async () => {}),
  startPublisher: vi.fn(),
  startPuller: vi.fn(),
  authority: {
    ticketClient: {},
    verifier: { verify: vi.fn() },
    reporter: { report: vi.fn(async () => ({ status: 'ok' })) },
    discovery: {
      contracts: vi.fn(async () => []),
      activations: vi.fn(async () => []),
      producerActivations: vi.fn(async () => [
        {
          activationId: 'a1',
          organizationId: 'org-live',
          role: 'producer',
          counterpartApplicationId: 'app.fxl-finance',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ]),
    },
  },
  getAuthority: vi.fn(),
}));

vi.mock('@fxl-business/fxl-contracts', () => ({
  startPositionPublisher: (o: unknown) => {
    m.startPublisher(o);
    return { stop: m.publisherStop };
  },
  startIntegrationPuller: (o: unknown) => {
    m.startPuller(o);
    return { stop: m.pullerStop };
  },
}));
vi.mock('../../../auth/select.js', () => ({
  isFakeAuthRequested: (env: NodeJS.ProcessEnv) => env.SALES_AUTH_FAKE === '1',
  getIntegrationAuthority: m.getAuthority,
}));
vi.mock('../config.js', () => ({
  buildIntegrationConfig: (env: NodeJS.ProcessEnv) => (env.HUB_PRESENT ? { hub: true } : null),
}));
vi.mock('../outbox-adapter.js', () => ({ createIntegrationPooledAdapter: () => ({ pooled: true }) }));
vi.mock('../consumer.js', () => ({
  createFinanceConsumer: () => ({ counters: { applied: 0, rejected: 0 } }),
}));
vi.mock('../feed-routes.js', async () => {
  const { Hono: H } = await import('hono');
  return {
    createIntegrationFeedRouter: () => new H().get('/feed', (c) => c.json({ ok: true })),
  };
});

const { resolveIntegrationRuntime, startIntegration } = await import('../start-integration.js');
const { isProducerFlowLive, registerProducerFlowGate } = await import('../producer-gate.js');

describe('resolveIntegrationRuntime', () => {
  it('is null with neither config nor fake flag', () => {
    expect(resolveIntegrationRuntime({} as NodeJS.ProcessEnv)).toBeNull();
  });
  it('is fake when SALES_AUTH_FAKE is set, even with config', () => {
    expect(
      resolveIntegrationRuntime({ SALES_AUTH_FAKE: '1', HUB_PRESENT: '1' } as unknown as NodeJS.ProcessEnv),
    ).toBe('fake');
  });
  it('is real with Hub config and no flag', () => {
    expect(resolveIntegrationRuntime({ HUB_PRESENT: '1' } as unknown as NodeJS.ProcessEnv)).toBe('real');
  });
});

describe('startIntegration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getAuthority.mockResolvedValue(m.authority);
    registerProducerFlowGate(() => false);
  });

  it('does nothing when the runtime is null', async () => {
    const app = new Hono();
    const handle = await startIntegration({ app, env: {} as NodeJS.ProcessEnv });
    expect(handle).toBeNull();
    expect(m.getAuthority).not.toHaveBeenCalled();
    expect((await app.request('/integration/v1/feed')).status).toBe(404);
  });

  it('mounts the feed and registers the gate but starts no loop under test', async () => {
    const app = new Hono();
    const handle = await startIntegration({
      app,
      env: { NODE_ENV: 'test', HUB_PRESENT: '1' } as unknown as NodeJS.ProcessEnv,
    });
    await handle!.ready;
    expect((await app.request('/integration/v1/feed')).status).toBe(200);
    expect(isProducerFlowLive('org-live')).toBe(true);
    expect(isProducerFlowLive('org-other')).toBe(false);
    expect(m.startPublisher).not.toHaveBeenCalled();
    expect(m.startPuller).not.toHaveBeenCalled();
    await handle!.stop();
    expect(isProducerFlowLive('org-live')).toBe(false);
  });

  it('real mode starts publisher and puller; stop is idempotent', async () => {
    const handle = await startIntegration({
      app: new Hono(),
      env: { NODE_ENV: 'development', HUB_PRESENT: '1' } as unknown as NodeJS.ProcessEnv,
    });
    expect(handle!.runtime).toBe('real');
    expect(m.startPublisher).toHaveBeenCalledTimes(1);
    expect(m.startPuller).toHaveBeenCalledTimes(1);
    await handle!.stop();
    await handle!.stop();
    expect(m.publisherStop).toHaveBeenCalledTimes(1);
    expect(m.pullerStop).toHaveBeenCalledTimes(1);
  });

  it('fake mode starts the publisher but never the puller', async () => {
    const handle = await startIntegration({
      app: new Hono(),
      env: { NODE_ENV: 'development', SALES_AUTH_FAKE: '1' } as unknown as NodeJS.ProcessEnv,
    });
    expect(handle!.runtime).toBe('fake');
    expect(m.startPublisher).toHaveBeenCalledTimes(1);
    expect(m.startPuller).not.toHaveBeenCalled();
    await handle!.stop();
  });
});
