---
slice: 00-guard-pathspec-fix
wave: 0
files_modified:
  - scripts/no-legacy-auth.mjs
  - scripts/__tests__/no-legacy-auth.test.mjs
---

# 00 - The tracked-file guard must not sweep the nexo archive

## The defect, measured on master before this run changed anything

`pnpm test` on `master` at `5eeff1e` exits NONZERO. It is not a test:

```
$ node scripts/no-legacy-auth.mjs ; echo $?
nexo/runs/20260907-ship-v3.0.0/release-verify.md:140: ... `VITE_CLERK_PUBLISHABLE_KEY` ...
1
```

`scripts/no-legacy-auth.mjs` runs `git grep -n -i -- <banned> -- .` over EVERY tracked file. Commit
`5eeff1e` added the v3.0.0 release-verify record, whose security section reports - correctly, and as
evidence - that one dead key NAME survives in the vendored SDK bundle and is unread by this repo.
Reporting the finding is the record doing its job. Tripping the guard is the guard doing the wrong
one.

This was shipped green: `5eeff1e` is a docs-only commit whose own content broke `pnpm test`, and
nothing between it and now ran the root script.

## Why the fix is the pathspec and not the record

The record under `nexo/runs/` is append-only history. Rewriting it to dodge a grep would falsify the
evidence a Gate-2 verifier wrote, which is worth more than the guard's convenience. And the same
would be true of the next release-verify that has to name the same string.

The guard's actual contract is "the removed auth provider is not REINTRODUCED" - a statement about
source, configuration and dependencies, not about prose describing the past. `CLAUDE.md` already
documents this exact carve-out shape for the `sales.core` literal, in its own words: "`CLAUDE.md` is
outside the grep gate's pathspec for exactly that reason". The archive needs the identical
treatment, and for the identical reason.

## What changes

`scripts/no-legacy-auth.mjs` gains an explicit pathspec:

```
-- . ':(exclude)nexo' ':(exclude)CLAUDE.md'
```

`nexo/` because it is the append-only record. `CLAUDE.md` because it is the prose record and already
holds one deliberate mention of a banned literal - today the guard passes on it only because that
literal is a different one, which is luck rather than design.

Nothing else is loosened. `apps/`, `packages/`, `scripts/`, every lockfile and every `.env` example
stay inside the gate, which is the whole of what "reintroduced" can mean.

## Locked oracle

A NEW `scripts/__tests__/no-legacy-auth.test.mjs`, run by the root `test` script, that proves BOTH
directions against a real throwaway git repository rather than by mocking `git`:

1. **`fails when the banned provider appears under apps/`** - seed a temp repo with the literal in
   `apps/web/src/x.ts`, run the guard, assert nonzero. Without this the pathspec fix could be
   widened to `':(exclude)*'` and still pass.
2. **`passes when the banned provider appears only under nexo/`** - the exact shape of the live
   failure, and the assertion that goes RED if the pathspec is reverted.
3. **`passes when the banned provider appears only in CLAUDE.md`**.

The test file must construct the banned literal by character code, exactly as the guard does; a test
that spells it out would itself be caught by the guard it is testing.

## Non-vacuity proof required of Execute

Revert the pathspec, confirm oracle 2 and 3 go RED and oracle 1 stays GREEN. Restore, then widen the
pathspec to exclude everything, confirm oracle 1 goes RED. Report both.
