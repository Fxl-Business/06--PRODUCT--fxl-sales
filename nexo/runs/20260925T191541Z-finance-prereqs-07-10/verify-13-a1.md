# Verify 13-fake-identity-hubauth (a1)

Verdict: PASS
Commit: 59ea810558930d479ae60214dab962ce5d43c3d2 (base c79abed)

## Oracles
- apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts: 10/10 pass, including the two new cases.
- Mutation: deleting `c.set('hubAuth', auth);` in applyHubAuthContext turns exactly the two new cases red (8 pass, 2 fail). Restored; tree clean.

## Security
- Real path: hubAppAuthMiddleware reads `auth = c.get('hubAuth')` (set by the SDK requireHubAuth) and passes that same object to applyHubAuthContext, so the new set writes the identical reference back. Idempotent, no behaviour change.
- Only two callers of applyHubAuthContext: app-auth.ts:288 (real) and auth/select.ts:203 (fake). The fake auth object is built by `fake.toHubAuthContext(identity, ...)` from the roster; the header/bearer sub only selects a roster id. No raw body or header value becomes hubAuth.
- No per-request branch on SALES_AUTH_FAKE added; diff touches only applyHubAuthContext, the test file and the reference doc.
- dev-identity-production-refusal.test.ts: 3/3 pass. scripts/__tests__/auth-fake-isolation.test.mjs: 21/21 pass.
- No em dash in the diff.

## Gates (run-once, CI=true)
- pnpm run lint: exit 0
- pnpm run type-check: exit 0
- pnpm test: exit 0 (auth-fake 35, shared-utils 155, api 680, web 998, node scripts 55 pass / 0 fail)

No process left running; worktree clean.
