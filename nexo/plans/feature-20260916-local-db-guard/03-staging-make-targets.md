---
id: 03-staging-make-targets
milestone: v4.1.0
status: done
depends_on: [01-env-file-resolution]
files_modified:
  - Makefile
  - apps/web/.env.staging.example
acceptance: "given a developer on a clean checkout, when they run `make help`, `make -n back-stg`, `make -n front-stg` and `make -n migrate-stg`, then the first lists `stg`, `back-stg` and `front-stg`, the second prints `SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev`, the third prints `pnpm --filter @fxl-sales/web dev --mode staging`, the fourth fails with `No rule to make target`, and `make -n db-reset` shows a host-announcement line that contains no user, no password and no URL"
goal: Give staging its own explicit, named make targets, deny it a migration target, and make `db-reset` say out loud which database host it is about to migrate.
must_not_break:
  - "`make dev`, `make front`, `make back` keep their exact current behaviour and recipes."
  - "`make help` keeps rendering every existing target (the `^[a-zA-Z_-]+:.*?## ` grep must still match every touched line)."
  - "`make -n db-reset` and `make db-reset` output must never contain a database user, password or full URL."
  - "No tracked file gains a real credential, a remote host or a remote database URL."
  - "`git status --porcelain` shows no `.env` and no `.env.staging`."
  - "`pnpm run lint`, `pnpm run type-check`, `pnpm run test` stay green (this slice touches no TypeScript)."
rules:
  - "NEVER read, copy, move or quote the contents of `apps/api/.env.staging`. Its existence is all you may rely on."
  - "NEVER run `make db-reset`, `make migrate`, `make stg`, `make back-stg` or `make front-stg`. Verification is `make -n` and `make help` only."
  - "NEVER set `SALES_ENV_FILE` in any command, shell, test or file. It appears exactly once in the repo as an ASSIGNMENT THAT REACHES A PROCESS: the literal inside the `back-stg` recipe. Other occurrences are not assignments and are expected - the `stg` menu prints it as a printf LABEL, and slice 01 documents it as a `#` COMMENT in three `.env.*.example` files."
  - "Do NOT create `migrate-stg`. Do NOT touch `.gitignore`. Do NOT add an npm dependency or a new CLI tool."
  - "Do NOT touch `apps/api/src/db/local-database-guard.ts`, `apps/api/src/db/__tests__/*`, `apps/api/src/server.ts` or `apps/api/src/db/migrate.ts` - those belong to slice 02, running in the same wave."
  - "`apps/web/.env.staging.example` carries SHAPE ONLY: every value is a placeholder or empty."
verifier_focus: "Prove by `make -n` and `make help` that the three staging targets exist with the exact recipes, that `migrate-stg` does not exist, and that the db-reset announcement leaks no credential."
---


> # ADDENDUM - AUTHORITATIVE, from the plan-check. Two verifier repairs.
>
> **V8 is wrong as written and would FAIL a correct implementation.** It asserts
> `grep -c 'SALES_ENV_FILE' Makefile` == 1. After this slice the count is **2**, because the `stg`
> menu's own `printf` label names the variable as text. Replace V8 with the assignment-scoped form:
>
> ```sh
> grep -c 'SALES_ENV_FILE=\.env\.staging pnpm' Makefile   # expect exactly 1
> ```
>
> **V5 is not discriminating on its own.** `make -n db-reset | grep -E '://|@[a-zA-Z0-9.-]+:[0-9]+'`
> already exits 1 on the UNCHANGED Makefile, so it proves the new line leaks nothing but would pass
> just as happily if the line were never added. Pair it with the presence check this plan already
> names in §7, and treat the PAIR as the oracle:
>
> ```sh
> grep -c 'db-reset: migrations will target host' Makefile   # expect exactly 1
> ```
>
> The frontmatter rule about `SALES_ENV_FILE` has been corrected in place: the ban is on an
> ASSIGNMENT that reaches a process, not on the string appearing.

# 03 - staging make targets

## 0. Wave-collision statement (read first)

This slice runs in the SAME WAVE as `02-local-database-guard`. Slice 02 owns
`apps/api/src/db/local-database-guard.ts`, `apps/api/src/db/__tests__/*`,
`apps/api/src/server.ts` and `apps/api/src/db/migrate.ts`.

**This plan needs NONE of those files.** `files_modified` is exactly two paths, and neither
overlaps slice 02:

- `Makefile`
- `apps/web/.env.staging.example` (new)

If, while executing, you believe you need to edit any slice-02 file, STOP and say so loudly in
`AUDIT.md` instead of editing it quietly.

Note also: `.gitignore` is deliberately **not** in `files_modified`. See section 4.

---

## 1. Findings from the codebase (already verified - do not re-derive)

### 1.1 `apps/web` and `--mode staging`

`apps/web/vite.config.ts` is `defineConfig(({ mode }) => { const env = loadEnv(mode, __dirname); ... })`.
`mode` is used for exactly one thing: `loadEnv`. Nothing in the config branches on the mode string -
there is no `if (mode === 'production')`, no mode-keyed plugin, no mode-keyed base path. The only
consumers of the loaded env are the dev-server proxy target
(`env.VITE_AUTH_PROXY_TARGET || env.VITE_API_URL || 'http://localhost:3006'`).

**Conclusion: `--mode staging` needs NOTHING beyond the env file.** Vite will read
`apps/web/.env.staging` (plus `.env.staging.local`, `.env`, `.env.local`) for `VITE_`-prefixed keys,
and `import.meta.env.MODE` becomes `"staging"`. `server.port` stays 8006 because it is hard-coded in
the config and not env-driven - so do NOT advertise a different port anywhere in the new targets.

### 1.2 `pnpm` argument forwarding - the `--` trap

The house style in `lint-fix` is `pnpm run lint -- --fix`. **That style must NOT be copied for
`front-stg`.** Measured on this repo (pnpm 10.17.1):

```
$ pnpm --filter @fxl-sales/web type-check -- --version
error TS5023: Unknown compiler option '--'.

$ pnpm --filter @fxl-sales/web type-check --version
> tsc --noEmit --version
Version 5.9.3
```

pnpm 10 forwards `--` through to the script verbatim instead of consuming it. So the correct,
working form is **without** `--`:

```
pnpm --filter @fxl-sales/web dev --mode staging
```

which resolves to `vite --mode staging`. The `pnpm --filter @fxl-sales/web ...` shape matches
`front` exactly, which is the part of the house style that matters. (The pre-existing `lint-fix`
line is out of scope for this slice - do not "fix" it here.)

**Decision: `front-stg` goes through `pnpm --filter @fxl-sales/web`, matching `front`. It does not
call `vite` directly.** Calling `vite` directly would bypass the workspace bin resolution that every
other target in this Makefile relies on.

### 1.3 Does any test read the `Makefile`?

No. Verified: `grep -rln "Makefile" --include=*.ts --include=*.mjs --include=*.js --include=*.tsx
--include=*.json .` (excluding `node_modules`, `.git`, `nexo`, `dist`) returns **zero hits**.
`scripts/__tests__/` contains only `no-legacy-auth.test.mjs` and `no-legacy-env-names.test.mjs`, and
the root `test` script runs only those two plus `no-legacy-auth.mjs`,
`no-legacy-env-names.mjs` and `build-contract.mjs`.

**So this slice's oracle is necessarily thin, and this plan says so plainly.** Do NOT invent a
Makefile-parsing test here; slice 04 (`structural-guard`) is the slice that owns tracked structural
assertions, and its stated scope is the two API entrypoints, not the Makefile.

What CAN be asserted mechanically, by hand, at verification time:

| # | Command | Expected |
| - | ------- | -------- |
| V1 | `make help` | lists `stg`, `back-stg`, `front-stg` with their `##` text |
| V2 | `make -n back-stg` | contains `SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev` |
| V3 | `make -n front-stg` | contains `pnpm --filter @fxl-sales/web dev --mode staging` |
| V4 | `make -n migrate-stg` | fails, `No rule to make target 'migrate-stg'` |
| V5 | `make -n db-reset` | first recipe line is the `node -e` announcement; output contains no `@`, no `://`, no password |
| V6 | `make -n dev` / `-n front` / `-n back` | byte-identical to before the change |
| V7 | `git check-ignore -v apps/web/.env.staging apps/api/.env.staging` | both ignored |
| V8 | `grep -c 'SALES_ENV_FILE' Makefile` | exactly `1` |

What CANNOT be asserted mechanically in this slice:

- That `make stg` menu actually dispatches (it blocks on `read`; running it is manual).
- That `make back-stg` actually boots against staging - that requires the live staging credential and
  is explicitly forbidden on this run.
- That `db-reset` refuses a remote host - that is slice 02's guard and slice 02's test, not this one.
- That `make front-stg` renders - requires a browser and a running API.

Record this honestly in the slice report. A thin oracle stated out loud is better than a fat oracle
that lies.

### 1.4 `.gitignore` coverage - PROVEN, not assumed

Current lines 9-13 of `.gitignore`:

```
# Real staging credentials. `.env.staging` is loaded BY NAME (see `make stg`),
# never as a default, and it holds a live database URL. The committed shape
# lives in .env.staging.example instead.
.env.staging
**/.env.staging
```

Proof of coverage, run on this checkout (git 2.54.0):

```
$ git check-ignore -v apps/web/.env.staging apps/api/.env.staging .env.staging
.gitignore:13:**/.env.staging	apps/web/.env.staging
.gitignore:13:**/.env.staging	apps/api/.env.staging
.gitignore:13:**/.env.staging	.env.staging
```

Both app directories are covered. `git check-ignore` names line 13 because git reports the LAST
matching pattern, not the only one.

**Is `**/.env.staging` redundant?** Yes. A gitignore pattern with no slash matches at every
directory level. Independent proof from this same file, using a pattern that has no `**` twin:

```
$ git check-ignore -v apps/api/.env apps/web/.env
.gitignore:4:.env	apps/api/.env
.gitignore:4:.env	apps/web/.env
```

Line 4 is the bare `.env`, with no `**/.env` anywhere in the file, and it ignores `.env` two
directories deep. Therefore the bare `.env.staging` on line 12 already covers
`apps/api/.env.staging` and `apps/web/.env.staging` on its own, and line 13 adds nothing.

**Recommendation: LEAVE `.gitignore` ALONE in this slice. Do not remove line 13, do not add
anything.** Justification:

1. Coverage is already proven above. Removing a redundant line buys zero safety and costs a
   re-proof on a file whose failure mode is "a live credential gets committed". The asymmetry of
   that risk is the whole reason this feature exists.
2. The redundancy is a deliberate-looking house pattern, not an accident: lines 7-8 are the exact
   same pair (`.env.test` / `**/.env.test`). Deleting one half of one pair and leaving the other
   pair intact makes the file *less* consistent, not more.
3. `.gitignore` is a single shared file; keeping it out of `files_modified` removes a merge-conflict
   surface in a wave where slice 02 is landing concurrently.

If a future cleanup wants to de-duplicate, it should de-duplicate **both** pairs in one dedicated
change, re-running `git check-ignore -v` on all four paths afterwards. That is not this slice.

The executor MUST still run V7 above after the change and paste the output into the slice report, so
that coverage stays proven rather than assumed.

---

## 2. The `db-reset` host announcement - design

### 2.1 What it must do

`db-reset` chains `$(MAKE) migrate`, and that chain is what carried DDL to staging. Slice 02 makes
`migrate` *refuse* a remote host. This slice makes `db-reset` *say* which host it is about to hand
to `migrate`, **before** it destroys anything - so the developer sees the answer while the prompt is
still theirs to abort.

### 2.2 Constraints and how they are met

| Constraint | How |
| ---------- | --- |
| No credential in normal output | The script prints only `hostname:port`, built from `new URL(...)`. `u.username` and `u.password` are never referenced. |
| No credential in `make -n` | `make -n` echoes the **recipe text**, not its runtime values. The recipe contains no `$(...)` make-expansion and no `$$VAR` shell expansion - it is a self-contained `node -e` script whose text holds no secret. Verified below. |
| No new tooling | `node` is already required (`engines.node >= 20`, every target shells into `pnpm`/`tsx`). `new URL` and `fs` are core. Zero new dependencies. |
| Robust to a missing/garbage value | Falls back to an explicit `(unknown - ...)` string rather than crashing the target. |

### 2.3 Why `node`, and not a shell one-liner

A `sed`/`awk` URL split is possible but is exactly the kind of thing that leaks: any regex that
isolates the host has to first match past `user:password@`, and one mis-anchored group prints the
credential. `new URL()` parses the URL properly and lets us name `hostname` and `port` and *only*
those two fields. `node` is already present, so this is dependency-light and the honest choice.
**Do not substitute `psql`, `docker run`, `python`, `jq` or `yq` - none is guaranteed present and
none is needed.**

### 2.4 Precedence, and one honest gap

dotenv does not override an already-set process variable, so the script checks
`process.env.DATABASE_URL` first, then falls back to the `DATABASE_URL=` line in `apps/api/.env`
(last occurrence wins, matching dotenv-ish behaviour closely enough for an advisory line).

**Stated gap, accepted:** the script deliberately does NOT consult `SALES_ENV_FILE`. The hard
constraint on this run is that `SALES_ENV_FILE` appears in exactly one place in the repo - the
`back-stg` recipe. So if a developer exports `SALES_ENV_FILE` by hand and then runs `db-reset`, this
line could name the wrong host. That is acceptable because **this line is an informational
pre-flight, not the enforcement.** The enforcement is slice 02's guard inside `migrate.ts`, which
refuses by exit code. Write this sentence into the Makefile comment so nobody mistakes the
announcement for a guard.

### 2.5 Verified output

Run on this checkout, with `apps/api/.env` pointing at local Postgres:

```
db-reset: migrations will target host localhost:5006
```

And the `make -n` form, validated by piping an equivalent Makefile into `make -f - -n db-reset`,
prints the script text and `docker compose down db -v` - **no credential, no URL, no user.**

---

## 3. EXACT Makefile edits

Four edits. Apply them in this order.

### Edit 3.1 - the `.PHONY` line

Replace the existing five-line `.PHONY` block at the very top of the file:

```make
.PHONY: dev front back install setup setup-no-db build build-shared build-web build-api \
       lint lint-fix type-check check \
       migrate db-up db-down db-reset docker-up docker-down docker-build \
       clean preview help doctor
```

with (the only change is `stg back-stg front-stg` appended to the first continuation line; keep the
7-space continuation indent exactly as-is):

```make
.PHONY: dev front back stg back-stg front-stg install setup setup-no-db build build-shared build-web build-api \
       lint lint-fix type-check check \
       migrate db-up db-down db-reset docker-up docker-down docker-build \
       clean preview help doctor
```

### Edit 3.2 - the three staging targets

Insert this block **immediately after the existing `back` target** and **immediately before the
`# --- Setup ---` header**. Keep exactly one blank line before and after the block. Recipe lines are
TAB-indented (this Makefile uses real tabs - do not emit spaces).

```make
# --- Staging ---
#
# Staging is opt-in BY NAME and never by default. `back-stg` names
# apps/api/.env.staging through SALES_ENV_FILE; `front-stg` names
# apps/web/.env.staging through vite's --mode. Both files are gitignored and
# hold real values; the committed shapes are the .env.staging.example files.
#
# There is deliberately NO `migrate-stg` target, and none is to be added.
# Applying DDL to staging is a DEPLOY step, run by the deploy pipeline against
# the deploy's own credentials - not a target sitting one typo away from
# `make migrate` on a developer's machine. If you came here to add it: don't.

stg: ## Interactive app selector for STAGING - pick api or web to run
	@printf "Which app do you want to run against STAGING?\n"
	@printf "  1) api     (SALES_ENV_FILE=.env.staging)\n"
	@printf "  2) web     (vite --mode staging)\n"
	@printf "Selection [1-2]: "
	@read choice; \
	case "$$choice" in \
		1) $(MAKE) back-stg ;; \
		2) $(MAKE) front-stg ;; \
		*) echo "Invalid choice: $$choice"; exit 1 ;; \
	esac

front-stg: ## Run only the frontend against staging (reads apps/web/.env.staging)
	pnpm --filter @fxl-sales/web dev --mode staging

back-stg: build-shared ## Run only the API against staging (reads apps/api/.env.staging)
	SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev
```

Notes for the executor, none of them optional:

- The order `stg`, then `front-stg`, then `back-stg` deliberately mirrors the existing
  `dev` / `front` / `back` ordering.
- `back-stg` carries the `build-shared` prerequisite because `back` does. `front-stg` carries none
  because `front` carries none.
- `SALES_ENV_FILE=.env.staging` is a **shell** variable assignment prefixing the command - not a
  make `export`, not a make variable. It must not be quoted and must not use `$(...)`.
- The value `.env.staging` is written **relative**, because slice 01 resolves `SALES_ENV_FILE`
  against `apps/api`. Do not write `apps/api/.env.staging` here.
- Do not print a port for either staging target. The API port comes from the staging env file (which
  you may not read) and vite's port is the hard-coded 8006 regardless of mode. Saying a number you
  cannot prove is exactly the failure mode this whole feature exists to kill.
- After this edit, `grep -c 'SALES_ENV_FILE' Makefile` must return `1`.

### Edit 3.3 - `db-reset` announces its host

Replace the existing `db-reset` target, in place, in the `# --- Database ---` section:

```make
db-reset: ## Destroy and recreate database volume
	docker compose down db -v
	docker compose up db -d
	@echo "Waiting for PostgreSQL..."
	@sleep 3
	$(MAKE) migrate
```

with:

```make
# db-reset chains `migrate`, and that chain is what once carried DDL to staging.
# The line below is an ANNOUNCEMENT, not a guard: it prints the host that
# `migrate` is about to receive, before anything is destroyed, so a wrong host is
# visible while the prompt is still yours to abort. The enforcement lives in
# apps/api/src/db/migrate.ts and refuses by exit code. Host and port only - never
# a user, never a password, never the whole URL.
db-reset: ## Destroy and recreate database volume (announces the target host first)
	@node -e 'const fs=require("fs");const p="apps/api/.env";let host="(unknown - no DATABASE_URL in environment or apps/api/.env)";try{let raw=process.env.DATABASE_URL||"";if(!raw){const line=fs.readFileSync(p,"utf8").split("\n").map(s=>s.trim()).filter(s=>s.startsWith("DATABASE_URL=")).pop();if(line)raw=line.slice(13).trim().replace(/"/g,"");}if(raw){const u=new URL(raw);host=u.hostname+":"+(u.port||"5432");}}catch(e){host="(unknown - DATABASE_URL unreadable or unparseable)";}console.log("db-reset: migrations will target host "+host);'
	docker compose down db -v
	docker compose up db -d
	@echo "Waiting for PostgreSQL..."
	@sleep 3
	$(MAKE) migrate
```

Mechanical warnings for the executor:

- The `node -e` script is **one single line**. Do not reformat it, do not wrap it, do not add
  backslash continuations. A line break inside it breaks the shell quoting.
- The script is wrapped in **single** quotes and uses **double** quotes internally. It contains
  **zero** `$` characters on purpose - so there is nothing for make to expand and nothing to escape
  as `$$`. If you edit it, keep it `$`-free; the moment you write `$(DATABASE_URL)` you have made
  `make -n` print the credential.
- `13` in `line.slice(13)` is `"DATABASE_URL=".length`. Leave it.
- The line is TAB-indented and prefixed with `@`, matching the other quiet lines in this file.
- It is the FIRST recipe line, before `docker compose down db -v`. "Before it acts" is literal.

### Edit 3.4 - nothing else

Do not touch `dev`, `front`, `back`, `migrate`, `help` or any other target. `make help`'s grep
(`^[a-zA-Z_-]+:.*?## `) already matches `stg:`, `front-stg:` and `back-stg:` - hyphens are in its
character class - and the `%-15s` column is wide enough for the 9-character `front-stg`. No change
to `help` is needed or permitted.

---

## 4. EXACT new file: `apps/web/.env.staging.example`

`vite --mode staging` reads `apps/web/.env.staging`, which is gitignored (proven in 1.4). This file
is the committed SHAPE of that gitignored file. It carries placeholders only.

Create `apps/web/.env.staging.example` with exactly this content (note it mirrors the section
headers and comments of `apps/web/.env.example`, and follows the `apps/web/.env.dev.example`
convention of naming itself on line 1):

```
# apps/web/.env.staging.example
#
# SHAPE ONLY. Copy to apps/web/.env.staging and fill in the real staging values.
# apps/web/.env.staging is gitignored and is read by `make front-stg`
# (vite --mode staging). Never commit a filled-in copy.

# --- API ---
VITE_API_URL=
VITE_AUTH_PROXY_TARGET=
VITE_AUTH_BFF_BASE_PATH=

# --- Auth (FXL Hub public config) ---
VITE_FXL_HUB_API_URL=
# The browser holds NO key as of @fxl-business/hub-sdk 2.2.0. The Client is named
# by audience plus environment, and createHubClient throws if handed a secret.
VITE_FXL_HUB_ENVIRONMENT=staging
VITE_FXL_HUB_AUDIENCE=app.fxl-sales

# --- Observability (optional) ---
VITE_SENTRY_DSN=
```

Why these two values are NOT blank:

- `VITE_FXL_HUB_ENVIRONMENT=staging` - this is the shape's discriminator, a fixed enum member, not a
  secret and not an address. Blanking it would make the file ambiguous about what it is for.
- `VITE_FXL_HUB_AUDIENCE=app.fxl-sales` - the app's own identifier, already committed verbatim in
  `apps/web/.env.example` and `apps/web/.env.dev.example`. Not a secret.

Every value that is a **host, URL or credential** is empty. That is the line this file must not
cross.

**Do NOT create `apps/api/.env.staging.example` in this slice.** The api-side named-file shape
belongs to slice 01 (`env-file-resolution`), which owns `SALES_ENV_FILE` and the api env story.
Creating it here would collide across slices. If slice 01 did not create it, raise it in the slice
report; do not fix it here.

---

## 5. Execution order

1. Edit 3.1 - `.PHONY`.
2. Edit 3.2 - the `# --- Staging ---` block after `back`.
3. Edit 3.3 - `db-reset`.
4. Create `apps/web/.env.staging.example` (section 4).
5. Run the verification table in 6. Paste raw output into the slice report.

No step depends on slice 02. Step 1-3 depend on slice 01 only for `SALES_ENV_FILE` to *mean*
something at runtime; the Makefile text itself compiles and dry-runs regardless.

---

## 6. Verification - exact commands, exact expectations

Run from the repo root. **None of these executes a migration, a reset or a staging boot.**

```
make help
```
Expect three new rows:
```
stg             Interactive app selector for STAGING - pick api or web to run
front-stg       Run only the frontend against staging (reads apps/web/.env.staging)
back-stg        Run only the API against staging (reads apps/api/.env.staging)
```

```
make -n back-stg
```
Expect, among the `build-shared` lines:
```
SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev
```

```
make -n front-stg
```
Expect exactly:
```
pnpm --filter @fxl-sales/web dev --mode staging
```

```
make -n migrate-stg
```
Expect a **failure**:
```
make: *** No rule to make target `migrate-stg'.  Stop.
```
A non-zero exit here is the PASS.

```
make -n db-reset
```
Expect the `node -e '...'` line first, then `docker compose down db -v`. Then assert the absence of a
credential shape in the dry run:
```
make -n db-reset | grep -E '://|@[a-zA-Z0-9.-]+:[0-9]+' ; echo "grep exit=$?"
```
Expect `grep exit=1` (no match). A match is a FAIL.

```
grep -c 'SALES_ENV_FILE' Makefile
```
Expect `1`.

```
git check-ignore -v apps/web/.env.staging apps/api/.env.staging
```
Expect both listed as ignored. Paste the output verbatim into the report.

```
git status --porcelain
```
Expect `Makefile` modified and `apps/web/.env.staging.example` untracked-new, and **no** `.env` or
`.env.staging` of any kind.

```
pnpm run lint && pnpm run type-check
```
Expect green. This slice touches no TypeScript, so any failure here is pre-existing or slice 02's -
report it, do not fix it here.

**Explicitly NOT run, and forbidden:** `make db-reset`, `make migrate`, `make stg`, `make back-stg`,
`make front-stg`, and any command that sets `SALES_ENV_FILE`.

---

## 7. Anticipated snags

- **Tabs.** This Makefile uses real tab indentation. An editor that expands tabs will produce
  `missing separator` errors. If `make -n stg` says `missing separator`, the indentation is spaces.
- **The `node -e` line getting reflowed.** Any auto-formatter or a manual line-wrap breaks it.
  Confirm with `grep -c "db-reset: migrations will target host" Makefile` returning `1` and
  `awk '/node -e/{print NR}' Makefile` returning a single line number.
- **Temptation to add `--` to `front-stg`.** Measured and rejected in 1.2. pnpm 10 forwards it.
- **Temptation to add `migrate-stg` "for symmetry".** The comment in Edit 3.2 exists precisely to
  stop that. Symmetry is not a reason to ship a foot-gun.
- **Temptation to "tidy" `.gitignore`.** Rejected in 1.4 with proof. Leave it.
