/**
 * Real integration authority: package ticket client, introspection verifier and
 * heartbeat reporter over the existing Hub config, plus the two discovery GETs
 * the package does not ship. No side effects at import or construction; the
 * network happens only when a method is called. NEVER hardcodes the Finance
 * address (it comes from discovery) and NEVER logs a ticket or secret.
 */
import {
  createIntrospectionVerifier,
  createTicketClient,
  IntegrationConfigError,
} from '@fxl-business/fxl-contracts';
import type {
  IntegrationPullPair,
  IntrospectionVerifier,
  TicketClient,
} from '@fxl-business/fxl-contracts';
import {
  toAuthorityConfig,
  type IntegrationClientSeams,
  type IntegrationConfig,
} from './config.js';
import { createSalesHeartbeatReporter, type HeartbeatReporter } from './heartbeat.js';

export { organizationForFeedRead } from '@fxl-business/fxl-contracts';

export interface DiscoveredContract {
  readonly contractId: string;
  readonly status: 'active' | 'suspended' | 'retired';
  readonly role: 'producer' | 'consumer';
  readonly eventName: string;
  readonly eventVersion: number;
  readonly schemaDigest: string;
  readonly contractsPackageVersion: string;
  readonly counterpartApplicationId: string;
  readonly counterpart: {
    readonly applicationId: string;
    readonly apiUrl: string | null;
    readonly webUrl: string | null;
  };
}
export interface ContractsDiscovery {
  readonly applicationId: string;
  readonly environment: 'production' | 'staging' | 'development';
  readonly contracts: readonly DiscoveredContract[];
}
export interface DiscoveredActivation {
  readonly activationId: string;
  readonly organizationId: string;
  readonly role: 'producer' | 'consumer';
  readonly counterpartApplicationId: string;
  readonly createdAt: string;
}
export interface ActivationsPage {
  readonly activations: readonly DiscoveredActivation[];
  readonly nextCursor?: string;
}

export type DiscoveryOutcome<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'refused'; readonly httpStatus: number; readonly code?: string }
  | {
      readonly status: 'unavailable';
      readonly reason: 'network' | 'timeout' | 'server';
      readonly httpStatus?: number;
    };

/** The discovery interface consumed by slices 04 and 08. */
export type IntegrationDiscovery = {
  contracts(): Promise<DiscoveredContract[]>;
  activations(): Promise<IntegrationPullPair[]>;
  producerActivations(): Promise<DiscoveredActivation[]>;
};

export type IntegrationAuthority = {
  ticketClient: TicketClient;
  verifier: IntrospectionVerifier;
  reporter: HeartbeatReporter;
  discovery: IntegrationDiscovery;
};

const DEFAULT_TIMEOUT_MS = 10_000;

async function getFromHub<T>(
  config: IntegrationConfig,
  path: string,
  query: Record<string, string> | undefined,
  seams: IntegrationClientSeams | undefined,
): Promise<DiscoveryOutcome<T>> {
  const qs = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query)}` : '';
  const url = `${config.hubApiUrl.replace(/\/+$/, '')}${path}${qs}`;
  const fetchImpl = seams?.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(seams?.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    const timedOut = name === 'AbortError' || name === 'TimeoutError';
    return { status: 'unavailable', reason: timedOut ? 'timeout' : 'network' };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const code =
    body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
      ? (body as { code: string }).code
      : undefined;

  if (res.status === 401 || (res.status === 403 && code === 'invalid_client')) {
    throw new IntegrationConfigError(
      'clientId',
      `The Hub rejected this application's credentials (HTTP ${res.status}) on ${path}.`,
    );
  }
  if (res.status >= 500) {
    return { status: 'unavailable', reason: 'server', httpStatus: res.status };
  }
  if (res.status >= 400) {
    return { status: 'refused', httpStatus: res.status, ...(code ? { code } : {}) };
  }
  if (body === undefined || body === null || typeof body !== 'object') {
    return { status: 'unavailable', reason: 'server', httpStatus: res.status };
  }
  return { status: 'ok', value: body as T };
}

export function discoverContracts(
  config: IntegrationConfig,
  seams?: IntegrationClientSeams,
): Promise<DiscoveryOutcome<ContractsDiscovery>> {
  return getFromHub<ContractsDiscovery>(config, '/integration/contracts', undefined, seams);
}

export function discoverActivations(
  config: IntegrationConfig,
  query?: { limit?: number; cursor?: string },
  seams?: IntegrationClientSeams,
): Promise<DiscoveryOutcome<ActivationsPage>> {
  const q: Record<string, string> = {};
  if (query?.limit !== undefined) q.limit = String(query.limit);
  if (query?.cursor !== undefined) q.cursor = query.cursor;
  return getFromHub<ActivationsPage>(config, '/integration/activations', q, seams);
}

/** Pages to exhaustion; stops on the first non-ok outcome. */
export async function discoverAllActivations(
  config: IntegrationConfig,
  query?: { limit?: number },
  seams?: IntegrationClientSeams,
): Promise<DiscoveryOutcome<{ activations: readonly DiscoveredActivation[] }>> {
  const all: DiscoveredActivation[] = [];
  let cursor: string | undefined;
  do {
    const page = await discoverActivations(config, { limit: query?.limit ?? 100, cursor }, seams);
    if (page.status !== 'ok') return page;
    all.push(...page.value.activations);
    cursor = page.value.nextCursor;
  } while (cursor);
  return { status: 'ok', value: { activations: all } };
}

export function peerEndpointForRole(
  discovery: ContractsDiscovery,
  role: 'producer' | 'consumer',
): { applicationId: string; apiUrl: string | null; webUrl: string | null } | null {
  const hit = discovery.contracts.find((c) => c.role === role && c.counterpart.apiUrl);
  if (!hit) return null;
  return {
    applicationId: hit.counterpart.applicationId,
    apiUrl: hit.counterpart.apiUrl,
    webUrl: hit.counterpart.webUrl,
  };
}

export function consumerPullPairs(page: {
  activations: readonly DiscoveredActivation[];
}): IntegrationPullPair[] {
  return page.activations
    .filter((a) => a.role === 'consumer')
    .map((a) => ({
      producerApplicationId: a.counterpartApplicationId,
      organizationId: a.organizationId,
    }));
}

export function producerActivations(page: {
  activations: readonly DiscoveredActivation[];
}): DiscoveredActivation[] {
  return page.activations.filter((a) => a.role === 'producer');
}

export function createSalesTicketClient(
  config: IntegrationConfig,
  seams?: IntegrationClientSeams,
): TicketClient {
  return createTicketClient(toAuthorityConfig(config, seams));
}

export function createSalesIntrospectionVerifier(
  config: IntegrationConfig,
  seams?: IntegrationClientSeams,
): IntrospectionVerifier {
  return createIntrospectionVerifier(toAuthorityConfig(config, seams));
}

function unwrap<T>(outcome: DiscoveryOutcome<T>, what: string): T {
  if (outcome.status === 'ok') return outcome.value;
  // Never include a body, header or secret: status only.
  throw new Error(
    outcome.status === 'refused'
      ? `Hub discovery of ${what} was refused (HTTP ${outcome.httpStatus}).`
      : `Hub discovery of ${what} is unavailable (${outcome.reason}).`,
  );
}

export function createRealIntegrationAuthority(
  config: IntegrationConfig,
  seams?: IntegrationClientSeams,
): IntegrationAuthority {
  return {
    ticketClient: createSalesTicketClient(config, seams),
    verifier: createSalesIntrospectionVerifier(config, seams),
    reporter: createSalesHeartbeatReporter(config, seams),
    discovery: {
      contracts: async () =>
        [...unwrap(await discoverContracts(config, seams), 'contracts').contracts],
      activations: async () =>
        consumerPullPairs(
          unwrap(await discoverAllActivations(config, undefined, seams), 'activations'),
        ),
      producerActivations: async () =>
        producerActivations(
          unwrap(await discoverAllActivations(config, undefined, seams), 'activations'),
        ),
    },
  };
}
