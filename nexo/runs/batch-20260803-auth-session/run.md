---
run: batch-20260803-auth-session
milestone: v2.4.0
flow: batch
mode: autopilot
date: 2026-08-03
trunk: master
gate1: skipped-autopilot
gate2: passed
gate3: not-cut
---

# Run - auth session loss

Invoked as `/nexo --batch --auto` against two reported auth failures.
`--auto` carried Gate 1 only; nothing was shipped past `master`.

## What was reported

1. A partner logged in and the app showed `A API de vendas não respondeu corretamente`, while the same
   product worked in the reporter's browser at the same moment and the partner's FXL Hub session was
   verified healthy in another tab.
   Clearing the browser cache fixed it, and he came back already logged in.
2. Roughly every five minutes, the next action reloaded the whole app back to the dashboard and destroyed
   the form in progress. It happened around the third produto he created.

## What it actually was

One root cause in the API, plus two web-side amplifiers that turned it into those two symptoms.

`createAppAuthBff()` passed no `sessionStore` to `createHubBff`, so `@fxl-business/hub-sdk` fell back to
`InMemoryHubSessionStore`. The browser holds only an opaque session id; the Hub refresh token lived solely
in one process's memory. Every API restart or redeploy therefore invalidated every logged-in session, and
with more than one replica a session created on A was invisible on B - which is exactly the shape of
"broken for him, fine for me, at the same moment".

The web then mistranslated that failure twice. `requireToken` did `(await getToken()) ?? ''` and `apiFetch`
omits the `Authorization` header for a falsy token, so an auth failure went out as an anonymous request and
came back as what read like a server outage (symptom 1). And `applyToken(null)` on any token read flipped
`isSignedIn` false, which made `HubProtected` call `login()` - a full page navigation whose server-chosen
post-login redirect is the web root (symptom 2).

## Slices

| Slice | Verify | Merge |
|---|---|---|
| 01-durable-bff-session-store | FAIL then PASS on re-verify | `6902b13` |
| 02-no-blank-bearer-token | PASS first pass | `4777627` |
| 03-preserve-session-and-route | FAIL then PASS on re-verify | `6acda51` |

One wave; `waves.sh` certified all three parallel-safe. Executed serial-on-`master`, one branch and one
`--no-ff` merge per slice. `nexo-wave-exec.sh` was not used: it hardcodes `main` and this repo's trunk is
`master`.

## What Gate 2 caught

Verify ran as a separate agent with fresh context on every slice, and it earned its keep twice.

Slice 01 came back FAIL on two counts. A blank `HUB_SESSION_ENCRYPTION_KEY` - the value the slice itself
shipped in `.env.dev.example`, which CLAUDE.md tells operators to copy - stopped the API booting outright,
because `??` does not catch `''`. And the new tamper test flipped a base64url character whose low bits are
padding, so it was a no-op 25.6% of the time (measured 5130/20000). Verify also found that deleting
`sessionStore: session.store`, the literal production bug, left both suites green, so the wiring was
unpinned; that gap is now closed by an identity assertion.

Slice 03 came back FAIL on an exploitable open redirect. `sanitizeReturnTo` validated the raw input and the
parsed URL but returned the normalized path, which nothing re-validated, so dot-segment normalization
escaped: `/..//evil.example` returned `//evil.example` and resolved off-origin. Seven inputs escaped. The
re-verify then hardened it with a 60-input corpus and a 22,620-sequence fuzz, all same-origin.

The most valuable finding was non-blocking and got promoted: deleting `revalidateAttempts.current = 0` left
the whole suite green, yet without it the counter accumulates across unrelated blips and signs the operator
out on roughly the fourth transient null - silently reshipping the exact bug this batch exists to fix. It
now has an oracle that goes red on that mutation.

## Gate 2 evidence

Wave-verify on the integrated `master`: lint, type-check, `pnpm test` (33+44 files, 323+484 tests),
`test:integration` (20 files, 109 tests), and `pnpm run build` - the build re-run from a clean state with
every `dist/` and `*.tsbuildinfo` deleted, producing byte-identical chunk hashes, so no cached artifact
masked a failure. Migration 0016 was proven to apply 0015 -> 0016 on a scratch database and the whole
integration suite passes against it from scratch. No skipped, quarantined or flaky tests.

## Deliberately not done

- No deploy and no release cut. Gate 3 is the user's.
- No form-draft persistence. The fix is to stop navigating away, not to autosave.
- No sweep of the pre-existing em dashes in the legacy `admin/**` and `finder/**` trees; most are `'—'` as
  a table placeholder, so the convention needs deciding before a blind sweep. Filed to ROADMAP.
- `logout()`'s inert `consumeReturnTo`, and the TanStack `retry: 1` window where a blip longer than 1000ms
  but shorter than the ladder parks the user on `Sessão expirada` while the session actually recovers.
  Both filed rather than fixed unasked.

## Operational notes for the deploy

- Existing sessions are invalidated once, on the deploy that lands this. Every user logs in again exactly
  once, which is what a redeploy already did before this batch.
- `FXL_HUB_SECRET_KEY` must be at least 32 characters or the API will not boot. The Hub key format is a
  fixed 45 characters, and the local value measures 45, so this is a floor to be aware of rather than a
  live risk.
- The two new tables get privileges from `ALTER DEFAULT PRIVILEGES`, not from `0016`, so confirm Coolify
  provisions them the same way the local and test databases do.
