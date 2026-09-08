# Execute notes - slice 00-guard-pathspec-fix

## The defect, reproduced first

On the branch point (`master` at `5eeff1e`), before any edit:

```
$ node scripts/no-legacy-auth.mjs; echo "EXIT=$?"
nexo/runs/20260907-ship-v3.0.0/release-verify.md:140:`VITE_*` strings surviving into the bundle are ... plus one dead `VITE_CLERK_PUBLISHABLE_KEY` **key name** inside an unassigned zod schema that ships in the vendored `@fxl-business/hub-sdk` dist, not in this repo ... Cosmetic only.
EXIT=1
```

Exactly the failure the plan describes: the append-only release record names the removed provider while reporting, correctly, that it is absent from this repo, and the guard greps every tracked file.

## What changed

### `scripts/no-legacy-auth.mjs`

The `git grep` invocation gained the pathspec from the plan, verbatim:

```
['grep', '-n', '-i', '--', banned, '--', '.', ':(exclude)nexo', ':(exclude)CLAUDE.md']
```

Nothing else was loosened.
`apps/`, `packages/`, `scripts/`, every lockfile and every `.env` example remain inside the gate.
A six-line comment above the call records why the two exclusions exist, so the next reader does not "tidy" them away.

### `scripts/__tests__/no-legacy-auth.test.mjs` (new)

`node:test`, three named oracles, no mocking of `git` anywhere.
Each oracle builds a REAL throwaway repository with `git init` plus `git add -A -f .` in `fs.mkdtempSync(os.tmpdir())`, runs the actual guard file as a child process with `cwd` set to that repo, and asserts on the child's exit status.
An `after()` hook removes every temp root.

Two details worth keeping:

- `git add` passes `-f`, so a developer's global gitignore cannot leave a seeded file untracked and make an oracle pass for the wrong reason (an untracked file is invisible to `git grep`, so oracle 1 would go green against a broken guard).
- The temp dir is `realpathSync`'d, because on macOS `os.tmpdir()` is the `/var` symlink and git reports paths through the resolved root.

The banned literal is built with `String.fromCharCode(99, 108, 101, 114, 107)`, exactly as the guard builds it, and every seeded fixture interpolates that binding.

## Something the plan did not anticipate

Two things.

**1. The guard caught its own test, as predicted - and it caught a spelling I did not intend to write.**
The first draft seeded the apps/ fixture as `` `import { useAuth } from '@${banned}/clerk-react';` ``.
The scope name was interpolated but the PACKAGE name was still spelled out, so:

```
$ git add -A scripts && node scripts/no-legacy-auth.mjs; echo "GUARD_EXIT=$?"
scripts/__tests__/no-legacy-auth.test.mjs:56:    'apps/web/src/x.ts': `import { useAuth } from '@${banned}/clerk-react';\n`,
GUARD_EXIT=1
```

Fixed to `` `@${banned}/${banned}-react` ``.
The lesson generalizes: the literal is easy to half-escape, and the only reliable check is running the guard with the test file STAGED, because `git grep` sees the index and an unstaged new file is invisible to it.
That is the check I ran, and it is worth running again on any future edit to this test.

**2. `node --test <directory>` does not work here.**
The first wiring was `node --test scripts/__tests__/`, which the plan's "run by the root `test` script" left open.
Under Node v22.22.3 in this repo that arg is resolved as a module entry rather than as a test directory and dies with `MODULE_NOT_FOUND` before any test runs - it reports `not ok 1 - scripts/__tests__`, so it fails loudly rather than silently skipping, but it fails.
`node --test "scripts/__tests__/*.test.mjs"` does work, but Node's glob support in `--test` landed in Node 21 and this repo's `engines.node` is `>=20`, so a glob would break the declared floor.

The root `test` script therefore names the file explicitly, which is also the existing idiom in that script (`node scripts/no-legacy-auth.mjs && node scripts/build-contract.mjs`):

```
"test": "pnpm run build:packages && pnpm -r --if-present test && node --test scripts/__tests__/no-legacy-auth.test.mjs && node scripts/no-legacy-auth.mjs && node scripts/build-contract.mjs"
```

It runs BEFORE the guard invocation deliberately: if the pathspec is ever broken, the three named oracles say which direction broke, and only then does the bare guard fail on the real tree.
No vitest config was reshaped.
Adding a second file under `scripts/__tests__/` will require adding it to this chain by hand; that is the cost of holding the Node 20 floor, and it is recorded here rather than discovered later.

## Non-vacuity proof - actual observed output

### Mutation A: pathspec reverted to `'.'`

```
$ grep -n "'grep'" scripts/no-legacy-auth.mjs
12:  ['grep', '-n', '-i', '--', banned, '--', '.'],

$ node --test scripts/__tests__/no-legacy-auth.test.mjs
ok 1 - fails when the banned provider appears under apps/
not ok 2 - passes when the banned provider appears only under nexo/
not ok 3 - passes when the banned provider appears only in CLAUDE.md
# tests 3
# pass 1
# fail 2
```

Oracles 2 and 3 RED, oracle 1 GREEN. As required.

### Mutation B: pathspec widened to exclude everything

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

Oracle 1 RED. As required.
This is the one that stops the fix being "silence the guard": no pathspec that lets a reintroduction under `apps/` through can pass oracle 1, and no pathspec that sweeps the archive can pass oracles 2 and 3, so the two constraints pin the exclusion set from both sides.

### Restored

```
$ grep -n "'grep'" scripts/no-legacy-auth.mjs
12:  ['grep', '-n', '-i', '--', banned, '--', '.', ':(exclude)nexo', ':(exclude)CLAUDE.md'],

$ node --test scripts/__tests__/no-legacy-auth.test.mjs
ok 1 - fails when the banned provider appears under apps/
ok 2 - passes when the banned provider appears only under nexo/
ok 3 - passes when the banned provider appears only in CLAUDE.md
# tests 3
# pass 3
# fail 0

$ node scripts/no-legacy-auth.mjs; echo $?
0
```

## Verification

| Command | Exit |
| --- | --- |
| `node scripts/no-legacy-auth.mjs` | 0 |
| `node --test scripts/__tests__/no-legacy-auth.test.mjs` | 0 (3 pass, 0 fail) |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |

`pnpm test` end to end: shared-utils 3 test files passed, api 42 test files passed, web 56 test files passed, the new scripts oracle 3/3, the guard clean, `build-contract: ok`.
All run-once invocations; no watcher was started and no process was left running.

## Out of scope, as instructed

`nexo/runs/20260907-ship-v3.0.0/release-verify.md` was not touched, nor was any other file under `nexo/runs/`.
The record was right; the guard was wrong.
`nexo/state.json` was modified in the working tree by the orchestrator rather than by this agent and was deliberately left unstaged.
