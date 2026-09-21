---
id: 06-make-targets
milestone: v4.1.0
status: todo
depends_on: ["02-api-dev-adapter", "03-web-dev-identity"]
files_modified:
  - Makefile
  - apps/api/.env.example
  - apps/api/.env.dev.example
  - apps/web/.env.example
  - apps/web/.env.dev.example
  - apps/api/src/config/__tests__/env-example-contract.test.ts
acceptance:
  - "`make help` lists `dev-fake`, `back-fake`, `front-fake`, `db-seed` and `dev-fake-setup`, each with a help comment in the existing `## ` style, and the existing help alignment (`%-15s`) still renders them unclipped."
  - "`make -n dev-fake` prints a recipe that starts BOTH the API and the web dev server with the dev-fake flags set, and `make -n back-fake` / `make -n front-fake` print exactly one flagged `pnpm --filter` invocation each."
  - "`back-fake` carries the `build-shared` prerequisite, exactly as `back` and `back-stg` do; `front-fake` carries none, exactly as `front` and `front-stg`."
  - "No new target sets `SALES_ENV_FILE`. After this slice `grep -rn 'SALES_ENV_FILE=' Makefile` still returns exactly one line, the one in `back-stg`."
  - "There is no `dev-fake-stg`, no `migrate-stg`, and no target that sets a dev-fake flag alongside `SALES_ENV_FILE`, and the comment block above the new section says so in the voice of the existing staging block."
  - "All four committed `.env` examples that a fresh clone copies (`apps/api/.env.example`, `apps/api/.env.dev.example`, `apps/web/.env.example`, `apps/web/.env.dev.example`) DOCUMENT the dev-fake flag as a COMMENTED line and set no enabling value. Neither staging example mentions it at all."
  - "`apps/api/src/config/__tests__/env-example-contract.test.ts` gains one `describe` that reads all six example files and goes RED if any of them ships an enabled dev-fake flag, and RED if the documented commented line disappears from the four dev/default examples."
  - "Every pre-existing assertion in `env-example-contract.test.ts` is byte-unchanged, and `hubConfigIsAbsent` still answers `true` for both API examples."
goal: >
  Give the operator the dev-fake surface: Make targets that run the stack with development
  identities and no Hub, a database seed target beside `migrate`, a one-shot setup chain, and
  `.env` example lines that DOCUMENT both halves' flags without ever turning them on.
must_not_break:
  - "The `dev`, `front`, `back`, `stg`, `front-stg`, `back-stg`, `migrate`, `db-up`, `db-down` and `db-reset` targets stay byte-unchanged. The only edits to existing lines are the `.PHONY` list and nothing else."
  - "`back-stg` remains the ONLY `SALES_ENV_FILE` assignment in the tracked tree (CLAUDE.md, Local database guard)."
  - "`db-reset`'s announcement node one-liner and its comment block stay byte-unchanged. It is an ANNOUNCEMENT and not a guard, and nothing in this slice may chain it."
  - "`hubConfigIsAbsent` stays `true` and `tryLoadHubAuthConfig` stays `null` for both API examples: a fresh clone must still reach `503 hub_auth_not_configured` rather than a boot failure."
  - "The `FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback` and `FXL_HUB_TRUSTED_ORIGINS=http://localhost:8006` lines, and the three commented known-good identity values, survive in both API examples exactly as they are."
  - "No production path is touched. This slice adds no source file to `apps/api/src` or `apps/web/src` and changes no runtime behaviour with the flags absent."
rules:
  - "House rule: no em dash, no en dash, one full sentence per line in prose."
  - "Match the Makefile's existing conventions rather than the reference repo's: `## ` help comments, `build-shared` on API targets, `$(MAKE) target` for chaining, `@echo` for announcements."
  - "Do NOT add a `dev-fake` entry to the existing `dev` selector menu. `dev` stays byte-unchanged."
  - "Never add an enabling dev-fake value to any committed file. Documented, commented, off."
verifier_focus:
  - "Diff the Makefile and confirm the only changed pre-existing line is `.PHONY`."
  - "`grep -rn 'SALES_ENV_FILE=' Makefile` returns exactly one hit, in `back-stg`."
  - "Run the extended `env-example-contract.test.ts` and confirm the new describe is non-vacuous by checking it asserts on raw text as well as on the parsed bag."
  - "Confirm no committed file anywhere sets `SALES_AUTH_FAKE` or `VITE_AUTH_FAKE` to an enabling value: `grep -rn 'AUTH_FAKE=1' --include='.env*' .` must return nothing outside comment lines."
---

# 06 - Make targets and the `.env` example lines

## What this slice is

This is the operator-facing surface of the feature and nothing else.
Slices 02 and 03 build the two halves that READ the flags; this slice is the one place a human turns them on, plus the committed documentation of their names.

It deliberately contains no logic.
Every guard that makes dev-fake safe lives elsewhere: the devDependency placement and the dynamic import in slice 01 and 02, the `import.meta.env.DEV` fence in slice 03, the API boot refusal under `NODE_ENV=production` in slice 02, and the tracked-file guard in the guard slice.
A Make target cannot be a security boundary, and this plan never pretends otherwise.

## Flag names, and the one verification the executor must do first

The canonical names for this repository are:

- `SALES_AUTH_FAKE` for the API half.
- `VITE_AUTH_FAKE` for the web half.

The reference repository spells the API half `AUTH_FAKE`, with no prefix.
This repository does not accept an unprefixed repo-owned variable any more.
`SALES_ENV_FILE`, `SALES_POST_LOGIN_REDIRECT`, `SALES_POST_LOGIN_ERROR_REDIRECT` and `SALES_SESSION_ENCRYPTION_IKM` are all repo-owned and all carry the `SALES_` prefix, and CLAUDE.md states outright that the `FXL_HUB_` namespace now means "the SDK resolves and validates this" while everything this repo resolves itself lives outside it.
It also states, of the `SALES_ENV_FILE` mirror of the Hub's `HUB_ENV_FILE`, that "the standardization is in the PATTERN, not in the string", which is the same argument applied to the same kind of variable.
So the API flag is `SALES_AUTH_FAKE`.

The web half keeps `VITE_AUTH_FAKE` unprefixed beyond `VITE_`, because `VITE_` already scopes it and because it then sits in the existing `VITE_AUTH_PROXY_TARGET` / `VITE_AUTH_BFF_BASE_PATH` family rather than inventing a second naming scheme inside one file.

FIRST ACTION FOR THE EXECUTOR, before editing anything:
this slice depends on 02 and 03, so both readers already exist in the tree.
Grep for the actual names those slices landed:

```
grep -rn 'AUTH_FAKE' apps/api/src apps/web/src packages/ | grep -v node_modules
```

The READER is authoritative.
If slice 02 or 03 chose a different spelling, use theirs everywhere in this slice and record the divergence in one line at the bottom of this plan file under a `## Executed as` heading.
Do NOT edit slice 02's or slice 03's source to match this plan; a Makefile that exports a variable nobody reads is a silently dead feature, and the reader is the half that was reviewed for it.

## The Makefile

### `.PHONY`

Append the five new target names to the existing `.PHONY` list.
The list is already wrapped across continuation lines; keep the existing wrapping style and add them to the first line's group with `dev front back stg back-stg front-stg`, or on a continuation line of their own if the line grows past the file's existing width.
This is the ONLY pre-existing line in the file this slice may touch.

### The new section

Insert one new section between the existing `# --- Development ---` section (which ends after `back`) and the existing `# --- Staging ---` section.
Do not reorder anything.

The comment block above the targets is load-bearing documentation and is written in the voice of the existing staging block, which explains a decision and then forbids a specific future edit.
It must say, in prose, one sentence per line:

- What the section is for: running the whole product against local development identities, with the Hub never contacted, so that work on screens behind auth is not blocked by a Hub that is down or not yet issued a Client for this machine.
- Where the safety actually lives: the identity package is a devDependency and is absent from the production image, every access to it is a dynamic import, the web half is behind `import.meta.env.DEV` so the production build eliminates it as dead code, and the API refuses to boot with `SALES_AUTH_FAKE` set under `NODE_ENV=production`.
- That the flags are OFF in every committed `.env` example and are turned on here, by a target, at the moment the operator means it.
- That there is deliberately NO staging or production variant, no `dev-fake-stg`, and no target that sets a dev-fake flag alongside `SALES_ENV_FILE`. If you came here to add one, do not.
- That `dev-fake-setup` chains `db-up`, `migrate` and `db-seed` and deliberately does NOT chain `db-reset`, which destroys the local volume.

### The targets

`dev-fake` runs BOTH servers, because acceptance 1 of this feature is that `make dev-fake` brings up API and web and the operator then opens the app.
It cannot be an interactive selector like `dev` for that reason, and the root `package.json` has no `dev` script to delegate to, so the recipe starts both itself.

```make
dev-fake: build-shared ## Run the full stack with development identities (no Hub required)
	@echo "dev-fake: api http://localhost:3006 | web http://localhost:8006 | the Hub is never contacted"
	@set -m; \
	SALES_AUTH_FAKE=1 pnpm --filter @fxl-sales/api dev & api=$$!; \
	VITE_AUTH_FAKE=1 pnpm --filter @fxl-sales/web dev & web=$$!; \
	trap 'kill -- -$$api -$$web 2>/dev/null || true' INT TERM EXIT; \
	wait
```

Notes the executor must not "clean up":

- `build-shared` is a real prerequisite and must run BEFORE either server starts, which is why it is a prerequisite and not a line inside the recipe. The web dev server resolves `@fxl-sales/shared-types` and `@fxl-sales/shared-utils` from their built output.
- `set -m` gives each background job its own process group, which is what makes `kill -- -$$api` reach the whole tree rather than only the `pnpm` parent and orphan the `tsx watch` and `vite` workers.
- The trap covers `INT TERM EXIT`, so Ctrl-C and an early failure both clean up. The `|| true` keeps an already-dead group from failing the target.
- `$$!` and `$$api` are Make escaping for the shell's `$!` and `$api`. Do not reduce the doubled dollars.

```make
back-fake: build-shared ## Run only the API with development identities
	SALES_AUTH_FAKE=1 pnpm --filter @fxl-sales/api dev

front-fake: ## Run only the frontend with development identities
	VITE_AUTH_FAKE=1 pnpm --filter @fxl-sales/web dev
```

`back-fake` carries `build-shared` and `front-fake` does not, mirroring `back` / `front` and `back-stg` / `front-stg` exactly.

```make
dev-fake-setup: ## One-shot: start the DB, migrate, seed the dev dataset, then run dev-fake
	$(MAKE) db-up
	@echo "Waiting for PostgreSQL..."
	@sleep 3
	$(MAKE) migrate
	$(MAKE) db-seed
	$(MAKE) dev-fake
```

The `@echo "Waiting for PostgreSQL..."` plus `@sleep 3` pair is copied verbatim from `db-reset`, because that is this file's existing idiom for the same wait.

### Is a combined one-shot setup target warranted here

Yes, and it is `dev-fake-setup` as specified above.

This repository already has `db-up`, `migrate` and `db-reset`, so the one-shot target adds no new capability, only an ordering.
That ordering is the point: a fresh clone in dev-fake mode needs the container up, the schema applied and the deterministic roster seeded before the app can render a screen with rows on it, and three targets typed in the wrong order produce three different confusing failures.
Wrapping them removes the ordering as a thing the operator has to know.

It chains `db-up` and never `db-reset`, and that is the decision to protect.
`db-reset` drops the local docker volume and then chains `migrate`, which is the exact shape that once carried DDL to staging.
Its `node -e` line prints the host `migrate` is about to receive before anything is destroyed, but that line is an ANNOUNCEMENT and not a guard: the enforcement is in `apps/api/src/db/migrate.ts` and refuses by exit code.
A setup target that quietly destroys the operator's local data because they wanted to try the identity switcher would be a bad trade, and it would put a destructive step behind a name that reads as harmless.
So `dev-fake-setup` is additive only, and an operator who wants a clean slate types `make db-reset` on purpose and sees the announced host first.

### `db-seed`

Place `db-seed` in the existing `# --- Database ---` section, immediately after `migrate` and before `db-up`.
The reference repository keeps it inside its dev-fake block; here it goes with the other database targets because that is where an operator of this repository looks for one, and because seeding is useful on its own.
The dev-fake comment block cross-references it.

```make
db-seed: ## Seed the local database with the deterministic development dataset
	pnpm --filter @fxl-sales/api db:seed:dev
```

PLAN-CHECK RULING, 2026-09-21: the pnpm script is `db:seed:dev` and NOT `db:seed`.
Slice 04 owns `apps/api/package.json` and names it `db:seed:dev` deliberately, so that a script
sitting beside `db:migrate` cannot be run somewhere it should not be by tab completion.
Slice 04's own recorded Makefile sketch called the target `dev-fake-seed`; the TARGET name `db-seed`
from this slice wins, because this slice owns the Makefile and `db-seed` belongs in the
`# --- Database ---` section with the other database targets.
So: make target `db-seed`, pnpm script `db:seed:dev`.

SOFT DEPENDENCY, stated so it is not discovered at runtime: the `db:seed:dev` script in `apps/api/package.json` is owned by slice 04, not by this one.
Before finishing, the executor runs `grep -n '"db:seed:dev"' apps/api/package.json`.
If it is present, nothing more to do.
If it is absent, still write the target, because this is the declarative operator surface, and record one line under `## Executed as` saying the seed script had not landed yet so `make db-seed` and `make dev-fake-setup` are not runnable until it does.
Do NOT add the `db:seed:dev` script to `apps/api/package.json` from this slice; two slices writing the same key is how a wave merge loses one of them.

### A residual risk, recorded rather than guarded

An operator who has exported `SALES_ENV_FILE` in their shell profile and then runs `make back-fake` gets the fake identity adapter pointed at whatever database that named file describes.
This slice does NOT add a second guard for it, deliberately.
CLAUDE.md is explicit that `SALES_ENV_FILE` is the one escape hatch and that "two exits for one rule is divergence", and the same reasoning forbids a second, target-local refusal that would then be the one nobody remembers to keep in step.
What already covers it: the API prints one boot line naming the database host and port on every non-production run, `migrate.ts` refuses a remote host outright unless a named file was given, and `apps/api/src/config/env-files.ts` prints the name of the file it loaded.
This paragraph exists so the gap is filed rather than assumed closed.

## The `.env` example lines

### The shape, and why it is a commented line

The flags are documented as COMMENTED lines with a prose block above them, never as an active `KEY=` line.

This repository already has the pattern for a dangerous opt-in that a human types in front of one command: the `SALES_ENV_FILE` block in both API examples, which says it "DELIBERATELY HAS NO LINE OF ITS OWN HERE, AND MUST NEVER GET ONE", explains why, and shows the usage instead.
The dev-fake flags are the same class of thing: they are turned on by a Make target at the moment the operator means it, and they are never part of the ambient environment of every command.

THE WARNING, stated plainly because it is the one way this slice can do real harm:
these flags must NEVER be added to any `.env` example in a form that is on by default.
The examples are what a fresh clone copies verbatim to `.env`, and a repository that authenticates fake identities out of the box is strictly worse than one that needs one extra word on a command line.
An active `SALES_AUTH_FAKE=` line is also worse than a commented one even when blank, because the next person to edit the file sees a slot and fills it.
Commented, with the usage shown, is the only shape this slice ships.

### `apps/api/.env.example` and `apps/api/.env.dev.example`

Add an identical block to BOTH files, at the end of the section `# --- Auth: this app's own values, outside the FXL_HUB_ namespace ---`, after the `SALES_SESSION_ENCRYPTION_IKM=` line and before `PUBLIC_LINK_BASE_URL`.
Both files carry that section already, with identical text, so the two edits are the same edit twice.

The block, exactly:

```
# --- Developing without the FXL Hub: SALES_AUTH_FAKE ---
#
# DELIBERATELY HAS NO ACTIVE LINE HERE, AND MUST NEVER GET ONE. This file is
# copied to apps/api/.env and loaded by DEFAULT on every command, so an active
# SALES_AUTH_FAKE line would authenticate fake identities out of the box, on
# every command, for every developer. It is an opt-in turned on by a target at
# the moment you mean it:
#
#   make dev-fake      # api + web, no Hub required
#   make back-fake     # api only
#
# With it set, the API adopts a local development identity instead of verifying
# a Hub token, and the Hub is never contacted. The adapter lives in a
# devDependency that is absent from the production image, every access to it is
# a dynamic import, and the API REFUSES TO BOOT with this set under
# NODE_ENV=production, naming the variable.
#
# There is no staging or production form of this and there must not be one.
#
# SALES_AUTH_FAKE=1
```

The commented usage line at the end is the one the oracle reads back, so its exact text `# SALES_AUTH_FAKE=1` matters.
Reconcile it with the reader if the grep at the top of this plan found a different variable name.

### `apps/web/.env.example` and `apps/web/.env.dev.example`

The web equivalent of the API examples is `apps/web/.env.example` and `apps/web/.env.dev.example`.
There is also `apps/web/.env.staging.example`, which this slice does NOT touch.

Add an identical block to both, immediately after the `# --- Auth: FXL Hub public config ---` group and before the observability group.

```
# --- Developing without the FXL Hub: VITE_AUTH_FAKE ---
#
# DELIBERATELY HAS NO ACTIVE LINE HERE. This file is copied to apps/web/.env,
# so an active line would put the development identity switcher into every
# local build. Turn it on by target instead:
#
#   make dev-fake      # api + web, no Hub required
#   make front-fake    # web only
#
# With it set, the app adopts a local development identity and shows a switcher
# that adopts another one and reloads. The whole half is behind
# import.meta.env.DEV, so a production build eliminates it as dead code and the
# variable can do nothing there even if it is set.
#
# VITE_AUTH_FAKE=1
```

### Files this slice must NOT add the flags to

- `apps/api/.env.staging.example` and `apps/web/.env.staging.example`. A staging environment must not carry even a commented invitation to run fake identities against it.
- `apps/api/.env`, `apps/web/.env` and `apps/api/.env.staging`. Those are real local or gitignored files and are not this slice's business.
- `README.md`. It carries a fenced `dotenv` block that the contract test already reads, and it is outside this feature's declared touch list.

## Does `env-example-contract.test.ts` constrain this, and does it need touching

FINDING, stated explicitly because the slice brief asked for it either way: the test as it stands does NOT forbid anything this slice adds, and nothing in this slice would break it.
The additions are nevertheless a claim about FILES, so the test DOES need one addition, which is the paragraph after this one.

The detail, from reading the file:

- `parseEnvExample` reads `.env.example` and `.env.dev.example` with a `KEY=VALUE` plus `#` comment grammar. Every line this slice adds is a comment, so the parsed bag is unchanged.
- `describes an ABSENT Hub configuration in %s` and `reaches the 503 door rather than a boot failure from %s` run `hubConfigIsAbsent` and `tryLoadHubAuthConfig` over that bag. Neither reads anything but the six credential-bearing Hub names, so a comment block is inert for both.
- `parses at all, so a green run below cannot mean an empty bag` asserts `Object.keys(bag).length > 10`. Comments add no keys, and the count today is far above 10, so this stays green.
- `still SHOWS the known-good local values, commented` and `keeps the callback off the Hub's own origin` read specific lines that this slice does not move.
- The `DOC_BLOCKS` describe reads `README.md` and `CLAUDE.md`, not the `.env` examples, so it constrains slice 07 and not this slice. See the handoff below.

So: no existing assertion needs editing, and none may be edited.

### The addition

Append ONE new `describe` at the end of `apps/api/src/config/__tests__/env-example-contract.test.ts`, named:

`the dev-fake switch in the shipped examples`

It reads six files by path, relative to the test file exactly as the existing helpers do (`../../../<name>` reaches `apps/api`, and the `DOC_BLOCKS` helper already reaches the repo root with `../../../../../`, so reaching `apps/web` is established practice in this file and needs no new mechanism).

The four DEV-OR-DEFAULT examples: `apps/api/.env.example`, `apps/api/.env.dev.example`, `apps/web/.env.example`, `apps/web/.env.dev.example`.
The two STAGING examples: `apps/api/.env.staging.example`, `apps/web/.env.staging.example`.

Three assertions, and the first is what makes the other two non-vacuous:

1. `still SHOWS the dev-fake switch, commented, in %s`, over the four dev-or-default examples.
   Assert on the RAW TEXT that the file contains the exact documented usage line, `# SALES_AUTH_FAKE=1` for the two API files and `# VITE_AUTH_FAKE=1` for the two web files.
   This is the vacuity guard and it is modelled on the existing `still SHOWS the known-good local values, commented` test: without it, a test that only says "nothing is enabled" would pass just as happily against a file that was never found or a variable that was never documented.

2. `never ENABLES the dev-fake switch in %s`, over all six files.
   Parse with the same small dotenv grammar the file already has, and assert the parsed bag has no `SALES_AUTH_FAKE` and no `VITE_AUTH_FAKE` key at all.
   Asserting absence from the parsed bag rather than "not equal to 1" is the stricter and simpler statement: any active line at all, blank or otherwise, fails it, which is exactly the rule this slice ships.

3. `keeps the dev-fake switch out of the staging examples entirely in %s`, over the two staging examples.
   Assert on the RAW TEXT that neither string `SALES_AUTH_FAKE` nor `VITE_AUTH_FAKE` appears anywhere in the file, commented or not.

Write the assertions against whichever variable names the grep at the top of this plan confirmed.
Reuse `parseEnvExample`'s grammar; if the existing helper's hard-coded `../../../` prefix does not accommodate the web paths, add a second tiny helper beside it rather than changing the existing one, because the existing one is called by four passing tests.

Add a short comment block above the new describe, in the voice of the rest of the file, saying why it exists: the examples are what a fresh clone copies, a dev-fake flag on by default would authenticate fake identities out of the box, and nothing else in the suite reads these files.

## Oracles

NAMED ORACLE, automated:

- `apps/api/src/config/__tests__/env-example-contract.test.ts`, the three new tests above, plus every existing test in it still green. Run with `pnpm --filter @fxl-sales/api test -- env-example-contract`.

NO UNIT ORACLE FOR THE MAKEFILE, stated honestly rather than papered over.
A Make target is a shell invocation; asserting its text in a test would restate the Makefile in a second file and would pass or fail for the same reason the Makefile is right or wrong, which is a tautology and not a test.
The genuine properties worth defending near it are already owned elsewhere: the tracked-file guard slice owns "no shipped source imports the fake package", and `scripts/__tests__/local-database-guard.test.mjs` owns the database entrypoints.

The Makefile's honest checks are MANUAL, and the executor runs all four and records the output in the slice notes:

1. `make help` and confirm the five new lines appear with their descriptions, unclipped at the existing `%-15s` width.
2. `make -n dev-fake`, `make -n back-fake`, `make -n front-fake`, `make -n db-seed` and `make -n dev-fake-setup`, and confirm each prints the expected commands and runs nothing. `-n` is required; never start a server to check a target.
3. `grep -n 'SALES_ENV_FILE=' Makefile` and confirm exactly one hit, in `back-stg`.
4. `grep -rn 'AUTH_FAKE' apps/api/.env*.example apps/web/.env*.example` and confirm every hit is on a line beginning with `#`.

The end-to-end check that `make dev-fake` really brings the operator to a sales-ops screen with no Hub listening on 9016 is acceptance 1 of the FEATURE and belongs to the integrated wave, not to this slice.
It cannot pass before slices 02, 03 and the seed slice are all in the tree.

## Handoff to slice 07, which owns CLAUDE.md

Slice 07 must add the following to `CLAUDE.md`, and this slice must not.

To the fenced `dotenv` block under "Required API vars", INSIDE the existing block and not as a new fence, append after the `PUBLIC_LINK_BASE_URL` line:

```
# Development without the Hub. OFF by default and never set in a committed
# file. `make dev-fake` and `make back-fake` set it for one command. The API
# refuses to boot with it set under NODE_ENV=production.
# SALES_AUTH_FAKE=1
```

To the fenced `dotenv` block under "Required web vars", append:

```
# Development without the Hub. OFF by default. `make dev-fake` and
# `make front-fake` set it. The whole half is behind import.meta.env.DEV, so a
# production build eliminates it.
# VITE_AUTH_FAKE=1
```

THE CONSTRAINT SLICE 07 MUST RESPECT, because `env-example-contract.test.ts` reads `CLAUDE.md` and will go red:

- `has a block in %s that really names all five identity variables` asserts that EXACTLY ONE fenced `dotenv` block in `CLAUDE.md` mentions all five of `FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE`. A new fence that repeats those five names makes the count 2 and goes red. Adding commented lines to the existing block does not.
- `describes an ABSENT Hub configuration in every %s block` runs `hubConfigIsAbsent` over EVERY fenced `dotenv` block in the file. A block carrying only commented dev-fake lines parses to an empty bag and is absent, so it is safe, but any new fence must still never set one of the six credential-bearing names.
- `still SHOWS the known-good identity values, commented` and `keeps the callback off the Hub's own origin` read the block that contains `FXL_HUB_CLIENT_SECRET`, so the three commented identity values, `FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback` and `FXL_HUB_TRUSTED_ORIGINS=http://localhost:8006` must all survive the edit untouched.

Recommendation to slice 07: append the commented lines to the two EXISTING blocks and open no new `dotenv` fence, which satisfies all four constraints by construction.

Slice 07 should also record in prose, wherever it documents the feature:

- The four targets by name, `dev-fake`, `back-fake`, `front-fake` and `dev-fake-setup`, plus `db-seed`.
- That `dev-fake-setup` chains `db-up`, `migrate`, `db-seed` and `dev-fake`, and deliberately never `db-reset`.
- That the flags are OFF in every committed example and are documented there only as commented lines, pinned by the new describe in `apps/api/src/config/__tests__/env-example-contract.test.ts`.
- That there is deliberately no `dev-fake-stg` and no target combining a dev-fake flag with `SALES_ENV_FILE`, and that `back-stg` remains the only `SALES_ENV_FILE` assignment in the tracked tree.

`README.md` also carries a `dotenv` block under the same test.
It is outside this feature's touch list; if slice 07 chooses to update it, the identical constraints apply.
