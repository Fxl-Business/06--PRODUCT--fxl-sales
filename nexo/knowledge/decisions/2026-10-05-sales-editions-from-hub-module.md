# The Sales edition is derived from a Hub module, never stored

**Date:** 2026-10-05
**Surfaced by:** run `20261005T221616Z-edicao-leads` (milestone v4.3.0)

## Context

The Construbom needs a very small version of Sales: the leads Kanban with a few contact fields, no propostas and no predefined etapas.
FXL is the only org in use today and must change in nothing.
The wish was to switch this on from the Hub when access is granted.

## Decision

The edition is a pure function of the verified token: `resolveSalesEdition(entitlements.modules)` in `@fxl-sales/shared-utils/sales-edition`.
Only the exact module `sales.edition.leads` selects `leads`; absent, empty or unknown modules resolve to `full`, which is today's behavior byte for byte.
The API resolves it once per request in `applyHubAuthContext` into `c.get('salesEdition')` and guards whole route groups with `requireCapability` (`403 {"error":"forbidden","code":"edition_capability"}`); services take the edition as an explicit argument.
The web reads the same token (`profile.edition`, `useSalesEdition()`) and filters navigation.
Sales only READS the module; the grant is a R$ 0 SKU plus SQL in the Hub, written up in `nexo/playbooks/ativar-edicao-leads.md`.
The only schema change is additive: three nullable contact columns on `sales_ops_leads` (migration 0027).

## Consequences

- FXL is unaffected by construction, and oracle tests pin that.
- Nothing is stored in the Sales database, so there is no edition state to migrate or to drift from the Hub.
- Fail-open: if the Hub stops sending the module, the org sees the full product. Data stays valid because the leads edition only writes lead rows, pessoas and etapas.
- Activation depends on a manual Hub SQL step until the Hub gets an audited "grant module" admin action (ROADMAP).
- A third edition is one more module name plus a capability set, but there is no configurable field builder.

## Alternatives considered

- B: a per-org edition setting persisted in the Sales database. It would make the edition survive a Hub change (fail-closed), but adds a table, an admin surface and a second source of truth that can disagree with the Hub entitlement. Filed as a ROADMAP question rather than built.
- C: a separate deployment or fork of the product for the Construbom. It isolates FXL completely but splits the codebase and every fix, against the "solid, configurable core" intent.
