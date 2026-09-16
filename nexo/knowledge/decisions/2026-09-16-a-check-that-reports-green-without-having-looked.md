# A check that reports green without having looked

**Date:** 2026-09-16
**Surfaced by:** `feature-20260916-local-db-guard`, three times in one run

## The shape

A check that never examined its subject and a check that examined it and found nothing are the same observation: green.
One run produced three instances of this, through three unrelated mechanisms, which is why it is written down as a shape rather than as three tips.

### 1. A `git grep` whose pattern cannot match

The secret sweep was `git grep -n -E '^\s*SALES_ENV_FILE=' -- . ':(exclude)nexo'`.
`git grep`'s ERE does NOT honour `\s`, and the one legitimate assignment was tab-indented, so the pattern matched nothing and certified a tree it had not searched.
`^[[:space:]]*` finds it.
Nothing had leaked, but the gate had been passing for the wrong reason, which is indistinguishable from the gate being broken.

### 2. A spawned child that runs zero tests and exits 0

A structural guard proved itself by re-spawning its own test file against mutated fixture trees and asserting a non-zero exit.
`node --test` sets `NODE_TEST_CONTEXT` in each test file's process; spreading `process.env` into the grandchild made node warn `run() is being called recursively within a test file`, run ZERO tests, print nothing and exit `0`.
All four negative cases were green while proving nothing.
Fix: strip every `NODE_TEST_`-prefixed key from the child env.

The detail that makes this generalisable: **the positive control did not catch it.**
A vacuous child exits 0, and exiting 0 is exactly what a positive control asserts.
Only the NEGATIVE cases - the ones that demand a failure - can see a subject that was never examined.

### 3. A guard that was never reached

See `2026-09-16-a-guard-at-an-esm-entrypoint-is-not-first.md`.
A successful boot cannot distinguish a guard that ran and allowed from a guard that was never reached.

## The rules that fall out

- **Every "must find nothing" check needs a positive control** that proves the same pattern can still find a known hit.
  Run it with the exclusion dropped, or against a seeded fixture; a sweep without one is a claim, not a measurement.
- **A positive control alone is not enough.** Pair it with negatives that must FAIL, and read their exit codes.
  Vacuity is only visible from the failing side.
- **Prove a guard by breaking what it claims to catch, and grade the EXIT CODE, never the message.**
  Message text drifts, gets paraphrased, gets printed by something else entirely, and can be emitted by a process that then continues.
  An exit code cannot be faked by a paraphrase.
- **Pair it with a specificity proof.** Show the same command against the acceptable input exits 0 and does its job, or "refuses everything" passes as "refuses the right thing".
- **A test count is an oracle.** When a harness has a degraded mode (fixture mode, skip mode, recursion cut-off), assert the expected number of tests actually ran, not only that the run was green.
