# Verify - slice 00-guard-pathspec-fix

Branch `feat/00-guard-pathspec-fix` at `09d32c0`, one commit ahead of `master` (`5eeff1e`).
Graded adversarially by an agent that did not write the code and did not read the execute notes or the context pack.
Nothing was merged, pushed or amended. Every mutation below was made in the working copy and restored; the final `git status` for `scripts/` is clean.

Note on `nexo/state.json`: it was already modified in the working tree before this verify began and was not touched by this agent.

## Verdict: PASS

All six acceptance criteria PASS, the non-vacuity proof holds in both directions, and lint and type-check are green.
One cosmetic observation and one pre-existing wrinkle are recorded at the end; neither is a defect in this slice.

## Criterion 1 - the guard and the suite are green: PASS

```
$ node scripts/no-legacy-auth.mjs; echo "GUARD_EXIT=$?"
GUARD_EXIT=0

$ CI=true pnpm test; echo "PNPM_TEST_EXIT=$?"
...
1..3
# tests 3
# pass 3
# fail 0
build-contract: ok
PNPM_TEST_EXIT=0
```

The redness this slice exists to fix was confirmed independently against the branch point, without checking out `master`:

```
$ git grep -n -i -- "$L" master -- . | head -5
master:nexo/runs/20260907-ship-v3.0.0/release-verify.md:140:`VITE_*` strings surviving into the bundle are ... plus one dead `VITE_CLERK_PUBLISHABLE_KEY` **key name** inside an unassigned zod schema that ships in the vendored `@fxl-business/hub-sdk` dist, not in this repo ... Cosmetic only.

$ git grep -n -i -- "$L" master -- . ':(exclude)nexo' ':(exclude)CLAUDE.md'
(no output)
```

The record is accurate security evidence, the guard was the thing that was wrong, and the guard is what moved.

## Criterion 2 - the guard still fails on real source: PASS

Proven with a throwaway repository this agent built from scratch, not by trusting the repo's own test.

```
$ R=$(mktemp -d ...); git -c init.defaultBranch=main init -q "$R"
$ L=$(node -e 'process.stdout.write(String.fromCharCode(99,108,101,114,107))')
$ printf "import { useAuth } from '@%s/%s-react';\n" "$L" "$L" > "$R/apps/web/src/x.ts"
$ git -C "$R" add -A -f .
$ (cd "$R" && node /abs/path/scripts/no-legacy-auth.mjs); echo "EXIT=$?"
apps/web/src/x.ts:1:import { useAuth } from '@clerk/clerk-react';
EXIT=1
```

The guard rejects a reintroduction under `apps/` and names the offending file and line.

## Criterion 3 - the exclusion set is exactly `nexo/` and `CLAUDE.md`: PASS

The pathspec is `-- . ':(exclude)nexo' ':(exclude)CLAUDE.md'`.
Each row below is a separate throwaway git repo seeded with the banned literal at that path only, then run through the real guard.
`EXIT=1` means the path is INSIDE the gate; `EXIT=0` means it is excluded.

| Seeded path | Guard exit | Inside the gate? |
| --- | --- | --- |
| `apps/web/src/x.ts` | 1 | yes |
| `packages/shared/src/a.ts` | 1 | yes |
| `scripts/thing.mjs` | 1 | yes |
| `pnpm-lock.yaml` | 1 | yes |
| `package-lock.json` | 1 | yes |
| `.env.dev.example` | 1 | yes |
| `apps/api/.env.example` | 1 | yes |
| `README.md` | 1 | yes |
| `AGENTS.md` | 1 | yes |
| `apps/nexo/src/z.ts` | 1 | yes - a nested directory merely NAMED nexo is not excluded |
| `nexo.md` | 1 | yes - a top-level FILE named nexo.md is not excluded |
| `nexosomething/a.ts` | 1 | yes - the exclusion is not a prefix match |
| `docs/CLAUDE.md` | 1 | yes - only the top-level CLAUDE.md is excluded |
| `apps/web/src/CLAUDE.md` | 1 | yes |
| `nexo/runs/x/release-verify.md` | 0 | excluded |
| `nexo/state.json` | 0 | excluded |
| `CLAUDE.md` | 0 | excluded |

The exclusion set is exactly the top-level `nexo/` tree and the top-level `CLAUDE.md`, and nothing more.
`apps/`, `packages/`, `scripts/`, both lockfile spellings and every `.env` example remain covered, as does every other doc file in the tree.

## Criterion 4 - the test file does not spell the literal: PASS

```
$ grep -in 'clerk' scripts/__tests__/no-legacy-auth.test.mjs; echo "exit=$?"
exit=1
```

No match. The test builds the literal with `String.fromCharCode(99, 108, 101, 114, 107)` and interpolates that binding into every fixture, including the package name (`@${banned}/${banned}-react`) and the uppercased env-var form (`VITE_${banned.toUpperCase()}_PUBLISHABLE_KEY`).
The guard running over the real tree with the test file committed exits 0, which is the live confirmation that the guard does not catch its own test.

## Criterion 5 - the new tests really execute inside the repo test command: PASS

Not inferred from the `&&` chain. One oracle was sabotaged in place and the full repo test command was re-run.

```
$ perl -0pi -e "s/assert\.notEqual\(result\.status, 0, '...'\);/assert.equal(result.status, 0, 'DELIBERATE SABOTAGE by verify agent');/" scripts/__tests__/no-legacy-auth.test.mjs
$ CI=true pnpm test; echo "PNPM_TEST_EXIT_WITH_BROKEN_ORACLE=$?"
not ok 1 - fails when the banned provider appears under apps/
# tests 3
# pass 2
# fail 1
PNPM_TEST_EXIT_WITH_BROKEN_ORACLE=1
```

The sabotage message appears in the `pnpm test` output (`grep -c 'DELIBERATE SABOTAGE'` = 1), which proves the failing assertion is the one that ran, and the whole command goes red.
The file was restored from a pre-edit copy and `git status --porcelain scripts/` is empty.

The wiring is in the root `test` script:

```
"test": "pnpm run build:packages && pnpm -r --if-present test && node --test scripts/__tests__/no-legacy-auth.test.mjs && node scripts/no-legacy-auth.mjs && node scripts/build-contract.mjs"
```

The oracles run BEFORE the bare guard invocation, so a broken pathspec reports which direction broke before the tree-wide grep fires.

## Criterion 6 - no file under `nexo/runs/` was modified: PASS

```
$ git diff --name-status master...feat/00-guard-pathspec-fix -- nexo/
A	nexo/runs/feature-20260907-hub-env-contract-prep/exec-00-notes.md
```

Exactly one path under `nexo/` appears and its status is `A` (added), not `M`.
No existing record was modified, renamed or deleted; in particular `nexo/runs/20260907-ship-v3.0.0/release-verify.md` is byte-unchanged, which is the point of the criterion.
The added file is this run's own execute-notes capture, which is the Nexo flow appending to the record rather than rewriting it.

## Non-vacuity - proven in both directions

### Mutation A: pathspec reverted to `'.'` (the `master` behaviour)

```
$ grep -n "'grep'" scripts/no-legacy-auth.mjs
12:  ['grep', '-n', '-i', '--', banned, '--', '.'],

$ node --test scripts/__tests__/no-legacy-auth.test.mjs
ok 1 - fails when the banned provider appears under apps/
not ok 2 - passes when the banned provider appears only under nexo/
    guard rejected the append-only record: nexo/runs/20260907-ship/release-verify.md:1:One dead `VITE_CLERK_PUBLISHABLE_KEY` key name survives in the vendored bundle.
    1 !== 0
not ok 3 - passes when the banned provider appears only in CLAUDE.md
    guard rejected the prose record: CLAUDE.md:1:The clerk provider was removed; this line is the prose record of that.
    1 !== 0
# tests 3
# pass 1
# fail 2
NODE_TEST_EXIT=1
```

Oracles 2 and 3 go RED with the fix reverted. The oracle tests the thing.

### Mutation B: pathspec widened to `:(exclude)*`

```
$ grep -n "'grep'" scripts/no-legacy-auth.mjs
12:  ['grep', '-n', '-i', '--', banned, '--', '.', ':(exclude)*'],

$ node --test scripts/__tests__/no-legacy-auth.test.mjs
not ok 1 - fails when the banned provider appears under apps/
ok 2 - passes when the banned provider appears only under nexo/
ok 3 - passes when the banned provider appears only in CLAUDE.md
# tests 3
# pass 2
# fail 1
```

Oracle 1 goes RED against a guard that has been silenced. This is the direction that matters most: the two mutations pin the exclusion set from both sides, so neither "grep everything" nor "grep nothing" can pass the suite.

### Restored

```
$ git diff --stat scripts/no-legacy-auth.mjs
(empty)
$ grep -n "'grep'" scripts/no-legacy-auth.mjs
12:  ['grep', '-n', '-i', '--', banned, '--', '.', ':(exclude)nexo', ':(exclude)CLAUDE.md'],
$ node --test scripts/__tests__/no-legacy-auth.test.mjs
# tests 3
# pass 3
# fail 0
$ node scripts/no-legacy-auth.mjs; echo $?
0
```

## Repo conventions

- **Em dash**: PASS. `git diff master...feat/00-guard-pathspec-fix | grep -c '^+.*<em dash>'` returns `0`. The diff introduces none, including in the added Markdown.
- **Commit attribution**: PASS. The commit message contains no `Co-Authored-By`, no `Generated with`, and no agent or session line. The only `claude` substring in it is the filename `CLAUDE.md`.

## Commands and exit codes

| Command | Exit |
| --- | --- |
| `node scripts/no-legacy-auth.mjs` | 0 |
| `node --test scripts/__tests__/no-legacy-auth.test.mjs` | 0 (3 pass, 0 fail) |
| `CI=true pnpm test` | 0 |
| `CI=true pnpm test` with one oracle sabotaged | 1 |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |

All run-once invocations. No watcher, dev server or background process was started, so none was left running.

## Observations - neither is a defect in this slice

1. **The pathspec is relative to the guard's cwd.** `:(exclude)nexo` resolves against the working directory, so running the guard from a subdirectory would exclude `<subdir>/nexo` rather than the repo's `nexo/`. This is inherited from the pre-existing `'.'` and does not weaken the gate for any real invocation: the root `test` script runs it from the repo root, and the oracles spawn it with `cwd` set to the repo root. Worth a leading `:/` one day; not worth blocking on.
2. **`node --test` names the single file explicitly** rather than a directory or glob, so a second file added under `scripts/__tests__/` will silently not run until it is added to the chain. The comment burden is real but the constraint is the declared Node 20 floor, and a missed second file would be a future slice's defect, not this one's.
