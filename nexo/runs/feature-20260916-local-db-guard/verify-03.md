# Verify 03 - staging-make-targets (Gate 2)

Branch under test: `feat/03-staging-make-targets`.
Base: `master`.
Verdict: **PASS**.

Diff read with `git diff master...feat/03-staging-make-targets -- . ':(exclude)nexo'`.
Two files changed: `Makefile` (modified) and `apps/web/.env.staging.example` (new).
Nothing under `nexo/runs/` was read.

---

## 1. `make help`

```
$ make help
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
EXIT:0
```

`stg`, `front-stg`, `back-stg` are listed. Column alignment survives the 9-character `front-stg`.

### "Nothing was lost" - PROVEN by row-set comparison

```
$ git show master:Makefile | grep -E '^[a-zA-Z_-]+:.*?## '
dev / front / back / install / setup / setup-no-db / build / build-shared / build-web /
build-api / lint / lint-fix / type-check / check / doctor / migrate / db-up / db-down /
db-reset / docker-up / docker-down / docker-build / preview / clean / help      (25 rows)

$ grep -E '^[a-zA-Z_-]+:.*?## ' Makefile
...the same 25 names, plus stg / front-stg / back-stg                           (28 rows)
```

Set difference master → branch is exactly `{stg, front-stg, back-stg}` added, **nothing removed**.
The one row whose help TEXT changed is `db-reset`
(`Destroy and recreate database volume` → `... (announces the target host first)`), which the plan
mandates in Edit 3.3. The target itself is still present and still matched by the `help` grep.

## 2. `make -n back-stg`

```
$ make -n back-stg
pnpm --filter @fxl-sales/shared-types build
pnpm --filter @fxl-sales/shared-utils build
SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev
EXIT:0
```

Exact expected line present. The two `build-shared` lines are the inherited prerequisite, matching
`back`.

## 3. `make -n front-stg`

```
$ make -n front-stg
pnpm --filter @fxl-sales/web dev --mode staging
EXIT:0
```

Exactly as specified. No `--` separator (the pnpm-10 trap the plan measured).

## 4. `make -n migrate-stg`

```
$ make -n migrate-stg
make: *** No rule to make target `migrate-stg'.  Stop.
EXIT:2
```

Non-zero exit with `No rule to make target`. PASS.

## 5. `make -n db-reset` - full verbatim output

```
$ make -n db-reset
node -e 'const fs=require("fs");const p="apps/api/.env";let host="(unknown - no DATABASE_URL in environment or apps/api/.env)";try{let raw=process.env.DATABASE_URL||"";if(!raw){const line=fs.readFileSync(p,"utf8").split("\n").map(s=>s.trim()).filter(s=>s.startsWith("DATABASE_URL=")).pop();if(line)raw=line.slice(13).trim().replace(/"/g,"");}if(raw){const u=new URL(raw);host=u.hostname+":"+(u.port||"5432");}}catch(e){host="(unknown - DATABASE_URL unreadable or unparseable)";}console.log("db-reset: migrations will target host "+host);'
docker compose down db -v
docker compose up db -d
echo "Waiting for PostgreSQL..."
sleep 3
/Library/Developer/CommandLineTools/usr/bin/make migrate
pnpm --filter @fxl-sales/api db:migrate
EXIT:0
```

`make db-reset` was **NEVER** run. Dry run only.

### Leak check (the pair, as the ADDENDUM requires)

```
$ make -n db-reset | grep -E '://|@[a-zA-Z0-9.-]+:[0-9]+'
GREPEXIT:1          # no match

$ grep -c 'db-reset: migrations will target host' Makefile
1
```

Both halves hold: the announcement line is present exactly once (so the grep is not vacuous), and
the dry run contains no URL and no `host:port` credential shape.

## 6. Assignment-scoped `SALES_ENV_FILE` count (V8, per ADDENDUM)

```
$ grep -c 'SALES_ENV_FILE=\.env\.staging pnpm' Makefile
1
```

## 7. `dev` / `back` / `front` unchanged - compared against master's own Makefile

```
$ git show master:Makefile > /tmp/mf-master
```

| target | branch | master (`make -f /tmp/mf-master -n …`) | identical |
| --- | --- | --- | --- |
| `front` | `pnpm --filter @fxl-sales/web dev` (EXIT 0) | same (EXIT 0) | yes |
| `back` | 2× `build-shared` lines + `pnpm --filter @fxl-sales/api dev` (EXIT 0) | same (EXIT 0) | yes |
| `dev` | 4 printf lines + the `read choice; case …` block, then `Invalid choice:` / `make: *** [dev] Error 1`, EXIT 2 | byte-for-byte the same, EXIT 2 | yes |

`dev`'s EXIT 2 is the documented PRE-EXISTING behaviour (`read` hits EOF under `-n`), and it is
**identical on both sides**. Not a defect and not introduced by this slice.

## 8. `pnpm run lint` / `pnpm run type-check`

```
$ pnpm run lint
LINTEXIT:0
apps/api lint: Done
apps/web lint: Done

$ pnpm run type-check
TCEXIT:0
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

Both green. This slice touches no TypeScript, so this is a no-regression confirmation.

## 9. gitignore coverage

```
$ git check-ignore -v apps/web/.env.staging apps/api/.env.staging
.gitignore:13:**/.env.staging	apps/web/.env.staging
.gitignore:13:**/.env.staging	apps/api/.env.staging
EXIT:0
```

Both paths ignored. Coverage remains proven, not assumed.

---

# Properties A-J

**A - `.gitignore` untouched. HOLDS.**
`git diff --name-only master...feat/03-staging-make-targets -- . ':(exclude)nexo'` returns exactly
`Makefile` and `apps/web/.env.staging.example`. `git diff master...HEAD -- .gitignore` is empty.

**B - `apps/web/.env.staging.example` is SHAPE ONLY. HOLDS.**
Full content read. Every host, URL, credential and token value is EMPTY:
`VITE_API_URL=`, `VITE_AUTH_PROXY_TARGET=`, `VITE_AUTH_BFF_BASE_PATH=`, `VITE_FXL_HUB_API_URL=`,
`VITE_SENTRY_DSN=` — all blank.
The only two populated values are `VITE_FXL_HUB_ENVIRONMENT=staging` (a fixed enum member) and
`VITE_FXL_HUB_AUDIENCE=app.fxl-sales` (the app's own public identifier, already committed verbatim
in `apps/web/.env.example`, and the value `CLAUDE.md` documents as the audience). Neither is a
hostname, a key or a secret. **No real staging hostname, no key, no secret anywhere in the file.**

**C - no `migrate-stg` target, and a comment says why. HOLDS.**
`grep -n 'migrate-stg' Makefile` → line 35 only, inside a comment:
`# There is deliberately NO `migrate-stg` target, and none is to be added.` followed by three lines
explaining that staging DDL is a deploy step. No target of that name exists (proved by V4).

**D - the announcement prints host:port ONLY. HOLDS.**
Read character by character. The script names exactly two URL fields: `u.hostname` and `u.port`
(with a `"5432"` default). `grep -c 'u\.username\|u\.password' Makefile` → **0**. There is no
`u.href`, no `u.host` with credentials, no raw `raw` printed anywhere — `raw` is only ever fed to
`new URL`. The `catch` fallbacks are fixed literal strings.
`$`-free: `awk '/node -e/{print (index($0,"$")==0)?…}'` → **NO-DOLLAR**. Nothing for make to expand,
which is why `make -n` can print the recipe text safely.

**E - it is the FIRST recipe line. HOLDS.**
```
db-reset: ## Destroy and recreate database volume (announces the target host first)
	@node -e '…'
	docker compose down db -v
	…
```
The `node -e` line precedes `docker compose down db -v`, so it prints before anything is destroyed.
Confirmed twice: by reading the file and by the `make -n` ordering in §5.

**F - fresh clone with no `apps/api/.env`. HOLDS - the target is not broken.**
Tested safely by extracting the exact `node -e` script and running it in a fresh `mktemp -d` where
`apps/api/.env` does not exist, with `DATABASE_URL` unset (`env -u DATABASE_URL`). `make db-reset`
was not run.
```
$ cd "$(mktemp -d)" && env -u DATABASE_URL node -e '…the exact script…'
db-reset: migrations will target host (unknown - DATABASE_URL unreadable or unparseable)
EXIT:0
```
Exit 0, no throw. `db-reset` still works on a fresh clone; the announcement degrades to an honest
"unknown" line.
Cosmetic finding (not a defect, does not affect any acceptance criterion): the *other* fallback
string, `(unknown - no DATABASE_URL in environment or apps/api/.env)`, is unreachable in the
missing-file case, because `readFileSync` throws and the `catch` overwrites `host` with the
"unreadable or unparseable" wording. Both messages are truthful and neither leaks anything; only the
nuance between them is lost.

**G - `SALES_ENV_FILE` occurrences in the Makefile. HOLDS.**
```
$ git grep -n 'SALES_ENV_FILE' -- Makefile
Makefile:31:# apps/api/.env.staging through SALES_ENV_FILE; `front-stg` names
Makefile:42:	@printf "  1) api     (SALES_ENV_FILE=.env.staging)\n"
Makefile:56:	SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev
```
Classification: line 31 is a `#` COMMENT (mandated verbatim by plan Edit 3.2's block comment);
line 42 is the `stg` menu's printf LABEL; line 56 is the ONE assignment that reaches a process.
Exactly one assignment. The plan's frontmatter rule bans an assignment, not the string, and
explicitly expects the non-assignment occurrences; line 31 is text the plan itself dictates.
No command run during this verification set `SALES_ENV_FILE`.

**H - no forbidden host or credential in the diff. HOLDS.**
`git diff master...HEAD -- . ':(exclude)nexo' | grep -nE 'fxl-db-server|tail89bca3\.ts\.net|100\.81\.240\.91|password|postgres://|postgresql://'`
returns exactly one line:
`58:+# a user, never a password, never the whole URL.`
— the word "password" inside the explanatory comment. No host, no tailnet name, no IP, no
connection string, no credential.

**I - `git status --porcelain`. HOLDS.**
```
 M nexo/runs/feature-20260916-local-db-guard/budget.json
?? .vscode/
?? nexo/runs/feature-20260916-local-db-guard/agents/exec-02.result.json
?? nexo/runs/feature-20260916-local-db-guard/agents/exec-03.result.json
?? nexo/runs/feature-20260916-local-db-guard/agents/verify-02.result.json
?? nexo/runs/feature-20260916-local-db-guard/exec-02-notes.md
?? nexo/runs/feature-20260916-local-db-guard/exec-03-notes.md
?? nexo/runs/feature-20260916-local-db-guard/verify-02.md
```
No `.env` and no `.env.staging` of any kind. All entries are `nexo/` run bookkeeping plus an
untracked `.vscode/` that predates this slice.

**J - `.PHONY` and `##` help comments. HOLDS.**
```
.PHONY: dev front back stg back-stg front-stg install setup setup-no-db build build-shared build-web build-api \
       lint lint-fix type-check check \
       migrate db-up db-down db-reset docker-up docker-down docker-build \
       clean preview help doctor
```
All three new targets are in `.PHONY`; the continuation indent and the other three lines are
unchanged. All three carry `##` help text (rendered in §1).

Additional structural confirmations: recipe lines are real TABs (`grep -n '^<TAB>'` matches);
`awk '/node -e/{print NR}' Makefile` → a single line number, **120**, so the one-line script was not
reflowed.

---

# Findings (non-blocking)

1. **Thin oracle, as stated by the plan.** No tracked test reads the `Makefile`, so every property
   above is asserted by `make -n`, `make help`, `grep` and reading. This is a known and
   plan-declared limitation of the slice, not a defect.
2. **Not mechanically assertable here, and not asserted:** that `make stg`'s menu actually
   dispatches (it blocks on `read`); that `make back-stg` boots against staging (forbidden on this
   run); that `make front-stg` renders; that `db-reset` refuses a remote host (that is slice 02's
   guard and slice 02's test).
3. **Cosmetic:** the unreachable first fallback string described under F.
4. **Observation, not a fault:** `make -n db-reset` expands `$(MAKE) migrate` and recurses into
   `pnpm --filter @fxl-sales/api db:migrate`, which is GNU make's documented `-n` behaviour for a
   `$(MAKE)` line and is identical on master.

# Verdict

**PASS.** Checks 1-9 are all as specified and properties A-J all hold. Lint and type-check are
green. Nothing was destroyed, no migration ran, no staging boot was attempted, no database was
contacted, and `SALES_ENV_FILE` was never set.
