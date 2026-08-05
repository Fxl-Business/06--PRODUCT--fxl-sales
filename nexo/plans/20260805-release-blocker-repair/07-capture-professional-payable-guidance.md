---
id: 07-capture-professional-payable-guidance
milestone: v2.4.0
status: done
depends_on: [05-legacy-professional-one-shot-reconciliation, 06-phased-professional-identity-migration]
files_modified:
  - CLAUDE.md
  - nexo/ROADMAP.md
acceptance: "given the verified professional identity and legacy reconciliation behavior, when a future agent reads the standing project guidance and roadmap, then the guidance describes the shipped durable-ID and one-shot rules and the completed same-name collision is no longer presented as unfixed backlog"
---

# Capture Professional Payable Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authoritative project guidance agree with the verified v2.4 payable identity, legacy one-shot reconciliation, and safe migration behavior.

**Architecture:** Replace the obsolete beneficiary-keyed limitation in `CLAUDE.md` with the exact durable-ID and legacy fallback invariants.
Remove only the completed same-name payable collision from `nexo/ROADMAP.md` while preserving every unrelated backlog item.

**Tech Stack:** Markdown, Nexo capture conventions, and repository diff checks.

## Global Constraints

- Execute this slice only after slices 05 and 06 have separate-agent Verify PASS results.
- Describe only behavior proven by tests and the deployed migration runner.
- Put each complete Markdown sentence on its own physical line.
- Use plain hyphens and no em dash.
- Do not change managed text inside the `nexo:managed` markers in `AGENTS.md`.
- Do not edit `CHANGELOG.md`, generated snapshots, generated context packs, migration metadata, or production code.
- Remove only the completed same-name payable-identity roadmap item.
- Preserve the separate `cancelContract`, mixed receivable, route coverage, UI ordering, and other unrelated backlog entries.
- Run every command once without watch mode and stop every process started for this slice.

---

## File map

- `CLAUDE.md` is the standing domain guide for payable generation and migration behavior.
- `nexo/ROADMAP.md` is the human backlog and must no longer list completed work as pending.

### Task 1: Lock the stale-guidance Red oracle

**Files:**

- Modify: none before recording Red.

- [ ] **Step 1: Prove the standing guidance still contradicts the implementation**

```bash
rg -n "re-win guard keys on|still collide|not in this milestone|payables\.sale_professional_id" CLAUDE.md nexo/ROADMAP.md
```

Expected Red: `CLAUDE.md` says the re-win guard is beneficiary-keyed and identity is absent, while `nexo/ROADMAP.md` lists the same-name collision as unfixed.

### Task 2: Curate the authoritative domain guidance

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the obsolete three-line limitation**

Replace the guidance around current lines 157 through 160 with complete sentences that pin all of these verified facts.

- Newly materialized `professional_cost` payables persist `sale_professional_id` from the originating `sales_ops_sale_professionals` row.
- Current split-row idempotency matches durable professional ID plus receivable ID, never display name.
- Migration `0018_professional_payable_identity` backfills only one unambiguous same-organization, same-sale, same-beneficiary match and leaves ambiguous identities null.
- Null-ID split rows use a consumable `(beneficiary_name, receivable_id, amount_brl)` multiset, so one historical row suppresses at most one candidate.
- A surviving v2.3.1 full-cost one-shot has null receivable and covers exactly one professional before per-receivable parts are considered.
- An identified full-cost one-shot covers its durable professional ID, while an ambiguous null-ID one-shot is consumed once by beneficiary snapshot plus full cost.

- [ ] **Step 2: Add the migration deployment invariant beside the identity guidance**

State that migration 0018 is applied by the shared repository migration runner in phases.
State that indexes are concurrent, the FK is added not-valid then validated, and the conservative backfill runs in bounded transactions.
State that production and integration startup must not bypass the shared runner with the stock all-migrations Drizzle transaction.

### Task 3: Resolve the completed roadmap entry

**Files:**

- Modify: `nexo/ROADMAP.md`

- [ ] **Step 1: Remove exactly the completed same-name payable collision line**

Delete the backlog line beginning with `fix: the professional_cost re-win guard keys on` and referring to `payables.sale_professional_id`.
Do not rewrite or reorder neighboring items.

### Task 4: Verify capture consistency

- [ ] **Step 1: Prove stale statements are gone and required guidance is present**

```bash
! rg -n "re-win guard keys on \(kind, receivable_id, beneficiary_name\)|still collide|not in this milestone" CLAUDE.md nexo/ROADMAP.md
rg -n "sale_professional_id|full-cost one-shot|bounded transactions|shared.*migration runner" CLAUDE.md
```

Expected: the negative search exits zero through `!`, and the positive search finds every new invariant in `CLAUDE.md`.

- [ ] **Step 2: Inspect exact scope and whitespace**

```bash
git diff -- CLAUDE.md nexo/ROADMAP.md
git diff --check -- CLAUDE.md nexo/ROADMAP.md
```

Expected: only the obsolete guidance, replacement guidance, and one completed roadmap entry differ, with no whitespace errors.

## Verification contract

A different Verify agent must run these commands from the repository root.

```bash
! rg -n "re-win guard keys on \(kind, receivable_id, beneficiary_name\)|still collide|not in this milestone" CLAUDE.md nexo/ROADMAP.md
rg -n "sale_professional_id|full-cost one-shot|bounded transactions|shared.*migration runner" CLAUDE.md
git diff --check
```

The verifier must compare the prose to the tests and implementation from slices 05 and 06.
Any statement not directly supported by verified behavior is a failure.
No process should be started for this documentation-only slice.

## Atomic capture guidance

After separate-agent Verify returns PASS, stage exactly `CLAUDE.md` and `nexo/ROADMAP.md` and inspect `git diff --cached --check` and `git diff --cached --stat`.
Capture the slice with this Conventional Commit.

```bash
git commit -m "docs(nexo): capture professional payable safeguards"
```

Do not tag, promote staging, or close milestone `v2.4.0` in this slice.
