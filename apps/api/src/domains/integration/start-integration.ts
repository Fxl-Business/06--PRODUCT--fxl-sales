/**
 * Composition root for the Sales/Finance integration. Resolves the authority
 * ONCE at boot, never per request:
 *   - null:  no Hub credentials and no fake flag - nothing mounted, nothing started;
 *   - fake:  SALES_AUTH_FAKE - feed, gate, publisher and heartbeat; NO puller (the
 *            fake authority has no Finance feed server to pull from);
 *   - real:  the Hub-backed authority - everything, puller included.
 * Loops never auto-start under NODE_ENV === 'test'.
 */
import {
  startIntegrationPuller,
  startPositionPublisher,
  type IntegrationPullerHandle,
  type PositionPublisherHandle,
} from '@fxl-business/fxl-contracts';
import type { Hono } from 'hono';
import { getIntegrationAuthority, isFakeAuthRequested } from '../../auth/select.js';
import { buildIntegrationConfig } from './config.js';
import { createFinanceConsumer } from './consumer.js';
import { createIntegrationFeedRouter } from './feed-routes.js';
import { collectHeartbeatInputs, type HeartbeatPairState } from './heartbeat.js';
import { createIntegrationPooledAdapter } from './outbox-adapter.js';
import { registerProducerFlowGate } from './producer-gate.js';

export const INTEGRATION_FEED_BASE = '/integration/v1';
export const HEARTBEAT_INTERVAL_MS = 60_000;

export type IntegrationRuntime = 'fake' | 'real' | null;

/** Pure. Fake wins when requested; real needs Hub credentials; else off. */
export function resolveIntegrationRuntime(env: NodeJS.ProcessEnv = process.env): IntegrationRuntime {
  if (isFakeAuthRequested(env)) return 'fake';
  return buildIntegrationConfig(env as Parameters<typeof buildIntegrationConfig>[0]) === null
    ? null
    : 'real';
}

export interface IntegrationHandle {
  runtime: 'fake' | 'real';
  /** Resolves once the first activation refresh finished (never rejects). */
  ready: Promise<void>;
  stop(): Promise<void>;
}

export interface StartIntegrationOptions {
  app: Hono;
  env?: NodeJS.ProcessEnv;
}

export async function startIntegration(
  options: StartIntegrationOptions,
): Promise<IntegrationHandle | null> {
  const env = options.env ?? process.env;
  const runtime = resolveIntegrationRuntime(env);
  if (runtime === null) return null;

  const authority = await getIntegrationAuthority(env);
  if (authority === null) return null;

  const adapter = createIntegrationPooledAdapter();

  // Fail closed: the gate is a synchronous predicate over the last activation
  // snapshot; a failed refresh keeps the previous snapshot (empty at first).
  let liveOrgs: ReadonlySet<string> = new Set();
  let producerPairs: HeartbeatPairState[] = [];
  const refresh = async (): Promise<void> => {
    try {
      const producers = await authority.discovery.producerActivations();
      liveOrgs = new Set(producers.map((a) => a.organizationId));
      producerPairs = producers.map((a) => ({
        organizationId: a.organizationId,
        counterpartApplicationId: a.counterpartApplicationId,
        role: 'producer' as const,
      }));
    } catch {
      // Keep the previous snapshot.
    }
  };
  registerProducerFlowGate((orgId) => liveOrgs.has(orgId));

  options.app.route(
    INTEGRATION_FEED_BASE,
    createIntegrationFeedRouter({ adapter, verifier: authority.verifier }),
  );

  const ready = refresh();
  let stopped = false;
  let publisher: PositionPublisherHandle | null = null;
  let puller: IntegrationPullerHandle | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  if (env.NODE_ENV !== 'test') {
    publisher = startPositionPublisher({
      adapter,
      onError: (error) => console.error('[integration] position publisher failed:', error),
    });

    let consumerCounters = { applied: 0, rejected: 0 };
    if (runtime === 'real') {
      const consumer = createFinanceConsumer({
        adapter,
        discovery: authority.discovery,
        ticketClient: authority.ticketClient,
        onError: (error) => console.error('[integration] consumer pull failed:', error),
      });
      consumerCounters = consumer.counters;
      puller = startIntegrationPuller(consumer);
    }

    const beat = async (): Promise<void> => {
      try {
        await refresh();
        const consumerPairs: HeartbeatPairState[] =
          runtime === 'real'
            ? (await authority.discovery.activations()).map((p) => ({
                organizationId: p.organizationId,
                counterpartApplicationId: p.producerApplicationId,
                role: 'consumer' as const,
                appliedCount: consumerCounters.applied,
                rejectedCount: consumerCounters.rejected,
              }))
            : [];
        for (const input of collectHeartbeatInputs({ pairs: [...producerPairs, ...consumerPairs] })) {
          await authority.reporter.report(input);
        }
      } catch {
        // Heartbeat is best-effort; the next tick retries.
      }
    };
    heartbeatTimer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
  }

  return {
    runtime,
    ready,
    async stop() {
      if (stopped) return;
      stopped = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      registerProducerFlowGate(() => false);
      await publisher?.stop();
      await puller?.stop();
    },
  };
}
