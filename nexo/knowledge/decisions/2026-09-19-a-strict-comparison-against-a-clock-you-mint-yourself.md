# A strict comparison against a clock you mint yourself

**Date:** 2026-09-19
**Surfaced by:** `feature-20260918-kanban-pipeline-leads`, flake fix `7650e44`

## The failure

```
stage_changed_at advances when and only when stage_id actually changes
AssertionError: expected 1789785147396 to be greater than 1789785147396
```

Two failures in five consecutive runs.
It had passed a slice verification and two wave gates by luck, which is the normal life of a flake of this shape: it is green often enough to be mistaken for green.

## The diagnosis, including the first wrong one

The first reading was "the test compares at millisecond resolution while Postgres stores microseconds".
That is true and it is not the cause, and the distinction is the whole lesson.

The two stamps being compared come from two different clocks:

- the CREATE stamp is the column's `defaultNow()`, a Postgres transaction timestamp carrying microseconds;
- every MOVE stamp is the service's own `new Date()` inside `moveLead`, which has no digit below the millisecond.

So `now()` is only in play for the first stamp.
A move never asks the database for the time at all.
Reading at higher precision alone would not have fixed anything, because two move stamps minted inside one millisecond are **genuinely equal at their own resolution**, and a strict `>` then has nothing left to stand on.

Truncating the create stamp to milliseconds to match the move stamps threw away the only digits that could ever separate two writes - the wrong repair, and the tempting one.

## The fix, both halves

1. **Read the stamp as a `bigint` of MICROSECONDS computed in SQL**, never through a JavaScript `Date`, so no precision is discarded on the way in.
2. **Wait, boundedly, for this process's clock to pass the stored stamp before each write that MUST advance**, so the `new Date()` the service is about to mint cannot collide with it.
   Bounded, so a clock disagreement fails the assertion instead of hanging.

The strict `>` was **kept**.
Relaxing it to `>=` would let through a regression where the field never advances at all, which is the entire property under test - the flake would be gone and so would the test.
The "does not advance" half became EXACT equality at microsecond precision, which is strictly stronger than the millisecond-truncated `Date` comparison it replaced.

Proof: ten consecutive green runs, plus both mutations (always-advance, never-advance) red.

## The rules

- **Find out which clock mints each value before blaming resolution.**
  "The database has microseconds" is irrelevant for a value the application generated.
- **A flaky ordering assertion is almost never fixed by weakening the comparison.**
  `>` to `>=`, `toBe` to `toBeCloseTo`, adding a tolerance: each of those deletes the property and leaves the test name behind, which is worse than deleting the test, because the name still reassures.
- **Fix the two halves separately: measure finer, and separate the events.**
  Widening the read alone leaves colliding writes; separating the writes alone leaves a truncated read.
- **Any bound you add to wait for a clock must expire into a FAILURE, never a hang.**
- **Take the opportunity to make the other half stricter.**
  A "does not change" assertion has no flake risk at all, so it can be exact equality at the finest resolution available. This fix ended up with a stronger test than the one that was flaking.
- **Prove the repaired test still fails for the right reasons.**
  Ten green runs prove the flake is gone; only the two mutations prove the property survived the repair.
