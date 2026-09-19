# A green suite is not a measurement until you mutate it

**Date:** 2026-09-19
**Surfaced by:** `feature-20260918-kanban-pipeline-leads`, feature-tier mutation pass: 22 mutations, 18 killed, 4 survived

## The shape

Every slice of that feature was verified by a separate agent, each of which ran a per-slice mutation battery and required every mutation to redden a NAMED test.
Eight slices, roughly seventy mutations, all green.
The feature then ran ONE cross-slice pass over the integrated trunk, and four mutations survived - one of them a board action that could materialize payables.

The reason is structural rather than a lapse: **a per-slice verifier only ever sees one slice's diff.**
Every property that spans a boundary - two files, two suites, two layers, two slices - is invisible to every reviewer in the run.
Each half is pinned; nothing pins the join.

The three real survivors were all joins:

- The enforcement of a fence lived in one directory and the behaviour it fenced lived in another (see `2026-09-19-a-source-scanning-guard-is-only-as-wide-as-its-file-list.md`).
- The API wire and the web wire were two independent hard-coded literals with NOTHING between them.
  Renaming the key in the API schema plus its service killed ten API tests and left the entire web suite green; the reverse is equally true.
  The schema is `.strict()`, so the production consequence is a hard `400` on every single user action while both suites are green.
- A function whose comment says it fails CLOSED was made to fail OPEN, and 911 tests stayed green.
  A documented invariant with no oracle is a comment, not a property.

## What the pass is actually for

Not to raise a score.
It is to convert "the suite is green" - which is one bit, and is the same bit whether the suite looked or not - into a list of the specific things the suite CANNOT see.
Three of the four holes here were things a careful reader would have sworn were covered, because a test existed with the right name.

## How to run one so it is worth the cost

- **Target joins, not lines.** Cross-slice, cross-layer, cross-suite. Where two files agree on a literal with nothing enforcing the agreement, mutate one side and judge with the OTHER side's suite. That is what measured survivor 2.
- **Judge each mutation with the suite that OUGHT to catch it, and name the test that went red.** "Something failed" is not a kill; a kill is a named test whose title states the property.
- **Record weak kills.** Two mutations died here on `a move into the conversion stage requires a saleId that resolves in-org`, a test about something else that happens to move a converted card as a fixture step. That is a kill today and an accident tomorrow: refactor the fixture and the rule is silently un-defended. A weak kill belongs in the report next to a survivor, not in the KILLED column unqualified.
- **Hide the mutation from the guard where a guard exists.** A regex guard plus a behavioural oracle look like two defences; they are one until you prove it. Writing the mutation as RAW SQL, or as a second UPDATE that leaves the scanned `set` object byte-identical, made the source guard stay GREEN while the behavioural test died - which is what proved the behavioural oracle independently decisive. Do this deliberately; it is the only way to tell defence-in-depth from a duplicate.
- **Report a survivor that the DATABASE absorbed, and say so.** One leak survived only because RLS returned zero rows over the non-superuser test role. The identical leak one scope inwards died instantly. That is not a defect, and it is not a pass either: it records that a named test is load-bearing on the RLS posture of a table, which nothing else in the tree says.
- **Give every survivor the exact oracle that would kill it**, or state plainly that none is worth adding. A survivor with no follow-up is a complaint.

## The rule

A property that crosses a boundary is unverified by default, however many green tests name it.
Run one cross-boundary mutation pass per feature, after the waves are green, and treat its survivors as the feature's real test report.
