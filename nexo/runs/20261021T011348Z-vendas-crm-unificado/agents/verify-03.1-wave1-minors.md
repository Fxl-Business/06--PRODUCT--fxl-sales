# Verify 03.1-wave1-minors: PASS
- parity + seed-callers vitest: 6/6; brand-and-technical-ids: 21/21; no Postgres suite run.
- Mutation (scratch copy): changed 0022 seed label and kind -> parity loop test "every registered migration seed comparison matches the pipeline" goes red.
- Mutation: types.ts filename reverted to fxl-sales-importacao -> brand test fails (20/21); restored -> 21/21.
- CLAUDE.md, kanban-de-leads.md (4 callers) and importacao-por-planilha.md (D11 and outside-feature line) agree with stages-seed-callers.test.ts allow-list (stage-service, sales-ops/routes, import/routes, stages-seed).
- No findings. Worktree untouched.
