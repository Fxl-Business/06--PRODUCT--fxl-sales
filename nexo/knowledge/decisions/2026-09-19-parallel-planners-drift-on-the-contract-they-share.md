# Parallel planners drift on exactly the contract they share

**Date:** 2026-09-19
**Surfaced by:** `feature-20260918-kanban-pipeline-leads`, two consecutive plan-check REJECTIONS before a line was executed

## What happened

Eight slice plans were written concurrently, each one thorough, each one internally coherent, each one citing the others.
The set was not executable.

The first plan-check found six defects, three of which would have stopped execution outright:

- Slice 02 was planned against a table with a `slug` column and a four-value `kind`; slice 01, the schema owner, has neither.
  Its service would have failed at `INSERT` with `column "slug" does not exist`, and several of its own named oracles could never have passed.
- Slices 02 and 03 each instructed the same file to `import { leadsRouter }` from a different module.
  Applied literally in sequence: duplicate-identifier compile error, with neither plan naming the fix.
- A phantom enum value (`'converted'`) was used by three slices and only half-repaired by a fourth, leaving a genuine DESIGN question - what read-only means now that the terminal stage does not exist - for an executor to answer, which the planner contract forbids.

A second, independent plan-check rejected the revision too, for two residues the sweep had missed: one slice would still have committed the dead type name **into `CLAUDE.md`**, and another's code block used a constant the paragraph directly below it explained could not exist.

## Why it happens, and why it is not a quality problem

Each planner read the shared contract at a different moment, or read a draft of it, and then reasoned locally and correctly from what it had.
Nothing in a parallel fan-out re-reads the fan-out.
The drift lands precisely on the shared surface - the schema, the wire body, the enum, the module identifiers - because that is the only thing more than one planner touches.

Thoroughness makes it worse, not better.
Each plan was detailed enough to specify literal code, so each disagreement became a compile error rather than a vague ambiguity, and each plan cited the others confidently enough to look reconciled.

## The rules

- **Fan out planning if you like, but never execute a fan-out unreviewed.**
  A plan-check over the SET, by an agent that read none of the plans as it was written, is the only thing that sees the join. Here it paid for itself twice.
- **Name an OWNER per shared surface, before planning, and let the owner win every dispute.**
  The resolution rule that closed all six findings was one sentence: slice 01 owns the schema, slice 03 owns the wire contract. Without a declared owner, reconciliation is a negotiation and produces a third variant.
- **Write the reconciliation into the durable plan, not into the run log, and say it must not be reopened.**
  Six months later the contradiction is still readable in eight plan files; only a "Contrato reconciliado" section in the overview stops a reader re-deriving the losing side.
- **Re-check every slice for the defect class you just fixed in one slice.**
  Finding 4 was closed in the slice that named it and left standing in the slice that had never been re-read. Sweeping one instance is not closing a class.
- **Re-check the plan-check's own output too.** The second checker's two findings were both "the revision did not sweep everything"; neither was a new design flaw.
- **A third round is dispensable when the evidence is mechanical.**
  The second report carried an exhaustive live-vs-documentary occurrence table, and closure was confirmed by deterministic grep rather than by an agent's reading. Grep is cheaper and more trustworthy than a third opinion, when the question is "does this string still appear".

## The sharpest instance

The worst finding of the second round was not a compile error.
It was that a slice would have committed a nonexistent type name into `CLAUDE.md`, where this repository treats prose as law.
A plan defect that lands in code fails loudly at the next build; a plan defect that lands in documentation ships and becomes the instruction the next person follows.
See `2026-09-19-documentation-that-is-law-is-code.md`.
