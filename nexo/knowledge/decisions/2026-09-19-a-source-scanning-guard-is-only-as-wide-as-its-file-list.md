# A source-scanning guard is only as wide as its file list

**Date:** 2026-09-19
**Surfaced by:** the feature-tier mutation pass of `feature-20260918-kanban-pipeline-leads`, survivor 1

## The shape

Some invariants can only be asserted by ABSENCE: "no board action ever calls `POST /sales/:id/transition`".
There is no behaviour to observe, because the correct implementation does nothing.
This repository's answer is a source-reading test that lists the files it owns, reads them with `readFileSync`, and fails if a forbidden symbol appears.
That pattern works, and it works well: it carries a mandatory planted-violation positive control, and injecting the forbidden call into a listed file killed it instantly.

Its failure mode is not vacuity.
It is SCOPE.

The Kanban feature's scanner listed `apps/web/src/sales-ops/leads/*`, which is where the board lives.
The real board-to-proposta path was not there: it was `saveLeadConversion` inside `SalesOpsApp.tsx`, a file the scanner never opened.
Injecting `transitionSale.mutate({ saleId, status: 'open' })` into its success path left **all 911 web tests green**.
That is a board action materializing a sale status change - and one `status: 'won'` away from materializing payables - under a fully green suite.

**A positive control cannot see this.**
The control proves the scanner can still find a planted hit *in a file it reads*.
It says nothing about a file it does not read.
Vacuity is visible from the failing side; scope is visible only from the mutation side.

## Why the obvious fix is usually wrong

The instinct is to add the missing file to the list.
That often fails, because the file has more than one job.
`SalesOpsApp.tsx` also hosts the propostas screen, whose `onTransition` IS the rightful caller of that endpoint and is the only writer of `sale.status` in the product.
A file-wide ban would fail on correct code, and a guard that fails on correct code gets deleted.

## The rule

Scan a REGION, not a file, and let the region travel with the code.

The repair used explicit sentinels in the source:

```
/* BOARD-WRITE-FENCE:START conversion-handlers */
...
/* BOARD-WRITE-FENCE:END conversion-handlers */
```

Only the text between them is scanned.
Three properties are what make a sentinel fence honest rather than decorative, and all three are needed:

1. **Each fenced region must still contain the symbol it is named for.**
   Otherwise hoisting the guarded function above a `START` escapes the fence silently; with the property, it reddens.
2. **Assert the UNFENCED remainder still contains what the fence is NOT supposed to cover.**
   Here: `does not overshoot onto the propostas screen` asserts the rest of the same file still reaches a transition endpoint.
   This proves the narrow scope is genuinely narrow rather than merely assumed, and it is the specificity control - "refuses everything" would otherwise pass as "refuses the right thing".
3. **Pin any wiring one-liner that sits outside the fence to its exact delegating shape**, so a violation injected at the call site is caught too.

Extraction into a new module is the cleaner answer and was rejected here for a good reason worth repeating: the two handlers closed over six pieces of component state, and the move could not be proven behaviour-preserving inside a guard-only change.
A fence you can prove beats a refactor you cannot.

## Generalisation

Any guard that enumerates its subjects - a file list, a directory glob, a pathspec exclusion, an `OWNED_FILES` constant - silently stops covering code the moment that code moves outside the enumeration.
The enumeration is a claim about where the behaviour lives, and nothing re-checks that claim.

So, whenever a guard enumerates:

- write down, next to the list, WHY those are the right subjects and what would make them wrong;
- prove the scope by mutating the property in a file OUTSIDE the list, and check the guard notices or state plainly that it cannot;
- prefer a sentinel that lives in the code over a path that lives in the test, because the sentinel moves when the code moves and the path does not.
