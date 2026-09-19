# Documentation that is law is code, and it fails verification like code

**Date:** 2026-09-19
**Surfaced by:** `feature-20260918-kanban-pipeline-leads`, both of the run's two verify FAILs

## The observation

Eight slices, seven waves, a new database schema, a new API surface, two new screens, a new dependency and a conversion flow that spans three requests.
**Every gate failure in the run was a false sentence in `CLAUDE.md`.**
Not one was a defect in code, in a test or in control flow.

That is not an accident of this feature.
In a repository where a prose file is the contract that agents and humans both read before touching anything, a false statement in it is a shipped defect with a longer half-life than a bug: a bug fails the next build, a false law gets FOLLOWED.

## The two failures

**Slice 07.** The new section asserted that a converted card "sits in a final READ-ONLY column that mirrors `sale.status`".
Three falsehoods in one sentence: no column is read-only, there is no final column, and it is the card - not any column - that mirrors `sale.status`.
The shipped code says the opposite three times, in three unprompted comments.

The origin is worth naming, because it is reproducible: the text was copied from the original acceptance criterion's raw wording, without applying the reconciliation decision that had SUPERSEDED that criterion during planning.
The requirement and the decision that overrode it both existed in writing, and the writer took the older one.

Left in, that sentence would have been a standing instruction to a future implementer to build exactly the design the plan-check had deleted.

**Slice 08.** The section states the line count of a file, to justify a "no new screen goes in here" fence.
The commit deliberately rewrote the number and wrote it wrong, six off.
The same number had already had to be repaired once, one slice earlier, in the same feature.

The sentence carries a self-exemption - "the number is here to justify the fence, not to be maintained: if it is stale, the fence still stands" - and that exemption is real and correct.
It excuses a number that goes stale under a LATER commit.
It does not excuse a commit that reaches in, rewrites the number, and writes a false one.

The same slice also left two in-code comments false, by hoisting two symbols out of the file whose comments described them as local.
Nothing catches that: not lint, not type-check, not a test.

## The rules

- **A documentation change gets verified like a code change**, by a separate agent, clause by clause against the shipped code. The slice-07 re-verify checked thirteen clauses individually; that is the right granularity, and it is what caught that the fix introduced nothing new.
- **When a decision SUPERSEDES a requirement, the documentation must be written from the decision, and must say the requirement was superseded.**
  The repaired bullet does exactly this: it quotes the original wording only in order to record that it was overridden. This file already uses that device for `sales.core` and for the renamed `FXL_HUB_*` variables, and it is the reason a later reader does not re-derive the losing design.
- **Verify a documentation fix by RESIDUE GREP, not by reading.**
  Grep the whole file for every phrasing of the deleted concept and expect exactly the known, deliberate occurrences. A read confirms the sentence you changed; a grep confirms the ones you forgot.
- **A self-exempting number still has to be true on the commit that writes it.**
  Either do not touch it, or measure it. Writing it from memory is how the same number breaks twice in one feature.
- **A hoist, a rename or a move must sweep the COMMENTS that name the old home.**
  A comment justifying a design decision by a fact that is no longer true is worse than no comment: it is a wrong reason attached to right code, and every automated gate is blind to it.
- **Loose is not false, and does not justify a third correction cycle.**
  One phrase in this section cites an internal service reason where a reader might expect the wire body. Both tokens exist, and the sentence does not claim to quote the body. It was filed to tighten next time the bullet is touched, rather than spending another verify round. Distinguishing "loose" from "false" is what keeps this discipline affordable.
