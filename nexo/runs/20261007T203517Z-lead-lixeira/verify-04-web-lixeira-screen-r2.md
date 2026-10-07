# Verify 04-web-lixeira-screen, attempt 2: PASS

1. Diff d8ccf14..HEAD: 11 files, all in the plan's files_modified. ea3aea1 touches only deleted-leads-view.test.tsx. No new em dash, no nexo/ files, no BOARD-WRITE-FENCE lines touched.
2. Oracles (6 files) run twice: 6/6 files, 221/221 tests, both runs.
3. Mutants, each alone, restored with git checkout, status clean after each:
   - M1 (on-success cache removal no-op): RED (removes the restored row from the cache itself, without any refetch)
   - M2 (invalidate narrowed to leads.stages()): RED (invalidates the whole leads root)
   - Drop Autor nao identificado fallback: RED (fallback test)
   - Render lead id: RED (2 tests: never renders an id or a cursor; Carregar mais)
4. Full web suite: 124 files, 1631 tests passed. tsc exit 0. eslint on changed files: 0 problems. Worktree clean.
