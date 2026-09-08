# Exec notes - slice 02, local-post-login-rename

Branch: `feat/02-local-post-login-rename`, branched from `master`.

## What was done

`FXL_HUB_POST_LOGIN_REDIRECT` is now `SALES_POST_LOGIN_REDIRECT` and
`FXL_HUB_POST_LOGIN_ERROR_REDIRECT` is now `SALES_POST_LOGIN_ERROR_REDIRECT`.
Behaviour is unchanged; only the names moved.

- `apps/api/src/env.ts` - both declarations keep `emptyToUndefinedUrl` and gain a comment saying why
  the pair carries no `FXL_HUB_` prefix.
- `apps/api/src/config/auth-provider.ts` - both the `HubEnvSource` `Pick` and the `hubEnvBag` body.
  The bag itself is untouched as a bridge; a comment now records that not every key in it is a Hub
  variable, which is exactly what the retitled oracle asserts.
- `apps/api/src/middleware/app-auth.ts` - the two reads, plus a doc comment on
  `resolveHubPostLoginRedirect` naming the reason for `SALES_` and stating that `createHubBff`'s
  `postLoginRedirect` / `postLoginErrorRedirect` CODE options are unchanged.
- `apps/api/.env.example` and `apps/api/.env.dev.example` - names renamed, and the one-line
  "Defaults to CORS_ORIGIN" comment kept in meaning and expanded to also say what the error variant
  defaults to and why the prefix differs.
- `CLAUDE.md` - a new bullet in the Auth Model section, directly under the session-IKM bullet,
  following slice 01's prose-record style: it names both old names once, says what they became, why,
  lists the canonical nine, and states explicitly that `FXL_HUB_REDIRECT_URI` is one of them and is
  untouched.
- `scripts/no-legacy-env-names.mjs` - two new entries.
- `scripts/__tests__/no-legacy-env-names.test.mjs` - three new oracles (8 tests -> 11).

`FXL_HUB_REDIRECT_URI` and `resolveHubRedirectUri` were not touched.

## Things the plan did not anticipate

1. **Five test files outside `files_modified` stub the pair.** `app-auth-access-gate`,
   `app-auth-bff-memory-path`, `app-auth-bff-production-boot`, `app-auth-bff-wiring` and
   `app-auth-unconfigured` all `vi.stubEnv` both names. They had to be renamed: left alone they
   would have gone silently inert (the stub would set a variable the schema no longer declares, and
   the resolvers would quietly fall back to `CORS_ORIGIN`), AND the guard would have failed. Same
   shape of omission as slice 01's `.env.example` surprise.

2. **`EnvLike` is `Record<string, string | undefined>`, so type-check cannot see the rename in
   `app-auth.ts` at all.** Unlike slice 01, where reverting the read was caught by `tsc` at once,
   here reverting `envBag.SALES_POST_LOGIN_REDIRECT` to the old key type-checks cleanly and the two
   existing resolver tests still pass, because neither of them passes an explicit value - both
   exercise only the `CORS_ORIGIN` fallback. The rename in the one file that actually reads the
   variables was therefore completely unpinned. Three tests were added to
   `apps/api/src/middleware/__tests__/app-auth.test.ts` to close that:
   `prefers an explicit SALES_POST_LOGIN_REDIRECT over CORS_ORIGIN`,
   `prefers an explicit SALES_POST_LOGIN_ERROR_REDIRECT over the derived one`, and
   `falls back to / and /?error=auth when neither the pair nor CORS_ORIGIN is set` (the `/` special
   case had no oracle at all before). No existing assertion was changed or removed.

3. **The `-w` cross-fire question was verified, and the answer is that `-w` is not what saves this
   pair.** Neither retired name is a substring of the other - the `ERROR_` segment sits in the
   MIDDLE, not at the end - so even a plain substring ban would not cross-fire here, and neither is
   a substring of any of the nine canonical names. `-w` is still correct and still load-bearing for
   the slice-01 entry, whose retired name IS a strict suffix of `FXL_HUB_SESSION_ENCRYPTION_KEY`.
   Verified empirically against a throwaway repo holding all of the names side by side, not
   assumed, and then pinned as
   `the two post-login bans do not cross-fire, and spare the canonical nine`.

4. **The guard's own comment trap did not recur**, because the `String.fromCharCode` idiom was
   followed for both the source and the test from the first write, comments included. Confirmed by
   the guard passing on its own staged tree.

## Non-vacuity, observed

| Probe | Observed |
| --- | --- |
| `FXL_HUB_POST_LOGIN_REDIRECT` planted in `apps/api/src/planted-probe-a.ts`, staged | exit 1, `Retired env name found. Use SALES_POST_LOGIN_REDIRECT instead:` / `apps/api/src/planted-probe-a.ts:1:...`. The ERROR ban did NOT also fire. Removed, exit 0. |
| `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` planted in `apps/api/src/planted-probe-b.ts`, staged | exit 1, `Retired env name found. Use SALES_POST_LOGIN_ERROR_REDIRECT instead:`. The plain ban did NOT also fire. Removed, exit 0. |
| `resolveHubPostLoginRedirect` mutated to drop `?? envBag.CORS_ORIGIN` | `app-auth.test.ts` goes RED: `returns users to the web origin after Hub callback` and `adds an auth error query to the post-login error redirect`, 2 failed / 15 passed. Restored. |
| Bag key renamed to `SALES_POST_LOGIN_ERR_REDIRECT` while the schema and the `Pick` keep the real name | `auth-provider.test.ts` goes RED on `projects exactly the auth variables off the validated env object`, 1 failed / 11 passed. This is the pin working: the mutation type-checks (the bag returns a loose `Record`), so the sorted-key assertion is the only thing that catches it. Restored. |

## Verification, exit codes

| Command | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 - shared-utils 80, api 428 (was 425, +3 new resolver oracles), web 784, guard tests 11 (was 8), build-contract ok |
| `node scripts/no-legacy-auth.mjs` | 0 |
| `node scripts/no-legacy-env-names.mjs` | 0 |

No integration suite was run: this slice touches no SQL, no route and no RLS path.

## Operator action required at deploy time

Both variables are OPTIONAL and are blank in both `.env` examples, and both fall back to
`CORS_ORIGIN`, which every environment already sets. So in the expected case there is nothing to
carry across and the rename is free.

If either variable currently carries a NON-blank value in Coolify (staging or production), that
value must be set under the new name BEFORE the deploy that reads it. The failure is quiet rather
than loud: post-login would simply land on `CORS_ORIGIN` and the error variant on
`CORS_ORIGIN/?error=auth`, instead of wherever the operator pointed them. Nothing throws, nothing
502s, and no user is logged out - which is why this must be CHECKED against Coolify rather than
noticed afterwards. The old variables can be deleted from Coolify after the deploy.
