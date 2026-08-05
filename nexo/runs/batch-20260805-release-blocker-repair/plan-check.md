# Release blocker repair plan check

## Verdict

FAIL.

The plan set covers the approved design, but two defects must be corrected before execution.

## Blocking findings

### 1. Slice 03 omits a known required file from its load-bearing frontmatter

`03-dependency-audit-remediation.md` declares only `apps/api/package.json`, `apps/web/package.json`, and `pnpm-lock.yaml` in `files_modified`.
Its plan treats `pnpm-workspace.yaml` as a conditional late addition.
That is incompatible with Nexo because wave derivation and parallel-safety certification consume `files_modified` before execution starts.

The current production audit exits zero and the current full audit exits one with six high findings.
An isolated execution of the plan's targeted update selected `postcss@8.5.25` and `brace-expansion@5.0.9`, but it left `brace-expansion@1.1.15` in the lockfile.
The full audit therefore still reported three high findings.
Adding the plan's selector-specific `brace-expansion@<1.1.18` override resolved the remaining high findings.
The override is required for the current graph, not an unresolved optional branch.

Exact required edits:

- Add `pnpm-workspace.yaml` to slice 03 `files_modified` frontmatter.
- Add `pnpm-workspace.yaml` to the Task 2 modified-file list.
- Make the `brace-expansion@<1.1.18: 1.1.18` override and subsequent lockfile regeneration mandatory for the current graph.
- Keep the `brace-expansion@>=4.0.0 <5.0.9` override conditional or omit it because the targeted update already selects `5.0.9`.
- Stage `pnpm-workspace.yaml` explicitly in the atomic capture command.

### 2. Slice 02 contains placeholder test bodies

`02-professional-payable-identity.md` presents three required migration tests as `it(..., () => {});`.
Those empty callbacks are placeholders even though prose below describes the intended assertions.
The checker contract requires complete executable plans without placeholder code.

Exact required edit:

- Replace all three empty test bodies with complete assertions for journal ordering, SQL and snapshot existence, nullable column and indexes, composite foreign-key direction, admin context, conservative backfill, uniqueness, and replay safety.
- Alternatively, remove the placeholder code block and provide complete mechanical pseudocode with exact paths, regular expressions, and assertions for every named test.

## Slice review

### Slice 01: Session refresh serialization

PASS after plan review.
The named Red oracle exercises two independent durable stores, real Hono middleware, and PostgreSQL.
The current implementation permits the stale hydration and later delete that the oracle expects.
The transaction handle, row-lock placement, synchronous public store interface, error phases, rollback behavior, file paths, and focused commands align with the repository.

### Slice 02: Professional payable identity

FAIL because of the placeholder test bodies above.
Apart from that defect, the migration number is the next journal index, the Drizzle generation command and paths exist, all current materializer call sites are covered, and the proposed string and nullable identity types align with Drizzle's UUID types.
The composite organization, sale, and professional relationship is feasible and the plan preserves the generated snapshot rule by generating rather than hand-editing it.

### Slice 03: Dependency audit remediation

FAIL because `pnpm-workspace.yaml` is already known to be required but is absent from the frontmatter and primary capture contract.
The audit commands, direct tooling roots, patched versions, and narrow override syntax are otherwise valid.

### Slice 04: Generated diff hygiene

PASS after behavior validation.
The current release diff produces exactly four whitespace errors from the two historical context packs.
The rule `nexo/runs/**/context-pack.md -whitespace` makes the release diff check pass, reports `whitespace: unset` for both generated paths, and leaves an ordinary file subject to trailing-whitespace rejection.
The plan does not edit either generated snapshot.

## Plan-set invariants

The four slices cover all four approved blockers and preserve the post-integration release verification requirement.
Their functional changes are independent, so empty `depends_on` lists are valid.
The currently declared paths do not overlap.
Adding the required `pnpm-workspace.yaml` path to slice 03 still creates no overlap with another slice.
Scope limits are explicit and no slice authorizes tagging, staging promotion, production promotion, or milestone closure.
All generated-file rules are respected except that slice 02 must eliminate its placeholder test bodies before execution.
