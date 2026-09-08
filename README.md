# fxl-sales

FXL Sales is the FXL affiliate and referral product.
It runs as a pnpm monorepo with an API and web app.

Authentication, workspace membership, active workspace switching, and commerce deep links are owned by FXL Hub through `@fxl-business/hub-sdk`.
The product audience is `app.fxl-sales`.

## Apps

| App | Package | Default URL |
| --- | --- | --- |
| API | `@fxl-sales/api` | `http://localhost:3006` |
| Web | `@fxl-sales/web` | `http://localhost:8006` |

The repository folder is intentionally unchanged for this session.
Do not rename the folder while an editor session is attached to it.

## Requirements

- Node 20 or newer.
- pnpm 9 or newer.
- Docker Desktop for local Postgres.
- A registered FXL Hub OAuth client for `app.fxl-sales`.
- Day-one Hub entitlements for each migrated workspace.

## Setup

```bash
bash scripts/setup.sh
pnpm install
make db-up
make migrate
```

Copy each `.env.dev.example` to `.env` when `scripts/setup.sh` has not already done it.
Fill the Hub secret from the operator-issued value.

## Hub Environment

API:

ALL FIVE IDENTITY VARIABLES TOGETHER, OR NONE.
They are one Client credential, so a partial set is a boot failure naming the missing variable, while none of them set boots and answers `503 hub_auth_not_configured` to the sales-ops routes.
That is why the block below ships all five BLANK with the known-good local values alongside as comments: a block a human copies wholesale must not itself describe a partial configuration.

```dotenv
# FXL_HUB_API_URL=http://localhost:9016
FXL_HUB_API_URL=
# FXL_HUB_ENVIRONMENT=development
FXL_HUB_ENVIRONMENT=
FXL_HUB_CLIENT_ID=
FXL_HUB_CLIENT_SECRET=
# FXL_HUB_AUDIENCE=app.fxl-sales
FXL_HUB_AUDIENCE=

# Operational, and always discrete variables of their own: they rotate
# independently of the Client credential, so FXL_HUB_CONFIG must never carry
# them and the API refuses to boot if it does.
FXL_HUB_HEALTH_TOKEN=
FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback
FXL_HUB_TRUSTED_ORIGINS=http://localhost:8006

PUBLIC_LINK_BASE_URL=http://localhost:3006
```

Web:

```dotenv
VITE_API_URL=http://localhost:3006
VITE_AUTH_PROXY_TARGET=http://localhost:3006
VITE_AUTH_BFF_BASE_PATH=
VITE_FXL_HUB_API_URL=http://localhost:9016
VITE_FXL_HUB_ENVIRONMENT=development
VITE_FXL_HUB_AUDIENCE=app.fxl-sales
```

The Hub audience is configured as `app.<slug>`, never derived from a key.
`FXL_HUB_AUDIENCE` is required, must equal `app.` plus the slug inside `FXL_HUB_CLIENT_ID`, and a mismatch stops the API booting.
`FXL_HUB_ENVIRONMENT` is likewise explicit, must equal the environment segment inside `FXL_HUB_CLIENT_ID`, and is never inferred from `NODE_ENV`.
Local browser auth uses same-origin `/auth/*` routes on `http://localhost:8006`.
Vite proxies those routes to `http://localhost:3006`, so the registered Hub redirect URI is `http://localhost:8006/auth/callback`.

`FXL_HUB_REDIRECT_URI` is not governed by a presence rule.
An absent value is not left absent: it DEFAULTS to `${FXL_HUB_API_URL}/auth/callback`, which is the Hub's own origin, and outside development the boot refuses any effective value whose origin equals the Hub's.
So an unset variable in staging or production does fail the boot, but it fails because of where the default landed and not because the variable was missing.

`FXL_HUB_TRUSTED_ORIGINS` is a DEPLOY-time gate.
Local development needs nothing from it, because vite proxies `/auth` with `changeOrigin` false and the request origin therefore already equals the origin the BFF computes for itself.
Staging and production put the web app and the API on different hosts, so both must set it before the next deploy; unset there, the list is empty and every browser POST to the BFF is answered `403 origin_not_trusted`.

The API owns public referral redirects at `/r/:code`, so `PUBLIC_LINK_BASE_URL` should point to the API public origin.
In production, either keep the same route shape with a scoped web rewrite for `/auth/login`, `/auth/callback`, `/auth/refresh`, and `/auth/logout`, or set `VITE_AUTH_BFF_BASE_PATH` and `FXL_HUB_REDIRECT_URI` to the same API-origin callback.

## Development

```bash
make              # interactive app selector
make dev          # run the default dev stack
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

The API mounts the Hub BFF at `/auth/*`.
Protected API routes use Hub access tokens and read the verified context from `c.get('hubAuth')`.
Tenant-scoped data continues to use `org_id` as the database partition key, with Hub workspace ids preserved during provisioning.

## Database

```bash
pnpm --filter @fxl-sales/api db:generate
pnpm --filter @fxl-sales/api db:migrate
pnpm --filter @fxl-sales/api db:studio
```

Every money or tenant table must keep RLS scoped by `org_id`.
Admin operator context is still audited through the API audit helpers.

## Verification

Use the root commands before shipping:

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

`pnpm test` also runs `scripts/no-legacy-auth.mjs`.
That guard fails if the removed auth provider is reintroduced into tracked files.

## Deployment Notes

- Hub auth and the product web origin must share one registrable domain in production.
- `AUTH_PUBLIC_URL`, `HUB_ISSUER`, and the web auth origin must match on the Hub side.
- The Hub operator must provision workspaces with preserved ids before product login.
- The Hub operator must seed `active` or `trialing` entitlements before users enter gated modules.
- Checkout and subscription management links are generated by the Hub browser client.
