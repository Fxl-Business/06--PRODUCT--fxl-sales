# Verify 04-web-lixeira-screen: FAIL (oracle quality gap)

Commit c246951 on base d8ccf14.

## 1. Scope
- Diff touches 11 files, all in the plan's files_modified. None of slice 03's files, no nexo/ files.
- Added lines containing the em dash: 0.
- BOARD-WRITE-FENCE regions of SalesOpsApp.tsx: identical hash at base and HEAD.

## 2. Oracles (6 files), run twice
- 6/6 files, 219/219 tests, both runs.

## 3. Mutation probes
- M1a render deletedByName without `Autor não identificado` fallback: RED (1 failed).
- M1b render lead id as a DOM attribute: RED (never renders an id or cursor).
- M2a restore does not remove the row from cache (onSuccess setQueryData -> identity): SURVIVES (219 pass).
- M2b restore invalidates `queryKeys.leads.stages()` instead of `queryKeys.leads.all`: SURVIVES (219 pass).
- M2c both M2a and M2b together: RED (2 failed).
- All files restored, status clean.

Why M2a/M2b survive: the fake server in deleted-leads-view.test.tsx drops the row on a 200, so the trash refetch from invalidation masks a missing cache removal, and the cache removal masks the trash refetch.
Nothing asserts that `queryKeys.leads.all` (board, stages) is invalidated after a restore, and nothing asserts the cache removal independently of the refetch.
A regression that stops refreshing the board after a restore, a stated acceptance criterion, would go green.
Required fix (test only): in the restore test, spy on `queryClient.invalidateQueries` and assert a call with `{queryKey: queryKeys.leads.all}`, and add a case where the server keeps returning the row after a 200 (so only the cache removal can hide it).

Nav oracles: navigation-edition.test.ts asserts `Leads excluídos` for admin in the full list (before Geral, last item Geral) and in the leads edition (appended last); seller, finder and no-role matrices redirect `/cadastros/leads-excluidos` to their role default. navigation.test.ts asserts admin resolves and seller does not. Good.

## 4. Review
- 403 on restore: MutationErrorBanner inline (restoreFailureKind -> banner). ForbiddenPanel only for a refused READ. OK.
- 400 no_open_stage: row stays, notice plus `Ir para Etapas do funil` navigates to /cadastros/etapas. OK.
- Dates: formatRecordedAt, Intl with America/Sao_Paulo. OK.
- Keyset: cursor is pageParam, URLSearchParams, limit 50, button gone when nextCursor null. OK.
- No id or cursor in the DOM (oracle checks innerHTML). OK.
- headerAction null for the view; mounts only on view === 'leads-excluidos'. OK.

## 5. Suites
- Full web suite: 124 files, 1629 tests passed.
- Web type-check (tsc --noEmit): 0 errors.
- eslint on changed files: 0 problems.
- Nothing left running.
