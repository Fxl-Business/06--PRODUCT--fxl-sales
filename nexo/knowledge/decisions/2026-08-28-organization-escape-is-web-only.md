# The Organization-context escape route is web-only, and the 402 body is untouched

**Date:** 2026-08-28
**Surfaced by:** `feature-20260828-organization-context-escape` (Frame, then re-confirmed at every slice)

## Context

An operator whose active Hub Organization does not carry FXL Sales got `402 {error: 'payment_required', code: 'missing_entitlement'}` on every sales-ops call, saw it rendered as `Verifique o servidor local`, and had no way out of that Organization from inside the app.

The obvious shape of a fix is to make the API help: add the active Organization's name to the 402 body, add the account's other Organizations, add a checkout URL, and have the web render what it is handed.
That shape was considered and rejected.

## Decision

The escape route is a WEB-ONLY change.
`apps/api` is byte-unchanged by this feature, and the 402's status, body and placement in `app-auth.ts` are exactly what they were.

The reason is that the web already holds everything it needs, and holds it more reliably than a response body could.
The ACTIVE Organization is in the access token itself, as the top-level `workspaceId` claim (the same claim `app-auth.ts` reads as `orgId`) and the `workspaceName` claim beside it.
The account's OTHER Organizations are in the token's `workspaces` claim, already projected into the auth context as `HubWorkspacePreview[]`.
So naming the active Organization and offering the others needs no round trip and cannot fail independently of the session that produced the 402.

Changing the 402 body would have been a change to the ENTITLEMENT GATE, which was explicitly out of scope for this feature, and it would have bought nothing.
The gate is one of the load-bearing security boundaries in the product; widening its response to carry Organization metadata puts tenant-adjacent naming into a rejection path that runs before any tenancy filter, for information the caller already had in its own token.

## `isEntitlementFailure` keys on status ALONE

`isEntitlementFailure` in `apps/web/src/lib/require-token.ts` is `status === 402` and deliberately does NOT also require `code === 'missing_entitlement'`.

That looks like a missed discriminator and is not.
`apiFetch` builds its error from `await res.json().catch(() => ({}))`, so a 402 whose body does not parse - a proxy error page, a truncated response, a gateway that rewrites the payload - carries no `code` at all.
Requiring the code would classify exactly that response as NOT an entitlement failure and route it to the generic API-fault arm, which is the `Verifique o servidor local` copy this whole feature exists to make unreachable for a 402.

So the two failure modes are asymmetric.
Keying on the code fails CLOSED, back onto the precise lie the feature removes, on the least debuggable version of the response.
Keying on the status fails OPEN, onto a panel that names the active Organization and offers a switch, which is a reasonable thing to show for any 402 the sales API can currently produce.
The predicate is otherwise strictly narrow: no `>= 400`, no error-string alternative, strict `===` on the number, and `null` / `undefined` handled.

The one thing that would invalidate this is a SECOND 402 code from the API meaning something other than "this Organization has no Sales entitlement".
That would land silently on this panel, so the day such a code is introduced is the day this predicate must grow a discriminator, and the pin that catches the current behaviour is `isEntitlementFailure is true for a 402 that carries no code at all`.

## Consequences

- No API change, no migration, no contract version, and nothing to deploy on the server side for this feature.
- The panel works for a 402 that arrives with an unparseable body, which is the case a body-driven design could not have handled at all.
- The active Organization is resolved by the `workspaceId` claim and never by name, so two Organizations sharing a name are told apart and a token with no name claim still resolves.
- The web keeps working if the Hub later stops populating `workspaces`: `others` is empty, no picker renders, and the checkout branch alone is offered.
- `?organization=` deep linking stays out, because hub-sdk 1.3.x drops the parameter; it belongs to the parked SDK 2.1.0 migration run.
