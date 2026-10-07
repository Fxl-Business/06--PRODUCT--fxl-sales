# E2E - leads sem vendedor (2026-10-07)

Ran `make dev-fake` from the integrated worktree (`feat/20261007-00-run` at d52389c) against the LOCAL dev database, organization `org_fake_leads` (leads edition).
Servers were stopped afterwards by process group.

## Browser (Claude in Chrome)

- As `leads-owner` (Lara, gestora) on `operacional/leads`: created `Pool E2E Sem Vendedor` with the Vendedor picker left empty.
  The Quadro card showed the dashed teal pill `Sem vendedor - disponível` beside the `hoje` badge, on one line, no wrap.
  The Lista row showed the same pill in the VENDEDOR column.
- As `leads-seller` (Leo Vendedor, non-admin) on `meus-dados/leads`: the board showed Leo's own leads plus `Pool E2E Sem Vendedor` with the marker, and did NOT show Ana Lima's lead `Rafael Souza`.
- The drag itself could not be completed in the browser: the Chrome extension disconnected mid-session.

## HTTP (same dev API, `x-fake-identity` header, the seam the browser uses)

- `GET /leads/<pool lead>` as `leads-seller`: 200, `sellerPersonId: null`.
- `POST /leads/<pool lead>/move` to `Novo` as `leads-seller`: 200, response carries `sellerPersonId` of Leo and `sellerNameSnapshot: "Leo Vendedor"`; the database row is in `Novo`, owned by Leo.
- A second lead created by `leads-owner` and moved by `leads-owner`: 200, stays unassigned in the database, and `leads-seller` still reads it (200).

Two E2E leads remain in the local dev org `org_fake_leads` (one now owned by Leo, one unassigned); they are local dev data only.
