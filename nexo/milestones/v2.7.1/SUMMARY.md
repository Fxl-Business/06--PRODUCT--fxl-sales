# v2.7.1 - restore login after the hub-sdk 1.3.x CSRF origin guard

Tag: `v2.7.1` at `e8a5810`
Cut: 2026-08-10, same day as `v2.7.0`
Flow: hotfix, express promotion
Chain: `master == staging == production == e8a5810`

## The incident

`v2.7.0` reached production and the app was unusable for entitled operators.
The symptom was a blank screen for roughly a minute, then `Nao foi possivel restabelecer sua sessao`, for an account holding `admin`, `Vendedor` and `Finder` on `sales.core`.

Reproduced live in the browser rather than inferred: four consecutive `POST /auth/refresh` calls, each `403 {"error":"forbidden"}`, then the login loop guard tripped and rendered the recovery panel.

## Cause

`@fxl-business/hub-sdk@1.3.x` added a CSRF guard to the top of `createHubBff`:

```js
if (site === "cross-site" || (origin && origin !== new URL(c.req.url).origin))
  return c.json({ error: "forbidden" }, 403);
```

`1.2.0` has no such guard - verified against a freshly packed tarball - and `MIGRATION.md` does not mention request origin or CSRF anywhere among its thirteen headings.
So it is a silent breaking change for any consumer whose browser origin differs from the origin its BFF is served on.

That is this product in production: the web app is `sales.fxlbusiness.com` and the API is `sales-api.fxlbusiness.com`.
Every POST the BFF serves was rejected. The GET redirects (`/auth/login`, `/auth/callback`) were unaffected, because the guard is POST-only, which is why login appeared to start and then failed.

## Why nothing caught it

Three independent reasons, all of which are worth remembering:

1. **Local development is same-origin.** `apps/web/vite.config.ts` proxies `/auth/*` to the API, which is the architecture `CLAUDE.md` describes. The browser request is genuinely same-origin locally, so the guard never fires.
2. **Every existing test called `createHubBff` with no `Origin` header**, and the guard's `origin &&` short-circuits on that. The slice 03 real-SDK pin and the slice 01 wiring tests all passed for this reason.
3. **The clean-clone deploy simulation builds, it does not run cross-origin traffic.** It would have caught a resolution failure, which is what it was written for after `v2.3.0`, but not a runtime origin rejection.

The general lesson: `v2.3.0` taught this repo that a green local build is not a green deploy, and the answer was a clean-clone build check. `v2.7.0` teaches that a green clean-clone BUILD is not a green deploy either, because deployment TOPOLOGY - two origins rather than one - is itself untested surface.

## The fix

`apps/api/src/auth/hub-bff-origin.ts` puts a shim in front of the BFF.
For a request whose `Origin` is on an explicit allowlist (`env.CORS_ORIGIN`, already the trusted web origin and already what the CORS middleware keys on), it rebuilds the request with `Origin` set to the API's own origin and forwards it into the BFF through `bff.fetch`.
Anything else is passed through untouched, so the SDK still issues its own `403` for a genuine cross-site POST.

The request is rebuilt rather than mutated because incoming `Request` headers are immutable in undici and Hono's `c.req` is a getter over a private field with no setter.

`hubBffErrorHandler` had to be attached to the BFF sub-app as well as the outer router: invoking it through its own `fetch` makes it a separate Hono app, so a store outage thrown inside it is caught there and would have answered `500` instead of the `503` that stops a database blip reading as "no session". An existing oracle caught that regression during development.

## Verification

Gate 2 by a separate Verify agent:

- **14 hostile origin shapes all still 403** - subdomain in both directions, scheme, port, trailing slash, case, `null`, prefix truncation, userinfo smuggling, `sec-fetch-site` lies, and a doubled `Origin` header in both orders. The allowlist is an exact `Set.has` over `new URL(x).origin` with no prefix, regex or wildcard, frozen in a closure from validated env and unreachable from any request.
- Redirects, `Set-Cookie` (including multiple), `Cookie`, request bodies, content type and query strings all survive the rebuild byte-identically.
- Two mutations, both non-vacuous: removing `bff.onError` turns the 503 oracle red with `expected 500 to be 503`; reverting the mount to `router.route('', bff)` reproduces the outage.

That second mutation initially left **all 391 API tests green** - the shim's own tests proved it worked, but nothing proved it was USED. `createAppAuthBff trusted-origin mount` was added for exactly that and is mutation-confirmed.

Production `CORS_ORIGIN` was confirmed correct against the live API before promoting, since the entire fix keys on that one value.

## Confirmed in production

`POST /auth/refresh` with the web origin moved `403` to `401`, and a real browser load reached `/tatico/dashboard` with live data.

## Follow-ups filed

The two that matter are in `nexo/ROADMAP.md`:

- The auth boot sequence shows nothing while it resolves, and its single failure panel cannot distinguish "not signed in" from "account not entitled" from "this workspace not entitled". This outage was diagnosed with `curl` rather than from the UI, which is the strongest possible argument for that work.
- A `403` is still classified `transient` by the web client, so any future origin misconfiguration will again present as four silent retries and a generic panel. Deliberately not changed under hotfix pressure, because a `403` from an intermediate proxy genuinely can be transient and the distinction needs the UX above to land with it.

Plus: report the guard upstream and ask for a `trustedOrigins` option, which would let the shim be deleted.
