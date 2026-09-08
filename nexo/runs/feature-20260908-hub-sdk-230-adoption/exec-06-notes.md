# Execute notes - slice 06, examples, docs and the mechanical guard

Branch `feat/06-examples-docs-guard`, cut from `master` at `5eeff1e`.
Slices 04 and 05 were already merged, so the branch started byte-identical to `master`.

## What landed

### 1. The two `.env` examples - `FXL_HUB_TRUSTED_ORIGINS` and the D3 carve-out

`apps/api/.env.example` and `apps/api/.env.dev.example` gained a dedicated
`--- Auth: FXL Hub, the four OPERATIONAL values ---` block holding `FXL_HUB_HEALTH_TOKEN`,
`FXL_HUB_REDIRECT_URI` and the new `FXL_HUB_TRUSTED_ORIGINS=http://localhost:8006`, plus a note
saying why the ninth canonical name, `FXL_HUB_SESSION_ENCRYPTION_KEY`, deliberately has no line of
its own.

`FXL_HUB_TRUSTED_ORIGINS` is documented as a DEPLOY-time gate.
The local value is shipped so the shape is documented, and the comment says outright that local
development needs nothing from it, because vite proxies `/auth` with `changeOrigin: false` and the
request origin therefore already equals the origin the BFF computes for itself.
The staging and production requirement is stated separately, with the 2026-08-10 outage named.

D3's carve-out is now stated where an operator reads it: `FXL_HUB_CONFIG` holds the five identity
fields and nothing else, and putting `redirectUri`, `healthToken`, `trustedOrigins` or
`sessionEncryptionKey` inside it is a hard refusal at boot naming the discrete variable to set
instead.
Read off the shipped `dist` (`readConfigJson`'s `OPERATIONAL_CONFIG_KEYS` offender branch), not
assumed.

D6 is written as an ORIGIN rule in both files, in the words the contract asked for: an absent value
is not left absent, it DEFAULTS to `${FXL_HUB_API_URL}/auth/callback`, and what refuses outside
development is a check on the origin of the EFFECTIVE value against `apiUrl`'s.
Confirmed against `server.js:321-334`: the check is `!isDevelopment && callbackOrigin ===
originOf(config.apiUrl)`, with no presence test anywhere in it.

### 2. The two fenced `dotenv` blocks a human copies - the carry-over defect

`README.md`'s "Hub Environment" API block and `CLAUDE.md`'s "Required API vars" block each shipped
three of five identity variables populated, which after slice 05 is a boot failure rather than a
503 - the same defect that failed slice 05's Gate 2, one file over.
Both now show all five BLANK with the known-good values alongside as comments, both carry the
operational block including `FXL_HUB_TRUSTED_ORIGINS`, and both state the rule in one line: all five
together, or none.

### 3. I DID extend `env-example-contract.test.ts` to those blocks - and why that is not a markdown parser

Judgement call, made the way the contract framed it. I extended it, and the reason is that the
fenced-block case is *not* the fragile case it looks like.

The extraction is `/^```dotenv\n([\s\S]*?)^```$/gm` and the content it yields is handed to the same
`KEY=VALUE` grammar the existing test already uses on `.env.example`.
That is legitimate rather than lucky: the fence's info string is itself the claim that its content
is dotenv, so parsing it as dotenv is reading the document's own assertion, not guessing at
markdown.
No headings, lists, emphasis or nesting are interpreted anywhere.

The one real failure mode is the regex finding too few blocks and every "nothing Hub-shaped is set"
assertion passing vacuously.
That is closed by a first test that demands exactly one block per file MENTIONING all five identity
names, before anything asserts a property.
Both directions were verified by mutation rather than reasoned about:

- repopulating `FXL_HUB_AUDIENCE=app.fxl-sales` in `README.md`'s block: 1 failed / 16 passed.
- changing both `CLAUDE.md` fences from ```` ```dotenv ```` to ```` ```ini ````: 3 failed / 14
  passed, the vacuity guard among them.

Eight new tests, four `it.each` cases over the two files: all-five-named, absent configuration,
known-good values still shown commented, and the redirect/trusted-origin values.
Both mutations were reverted; `git diff` on those files carries only the intended edits.

### 4. D4 - the mount-test titles

`CLAUDE.md` claimed the two trusted-origin mount tests "keep their exact titles and assertions".
Slice 05 renamed both.
The line now names them as they actually are, in
`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`:
`does not 403 a cross-origin refresh from the trusted web origin, through the real mount` and
`still 403s a cross-origin refresh from an origin that is not trusted`, records that the assertions
are intact and that they still drive the real mount, and says plainly that the earlier claim was
wrong.

### 5. The `nameDiscreteVar` decision record

Written into `CLAUDE.md` beside the deletion, with the cost stated rather than glossed: the SDK's
`operationalMessage` names the discrete variable for the four OPERATIONAL fields, but the five
IDENTITY fields still format as `FXL_HUB_CONFIG.<field>` (`message()` at
`chunk-DJ323EJE.js:4119`), so an operator of the five discrete variables who misconfigures one is
pointed at a variable they never set.
Accepted diagnostic regression, filed upstream as 2.4.0 feedback, and repeated in `AUDIT.md`.

### 6. The Auth Model section rewrite

Rewritten against the code as it now is, and only where slice 05 changed it:

- the nine canonical names, split five identity / four operational, with the ninth called out as
  read by nothing here.
- `FXL_HUB_REDIRECT_URI` as an ORIGIN rule with its own bullet, including the sentence the contract
  asked for about why a presence check is the wrong repair.
- `resolveHubRedirectUri` recorded as deleted, with why it was worse than what replaced it.
- `hubConfigPresence`, `HUB_DISCRETE_ENV_VARS`, `HUB_FIELD_TO_DISCRETE_VAR`, `nameDiscreteVar`, the
  local health-token requirement and `HubAuthConfig`'s healthToken extension recorded as deleted;
  `hubEnvBag` and `hubConfigIsAbsent` described as what remains, including why the six credential
  names and not the nine.
- the boot assertion running exactly once, inside `createHubBff`, and why a second call would
  disagree about `redirectUri`.
- `trustedOrigins` and `healthToken` moved from `createHubBff` options to config, with the
  promotion-gate paragraph.
- the pin moved from 2.2.0 to 2.3.0 in both places, and hono's override recorded as not moving
  because the peer is unchanged at `>= 4.12.28`.

Untouched, because the slice did not change them: the single access gate, the deny taxonomy, the
session store decision and its transaction rules, the `503` fail-soft door, the cookie-rotation
history, and every non-auth section.

### 7. The guard

`scripts/no-legacy-env-names.mjs` gained NO entry, and that is a decision rather than an omission.
Slice 05 retired code IDENTIFIERS (`hubConfigPresence`, `HUB_DISCRETE_ENV_VARS`,
`HUB_FIELD_TO_DISCRETE_VAR`, `nameDiscreteVar`, `resolveHubRedirectUri`) and not one environment
variable NAME.
A reintroduced identifier either fails to resolve or is dead code, so the type checker and lint
already catch it; a retired env NAME resolves to `undefined` in silence, which is the only thing
this guard exists for.
Mixing the two would make the guard mean two things and would go red the moment either identifier
is legitimately discussed outside the pathspec.
The reasoning is recorded in the guard's own header so the next reader does not re-open it.

One stale comment in the guard was corrected: it said `FXL_HUB_SESSION_ENCRYPTION_KEY` was a name
this repo "may legitimately mention once 2.3.0 lands". It now does, in both `.env` examples, so the
comment says so.

### 8. The slice-04 comment nit

`apps/api/src/middleware/__tests__/app-auth-bff-production-boot.test.ts` called
`sales-api.fxlbusiness.test` "the BROWSER-facing origin" in two places.
It is this app's API origin.
The VALUE is unchanged and load-bearing - it differs from the fixture `apiUrl`, which is the only
property the origin check examines - and the comments now also name `sales.fxlbusiness.test` as the
web origin, a third host again, so the three cannot be conflated by the next reader.

### 9. Two README corrections found along the way

`README.md` said the product audience is `product.fxl-sales`, twice.
It is `app.fxl-sales`, per `CLAUDE.md`, `apps/api/.env.example` and the audience regex the SDK
enforces (`/^app\.[a-z0-9-]+$/`).
Same defect class as the fenced blocks: a doc handing a human a Hub value that does not work.

`README.md` also listed `/auth/switch` among the routes a production rewrite must cover.
That endpoint no longer exists; an Organization switch rides `POST /auth/refresh` with
`{organizationId}`. Removed from the list.

## Verification - real commands, real exit codes

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | api and web clean |
| `pnpm run type-check` | 0 | all four projects clean |
| `CI=true pnpm test` | 0 | see counts below |
| `pnpm run build` | 0 | real build, tsbuildinfo removed first; web built in 1.92s |
| `node scripts/no-legacy-auth.mjs` | 0 | |
| `node scripts/no-legacy-env-names.mjs` | 0 | |

Test counts against the stated baseline:

| Project | Baseline | Now | Delta |
| --- | --- | --- | --- |
| shared-utils | 80 | 80 | 0 |
| api | 437 | 445 | +8 |
| web | 784 | 784 | 0 |
| guards (`node:test`) | 11 | 11 | 0 |

The +8 is fully accounted for: `env-example-contract.test.ts` went from 9 tests to 17, which is the
four new `it.each` cases run over `README.md` and `CLAUDE.md`. Nothing else was added, removed,
skipped or renamed.

## The nine canonical names in the two `.env` examples

Counted with `grep -c` per name, per file. Identical in `apps/api/.env.example` and
`apps/api/.env.dev.example`:

| Name | Uncommented assignments |
| --- | --- |
| `FXL_HUB_API_URL` | 1 (blank, known-good value commented above it) |
| `FXL_HUB_ENVIRONMENT` | 1 (blank, known-good value commented above it) |
| `FXL_HUB_CLIENT_ID` | 1 (blank) |
| `FXL_HUB_CLIENT_SECRET` | 1 (blank) |
| `FXL_HUB_AUDIENCE` | 1 (blank, known-good value commented above it) |
| `FXL_HUB_REDIRECT_URI` | 1 = `http://localhost:8006/auth/callback` |
| `FXL_HUB_HEALTH_TOKEN` | 1 (blank) |
| `FXL_HUB_TRUSTED_ORIGINS` | 1 = `http://localhost:8006` |
| `FXL_HUB_SESSION_ENCRYPTION_KEY` | 0, deliberately |

Eight of nine appear exactly once as an assignment.
The ninth appears only in prose, once as its own explanatory note and once inside the
`SALES_SESSION_ENCRYPTION_IKM` comment that distinguishes the two.
That is the right shape for it: it keys the SDK's own `SqlHubSessionStore`, a store this repo does
not use, `hubEnvBag` does not carry it, so a value pasted into an example line would be read by
nothing and would only invite the belief that it does something.
Stating that in a comment is more useful than a line that lies.

`env-example-contract.test.ts` re-run on its own: 17 passed, exit 0.

## Honest gaps

- The two `aria-label`-only string renames noted elsewhere in `CLAUDE.md` remain unpinned. Out of
  scope here, unchanged by this slice, and already recorded there.
- Nothing in this slice tests the `.env` examples against a REAL boot of `server.ts`; the oracle
  drives `tryLoadHubAuthConfig`, which is the door `app-auth.ts` calls at module scope. That is the
  same seam the existing tests used and is deliberate, but it is a projection of the boot rather
  than the boot.
- `FXL_HUB_TRUSTED_ORIGINS` cannot be verified for staging or production from here. It is an
  `AUDIT.md` operator item, and it is the one thing in this feature that can still produce an
  outage after a green merge.
