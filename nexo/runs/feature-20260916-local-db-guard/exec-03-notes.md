# exec-03 - staging make targets

Branch: `feat/03-staging-make-targets`. Files touched: `Makefile`, `apps/web/.env.staging.example` (new).
`.gitignore` untouched, as the plan directed.

## What landed

1. `.PHONY` first continuation line gained `stg back-stg front-stg` (7-space continuation indent preserved).
2. A `# --- Staging ---` block between `back` and `# --- Setup ---`, carrying the "there is deliberately
   NO `migrate-stg`" comment, then `stg`, `front-stg`, `back-stg` in that order.
3. `db-reset` gained the `@node -e '...'` host announcement as its FIRST recipe line, preceded by the
   announcement-not-a-guard comment block. The one-liner is on Makefile line 120 and is `$`-free.
4. `apps/web/.env.staging.example` - shape only; every host/URL/credential value empty.

## Verification (all run from repo root; nothing executed against any database)

### `make help` - three new rows, every pre-existing row still present

```
dev             Interactive app selector - pick api or web to run
front           Run only the frontend
back            Run only the API
stg             Interactive app selector for STAGING - pick api or web to run
front-stg       Run only the frontend against staging (reads apps/web/.env.staging)
back-stg        Run only the API against staging (reads apps/api/.env.staging)
install         Install all dependencies
setup           One-shot bootstrap (preflight + rename + .env + install + db). Auto-detects new-project vs new-dev mode.
setup-no-db     Same as `setup` but skips starting Postgres (use when Docker isn't running)
build           Build everything
build-shared    Build shared workspace packages
build-web       Build frontend
build-api       Build API
lint            Lint all workspaces
lint-fix        Lint and auto-fix
type-check      Type check all workspaces
check           Run lint + typecheck
doctor          Run the FXL health check
migrate         Run database migrations
db-up           Start PostgreSQL only
db-down         Stop PostgreSQL
db-reset        Destroy and recreate database volume (announces the target host first)
docker-up       Start all services (API + PostgreSQL)
docker-down     Stop all services
docker-build    Rebuild Docker images
preview         Preview production build locally
clean           Remove all node_modules and build artifacts
help            Show this help
```

Row count before: 25. After: 28. The only delta is the three new rows plus `db-reset`'s amended `##` text.

### `make -n back-stg`

```
pnpm --filter @fxl-sales/shared-types build
pnpm --filter @fxl-sales/shared-utils build
SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev
```

### `make -n front-stg`

```
pnpm --filter @fxl-sales/web dev --mode staging
```

No `--` separator, per §1.2.

### `make -n migrate-stg` - FAILS, which is the PASS

```
make: *** No rule to make target `migrate-stg'.  Stop.
exit=2
```

### `make -n db-reset` - full output, verbatim

```
node -e 'const fs=require("fs");const p="apps/api/.env";let host="(unknown - no DATABASE_URL in environment or apps/api/.env)";try{let raw=process.env.DATABASE_URL||"";if(!raw){const line=fs.readFileSync(p,"utf8").split("\n").map(s=>s.trim()).filter(s=>s.startsWith("DATABASE_URL=")).pop();if(line)raw=line.slice(13).trim().replace(/"/g,"");}if(raw){const u=new URL(raw);host=u.hostname+":"+(u.port||"5432");}}catch(e){host="(unknown - DATABASE_URL unreadable or unparseable)";}console.log("db-reset: migrations will target host "+host);'
docker compose down db -v
docker compose up db -d
echo "Waiting for PostgreSQL..."
sleep 3
/Library/Developer/CommandLineTools/usr/bin/make migrate
pnpm --filter @fxl-sales/api db:migrate
```

No user, no password, no URL. The announcement is recipe TEXT, not a runtime value, so `make -n`
cannot expand a credential into it.

Note on the last two lines: GNU make EXECUTES a recipe line containing `$(MAKE)` even under `-n`,
so the `$(MAKE) migrate` line really ran - but recursively in `-n` mode, so it only echoed
`pnpm --filter @fxl-sales/api db:migrate`. Nothing migrated. This is pre-existing behaviour and is
identical in the baseline capture below.

Credential-shape assertion:

```
$ make -n db-reset | grep -E '://|@[a-zA-Z0-9.-]+:[0-9]+' ; echo "grep exit=$?"
grep exit=1
```

Paired, per the ADDENDUM, with the presence check:

```
$ grep -c 'db-reset: migrations will target host' Makefile
1
```

### ADDENDUM V8 (assignment-scoped)

```
$ grep -c 'SALES_ENV_FILE=\.env\.staging pnpm' Makefile
1
```

(The bare `grep -c 'SALES_ENV_FILE' Makefile` would be 2, the second being the `stg` menu's printf
LABEL - exactly what the addendum predicted.)

### `awk '/node -e/{print NR}' Makefile`

```
120
```

One line. The one-liner was not reflowed.

### `make -n dev` / `-n front` / `-n back` - unchanged

`front` and `back` are byte-identical to the pre-edit capture:

```
$ make -n front
pnpm --filter @fxl-sales/web dev
$ make -n back
pnpm --filter @fxl-sales/shared-types build
pnpm --filter @fxl-sales/shared-utils build
pnpm --filter @fxl-sales/api dev
```

`make -n dev` is byte-identical too. It exits 2 both before and after the edit, for the
`$(MAKE)`-under-`-n` reason above: the `read choice` line really runs, gets EOF, and hits the
`Invalid choice` arm. Pre-existing, unchanged, and not caused by this slice. `make -n stg </dev/null`
behaves identically, which also proves the new recipe is TAB-indented (spaces would have produced
`missing separator`).

### `git check-ignore -v`

```
.gitignore:13:**/.env.staging	apps/web/.env.staging
.gitignore:13:**/.env.staging	apps/api/.env.staging
```

Coverage re-proven on this checkout. `.gitignore` was NOT modified.

### `git status --porcelain`

```
 M Makefile
 M nexo/runs/feature-20260916-local-db-guard/budget.json
?? .vscode/
?? apps/web/.env.staging.example
?? nexo/runs/feature-20260916-local-db-guard/agents/exec-02.result.json
?? nexo/runs/feature-20260916-local-db-guard/agents/verify-02.result.json
?? nexo/runs/feature-20260916-local-db-guard/exec-02-notes.md
?? nexo/runs/feature-20260916-local-db-guard/verify-02.md
```

No `.env` and no `.env.staging` of any kind. The pre-existing untracked `nexo/` and `.vscode/`
entries were there before this slice started and were NOT staged.

### `pnpm run lint` / `pnpm run type-check`

Both green (`apps/api lint: Done`, `apps/web lint: Done`; all four `type-check: Done`). This slice
touches no TypeScript.

## Honest limits of this slice's oracle (per plan §1.3)

No tracked test reads the `Makefile`, and this slice deliberately does not invent one - slice 04
owns the tracked structural guard, and its scope is the two API entrypoints. Therefore NOT proven
here, and stated rather than hidden:

- that `make stg` actually dispatches after a real keypress (it blocks on `read`);
- that `make back-stg` boots against staging (needs the live credential; forbidden on this run);
- that `db-reset` REFUSES a remote host - that is slice 02's guard and slice 02's test;
- that `make front-stg` renders.

## Prohibitions honoured

- `apps/api/.env.staging` never read, quoted, copied or moved; `apps/web/.env.staging` never created.
- `SALES_ENV_FILE` never set in any command or shell. It appears in the repo only as the `back-stg`
  recipe literal and as the `stg` printf label.
- `make db-reset`, `make migrate`, `make stg`, `make back-stg`, `make front-stg` never run.
- No `.gitignore`, no `apps/api/src/**`, no `scripts/**`, no `package.json`, no `.env` edits.
- No new dependency or CLI tool; `node` is already an engine requirement.
- No `apps/api/.env.staging.example` created here (slice 01 owns the api env story). Checked: it
  already exists in the tree, created by slice 01, so there is nothing to raise.
