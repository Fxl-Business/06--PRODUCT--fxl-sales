# Unassigned leads are a shared pool claimed on first write, and board writers share one per-org lock

**Date:** 2026-10-07
**Surfaced by:** run `20261007T181210Z-leads-sem-vendedor`

## Context

The Construbom imports 114 prospect leads with no vendedor and wants every vendedor to see them and work them.
A non-admin only saw leads whose `seller_person_id` was their own pessoa.
While planning the claim, a pre-existing deadlock (`40P01`) between two moves in one column and a duplicate-position bug on concurrent creates were found.

## Decision

A non-admin whose pessoa is an active vendedor sees own leads plus `seller_person_id IS NULL` leads through one predicate, `leadSellerCondition`.
The first write by such a vendedor (move or any PATCH) claims the lead in the same transaction, after the row lock and the `already_converted` refusal.
An admin never claims, and a non-vendedor non-admin keeps today's scope.
`insertLead` and `moveLead` take one per-org transaction advisory lock, `lockLeadBoard`, after the scope gate and before any card row lock; PATCH and reads take none.

## Consequences

- The race between two vendedores is decided by `FOR UPDATE` plus READ COMMITTED re-evaluation: the loser answers `not_found`. The isolation level must never be raised.
- Creates and moves of one org serialize for a few milliseconds each, and an import holds the board for its transaction.
- Every future writer of `stage_id` or `position` must take the lock first.
- No schema change and no `audit_log` entry for a claim.
- Open: no `lock_timeout` on the board lock, so waiting requests hold pooled connections during a long import.

## Alternatives considered

- A claim button or an admin assignment step: slower for the team and unnecessary when "whoever acts first" is the rule.
- Letting admins claim: one stray drag would take a pool lead away from every vendedor.
- Retry on `40P01`: hides the deadlock behind latency and does not fix the duplicate position.
- Stage-row locks: collide with `reorderLeadStages` and add a second lock order.
- Per-stage advisory locks: a move touches two stages and needs a canonical order, for no gain at this scale.
