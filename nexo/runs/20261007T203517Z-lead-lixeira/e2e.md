# E2E - lead-lixeira (2026-10-07)

Ran `make dev-fake` from the integrated run branch at `e597739` against the LOCAL dev database, organization `org_fake_leads` (leads edition), in Chrome at 1366x617.
Servers were stopped afterwards by process group.

- As `leads-seller` (Leo Vendedor, non-admin) on `meus-dados/leads`: every open card shows a quiet `...` trigger at the top right, aligned with the contact name, no layout shift.
- Clicking it opened a menu with `Excluir` and did NOT open the edit form or start a drag.
- `Excluir` opened the in-app confirmation `Excluir lead` naming "Teste E2E Alfa" with the restore hint; focus started on `Cancelar`.
- Confirming removed the card at once and the column badge went from 2 to 1.
- The edit form of another lead shows `Excluir lead` (red, left of the footer); Escape on its confirmation closed only the confirmation and returned focus to the button.
- As `leads-owner` (Lara Gestora): `Cadastros > Leads excluídos` appears in the sidebar; the row shows Lead, Etapa, Vendedor, `Excluído por Leo Vendedor` and `07/10/2026 às 18:42` (São Paulo), no id.
- `Restaurar` showed `O lead "Teste E2E Alfa" voltou para o quadro de prospecção.`, the list emptied, and the lead was back in `Primeiro contato` (badge 3).
- Database: `audit_log` has `lead.deleted` (actorLabel `Leo Vendedor`) and `lead.restored` (actorLabel `Lara Gestora`), both with the contact name in the metadata.
- Not exercised in the browser: the `Carregar mais leads (N de M)` label and a summary larger than the loaded page (needs more than 100 leads in a column); both are covered by the slice 05 oracle.
