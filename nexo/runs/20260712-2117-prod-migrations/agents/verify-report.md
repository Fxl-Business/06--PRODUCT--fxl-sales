# Verify Report: prod-migrations

## Verdict

PASS

The production migration startup contract is established by the focused test, compiled output, Dockerfile ordering, checked-in migration journal, and failure-path execution.
The Docker daemon was unavailable, so the conditional real Docker fresh-database E2E was not attempted.

## Scope Reviewed

- `apps/api/Dockerfile`
- `apps/api/package.json`
- `apps/api/scripts/migrate.ts` deletion
- `apps/api/src/db/migrate.ts`
- `apps/api/src/config/__tests__/docker-migration-contract.test.ts`
- `apps/api/drizzle/0007_marvelous_valeria_richards.sql`
- `apps/api/drizzle/meta/_journal.json`

The verifier did not read the context pack or execute report and did not modify production code or tests.

## Acceptance Evidence

1. The runtime image copies `/app/apps/api/drizzle` to `./apps/api/drizzle` and starts with `node dist/db/migrate.js && exec node dist/server.js` from `/app/apps/api`.
2. `pnpm build` produced `apps/api/dist/db/migrate.js`, and the compiled file invokes Drizzle with `migrationsFolder: './drizzle'`.
3. The shell startup contract was executed with an empty `DATABASE_URL`.
   The migrator printed `DATABASE_URL is required`, exited with code 1, and the server did not print its listening message.
4. `apps/api/drizzle/meta/_journal.json` includes `0007_marvelous_valeria_richards`.
5. The checked-in `apps/api/drizzle/0007_marvelous_valeria_richards.sql` creates `sales_ops_sales` at line 89.
6. The focused Docker migration contract passed and locks the migration copy plus migrate-before-server command.

## Machine Checks

| Check | Result | Evidence |
|---|---|---|
| Focused Docker migration contract | PASS | 1 test passed |
| Full repository test suite | PASS | API 153 tests, web 31 tests, shared-utils 17 tests |
| Lint | PASS | All workspace lint commands exited 0 |
| Typecheck | PASS | All workspace typecheck commands exited 0 |
| Build | PASS | API and web production builds exited 0 |
| Compiled migrator artifact | PASS | `apps/api/dist/db/migrate.js` exists after build |
| Production dependency audit | PASS | `pnpm audit --prod` reported no known vulnerabilities |
| Diff hygiene | PASS | `git diff --check` exited 0 |
| Docker fresh-database E2E | NOT RUN | Docker daemon was unavailable at the configured OrbStack socket |

## Commands

```text
pnpm --filter @fxl-sales/api exec vitest run src/config/__tests__/docker-migration-contract.test.ts
pnpm test
pnpm lint
pnpm type-check
pnpm build
test -f apps/api/dist/db/migrate.js
pnpm audit --prod
docker info --format '{{.ServerVersion}}'
DATABASE_URL='' sh -c 'node dist/db/migrate.js && exec node dist/server.js'
git diff --check
```

No containers, dev servers, watchers, or other persistent processes were started.
