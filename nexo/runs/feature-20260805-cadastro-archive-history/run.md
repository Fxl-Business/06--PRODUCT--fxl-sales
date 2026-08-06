---
run: feature-20260805-cadastro-archive-history
milestone: v2.4.0
flow: feature (escalated from the requested quick)
mode: autopilot
date: 2026-08-05
trunk: master
gate1: skipped-autopilot
gate2: passed (4 slices, all independently verified)
gate3: NOT taken - awaiting human approval
---

# Run - safe archive, history and restore for the cadastros

## Scope call

The user asked for this as a `/nexo-quick`. It was escalated to the feature engine: four slices across
the schema, the API and two web surfaces is past the quick guardrail, which says to escalate rather
than cram. That call was made and stated up front, not discovered late.

## What shipped

| Slice | What |
|---|---|
| 01 | Archive/restore of a produto, área, função or pessoa appends a hash-chained `audit_log` entry from inside the same transaction as the status write |
| 03 | The `Arquivar` / `Restaurar` controls, behind a confirmation, on the four cadastro screens |
| 02 | `GET /api/v1/sales-ops/history` - org-scoped, keyset paginated |
| 04 | `Histórico de arquivamentos` in Configurações, with restore |

There is still no DELETE verb. Archiving is a status-only PATCH on endpoints that already existed.

## What the plan-check caught before any code was written

Four planners ran in parallel and could not see each other. An adversarial plan-check found ten
collisions, five of which would have shipped bugs:

- Slices 01 and 02 both claimed migration `0019`.
- Cliente was in scope for the API half and out of scope for BOTH web halves - slice 01 would have
  shipped an irreversible migration behind a code path with no caller. Cliente is now deferred
  feature-wide with a written-out recipe.
- Slice 04 assumed an actor contract slice 02 does not provide. Closed by making slice 01 snapshot the
  actor name at write time, without which the history could only ever have named the reader themselves.
- Slice 04 would have rendered `commission.created` rows in a card titled about archiving.
- Slice 04's restore was a `{id, name, status}` fan-out that could silently revert a rename made in
  another tab. It now reuses slice 03's status-only hook.

## What Gate 2 caught that the plans got wrong

**The planned atomicity oracle did not work.** Slice 01's plan claimed a specific assertion would fail
if the audit writer were handed the pooled `db` instead of the transaction's `tx`. The executor tested
that claim rather than trusting it: under the mutation, the whole integration suite stayed green,
because both planned rollback probes throw BEFORE the entry exists. Proving it needs a failure AFTER
the write, so the test now uses a `DEFERRABLE INITIALLY DEFERRED` constraint trigger that fires at
COMMIT. Verify independently reproduced both halves.

Every slice's Verify ran mutation experiments rather than reading code: deleting the org predicate
turned the isolation oracle red and printed the leaked row; rendering a raw account id turned the
actor test red; fanning out the restore payload turned four tests red across two files.

## Known limitation shipped knowingly

`writeAuditEntry` has a pre-existing hash-chain race under CONCURRENT writes: its tail lookup is
`SELECT ... ORDER BY id DESC LIMIT 1 FOR UPDATE`, which under READ COMMITTED does not re-evaluate the
LIMIT after unblocking and locks nothing on an empty table. Twelve concurrent archives left
`verifyChain` reporting `{valid:false, brokenAt:2}`. Proven pre-existing against an md5-identical copy
of the function with none of this feature's code in the path - but this feature adds four new writers
and bulk-archiving is a far more plausible concurrency source than the single money events that
existed before. Sequential traffic is unaffected. Filed to `nexo/ROADMAP.md`.

## Gate 2 evidence on the integrated trunk

lint, type-check, `pnpm test` (80 + 362 + 575 = 1017), `test:integration` (150), and `pnpm run build`
from a clean state with every `dist/` and `tsconfig.tsbuildinfo` deleted - the reproduction of Vercel's
fresh clone that caught the v2.3.0 deploy failure.

## Not done

- Cliente archiving (deferred, recipe in `00-OVERVIEW.md`).
- The audit chain concurrency fix (filed).
- `/api/v1/admin/audit`'s BigInt 500 (pre-existing, filed, deliberately untouched).
- Gate 3. Nothing has been promoted.
