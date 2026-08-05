---
id: 20260805-release-blocker-repair
milestone: v2.4.0
status: done
mode: autopilot
approved_at: 2026-08-05
---

# v2.4.0 release blocker repair design

## Context

The independent release verification of commit `5162d4d` rejected the proposed `v2.4.0` release before Gate 3a.
The release must remain untagged until the four verified blockers are repaired and a fresh independent release verification passes on the exact new `master` commit.

## Scope

This repair batch contains four independently verifiable slices:

1. Serialize durable Hub session refreshes across API replicas.
2. Give professional payables a durable professional identity.
3. Remove all high-severity findings from the full dependency audit.
4. Make the release diff hygiene gate pass without editing generated context-pack snapshots.

The batch does not change user-facing workflows, introduce new product capabilities, promote production, or close the milestone.
The staging cut remains Gate 3a and requires explicit human approval after release verification passes.

## Durable session concurrency

### Problem

Two replicas can hydrate the same rotating Hub refresh token before either request flushes.
One request can persist the rotated token while the stale request receives a Hub rejection, deletes the shared database row, and clears the browser cookie.

### Design

`withRequest` will execute hydration, the BFF handler, and persistence inside one admin-database transaction.
When a request carries a session id, hydration will lock the matching live session row with `SELECT FOR UPDATE` before decrypting it.
The lock remains held through the Hub back-channel request and the final session mutation flush.
Concurrent refreshes for the same session therefore serialize across processes and replicas.
The waiting request reads the newly committed token instead of acting on a stale token.

Requests for different sessions remain independent.
Login transaction consumption remains database-atomic inside the same request transaction.
Hydration failures continue to fail closed as a 503 before the BFF handler runs.
Handler failures continue to propagate normally.
Persistence failures after a response is formed retain the existing bounded behavior: the transaction rolls back, the failure is logged, and no partial session mutation commits.

### Rejected alternatives

An in-process mutex cannot coordinate multiple replicas.
An optimistic compare-and-swap can preserve the database row, but the stale SDK response can still clear the browser cookie.
A database row lock is the smallest mechanism that protects both token rotation and the resulting HTTP behavior.

### Test contract

The Red oracle uses two independent durable-store instances and the real integration database.
The first request rotates a token while a concurrent request targets the same session.
Before the fix, both requests can hydrate the old token and the stale delete removes the rotated session.
After the fix, the second request waits, observes the current token, and the final session remains readable with the rotated value.

## Professional payable identity

### Problem

Professional payable idempotency currently uses display name plus receivable.
Display names are not unique, so one surviving paid payable can suppress another same-name professional's payable during a won to open to won cycle.

### Design

Migration `0018` will add nullable `sale_professional_id` to `sales_ops_payables` and index it.
The column will reference the originating `sales_ops_sale_professionals` row through an organization-safe relationship.
Every newly materialized `professional_cost` payable will persist this id.
Commission, tax, and other-cost payables will keep the column null.

Sale creation will retain the inserted professional row ids before materializing payables.
Status transitions already load professional rows, so they will pass those ids into the materializer.
Professional idempotency will match non-void existing payables by professional id and receivable id.

Migration backfill will populate the id only where one existing sale professional is an unambiguous match for the payable's organization, sale, and beneficiary snapshot.
Ambiguous legacy rows will remain null rather than guessing an identity.
For those rows only, a consumable legacy multiset keyed by beneficiary snapshot, receivable, and amount will ensure that one historical payable suppresses at most one candidate draft.

### Rejected alternatives

Array position is unstable when a proposal is edited.
Name plus amount is not an identity and still collides when two professionals have equal costs.
A durable foreign identity is the only long-term-safe key.

### Test contract

The Red oracle exercises the real `transitionSale` integration path.
It creates two allocated professionals with the same display name, wins the sale, marks one professional payable paid, reopens the sale, and wins it again.
Before the fix, the surviving row suppresses both professionals.
After the fix, the surviving row suppresses only its source professional and exactly one payable is created for the other professional.
The total payable amount and tenant isolation must remain correct.

## Dependency security

The dependency slice will apply the narrowest compatible direct-tooling upgrades that resolve the vulnerable `postcss`, `brace-expansion`, and related transitive paths.
It will regenerate `pnpm-lock.yaml` through pnpm rather than editing the lockfile manually.
Package overrides are permitted only when a current compatible upstream graph cannot select a fixed transitive version.
Broad unrelated runtime upgrades are out of scope.

The Red oracle is the current nonzero `pnpm audit --audit-level high` result with six high-severity findings.
Green requires both `pnpm audit --prod --audit-level high` and `pnpm audit --audit-level high` to exit zero, followed by the full test, lint, type-check, and build gates.

## Generated context-pack diff hygiene

The two failing context packs are generated historical snapshots and must not be edited manually.
A narrowly scoped `.gitattributes` rule will classify `nexo/runs/**/context-pack.md` as generated output for whitespace checking.
The historical snapshots remain byte-for-byte unchanged while `git diff --check` continues enforcing whitespace rules everywhere else.

The oracle is `git diff --check v2.3.1..HEAD`.
A negative control will add trailing whitespace to a normal non-generated file and prove that the gate still rejects it.

## Execution and delivery

The four items form a Nexo autopilot batch.
Each implementation slice starts with its named failing oracle, reaches Green with the smallest production change, and is verified by a different agent.
Each verified slice lands through an atomic Conventional Commit and a no-fast-forward merge into `master`.
The full repository suite, lint, type-check, build, integration suite, dependency audits, and security review run again at the integrated boundary.

After all slices are Green, a fresh independent ship verifier will grade the exact `master` release commit.
A PASS will reopen Gate 3a with the updated release contents and proposed version.
No tag or staging push occurs before that approval.
