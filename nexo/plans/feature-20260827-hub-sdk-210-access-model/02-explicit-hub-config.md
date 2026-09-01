---
id: 02-explicit-hub-config
milestone: v2.8.0
status: todo
depends_on: []
files_modified:
  - apps/api/src/config/hub-config.ts
  - apps/api/src/config/auth-provider.ts
  - apps/api/src/config/__tests__/hub-config.test.ts
  - apps/api/src/config/__tests__/auth-provider.test.ts
  - apps/api/src/env.ts
  - apps/api/src/middleware/app-auth.ts
  - apps/api/src/middleware/__tests__/app-auth.test.ts
  - apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts
  - apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts
  - apps/api/src/auth/session-crypto.ts
  - apps/api/.env.example
  - apps/api/.env.dev.example
  - README.md
acceptance: "given FXL_HUB_CONFIG carrying an app.<slug> audience and an environment matching the client id segment, when the API boots, then the config validates offline with no network call, while a product.<slug> audience, a NODE_ENV-inferred environment, or FXL_HUB_CONFIG set beside any discrete variable each fail at boot and name the offending field"
goal: "Make the Hub audience and environment explicit validated configuration and delete the derived-audience logic, on the 1.3.1 SDK, keeping master green"
must_not_break:
  - "FXL_HUB_REDIRECT_URI resolving to this app's own origin plus /auth/callback, never the Hub's"
  - "the existing BFF wiring and the session store construction"
  - "reading configuration off the validated env object rather than raw process.env"
rules:
  - "no em dash and no en dash on any added line"
  - "no credential value may be invented, guessed or placeheld"
  - "clientSecret must never reach a log line or an error message"
  - "coreModuleFromAudience is NOT deleted in this slice"
verifier_focus: "that the audience is nowhere derived from a key, that NODE_ENV cannot decide environment, and that no secret can leak into an error path"
---

# Slice 02 - explicit-hub-config

## Why this slice exists

`apps/api/src/config/auth-provider.ts:11-17` DERIVES the Audience from the publishable key
as `product.<slug>`. Access model v1 Audiences are `app.<slug>`, so the derived value names
nothing the Hub mints and every request 401s. The Audience is CONFIGURATION. It is never a
function of a key.

Two structural defects ride along and are fixed here:

1. `apps/api/src/env.ts` validates six `FXL_HUB_*` variables that are then never READ off the
   validated `env` object. `app-auth.ts:84,237,238,239` passes raw `process.env` into the
   loaders. CLAUDE.md already records the cost of that shape: `.env.dev.example` ships blank
   values, `??` does not catch `''`, and a blank string silently fails a length floor at boot.
2. There is no `environment` at all today. 2.x makes it a required, explicit field that must
   agree with the environment segment inside the Client id, and that agreement is checkable
   OFFLINE. Inferring it from `NODE_ENV` would make a staging deploy that happens to run with
   `NODE_ENV=production` ask the Hub for the wrong Client, which is a 401 at runtime instead
   of a refusal to boot.

This slice does all of that on `@fxl-business/hub-sdk@1.3.1`. The SDK is NOT bumped here.
Slice 04 owns the bump, and this slice is deliberately shaped so that bump is a small diff.

## The shape we are building, and the slice 04 swap

We vendor the 2.1.0 config module into this repo under the SAME exported names the SDK uses
(`HubConfig`, `HubEnvironment`, `HubConfigError`, `ParsedClientId`, `parseClientId`,
`parseHubConfig`, `loadHubConfig`). Slice 04 then deletes
`apps/api/src/config/hub-config.ts` outright and changes ONE import line in
`apps/api/src/config/auth-provider.ts` from `./hub-config.js` to `@fxl-business/hub-sdk`.
Nothing else moves.

What stays ours forever, and therefore does NOT live in the vendored file:
`hubConfigPresence`, `HUB_DISCRETE_ENV_VARS`, `hubEnvBag`, `HubAuthConfig`,
`loadHubAuthConfig`, `tryLoadHubAuthConfig`. Those live in `auth-provider.ts`.

### This survives slice 04

Settled by decision D1 in
`nexo/runs/feature-20260827-hub-sdk-210-access-model/replan-decisions.md`, which is binding.
This slice's architecture is CONFIRMED and is permanent. Slice 04 replaces only the vendored
PARSER with the SDK's real `loadHubConfig` and keeps every gate this slice builds around it.

Permanent, and not reopened by slice 04:

- `hubEnvBag`, `hubConfigPresence`, `HUB_DISCRETE_ENV_VARS`, `HubEnvSource` and `HubAuthConfig`.
- Above all the ABSENCE of any blanket `try/catch` in `auth-provider.ts`. A bad Hub configuration
  is a BOOT FAILURE and not a 503. Slice 04 does not reinstate `tryLoadHubAuthConfig`'s catch, does
  not take `EnvLike` again, does not delete `HubAuthConfig`, and does not hand raw `process.env` to
  `loadHubConfig`. `00-OVERVIEW.md` carries three acceptance criteria that only a throw can satisfy,
  and a catch-to-null turns all three into a running API that answers 503 to everything.
- Consequently the named oracle tests 19, 20, 21, 22, 23, 24 and 25 below SURVIVE slice 04
  UNCHANGED. Slice 04 must not list any of them as an edit. Test 20,
  `refuses to boot on a product. audience rather than answering 503`, is the oracle that goes red if
  anyone reinstates the catch, and it must stay able to fail.

The ONE thing that legitimately changes later is `coreModule`: slice 03 deletes it from
`HubAuthConfig` together with the module gate it feeds, so after wave 2 the type is
`HubConfig & { healthToken }`. That is slice 03's own planned edit and it is not a reversion of
anything here.

## Module layout and exported symbols

### 1. NEW `apps/api/src/config/hub-config.ts`

A vendored, dependency-free copy of the 2.1.0 config validator. Its file header must say, in
plain words, that it is a temporary vendored copy of `@fxl-business/hub-sdk@2.1.0`'s config
module, that slice 04 deletes it, and that its exported names are deliberately identical to
the SDK's so the swap is an import-line change.

Exports, exactly:

```ts
export type HubEnvironment = 'production' | 'staging' | 'development';
export const HUB_ENVIRONMENTS: readonly HubEnvironment[];
export interface HubConfig {
  apiUrl: string;
  environment: HubEnvironment;
  clientId: string;
  clientSecret: string;
  audience: string;
}
export interface ParsedClientId { slug: string; environment: HubEnvironment }
export class HubConfigError extends Error { readonly field: string }
export function parseClientId(clientId: string): ParsedClientId | null;
export function parseHubConfig(value: unknown): HubConfig;
export function loadHubConfig(env: Record<string, string | undefined>): HubConfig;
```

`HubConfigError`'s constructor is `(field: string, message: string)` and sets
`this.name = 'HubConfigError'`.

`parseClientId` algorithm, spelled out because the random segment may itself contain
underscores:

- the string must start with `pk_`; otherwise return `null`
- take the body after `pk_`
- the FIRST `_` in the body ends the slug; the SECOND `_` ends the environment; everything
  after it is the random
- the slug must match `/^[a-z0-9-]+$/`
- the environment must be a member of `HUB_ENVIRONMENTS`
- the random must be non-empty and match `/^[A-Za-z0-9_-]+$/`
- any failure returns `null`

`parseHubConfig` enforces these rules IN THIS ORDER, each throwing
`new HubConfigError(<field>, <message>)`:

1. `value` is a non-null, non-array object, else field `FXL_HUB_CONFIG`
2. `environment` is one of `production | staging | development`, else field `environment`
3. `apiUrl` is a non-empty string, else field `apiUrl`
4. `apiUrl` parses with `new URL()`, else field `apiUrl`
5. the protocol is `http:` or `https:`, else field `apiUrl`
6. the protocol is `https:` unless `environment === 'development'`, else field `apiUrl`
7. trailing slashes are trimmed off `apiUrl` with `/\/+$/`
8. `clientId` is a non-empty string, else field `clientId`
9. `parseClientId(clientId)` is non-null, else field `clientId`
10. the parsed client id's environment equals `environment`, else field `environment`
11. `clientSecret` is a non-empty string of the form `sk_<slug>_<environment>_<random>`
    parsed by the same three-segment rule, else field `clientSecret`
12. the client secret's slug AND environment equal the client id's, else field `clientSecret`
13. `audience` matches `/^app\.[a-z0-9-]+$/`, else field `audience`
14. `audience` equals `` `app.${parsed.slug}` ``, else field `audience`

Rule 13 is what makes a hardcoded `product.` prefix a BOOT failure rather than a 401 later.
Rule 10 is the offline environment agreement: it is a string comparison and reaches no
network.

`loadHubConfig(env)` reads the JSON form first and otherwise the discrete form, exactly as
2.1.0 does:

```ts
export function loadHubConfig(env: Record<string, string | undefined>): HubConfig {
  const json = env['FXL_HUB_CONFIG'];
  if (typeof json === 'string' && json !== '') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new HubConfigError('FXL_HUB_CONFIG', 'FXL_HUB_CONFIG is not valid JSON');
    }
    return parseHubConfig(parsed);
  }
  return parseHubConfig({
    apiUrl: env['FXL_HUB_API_URL'],
    environment: env['FXL_HUB_ENVIRONMENT'],
    clientId: env['FXL_HUB_CLIENT_ID'],
    clientSecret: env['FXL_HUB_CLIENT_SECRET'],
    audience: env['FXL_HUB_AUDIENCE'],
  });
}
```

The mutual-exclusion check does NOT live here. It lives in `hubConfigPresence`, because it
has to run before the "is this configured at all" verdict, and because it is ours to keep
across the slice 04 swap.

HARD CONSTRAINTS on this file, both of which have a dedicated test:

- The literal string `NODE_ENV` must not appear anywhere in it, not even in a comment.
- No error message may interpolate any INPUT VALUE. Messages name the FIELD and the RULE
  only. The two exceptions, both non-secret and both closed sets, are the three environment
  words and the expected audience `app.<slug>` computed from the client id slug. The
  `clientSecret` and the `clientId` are NEVER interpolated.

Message wording, verbatim, for the four load-bearing rules:

- rule 10: `` `FXL_HUB_ENVIRONMENT is ${environment} but the client id names ${parsed.environment}` ``
- rule 13: `'FXL_HUB_AUDIENCE must be app.<slug>; an audience is configured, never derived from a key'`
- rule 14: `` `FXL_HUB_AUDIENCE must be app.${parsed.slug}` ``
- rule 12: `'FXL_HUB_CLIENT_SECRET does not belong to FXL_HUB_CLIENT_ID'`

### 2. REWRITTEN `apps/api/src/config/auth-provider.ts`

DELETE `parseAudienceFromPublishableKey` entirely. KEEP `coreModuleFromAudience`, which
slice 03 owns, but widen its prefix strip from `/^product\./` to `/^(?:app|product)\./` so
that `app.fxl-sales` still yields `sales.core` and every existing 402 test stays green
unchanged. Add a one line comment saying slice 03 deletes it along with the module gate.

That comment MUST NOT contain the literal string `product.`. This slice's own named test
24 is a source guard that reads `auth-provider.ts` and asserts it contains no such literal,
so a prose comment that spells it out would redden this slice's own oracle. The widened
regex is safe for the same reason the guard is narrow: its source text is
`/^(?:app|product)\./`, which spells the prefix as `product\.` with a backslash before the
dot, and the guard's substring search for `product.` does not match that. A comment has no
such escape, so write it without the literal at all - for example
`// slice 03 deletes this together with the module entitlement gate`.

```ts
import type { Env } from '../env.js'; // type-only: must NOT pull env.ts's side effects in
import { type HubConfig, HubConfigError, loadHubConfig } from './hub-config.js';

export const HUB_DISCRETE_ENV_VARS = [
  'FXL_HUB_API_URL',
  'FXL_HUB_ENVIRONMENT',
  'FXL_HUB_CLIENT_ID',
  'FXL_HUB_CLIENT_SECRET',
  'FXL_HUB_AUDIENCE',
] as const;

export type HubConfigPresence = 'absent' | 'incomplete' | 'json' | 'discrete';

export type HubEnvSource = Pick<
  Env,
  | 'NODE_ENV'
  | 'CORS_ORIGIN'
  | 'FXL_HUB_CONFIG'
  | 'FXL_HUB_API_URL'
  | 'FXL_HUB_ENVIRONMENT'
  | 'FXL_HUB_CLIENT_ID'
  | 'FXL_HUB_CLIENT_SECRET'
  | 'FXL_HUB_AUDIENCE'
  | 'FXL_HUB_HEALTH_TOKEN'
  | 'FXL_HUB_REDIRECT_URI'
  | 'FXL_HUB_POST_LOGIN_REDIRECT'
  | 'FXL_HUB_POST_LOGIN_ERROR_REDIRECT'
>;

export type HubAuthConfig = HubConfig & {
  /** Slice 03 deletes this together with the module gate it feeds. */
  coreModule: string;
  healthToken: string | undefined;
};

export function hubEnvBag(source: HubEnvSource): Record<string, string | undefined>;
export function hubConfigPresence(bag: Record<string, string | undefined>): HubConfigPresence;
export function loadHubAuthConfig(bag: Record<string, string | undefined>): HubAuthConfig;
export function tryLoadHubAuthConfig(bag: Record<string, string | undefined>): HubAuthConfig | null;
```

`import type { Env }` must be a TYPE-ONLY import. A value import would run `env.ts`'s dotenv
load and its `process.exit(1)` inside the config unit tests.

`hubEnvBag(source)` returns a NEW object carrying EXACTLY these twelve keys and no others,
each taken straight off the validated `env` object: `NODE_ENV`, `CORS_ORIGIN`,
`FXL_HUB_CONFIG`, `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`,
`FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE`, `FXL_HUB_HEALTH_TOKEN`,
`FXL_HUB_REDIRECT_URI`, `FXL_HUB_POST_LOGIN_REDIRECT`, `FXL_HUB_POST_LOGIN_ERROR_REDIRECT`.
This function is the ONLY bridge between the validated env and the Hub loaders, and it is why
no loader ever needs `process.env` again.

`hubConfigPresence(bag)`, treating a value as SET only when it is a string and not `''`
(blank is how `.env.dev.example` ships every credential, and `env.ts`'s `emptyToUndefined`
already normalises the real path; the explicit check keeps a hand-built test bag honest):

```
const jsonSet     = isSet(bag.FXL_HUB_CONFIG);
const discreteSet = HUB_DISCRETE_ENV_VARS.filter((k) => isSet(bag[k]));

if (jsonSet && discreteSet.length > 0) {
  throw new HubConfigError(
    'FXL_HUB_CONFIG',
    `FXL_HUB_CONFIG is set alongside ${discreteSet.join(', ')}; use FXL_HUB_CONFIG alone or the five discrete variables alone`,
  );
}
if (jsonSet) return 'json';
if (discreteSet.length === HUB_DISCRETE_ENV_VARS.length) return 'discrete';
if (discreteSet.length === 0) return 'absent';
return 'incomplete';
```

Ambiguity is checked FIRST, so mixing the forms fails even when the discrete side is
incomplete. The thrown message NAMES the offending variables by NAME and never prints a value.

`loadHubAuthConfig(bag)`:

```
const config = loadHubConfig(bag);                       // throws HubConfigError
const healthToken = isSet(bag.FXL_HUB_HEALTH_TOKEN) ? bag.FXL_HUB_HEALTH_TOKEN : undefined;
if (config.environment !== 'development' && healthToken === undefined) {
  throw new HubConfigError(
    'FXL_HUB_HEALTH_TOKEN',
    'FXL_HUB_HEALTH_TOKEN is required outside development; the operator generates it and the Hub does not issue it',
  );
}
return { ...config, coreModule: coreModuleFromAudience(config.audience), healthToken };
```

`healthToken` is carried but NOT yet handed to `createHubBff`; 1.3.1 has no such option.
Slice 04 wires it. Say so in a comment so it does not read as dead.

`tryLoadHubAuthConfig(bag)` is the ONLY fail-soft door, and it is deliberately narrow:

```
const presence = hubConfigPresence(bag);   // may THROW on ambiguity - do not catch
if (presence === 'absent' || presence === 'incomplete') return null;
return loadHubAuthConfig(bag);             // may THROW - do not catch
```

There is no `try/catch` left in this file. That is the whole point: today's blanket catch is
what would turn a `product.` audience into a silent 503 instead of a boot failure. The
`absent` and `incomplete` verdicts preserve exactly today's behaviour for a machine that has
not been given credentials yet, which is what keeps `503 hub_auth_not_configured` alive and
what keeps every unrelated test file able to import `app-auth.ts`. Write that reasoning into
the file as a comment; the next reader will otherwise reinstate the catch.

### 3. `apps/api/src/env.ts`

REMOVE `FXL_HUB_PUBLISHABLE_KEY` and `FXL_HUB_SECRET_KEY`.

ADD, all with the existing `emptyToUndefined` preprocessor:

```ts
  FXL_HUB_CONFIG: emptyToUndefined,
  FXL_HUB_ENVIRONMENT: emptyToUndefined,
  FXL_HUB_CLIENT_ID: emptyToUndefined,
  FXL_HUB_CLIENT_SECRET: emptyToUndefined,
  FXL_HUB_HEALTH_TOKEN: emptyToUndefined,
```

`FXL_HUB_ENVIRONMENT` is deliberately a plain optional string here and NOT a `z.enum`. zod
would `process.exit(1)` with its own flattened field errors and the operator would never see
the named `HubConfigError`. The environment verdict, and the agreement with the client id,
belong to `hub-config.ts`. Put that sentence in the file as a comment.

Keep `FXL_HUB_API_URL` on `emptyToUndefinedUrl` and keep `FXL_HUB_REDIRECT_URI`,
`FXL_HUB_POST_LOGIN_REDIRECT`, `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` exactly as they are.

Update the `HUB_SESSION_ENCRYPTION_KEY` comment: the derivation source is now
`FXL_HUB_CLIENT_SECRET`.

### 4. `apps/api/src/middleware/app-auth.ts`

Raw `process.env` leaves this file completely.

- `import { hubEnvBag, tryLoadHubAuthConfig } from '../config/auth-provider.js';`
- module top level becomes `const hubAuthConfig = tryLoadHubAuthConfig(hubEnvBag(env));`
- `hubSdkConfig` maps our 2.x names onto 1.3.1's `HubSdkConfig` shape:

```ts
const hubSdkConfig: HubSdkConfig | null = hubAuthConfig
  ? {
      apiUrl: hubAuthConfig.apiUrl,
      // 1.3.1 still calls these publishableKey / secretKey and sends them as
      // client_id / client_secret. Slice 04 renames them at the SDK boundary.
      publishableKey: hubAuthConfig.clientId,
      secretKey: hubAuthConfig.clientSecret,
      // ALWAYS passed. It is configured, never derived: with an explicit
      // audience the SDK's deriveAudience is never consulted.
      audience: hubAuthConfig.audience,
    }
  : null;
```

- inside `createAppAuthBff`, replace the three raw reads:
  - `const secureCookies = env.NODE_ENV === 'production';`
  - `nodeEnv: env.NODE_ENV,`
  - `encryptionIkm: env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.clientSecret,`
    and update the long comment above it so it names `FXL_HUB_CLIENT_SECRET`.
- compute the bag ONCE and reuse it:
  `const hubEnv = hubEnvBag(env);` then `redirectUri: resolveHubRedirectUri(hubEnv)`,
  `postLoginRedirect: resolveHubPostLoginRedirect(hubEnv)`,
  `postLoginErrorRedirect: resolveHubPostLoginErrorRedirect(hubEnv)`.

`resolveHubRedirectUri`, `resolveHubPostLoginRedirect` and
`resolveHubPostLoginErrorRedirect` keep their current bodies and their current
`EnvLike` signatures. Their `NODE_ENV` read is about whether an EXPLICIT redirect is
mandatory, not about the Hub environment, and it must stay. Add one comment above
`resolveHubRedirectUri` stating that the value is THIS app's own origin plus
`/auth/callback` and never the Hub's, that 2.x's `createHubBff` default of
`${config.apiUrl}/auth/callback` is the Hub's origin and therefore wrong, and that locally
vite proxies `/auth` from 8006 to the api on 3006.

`hasHubCoreEntitlement`, the 402, the 401, the 503 and the whole BFF wiring are untouched.

### 5. Comment-only edits

- `apps/api/src/auth/session-crypto.ts:6,10`: `FXL_HUB_SECRET_KEY` becomes
  `FXL_HUB_CLIENT_SECRET`.
- `apps/api/src/auth/hub-session-store.ts:27` carried the same one line comment edit and has
  MOVED TO SLICE 01, which already rewrites that header block and already declares the file.
  This slice no longer declares `apps/api/src/auth/hub-session-store.ts` at all. Do not touch it:
  two wave-1 slices declaring one file is a guaranteed textual merge conflict, and the flow's
  parallel-build safety rests on the declared file sets being disjoint.

### 6. Documentation: `CLAUDE.md` is NOT this slice's file

`CLAUDE.md` has been REMOVED from `files_modified` and this slice makes no edit to it. Slice 01 is
the sole `CLAUDE.md` owner in wave 1. The reason is structural rather than editorial: both slices
would be appending bullets into the same Auth Model list, so naming disjoint anchor regions is not
enough, and the whole parallel-build safety property of the wave is "non-overlapping declared files
implies no conflict".

This slice's documentation bullet therefore lands in SLICE 03, in wave 2, where 03 is the only slice
in its wave and already owns a `CLAUDE.md` section. A reader of a wave-1-only tree should understand
the omission is deliberate and dated, not an oversight: for one wave, `CLAUDE.md` documents variable
names the API has stopped reading.

Slice 03 carries the following two items VERBATIM. Nothing here is slice 03's to reword.

```
CLAUDE.md, Auth Model section, ADD one bullet:

- The Hub Audience and the Hub environment are EXPLICIT validated configuration, read off the
  validated `env` object through `hubEnvBag` in `apps/api/src/config/auth-provider.ts` and never off
  raw `process.env`.
  The Audience is `app.<slug>` and must equal `app.` plus the Client id's slug; nothing derives it
  from a key, and `parseAudienceFromPublishableKey` is deleted.
  The environment must equal the environment segment inside `pk_<slug>_<environment>_<random>` and
  is NEVER inferred from `NODE_ENV`: a staging deploy that happens to run with `NODE_ENV=production`
  would otherwise ask the Hub for the wrong Client, which is a 401 at runtime instead of a refusal
  to boot, and the agreement is checkable OFFLINE.
  `FXL_HUB_CONFIG`, one JSON object with `apiUrl`, `environment`, `clientId`, `clientSecret` and
  `audience`, is this repo's documented form; setting it beside ANY of the five discrete variables
  is a boot failure whose message names every offender by NAME and never prints a value.
  `FXL_HUB_REDIRECT_URI` stays its own variable because 2.x's `HubConfig` has no `redirectUri` and
  `createHubBff`'s default of `${config.apiUrl}/auth/callback` is the HUB's origin, which is always
  wrong for this app.
  `FXL_HUB_HEALTH_TOKEN` is generated by the OPERATOR, not issued by the Hub, and is required
  whenever the environment is not `development`.
  A bad Hub configuration is a BOOT FAILURE and not a 503: there is no blanket `try/catch` in
  `auth-provider.ts`, and `tryLoadHubAuthConfig` returns `null` only for the `absent` and
  `incomplete` presences, which is what keeps `503 hub_auth_not_configured` alive for a machine that
  has simply not been given credentials yet.

CLAUDE.md, Environments section, EDIT:

- The Hub Client column reads `app.fxl-sales` rather than `product.fxl-sales`.
- The "Required API vars" dotenv block uses `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`,
  `FXL_HUB_ENVIRONMENT`, `FXL_HUB_AUDIENCE=app.fxl-sales` and `FXL_HUB_HEALTH_TOKEN` in place of
  `FXL_HUB_PUBLISHABLE_KEY` and `FXL_HUB_SECRET_KEY`, with every credential value EMPTY. The
  committed `pk_fxl-sales_VzQ9-...` literal leaves that block.
```

### 7. `README.md`

`README.md` documents variables this slice stops the API reading, so it goes stale the moment this
slice lands unless it is corrected here. Nothing else in waves 1 to 3 touches this file, so there is
no merge hazard, and it is added to `files_modified`.

- `README.md:45-46`, inside the "Hub Environment" API dotenv block: replace
  `FXL_HUB_PUBLISHABLE_KEY=<the committed pk_fxl-sales_VzQ9... literal>` and
  `FXL_HUB_SECRET_KEY=<operator-issued-secret>` with the new names, matching the example files
  exactly in spirit and leaving every credential EMPTY:
  `FXL_HUB_ENVIRONMENT=development`, `FXL_HUB_CLIENT_ID=`, `FXL_HUB_CLIENT_SECRET=`,
  `FXL_HUB_AUDIENCE=app.fxl-sales`, `FXL_HUB_HEALTH_TOKEN=`. Do not invent, guess or placehold a
  credential value.
- `README.md:58`: the same committed `pk_fxl-sales_VzQ9-...` literal appears on the WEB line
  `VITE_FXL_HUB_PUBLISHABLE_KEY=`. Delete the LITERAL only and leave the line
  `VITE_FXL_HUB_PUBLISHABLE_KEY=` with an empty value. Do NOT rename that variable: the browser half
  is slice 04's, and renaming it here would document a variable the web does not read yet.
- `README.md:61-62`, the prose "The Hub SDK derives `product.fxl-sales` from the publishable key. /
  Only set `FXL_HUB_AUDIENCE` when an operator explicitly asks for an override.": replace both
  sentences with the fact this slice establishes, that the Audience is configured as `app.<slug>`,
  is validated against the Client id's slug and is never derived from a key.
- `README.md:7` and `:24` also say `product.fxl-sales`. Leave them: they name the Hub Application
  audience in prose that slice 04 rewrites together with the web half, and touching them here would
  put this file in two waves for no gain. Record that as a known one-wave staleness rather than
  hiding it.

## Env example files

Both files get the SAME Hub block. Every credential value stays EMPTY. Never write a real or
invented value. The old `pk_fxl-sales_VzQ9-...` literal is DELETED from both files: it is not
a valid 2.x client id (it has no environment segment) and keeping it would make the discrete
form look complete while failing rule 9.

`FXL_HUB_AUDIENCE=app.fxl-sales` IS written out in full in both example files, and
`"audience":"app.fxl-sales"` in the JSON-form comment. This is settled by decision D4 and this
slice's position WINS: the Audience is a PUBLIC IDENTIFIER and not a credential, it is derivable
from the committed clientId slug so committing it discloses nothing the clientId would not, and
shipping the field blank would make the example non-working and push every operator into guessing
the one value the boot check exists to validate. This covers EXAMPLE files ONLY. It licenses no
Hub-issued CREDENTIAL into any tracked file, and the gitignored `apps/api/.env` is still untouched.
Slice 04's instruction "do not invent `app.fxl-sales` here" is REVERSED by that decision and is
being deleted from slice 04's plan; do not restore a blank audience here to match it.

`apps/api/.env.example` and `apps/api/.env.dev.example`, replacing the current
`FXL_HUB_PUBLISHABLE_KEY` / `FXL_HUB_SECRET_KEY` / `FXL_HUB_AUDIENCE` lines:

```dotenv
# --- Auth: FXL Hub ---
# TWO forms, and setting BOTH stops the API booting with a message naming the
# offenders. FXL_HUB_CONFIG is this repo's documented form.
#
# Preferred: one JSON object with exactly these five keys, from the Hub admin panel.
#   {"apiUrl":"","environment":"development","clientId":"","clientSecret":"","audience":"app.fxl-sales"}
FXL_HUB_CONFIG=

# Discrete form. Leave every line here blank when FXL_HUB_CONFIG is set.
FXL_HUB_API_URL=http://localhost:9016
# production | staging | development. Explicit, never inferred from NODE_ENV, and it
# must equal the environment segment inside the client id.
FXL_HUB_ENVIRONMENT=development
# pk_<slug>_<environment>_<random>, issued by the Hub admin panel.
FXL_HUB_CLIENT_ID=
# sk_<slug>_<environment>_<random>, shown ONCE by the Hub admin panel.
# Never commit a real value.
FXL_HUB_CLIENT_SECRET=
# app.<slug>, and it must equal app. plus the client id's slug. Configured, never derived.
FXL_HUB_AUDIENCE=app.fxl-sales

# Generated by the OPERATOR, not issued by the Hub. Required when
# FXL_HUB_ENVIRONMENT is not development.
FXL_HUB_HEALTH_TOKEN=

# THIS app's own origin plus /auth/callback, never the Hub's origin. Local dev
# defaults to http://localhost:8006/auth/callback from CORS_ORIGIN, and vite
# proxies /auth from 8006 to the api on 3006.
FXL_HUB_REDIRECT_URI=
# Optional. Defaults to CORS_ORIGIN after a successful Hub callback.
FXL_HUB_POST_LOGIN_REDIRECT=
FXL_HUB_POST_LOGIN_ERROR_REDIRECT=
```

In `.env.dev.example` also fix the `HUB_SESSION_ENCRYPTION_KEY` comment so it names
`FXL_HUB_CLIENT_SECRET`.

With `FXL_HUB_CLIENT_ID` and `FXL_HUB_CLIENT_SECRET` blank, `hubConfigPresence` answers
`incomplete`, `tryLoadHubAuthConfig` answers `null` and a fresh clone still boots and answers
`503 hub_auth_not_configured`. That is EXACTLY today's behaviour, because
`FXL_HUB_SECRET_KEY` already ships blank and already makes today's loader return `null`.

`apps/api/.env` is gitignored. DO NOT touch it.

## Test fixtures

The credential ban is about committed configuration, documentation and source. Tests still
need inputs, so use these three obviously-synthetic constants and nothing else. They are
labelled as fixtures, they carry no entropy, and the secret is long enough to clear the
sealer's 32 character floor on its own:

```ts
const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';
const HUB_AUDIENCE = 'app.fxl-sales';
```

## Named oracle tests

RED first. Every test below is written and committed before a line of implementation, and
each is IMMUTABLE once written.

### NEW `apps/api/src/config/__tests__/hub-config.test.ts`

`describe('loadHubConfig')`

1. `accepts a single FXL_HUB_CONFIG JSON object as this repo's documented form`
   Bag with only `FXL_HUB_CONFIG` holding the five keys; expect the parsed object to equal
   `{ apiUrl, environment: 'development', clientId, clientSecret, audience: 'app.fxl-sales' }`.
2. `accepts the five discrete variables when FXL_HUB_CONFIG is absent`
   Same result from the discrete bag.
3. `trims trailing slashes off apiUrl`
4. `refuses a plain http apiUrl outside development`
   `environment: 'staging'` with `http://` expects a throw whose `field` is `apiUrl`.
5. `refuses a product. audience at boot and names the audience field`
   Audience `product.fxl-sales`; expect `field === 'audience'` and the message to match
   `/app\.<slug>/` and `/never derived/`.
6. `refuses an audience that is not app. plus the client id slug`
   Audience `app.fxl-finance` against a `fxl-sales` client id; `field === 'audience'`.
7. `refuses an environment that disagrees with the client id segment, and reaches no network`
   `FXL_HUB_ENVIRONMENT=production` against the development client id. Assert
   `field === 'environment'`, and assert OFFLINE explicitly: `vi.stubGlobal('fetch', spy)`
   where `spy` throws if called, and `expect(spy).not.toHaveBeenCalled()` after the throw.
8. `never consults NODE_ENV to decide the environment`
   Two assertions in one test. First, a bag carrying `NODE_ENV: 'production'` plus
   `FXL_HUB_ENVIRONMENT: 'development'` and the development client id resolves to
   `environment: 'development'`. Second, the same bag with `FXL_HUB_ENVIRONMENT` REMOVED
   throws with `field === 'environment'` rather than silently adopting `production`.
9. `refuses a client secret whose slug or environment disagrees with the client id`
   `field === 'clientSecret'`.
10. `refuses FXL_HUB_CONFIG that is not valid JSON`
    `field === 'FXL_HUB_CONFIG'`.
11. `never puts the client secret in an error message or a log line`
    A `console.error` and a `console.warn` spy installed for the whole test. Iterate every
    invalid bag from tests 4 to 10, catch each throw, and assert that neither
    `String(error)` nor `error.message` nor `String(error.stack)` contains
    `HUB_CLIENT_SECRET`, and that no spy call argument stringifies to anything containing it.
    Also assert both spies were never called at all: the parser logs nothing, it throws.

`describe('parseClientId')`

12. `parses pk_<slug>_<environment>_<random> and keeps underscores inside the random segment`
    `pk_fxl-sales_staging_aa_bb-cc` gives `{ slug: 'fxl-sales', environment: 'staging' }`.
13. `returns null for a key with no environment segment`
    The retired `pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2` shape returns `null`. This is
    the test that documents why the old committed literal had to leave the example files.

`describe('the NODE_ENV guard')`

14. `does not read NODE_ENV anywhere in the Hub config module`
    `readFileSync(new URL('../hub-config.ts', import.meta.url), 'utf8')` and
    `expect(source).not.toMatch(/NODE_ENV/)`. This is the structural guard the brief asks for:
    it fails the moment anyone reintroduces inference, including through a comment that
    invites it.

### REWRITTEN `apps/api/src/config/__tests__/auth-provider.test.ts`

The existing three tests are REPLACED, not weakened. `loads the Hub contract for
product.fxl-sales` asserted the exact behaviour this slice deletes, so it cannot survive; its
successor asserts the stronger `app.fxl-sales` contract on the same code path. `returns null from
the optional loader when Hub env is incomplete` is kept VERBATIM in behaviour as test 17 below.

`rejects missing secret keys` splits in TWO, and BOTH halves are required. Test 18 below carries the
soft half, that `tryLoadHubAuthConfig` answers `null` on an incomplete bag. That is a strictly
WEAKER claim than what exists today, which is that the STRICT loader REFUSES an incomplete
configuration and names the missing field, so test 18 alone would drop a live claim for two waves.
Test 18a below carries the strict half and closes that gap inside this slice.

15. `loads the Hub contract for app.fxl-sales from FXL_HUB_CONFIG`
    `loadHubAuthConfig` on the JSON bag gives `audience: 'app.fxl-sales'`,
    `environment: 'development'`, `coreModule: 'sales.core'`.
16. `loads the same contract from the five discrete variables`
17. `returns null from the optional loader when no Hub configuration is present at all`
    `tryLoadHubAuthConfig({})` is `null`.
18. `returns null from the optional loader when the discrete form is incomplete`
    Only `FXL_HUB_API_URL` set. `null`, not a throw. This is the 503 path and it is the
    reason a half-configured developer machine can still import `app-auth.ts`.
18a. `it('refuses an incomplete Hub configuration from the strict loader and names the client secret field')`
    The direct successor of today's `rejects missing secret keys`, kept so its claim is not dropped.
    Bag carrying `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID` and
    `FXL_HUB_AUDIENCE` but NO `FXL_HUB_CLIENT_SECRET`. Assert that `loadHubAuthConfig(bag)` THROWS,
    that the thrown error is a `HubConfigError` whose `field === 'clientSecret'`, and, keeping
    today's strength, that its message mentions `FXL_HUB_CLIENT_SECRET` by name. Also assert the
    message does not contain any secret VALUE, since the bag has none to leak and a future
    implementation that echoed the bag would go red here.
    This is the STRICT loader and it is a different door from test 18: `tryLoadHubAuthConfig`
    classifies this same bag as `incomplete` and answers `null` without ever calling the strict
    loader, which is why one test cannot cover both and why 18 alone is not a replacement.
19. `refuses to boot when FXL_HUB_CONFIG is set beside a discrete variable and names every offender`
    JSON form plus `FXL_HUB_CLIENT_ID` plus `FXL_HUB_AUDIENCE`. Assert the throw comes out of
    `tryLoadHubAuthConfig` (NOT swallowed), that `field === 'FXL_HUB_CONFIG'`, and that the
    message contains BOTH `FXL_HUB_CLIENT_ID` and `FXL_HUB_AUDIENCE` and does NOT contain
    `FXL_HUB_API_URL`, which was not set.
20. `refuses to boot on a product. audience rather than answering 503`
    `expect(() => tryLoadHubAuthConfig(bag)).toThrow()` with `field === 'audience'`. The
    negative half matters more than the positive: this is the test that fails if anyone
    reinstates the `try/catch`.
21. `requires FXL_HUB_HEALTH_TOKEN outside development`
    A staging bag with an https apiUrl, a staging client id and secret, and no health token
    throws with `field === 'FXL_HUB_HEALTH_TOKEN'`; adding the token makes it load and puts
    it on `healthToken`.
22. `does not require FXL_HUB_HEALTH_TOKEN in development`
    `healthToken` is `undefined` and nothing throws.
23. `projects exactly the Hub variables off the validated env object`
    `Object.keys(hubEnvBag(source)).sort()` equals the twelve documented keys sorted, and a
    key that is `undefined` on the source stays `undefined` rather than becoming `''`.
24. `no API module derives the Hub audience from a key`
    Source guard over `../hub-config.ts`, `../auth-provider.ts` and
    `../../middleware/app-auth.ts`: none contains `parseAudienceFromPublishableKey`, and none
    contains the literal `product.`. `app-auth.ts` legitimately still contains the identifier
    `publishableKey`, because 1.3.1's `HubSdkConfig` spells the field that way, so the guard
    must NOT ban that word.
25. `never leaks the client secret out of the optional loader`
    Same assertion as test 11, applied to `tryLoadHubAuthConfig` on the ambiguous bag and on
    the invalid-secret bag.

### CHANGED `apps/api/src/middleware/__tests__/app-auth.test.ts`

The seven `getHubLegacyAuthContext` tests and the two `hasHubCoreEntitlement` tests are
UNTOUCHED. The four existing `resolveHubRedirectUri` tests are UNTOUCHED.

ADD `vi.stubEnv('FXL_HUB_CONFIG', '')` to this file as well, in a `beforeAll` that runs before the
module import takes effect, matching what the two BFF test files do. Blank reads as unset.
The reason is specific to this slice: with the blanket `try/catch` gone, `hubConfigPresence` THROWS
on ambiguity at MODULE SCOPE through `app-auth.ts`'s top-level
`tryLoadHubAuthConfig(hubEnvBag(env))`, and this file imports `../app-auth.js` at module scope with
no env stubs at all. `vi.stubEnv` adds to `process.env` rather than clearing it, so a developer
machine whose `apps/api/.env` carries `FXL_HUB_CONFIG` beside the discrete variables would crash
this entire file at import rather than fail one test. CI has no `.env` and is already safe, which is
exactly why this would only ever bite locally and would read as an unrelated breakage.
No existing assertion or title in this file changes.

Then add two tests:

26. `resolves the redirect to this app's own origin, never the Hub's`
    A bag carrying `FXL_HUB_API_URL: 'http://localhost:9016'`,
    `CORS_ORIGIN: 'http://localhost:8006'`, `NODE_ENV: 'development'` and no
    `FXL_HUB_REDIRECT_URI`. Assert the result is exactly
    `'http://localhost:8006/auth/callback'`, and additionally assert
    `expect(result.startsWith('http://localhost:9016')).toBe(false)`. That second assertion is
    the one that goes red if anyone ever adopts 2.x's `${config.apiUrl}/auth/callback` default.
27. `keeps the redirect on this app's origin when the Hub api url and the web origin differ`
    Production shaped bag: `FXL_HUB_API_URL: 'https://auth.fxlbusiness.com'`,
    `FXL_HUB_REDIRECT_URI: 'https://sales.fxlbusiness.com/auth/callback'`. Assert the result
    is the sales origin and that it does not contain `auth.fxlbusiness.com`.

### CHANGED `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`

Every existing assertion stays. Only the `beforeAll` stubs and one constant name change, plus
one added assertion.

- rename the constant `HUB_SECRET_KEY` to `HUB_CLIENT_SECRET` and give it the fixture value
  above. The `expect(encryptionIkm).toBe(HUB_CLIENT_SECRET)` assertion is otherwise unchanged,
  so the Blocker A oracle keeps exactly its current strength.
- replace the three stubs:
  - `vi.stubEnv('FXL_HUB_PUBLISHABLE_KEY', ...)` becomes
    `vi.stubEnv('FXL_HUB_CLIENT_ID', HUB_CLIENT_ID)`
  - `vi.stubEnv('FXL_HUB_SECRET_KEY', ...)` becomes
    `vi.stubEnv('FXL_HUB_CLIENT_SECRET', HUB_CLIENT_SECRET)`
  - `vi.stubEnv('FXL_HUB_AUDIENCE', 'product.fxl-sales')` becomes
    `vi.stubEnv('FXL_HUB_AUDIENCE', 'app.fxl-sales')`
- ADD `vi.stubEnv('FXL_HUB_ENVIRONMENT', 'development')`. Note that `NODE_ENV` is stubbed to
  `'test'` in the very same block, which makes this file a live demonstration that the two are
  independent. Say so in a comment.
- ADD `vi.stubEnv('FXL_HUB_CONFIG', '')`. A developer's own `apps/api/.env` could otherwise
  carry the JSON form and make this file throw on ambiguity. Blank reads as unset.
- extend `CapturedBffOptions` with `redirectUri?: unknown` and add one test:
  28. `points the BFF callback at this app's own origin rather than the Hub's`
      `expect(bffOptions?.redirectUri).toBe('http://localhost:8006/auth/callback')` and
      `expect(String(bffOptions?.redirectUri)).not.toContain('localhost:9016')`.

### CHANGED `apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts`

The same five stub edits as above, same constant rename. No assertion changes.

## Sequencing

Red then Green then Refactor, three atomic commits.

1. `test(api): pin explicit Hub config, offline environment agreement and no NODE_ENV inference`
   Adds `hub-config.test.ts`, rewrites `auth-provider.test.ts`, adds tests 26 to 28 and the
   stub edits. The suite is RED and every failure is a missing symbol or a wrong value, never
   a syntax error.
2. `feat(api): make the Hub audience and environment explicit validated configuration`
   Adds `hub-config.ts`, rewrites `auth-provider.ts`, updates `env.ts` and `app-auth.ts`.
   Suite green, `pnpm run type-check`, `pnpm run lint`, `pnpm run build`.
3. `docs(api): retire the Hub publishable and secret key variables`
   Both `.env.example` files, `README.md`, and the comment-only edit at
   `apps/api/src/auth/session-crypto.ts:6,10`. NOT `CLAUDE.md`, which slice 01 owns in this wave,
   and NOT `apps/api/src/auth/hub-session-store.ts`, whose one line comment edit slice 01 adopted.

## Challenges the executor will actually hit

- Importing `env.ts` from `auth-provider.ts` as a VALUE would run dotenv and
  `process.exit(1)` inside a unit test worker. It must be `import type`.
- `coreModuleFromAudience` silently produces `app.fxl-sales.core` if its prefix strip is left
  at `/^product\./`. Every 402 test would then go red for an unrelated reason. Widen it to
  `/^(?:app|product)\./` in the same commit that changes the audience.
- `vi.stubEnv` ADDS to `process.env`; it does not clear it. `apps/api/.env` on a developer
  machine currently sets `FXL_HUB_API_URL`, `FXL_HUB_PUBLISHABLE_KEY`, `FXL_HUB_SECRET_KEY`
  and `FXL_HUB_REDIRECT_URI`. The retired two are simply no longer read. `FXL_HUB_CONFIG` is
  the one that can poison a test file, which is why all THREE middleware test files stub it blank:
  `app-auth-bff-wiring.test.ts`, `app-auth-bff-memory-path.test.ts` and `app-auth.test.ts`.
- 1.3.1's `deriveAudience` throws on a client id it cannot parse as `pk_<slug>_<random>`. It
  is never reached, because `hubSdkConfig.audience` is ALWAYS passed and an explicit audience
  short-circuits the derivation. Do not drop that field on the `null` branch tidy-up.
- The environment agreement is a string comparison against a segment of the client id. If the
  executor finds themselves reaching for `discover()` or any fetch, they have taken a wrong
  turn: test 7 stubs a throwing `fetch` precisely to catch it.

## Explicitly out of scope

- `CLAUDE.md`. Slice 01 owns it in wave 1; this slice's documentation bullet is carried verbatim by
  slice 03 in wave 2. See section 6.
- `apps/api/src/auth/hub-session-store.ts`. Slice 01 adopted the `:27` comment edit.
- `coreModuleFromAudience`, `hasHubCoreEntitlement` and the 402 gate. Slice 03.
- The SDK bump, `entitlements.access`, `toPublicConfig`, `assertBootConfiguration`, and
  handing `healthToken` to `createHubBff`. Slice 04.
- Everything under `apps/web` and `packages/shared-types`, including
  `VITE_FXL_HUB_PUBLISHABLE_KEY`. Slice 04 owns the browser half.
