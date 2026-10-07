# Exec 04-web-lixeira-screen (retry)

Commit: ea3aea1 (test only: deleted-leads-view.test.tsx). No product code changed.

New tests:
- removes the restored row from the cache itself, without any refetch (server keeps the row after 200, list refetch held, asserts row gone).
- invalidates the whole leads root, so a cached board query goes stale (spy on invalidateQueries for the leads root key, seeded board and stages queries both isInvalidated).

Mutant evidence (deleted-leads.ts, restored with git checkout after each):
- M1 (cache removal no-op): 1 failed, 18 passed (19) - killed by the cache test.
- M2 (invalidates stages() only): 1 failed, 18 passed (19) - killed by the invalidation test (re-confirmed after final assertion edit).
- Unmutated: 19/19 pass.

Gates: full web suite 124 files, 1631 tests pass; eslint on test file clean; web tsc clean. Git status clean.
