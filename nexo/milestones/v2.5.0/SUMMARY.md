# v2.5.0 - safe archive, audit history and restore

Released 2026-08-06. Release commit `71ddfbd`. Promoted master -> staging -> production.

Note on numbering: the work was planned under `current_milestone_id: v2.4.0`, but v2.4.0 had already
been tagged and promoted, so the plan-set's `milestone:` frontmatter trails the version it shipped in.
The runs are the authoritative record; `current_milestone_id` advances to v2.6.0 here.

## What shipped

1. **The produto wizard stopped saving behind the operator's back.** Its primary button chose its own
   `type` from the step, so the step 3 -> 4 click was the one click that changed the element's own
   activation behaviour. React 18 flushes a discrete event's state update synchronously, so the
   re-render landed between the event dispatch and the browser's activation behaviour - the browser
   then asked "is this a submit button?" of an element React had already rewritten to `submit`. The
   button is now `type="button"` on every step, which is the shape the proposta wizard always had.
2. **Archiving as a safe delete.** `Arquivar` / `Restaurar` on produtos, áreas, funções and pessoas,
   behind a confirmation, as a status-only PATCH on endpoints that already existed. No DELETE verb was
   added and none may be: an archived produto permanently occupies its `code_suffix` slot and archived
   funções stay visible on the people who carry them.
3. **The cadastros entered the audit ledger.** Archive and restore append a hash-chained `audit_log`
   entry from inside the same transaction as the status write, with the actor's display name
   snapshotted at write time from the verified token.
4. **An org-scoped history in Configurações**, with restore, reading a new endpoint rather than the
   cross-tenant admin audit router.

## Key decisions

- **The history read had to be a new endpoint.** `/api/v1/admin/audit` reads through `getAdminDb()`,
  documents `audit_log` as cross-tenant, and applies no org filter, while `requireAdmin` here is a Hub
  WORKSPACE role rather than a platform superuser. Reusing it would have handed one tenant every other
  tenant's audit trail. `audit_log` carries no RLS, so the `actorOrgId` predicate is the sole control.
- **The actor name is snapshotted at write time.** `sales_ops_people` has no account-id column and the
  Hub SDK exposes no directory, so there is no join path from a Hub account id to a pessoa. Without
  the snapshot the history could only ever have named the reader themselves.
- **Cliente archiving was deferred**, not half-built. `sales_ops_clients` has no `status` column, so a
  `PATCH {status}` is a zod-stripped no-op returning 200. Shipping the API half alone would have meant
  an irreversible migration behind a code path with no caller. Recipe in the run's `00-OVERVIEW.md`.
- **A restore is a new ledger entry, never an undo**, because the chain is append-only and
  hash-verified.

## What the gates caught

- An adversarial plan-check found **ten** collisions across four independently-planned slices before
  any code was written, including two slices both claiming migration `0019`, a restore fan-out that
  could have silently reverted a rename made in another tab, and an entityType vocabulary mismatch
  that would have made the whole history silently read-only.
- Gate 2 proved the **planned atomicity oracle did not work**: under the `db`-for-`tx` mutation the
  entire integration suite stayed green, because both planned rollback probes throw before the ledger
  entry exists. The real discriminator is a `DEFERRABLE INITIALLY DEFERRED` constraint trigger firing
  at COMMIT.
- Earlier in the same milestone Gate 2 rejected two slices outright: a blank
  `HUB_SESSION_ENCRYPTION_KEY` that stopped the API booting, and an exploitable open redirect where
  dot-segment normalization escaped a same-origin check.

## Carried forward

- `writeAuditEntry` has a pre-existing hash-chain race under concurrent writes; this release adds four
  new writers, so the exposure is higher. Filed.
- `/api/v1/admin/audit` still 500s on its raw BigInt id. Filed, deliberately untouched.
- Migration 0019's `CREATE INDEX` is not `CONCURRENTLY`.
