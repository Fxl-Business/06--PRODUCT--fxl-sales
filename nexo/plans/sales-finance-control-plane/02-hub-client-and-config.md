---
id: 02-hub-client-and-config
milestone: v4.1.0
status: todo
depends_on: [01-pkg-and-transport-ddl]
files_modified: [apps/api/src/domains/integration/config.ts, apps/api/src/domains/integration/hub-client.ts, apps/api/src/domains/integration/heartbeat.ts, apps/api/src/domains/integration/__tests__/config.test.ts, apps/api/src/domains/integration/__tests__/hub-client.test.ts, apps/api/src/domains/integration/__tests__/heartbeat.test.ts]
acceptance:
  - "`integrationConfigFromHubConfig(hub)` maps a resolved `HubConfig` to `IntegrationConfig` with hubApiUrl<-apiUrl, applicationId<-audience, clientId<-clientId, clientSecret<-clientSecret, environment<-environment; unit-proven with a literal HubConfig, no env, no I/O."
  - "`buildIntegrationConfig(env)` reads only through `hubEnvBag` + `tryLoadHubAuthConfig` (never `process.env`), returns `null` when the Hub config is absent, else the mapped `IntegrationConfig`; no new `FXL_HUB_*` name is introduced (verified by `no-legacy-env-names` staying green and no string `FXL_HUB_` added outside auth-provider)."
  - "`createSalesTicketClient`, `createSalesIntrospectionVerifier`, `createSalesHeartbeatReporter` construct a package client from an `IntegrationConfig` (+ optional test seams) with ZERO network at construction; `organizationForFeedRead` is re-exported for the feed route (slice 05)."
  - "`discoverContracts(config, seams?)` and `discoverActivations(config, {limit?,cursor?}, seams?)` issue GET requests to `{hubApiUrl}/integration/contracts` and `{hubApiUrl}/integration/activations` with `Authorization: Basic base64(clientId:clientSecret)`, return typed discriminated outcomes, and NEVER hardcode the Finance address; `peerEndpointForRole` / `consumerPullPairs` derive the Finance api_url/web_url and the (producer, org) pairs from the responses."
  - "`buildSalesHeartbeatBody(input)` delegates to the package `buildHeartbeatBody`, producing a metadata-only body (no money, no counterpart name, no obligation ref); the closed enums `HEARTBEAT_ERROR_CODES` / `HEARTBEAT_ELIGIBILITY_CODES` are the only vocabularies and `lastErrorDetail` comes from `HEARTBEAT_ERROR_DETAIL` via the package, never a free-form string."
  - "All three modules import with NO side effect (no network, no clock read, no `process.env`) and `pnpm --filter @fxl-sales/api type-check` is clean; the named oracle `apps/api/src/domains/integration/__tests__/hub-client.test.ts` passes offline with an injected `fetchImpl`."
---

# Slice 02 - Hub client and integration config (pure modules)

## Goal and boundary

Build the three PURE, side-effect-free modules that turn this app's EXISTING Hub
config into everything the `@fxl-business/fxl-contracts@0.1.0` authority clients
need, plus the two discovery calls the package does not ship.

This slice writes modules ONLY.
It does NOT mount any route, does NOT start any loop, does NOT do fake/real
selection, and does NOT read `process.env`.
Boot wiring, the fake-authority swap, the feed route and the loops are slices
06 / 08 / 05 / 03-04.
Nothing here performs network I/O at import or at construction; the network
happens only when a returned client's method is called.

Depends on slice 01 only for the package being installed at exact `0.1.0`
(the transport DDL is not touched here).

## Repo facts this slice is built on (verified, do not re-derive)

- `hubEnvBag(source: HubEnvSource)` and `tryLoadHubAuthConfig(bag): HubAuthConfig | null`
  live in `apps/api/src/config/auth-provider.ts`.
  `HubAuthConfig` is exactly the SDK's `HubConfig`.
  `tryLoadHubAuthConfig` returns `null` only when NOTHING that identifies a
  Client is set (the "unconfigured machine" door); a partial config THROWS.
  This slice mirrors that null-vs-throw contract and never widens it.
- `HubEnvSource` is a `Pick<Env, ...>` type-only projection.
  Importing it is `import type` only; a VALUE import of `apps/api/src/env.ts`
  runs dotenv + `process.exit(1)` inside a unit worker, so this slice imports
  `HubEnvSource` / `hubEnvBag` / `tryLoadHubAuthConfig` from
  `../../config/auth-provider.js` and NEVER imports `env.ts`.
- SDK `HubConfig` fields (from `@fxl-business/hub-sdk`):
  `apiUrl`, `environment` (`'production' | 'staging' | 'development'`),
  `clientId`, `clientSecret`, `audience` (`app.<slug>` = `app.fxl-sales`), plus
  optional operational fields this slice ignores.
- Package `IntegrationAuthorityConfig` (from `@fxl-business/fxl-contracts`):
  required `hubApiUrl`, `applicationId`, `clientId`, `clientSecret`,
  `environment` (`IntegrationEnvironment`, the SAME three-literal union as
  `HubEnvironment`); optional injectable seams `fetchImpl`, `now`, `timeoutMs`
  (default 10_000), `cacheMaxEntries` (default 1000).
- Package factories are `createTicketClient(config)`, `createIntrospectionVerifier(config)`,
  `createHeartbeatReporter(config)` - each calls `assertAuthorityConfig` at
  construction (pure, no network) and does I/O only on a method call.
- Package Basic auth is `"Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64")`;
  the Hub middleware `parseBasicCredentials` reads clientId before the first
  `:` and the secret after it. Discovery MUST use the identical header.
- The package does NOT expose the discovery calls (`GET /integration/contracts`,
  `GET /integration/activations`); this slice implements them with `fetch`,
  mirroring the package's own `postToHub` conventions (timeout via
  `AbortSignal.timeout`, trailing-slash trim on `hubApiUrl`, 401 -> loud config
  error, 4xx -> refused, network/timeout/5xx -> unavailable).

## Hub discovery wire shapes (verified against the Hub source)

`GET /integration/contracts` (Basic auth) responds:

```jsonc
{
  "applicationId": "app.fxl-sales",
  "environment": "development",
  "contracts": [
    {
      "contractId": "string",
      "status": "active" | "suspended" | "retired",
      "role": "producer" | "consumer",          // THIS app's side of the pair
      "eventName": "string",
      "eventVersion": 1,
      "schemaDigest": "string",
      "contractsPackageVersion": "string",
      "counterpartApplicationId": "app.fxl-finance",
      "counterpart": {
        "applicationId": "app.fxl-finance",
        "apiUrl": "string | null",              // the PEER (Finance) api origin
        "webUrl": "string | null"               // the PEER (Finance) web origin
      }
    }
  ]
}
```

`GET /integration/activations?limit=&cursor=` (Basic auth) responds:

```jsonc
{
  "activations": [
    {
      "activationId": "string",
      "organizationId": "string",
      "role": "producer" | "consumer",          // THIS app's side of the pair
      "counterpartApplicationId": "app.fxl-finance",
      "createdAt": "ISO-8601"                    // Date serialized on the wire
    }
  ],
  "nextCursor": "string | undefined"            // absent on the last page
}
```

`limit` is `1..100` (Hub `activationsQuery`); page it with `cursor`.
`role` is always THIS authenticated app's role, so a CONSUMER pull pair is a row
with `role === 'consumer'` whose `producerApplicationId` is
`counterpartApplicationId`.

## Module 1 - `apps/api/src/domains/integration/config.ts`

The typed integration config plus the env-facing builder. No I/O.

```ts
import type { IntegrationAuthorityConfig, IntegrationEnvironment } from '@fxl-business/fxl-contracts';
import type { HubAuthConfig, HubEnvSource } from '../../config/auth-provider.js';
import { hubEnvBag, tryLoadHubAuthConfig } from '../../config/auth-provider.js';

/**
 * This app's typed integration config. Structurally the REQUIRED members of the
 * package's `IntegrationAuthorityConfig` (the optional test seams are added at
 * client-construction time in hub-client.ts / heartbeat.ts), so it can be spread
 * straight into any package factory. No new FXL_HUB_* name: every field is
 * projected from the existing resolved Hub config.
 */
export interface IntegrationConfig {
  /** From HubConfig.apiUrl. No trailing slash guarantee is the caller's; the
   * package (and discovery here) trim trailing slashes defensively. */
  readonly hubApiUrl: string;
  /** From HubConfig.audience (`app.fxl-sales`). This app's application id. */
  readonly applicationId: string;
  /** From HubConfig.clientId. */
  readonly clientId: string;
  /** From HubConfig.clientSecret. Server-side only, never logged. */
  readonly clientSecret: string;
  /** From HubConfig.environment; identical union to IntegrationEnvironment. */
  readonly environment: IntegrationEnvironment;
}

/** Optional injectable seams shared by every package client and by discovery.
 * Tests pass fetchImpl / now; production passes nothing. */
export type IntegrationClientSeams = Pick<
  IntegrationAuthorityConfig,
  'fetchImpl' | 'now' | 'timeoutMs' | 'cacheMaxEntries'
>;

/**
 * PURE mapping. Given an already-resolved HubConfig, project the five fields.
 * Unit-tested with a literal HubConfig; no env, no I/O, no process.env.
 */
export function integrationConfigFromHubConfig(hub: HubAuthConfig): IntegrationConfig {
  return {
    hubApiUrl: hub.apiUrl,
    applicationId: hub.audience,
    clientId: hub.clientId,
    clientSecret: hub.clientSecret,
    environment: hub.environment,
  };
}

/**
 * The env-facing door. Reads ONLY through hubEnvBag + tryLoadHubAuthConfig, so
 * it never touches process.env and never runs env.ts's dotenv/exit. Returns
 * null on the unconfigured machine (mirrors tryLoadHubAuthConfig); a partial
 * config still THROWS from the SDK loader, unchanged. Boot (slice 08) decides
 * what to do with null (fake mode, or 503-style absence).
 */
export function buildIntegrationConfig(env: HubEnvSource): IntegrationConfig | null {
  const hub = tryLoadHubAuthConfig(hubEnvBag(env));
  if (hub === null) return null;
  return integrationConfigFromHubConfig(hub);
}

/** Widen an IntegrationConfig to the package's authority config, folding in
 * optional test seams. Every package factory in this slice goes through here. */
export function toAuthorityConfig(
  config: IntegrationConfig,
  seams?: IntegrationClientSeams,
): IntegrationAuthorityConfig {
  return { ...config, ...(seams ?? {}) };
}
```

Notes for the executor:
- `IntegrationEnvironment` and `HubEnvironment` are byte-identical unions
  (`'production' | 'staging' | 'development'`), so `environment: hub.environment`
  assigns with no cast. If TS complains about nominal narrowing, use a plain
  assignment, never a `String()` round-trip and never `as` on the credential.
- Do NOT import `env.ts`. Do NOT re-export anything from auth-provider.
- Do NOT read `NODE_ENV` here; the environment is `hub.environment`, never
  inferred from `NODE_ENV` (project rule).

## Module 2 - `apps/api/src/domains/integration/hub-client.ts`

The package authority factories over `IntegrationConfig`, plus the two discovery
GET calls the package does not ship, plus pure derivations from the responses.

Re-exports from the package for downstream slices (single import site):
```ts
export { organizationForFeedRead } from '@fxl-business/fxl-contracts';
export type {
  TicketClient, TicketOutcome, TicketRequest, IntegrationTicket,
  IntrospectionVerifier, VerifyOutcome, IntrospectionDecision,
  IntegrationPullPair,
} from '@fxl-business/fxl-contracts';
```

Factory wrappers (thin; construction is offline):
```ts
import { createTicketClient, createIntrospectionVerifier } from '@fxl-business/fxl-contracts';
import type { TicketClient, IntrospectionVerifier } from '@fxl-business/fxl-contracts';
import { toAuthorityConfig, type IntegrationConfig, type IntegrationClientSeams } from './config.js';

export function createSalesTicketClient(
  config: IntegrationConfig, seams?: IntegrationClientSeams,
): TicketClient {
  return createTicketClient(toAuthorityConfig(config, seams));
}

export function createSalesIntrospectionVerifier(
  config: IntegrationConfig, seams?: IntegrationClientSeams,
): IntrospectionVerifier {
  return createIntrospectionVerifier(toAuthorityConfig(config, seams));
}
```
(The heartbeat reporter factory lives in module 3.)

Discovery types (mirroring the verified wire shapes above):
```ts
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

/** Discriminated outcome, mirroring the package's ok/refused/unavailable split.
 * A 401 (or 403 invalid_client) is thrown as a config error, never returned. */
export type DiscoveryOutcome<T> =
  | { readonly status: 'ok'; readonly value: T }
  | { readonly status: 'refused'; readonly httpStatus: number; readonly code?: string }
  | { readonly status: 'unavailable'; readonly reason: 'network' | 'timeout' | 'server'; readonly httpStatus?: number };
```

Discovery functions:
```ts
export function discoverContracts(
  config: IntegrationConfig, seams?: IntegrationClientSeams,
): Promise<DiscoveryOutcome<ContractsDiscovery>>;

export function discoverActivations(
  config: IntegrationConfig,
  query?: { limit?: number; cursor?: string },
  seams?: IntegrationClientSeams,
): Promise<DiscoveryOutcome<ActivationsPage>>;

/** Convenience: page discoverActivations to exhaustion, following nextCursor.
 * Stops on the first non-ok outcome and returns it. */
export function discoverAllActivations(
  config: IntegrationConfig,
  query?: { limit?: number },
  seams?: IntegrationClientSeams,
): Promise<DiscoveryOutcome<{ activations: readonly DiscoveredActivation[] }>>;
```

Implementation contract for the GET transport (a private `getFromHub` local to
this module, NOT exported), copying the package's `postToHub` behaviour exactly
except method GET and no body:
- `const url = `${config.hubApiUrl.replace(/\/+$/, '')}${path}`` (+ query string
  built with `URLSearchParams` when present);
- headers `{ authorization: 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64') }`;
- `signal: AbortSignal.timeout(seams?.timeoutMs ?? 10_000)`;
- `fetchImpl = seams?.fetchImpl ?? fetch`;
- catch -> `{ status: 'unavailable', reason: <'timeout' if AbortError/TimeoutError else 'network'> }`;
- 2xx with JSON -> `{ status: 'ok', value }`; 2xx without JSON -> `unavailable/server`;
- `401`, or `403` with body `{ code: 'invalid_client' }` -> THROW
  `IntegrationConfigError`-shaped error (import the package's
  `IntegrationConfigError` if exported; otherwise throw a local
  `Error` with `field: 'clientId'` and the SAME message discipline - the
  clientSecret NEVER appears in the message);
- other `4xx` -> `{ status: 'refused', httpStatus, code }`;
- `5xx` -> `{ status: 'unavailable', reason: 'server', httpStatus }`.
- NEVER log the response body, the ticket header, or the clientSecret.

Pure derivations from discovery responses (no I/O, unit-tested directly):
```ts
/** The peer (Finance) endpoint for the given role, from the first matching
 * contract. Returns null when no contract of that role carries a counterpart
 * apiUrl. NEVER hardcodes a Finance address. */
export function peerEndpointForRole(
  discovery: ContractsDiscovery, role: 'producer' | 'consumer',
): { applicationId: string; apiUrl: string | null; webUrl: string | null } | null;

/** The live (producer, organization) pairs THIS app must PULL as a consumer:
 * activations with role === 'consumer', mapped to IntegrationPullPair
 * { producerApplicationId: counterpartApplicationId, organizationId }. */
export function consumerPullPairs(
  page: { activations: readonly DiscoveredActivation[] },
): IntegrationPullPair[];

/** The organizations THIS app PRODUCES for (role === 'producer'), for the
 * heartbeat/prune loops. */
export function producerActivations(
  page: { activations: readonly DiscoveredActivation[] },
): DiscoveredActivation[];
```

## Module 3 - `apps/api/src/domains/integration/heartbeat.ts`

Thin wrapper over the package heartbeat surface. No I/O at import.

```ts
import { buildHeartbeatBody, createHeartbeatReporter } from '@fxl-business/fxl-contracts';
import type { HeartbeatInput, HeartbeatBody, HeartbeatReporter } from '@fxl-business/fxl-contracts';
import { toAuthorityConfig, type IntegrationConfig, type IntegrationClientSeams } from './config.js';

export {
  HEARTBEAT_ERROR_CODES, HEARTBEAT_ELIGIBILITY_CODES, HEARTBEAT_ERROR_DETAIL,
} from '@fxl-business/fxl-contracts';
export type {
  HeartbeatInput, HeartbeatBody, HeartbeatReporter,
  HeartbeatErrorCode, HeartbeatEligibilityCode, HeartbeatReportResult,
} from '@fxl-business/fxl-contracts';

/** Metadata-only body. Delegates entirely to the package builder, which fills
 * lastErrorDetail from HEARTBEAT_ERROR_DETAIL and rejects a malformed input.
 * The HeartbeatInput type has NO free-text / money / counterpart-name / ref
 * slot, so "metadata only" is true by construction. */
export function buildSalesHeartbeatBody(input: HeartbeatInput): HeartbeatBody {
  return buildHeartbeatBody(input);
}

export function createSalesHeartbeatReporter(
  config: IntegrationConfig, seams?: IntegrationClientSeams,
): HeartbeatReporter {
  return createHeartbeatReporter(toAuthorityConfig(config, seams));
}
```

Rationale for keeping `buildSalesHeartbeatBody` as a one-line delegate: it gives
slices 04/08 ONE import site for heartbeat construction and one place a future
Sales-specific guard could land, without re-implementing the package's null/omit
asymmetry (the three non-nullable numeric/date fields are OMITTED on
null/undefined; the four error/eligibility fields pass explicit `null`). The
executor must NOT re-derive that logic here.

## What this slice must NOT do (guardrails)

- No `process.env` read anywhere in the three modules (grep must be empty).
- No new `FXL_HUB_*` (or any new env) name; `scripts/no-legacy-env-names.mjs`
  and `env-example-contract.test.ts` stay untouched and green.
- No route mounting, no `startPositionPublisher` / `startIntegrationPuller` /
  reporter loop, no fake/real selection (slices 05/06/08).
- No hardcoded Finance api_url/web_url; the address comes only from discovery.
- No logging of the ticket value, the clientSecret, or a raw discovery body.
- No import of `apps/api/src/env.ts` (value import triggers dotenv + exit).
- No second reducer, no duplicate of `hubEnvBag` / `tryLoadHubAuthConfig`.

## Named oracle tests

Three unit test files under `apps/api/src/domains/integration/__tests__/`,
all offline (injected `fetchImpl`), run by the existing api vitest project.

### `config.test.ts` - "integration config maps hub config"
- `integrationConfigFromHubConfig` maps a literal `HubConfig`
  (`apiUrl`,`environment`,`clientId`,`clientSecret`,`audience`) to the five
  `IntegrationConfig` fields, asserting `applicationId === audience` and
  `hubApiUrl === apiUrl` explicitly (the two non-same-named mappings).
- `buildIntegrationConfig` returns `null` for an empty `HubEnvSource`-shaped bag
  (unconfigured machine), and returns the mapped config for a fully-set fake env
  bag; it never reads `process.env` (the test sets no env and passes a plain
  object literal typed as `HubEnvSource`).
- `buildIntegrationConfig` on a PARTIAL bag (three of five identity vars) THROWS
  (mirrors `tryLoadHubAuthConfig`) - pin the throw so nobody widens the null door.
- `toAuthorityConfig` folds `fetchImpl`/`now` seams onto the five fields.

### `hub-client.test.ts` - "hub client constructs and discovers without a live Hub" (PRIMARY ORACLE)
- `createSalesTicketClient` / `createSalesIntrospectionVerifier` construct with a
  valid `IntegrationConfig` and DO NOT call the injected `fetchImpl` at
  construction (assert `fetchImpl` call count is 0 after construction).
- `discoverContracts` with an injected `fetchImpl` returning a canned
  `/integration/contracts` body yields `{status:'ok'}`, and the request it made
  had method GET, path `/integration/contracts`, and header
  `authorization === 'Basic ' + base64('clientId:clientSecret')`.
- `discoverActivations` builds `?limit=&cursor=` correctly and returns the page +
  `nextCursor`; `discoverAllActivations` follows `nextCursor` across two pages
  then stops.
- Transport outcomes: injected `fetchImpl` returning 500 -> `unavailable/server`;
  a thrown `AbortError` -> `unavailable/timeout`; a 4xx (non-401) -> `refused`
  with `httpStatus`; a `401` THROWS and the thrown message does NOT contain the
  clientSecret.
- `peerEndpointForRole` returns the Finance counterpart endpoint for
  `role:'producer'`; `consumerPullPairs` maps `role:'consumer'` activations to
  `{ producerApplicationId, organizationId }` and drops producer-role rows.

### `heartbeat.test.ts` - "heartbeat body is metadata-only with closed enums"
- `buildSalesHeartbeatBody` on a minimal `HeartbeatInput` produces a body whose
  keys are a subset of the known metadata keys (assert NO money / counterpart
  name / obligation ref field can exist - the type forbids it, and the produced
  object has only the documented keys).
- With `lastError: { code: <a HEARTBEAT_ERROR_CODES member>, at: <ISO> }`, the
  body's `lastErrorCode` is that code and `lastErrorDetail === HEARTBEAT_ERROR_DETAIL[code]`
  (never a free-form string).
- `eligibility: 'ineligible'` with no `eligibilityCode` THROWS (package guard);
  the three non-nullable numeric/date fields are OMITTED (not `null`) when
  absent, and a `HEARTBEAT_ELIGIBILITY_CODES` member is accepted.
- `createSalesHeartbeatReporter` constructs offline (injected `fetchImpl`, 0
  calls at construction).

## Verify (slice-local)

- `pnpm --filter @fxl-sales/api type-check`
- `pnpm --filter @fxl-sales/api test -- src/domains/integration` (run-once; the
  three oracle files above)
- `pnpm run lint` on the changed files (no `process.env`, no `FXL_HUB_` string,
  no `console.*` of secrets/tickets)
- Sanity grep: `grep -rn "process.env\|FXL_HUB_" apps/api/src/domains/integration`
  returns nothing.
