# Execute - prod migrations

## Root cause

The production runtime image copied `apps/api/dist` but did not copy `apps/api/drizzle`.
The only migration runner lived at `apps/api/scripts/migrate.ts`, outside the API TypeScript compiler's `src/**/*` include, so no compiled migration entrypoint existed in `dist`.
The Docker command started `dist/server.js` directly, so deployments could serve application code against an outdated database schema.

## RED

Added `apps/api/src/config/__tests__/docker-migration-contract.test.ts` to lock the production runtime contract.
The test requires a buildable migration entrypoint under `src`, the Drizzle migration directory in the runtime stage, and a fail-fast migration-before-server command.

Command:

```sh
pnpm --filter @fxl-sales/api exec vitest run src/config/__tests__/docker-migration-contract.test.ts
```

Result: expected failure with exit code 1.
The assertion for `apps/api/src/db/migrate.ts` received `false`, proving the compiled runner was absent before the implementation.

## GREEN

Moved the existing runner to `apps/api/src/db/migrate.ts`, which compiles to `dist/db/migrate.js`.
Updated `db:migrate` to use the same source entrypoint so local and production migration paths do not diverge.
Copied `apps/api/drizzle` into the runtime image.
Changed container startup to `node dist/db/migrate.js && exec node dist/server.js` through `sh -c`.
The `&&` prevents the API from starting after migration failure, and `exec` preserves normal signal delivery to the server process.

Focused command:

```sh
pnpm --filter @fxl-sales/api exec vitest run src/config/__tests__/docker-migration-contract.test.ts
```

Result: 1 test passed.

Build assertion:

```sh
pnpm --filter @fxl-sales/api build
test -f apps/api/dist/db/migrate.js
```

Result: passed, and the compiled migration runner is present.

## Verification performed

```sh
pnpm --filter @fxl-sales/api test
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api build
```

Result: 18 test files and 153 tests passed, with lint, type-check, and build also passing.

## Production-image E2E

The production-image E2E could not run because the configured Docker daemon was unavailable.
`docker version --format '{{.Server.Version}}'` failed with `Cannot connect to the Docker daemon at unix:///Users/cauetpinciara/.orbstack/run/docker.sock. Is the docker daemon running?`.
No image, container, network, server, watcher, or other long-running process was started.

## Scope

No schema, generated migration metadata, changelog, web code, `.vscode` content, or unrelated doubt file was modified.
No commit was created.
