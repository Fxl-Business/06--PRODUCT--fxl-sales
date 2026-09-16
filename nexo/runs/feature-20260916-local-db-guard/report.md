# Relatório: local-db-guard

## Status da solicitação
pass · All four slices landed on master and every acceptance criterion is met, proven by exit code; one item needs your hands and is out of this run's scope by your own brief.
Pedido: Close the hole that let a local process write to the staging database, and give Sales the same named opt-in mechanism the FXL Hub already proved.

## Entregue
- 01-env-file-resolution  2facf27  apps/api/src/env.ts and apps/api/src/db/migrate.ts now reach the environment through one shared resolver, so they cannot diverge. SALES_ENV_FILE names a file that loads LAST with override, resolved against apps/api when relative. An unreadable named file THROWS rather than falling back, because the fallback is the original bug: it runs against the local database while you believe you asked for another one. migrate.ts no longer carries a bare dotenv/config import.
- 02-local-database-guard  6099395  A pure guard refuses a non-local database host at both entrypoints and exits 1, naming the host it found and telling you to use make stg. It runs before anything can open a connection, and both entrypoints now print one host-and-port line so the target is never invisible again. Building it found that the plan's placement was wrong: ESM evaluates the whole static import graph before any body statement, so server.ts was restructured to import only env.js and the guard statically.
- 03-staging-make-targets  8f5660a  make stg, back-stg and front-stg name staging explicitly. There is deliberately no migrate-stg, and the Makefile now says so in a comment so the next person does not add one. db-reset announces which host its chained migration will target, before it destroys anything.
- 04-structural-guard  ffb5245  A tracked node --test guard, wired into the root test script, fails if either entrypoint stops invoking the guard or if migrate.ts regains a raw dotenv/config import. It proves each regression against a fixture tree by exit code, never by message text, and never by damaging the real sources.

## Não feito e por quê
- operator-env-refresh  park · out_of_scope
  apps/api/.env on this machine is stale against hub-sdk 2.3.0: it still names the retired FXL_HUB_PUBLISHABLE_KEY and FXL_HUB_SECRET_KEY and supplies none of the identity five, so the API cannot complete a local boot. It predates this run and your brief forbids this run from editing that file and says the Hub values come later by hand. Refresh it from apps/api/.env.dev.example. Audit: nexo/runs/feature-20260916-local-db-guard/AUDIT.md
- drizzle-config-door  park · out_of_scope
  apps/api/drizzle.config.ts has its own dotenv/config and raw DATABASE_URL read, so pnpm db:studio reaches a database without passing the guard. Your brief names exactly two entrypoints, so scope was not widened. The remedy is one more call site plus one assertion in the structural guard. Audit: nexo/runs/feature-20260916-local-db-guard/AUDIT.md
- mutation-tier  skip · not_applicable
  The feature-boundary mutation pass did not run because this repository configures no mutation tool. What stands in its place is hand-applied-and-reverted mutations by the slice verifiers and slice 04's tracked fixture mutations. There is no coverage-wide mutation score for this run. Audit: nexo/runs/feature-20260916-local-db-guard/AUDIT.md

## Decisões tomadas sem você
- Inverted the execution order of your Fatia 1 and Fatia 2: the named opt-in resolver landed first and the guard second, because the guard consumes namedEnvFile and that value does not exist until the resolver does. (nexo/plans/feature-20260916-local-db-guard/00-OVERVIEW.md)
- Restructured apps/api/src/server.ts to statically import only env.js and the guard, loading every other module with await import, because ESM evaluates the entire static import graph before any body statement and the guard was otherwise not first. (nexo/runs/feature-20260916-local-db-guard/run.md)
- Added apps/api/test/unit-setup.ts to slice 01 so the unit suite blanks SALES_ENV_FILE, keeping the suite decided by its own fixtures rather than by a developer's shell. (nexo/plans/feature-20260916-local-db-guard/01-env-file-resolution.md)
- Left .gitignore untouched: coverage of both apps/api/.env.staging and apps/web/.env.staging is already proven by git check-ignore, and the redundant pattern buys no safety. (nexo/plans/feature-20260916-local-db-guard/03-staging-make-targets.md)
- Ran wave 2's two slices serially rather than in parallel worktrees, because two agents in one working tree has already swallowed one agent's work into another's commit in this repository. (nexo/runs/feature-20260916-local-db-guard/run.md)
- Did not revert wave 1 on its FAIL, because the cause was a pre-existing stale apps/api/.env that reverting would not fix and that your brief puts out of scope. (nexo/runs/feature-20260916-local-db-guard/AUDIT.md)

## Perguntas
- nada a registrar.
