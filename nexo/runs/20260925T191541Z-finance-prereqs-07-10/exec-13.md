# Exec 13 - fake identity carries hubAuth

Branch `feat/20260925-13-fake-identity-hubauth`, head `59ea810558930d479ae60214dab962ce5d43c3d2`, based on master `c79abed`.

## Commits

- `59ea810` docs(auth): record applyHubAuthContext as the one hubAuth seam for both paths
- `1816f69` fix(auth): applyHubAuthContext sets hubAuth so dev identity mode carries it
- `62d7273` test(auth): dev identity handlers see hubAuth for actor name and lead scope email

## Red

Two new cases in `apps/api/src/auth/__tests__/dev-identity-no-hub.test.ts` (probe route extended with `actorName` via `getHubActorDisplayName(c.get('hubAuth'))` and `email` via `c.get('hubAuth')?.claims?.email`).
Both failed on master with `expected null not to be null`; expected values read from the roster (`identity.profile.name` / `.email`).

## Green

`applyHubAuthContext` now starts with `c.set('hubAuth', auth);` plus a one-line comment.
No change to `packages/auth-fake`, `select.ts` or any consumer; no per-request flag branch.

## Docs

One bullet in `nexo/knowledge/reference/development-identity-mode.md` naming `applyHubAuthContext` as the one `hubAuth` seam for both paths.

## Verification

- Oracle file: 10/10 pass.
- Mutation (delete the `c.set` line): both new oracles fail (2 failed, 8 passed); restored, tree clean.
- `CI=true pnpm test`: exit 0 (api 63 files, web 85 files, shared-utils 5, auth-fake 1, scripts 55 pass 0 fail).
- `pnpm run lint`: exit 0.
- `pnpm run type-check`: exit 0.
- No processes left running.
