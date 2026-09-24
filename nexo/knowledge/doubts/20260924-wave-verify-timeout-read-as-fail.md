---
milestone: v4.1.0
question: "Why did nexo-wave-exec.sh revert three already-passing merges when nothing about them had failed?"
answer: "A wave-verify agent's result was lost to an account rate-limit outage, and the script's wait on that result has only one timeout branch, which it treats as FAIL and reverts."
---

# A wave-verify timeout is read as FAIL, not as a lost dispatch

**Surfaced by:** `nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md`, incident at 2026-09-24 00:05-01:40 (-03).

## What happened

An account usage limit (HTTP 429) killed four live agents at once, including the wave-1 verify agent for slices 01-03.
That verify agent's result never landed.
`nexo-wave-exec.sh` waits on the verify result with a fixed timeout, currently 3600 seconds.
The script has no branch for "the wait timed out because the dispatch was lost"; it treats a timeout exactly like a verify agent that ran to completion and reported FAIL.
It appended revert commits for all three merged slices and began the serial recovery path, reverting slice 01 before the run's orchestrator noticed and stopped the process group.

The FAIL was never real.
Every one of the three slices had already passed its own per-slice Gate 2 Verify before the wave verify was even dispatched, and the wave-verify agent's last visible output (before the outage cut it off) had reported 233 of 233 integration tests green.
The repair was append-only: `git revert` of the two remaining revert commits, restoring master to a tree byte-identical to the original merged wave, then resuming the same wave-verify agent against that tree.

The outage separately cost the run about 1.5 hours of its 4-hour active budget, which is why slices 07-09 ended up parked rather than re-planned or rushed.

## Why it happens

A wait-with-timeout has exactly two outcomes from the waiting script's point of view: a result arrived, or it did not.
`nexo-wave-exec.sh` collapses "it did not" into the same handling as "a result arrived and said FAIL", because until now the only realistic cause of a timeout was assumed to be a hung or genuinely broken wave.
An account-wide rate limit that kills the dispatch itself, mid-flight, with no chance to write a result file, was not a case the script's design considered.
The two situations look identical from outside the wait: silence.
They are not identical in what the right response is.
A real FAIL means the merged code is broken and reverting is correct.
A lost dispatch means nothing is known about the merged code at all, and reverting destroys three separately-verified, already-passing merges on the strength of no evidence.

## The rule

- **A wait timeout is not a verdict; treat it as "unknown", not as "FAIL".**
  Escalate a lost wave-verify dispatch (for example, exit code 3, or a distinct "lost" status) rather than silently mapping it onto the FAIL path that exists for a real, reported failure.
- **Escalating means: pause and re-dispatch verify against the same tree, not revert.**
  Every one of the three slices in this incident had already cleared its own Gate 2; the correct recovery was to re-run the wave-level check, not to undo work no oracle had actually rejected.
- **A revert triggered by an unattended script should be cheap to undo, and it was here only because the run stayed append-only.**
  No `git reset --hard`, no force-push; the repair was two more `git revert` commits. That discipline is what made the repair mechanical instead of a forensic reconstruction.
- **Recommended fix:** give `nexo-wave-exec.sh` a distinct "lost dispatch" outcome for a timed-out wait, separate from a wave-verify agent's own reported FAIL, and have the run escalate (pause, alert, or retry the same dispatch) instead of reverting on that outcome.
