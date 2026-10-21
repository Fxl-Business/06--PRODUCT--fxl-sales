# Verify 13-dias-sem-comprar - FAIL

Baseline 4810029. Commands run directly (helper not used).

## Results
- shared-utils: purchase-recency 15/15, full 213/213, build, type-check green.
- API: lint 0, type-check 0, unit 1603/1603, integration (serial, local DB 5006) 62 files 555/555.
- Web: lint 0, type-check 0, vitest 158 files 1987/1987.
- Root: node --test scripts/__tests__ 112/112, no-legacy-auth and no-legacy-env-names ok.
- No em dash in added lines. Worktree status clean before and after (mutations in scratch clone).

## Checks
- Pure function never reads the clock (today is an argument); SP boundary test (02:59Z vs 03:00Z) present.
- Read only: two SELECTs, no write; test asserts sales count and max updated_at unchanged.
- leads-no-financial-impact: nothing removed; strict projection of the two keys plus a new ganho-move test. OK.
- sao-paulo-day-decisions: todayInSaoPaulo(now) 1 to 2 matches the one new decision (withPurchaseRecency). Justified.
- ClientsView uses Combobox, no native select. CLAUDE.md exception sentence accurate.

## Mutations (scratch clone)
Pure: count lost (red), UTC day (red), never=0 (red), earliest (red), drop leads (red).
Web: >= threshold (red), null as 0 (red), null first (red).
SQL: drop ganho exit filter (red). 
SQL: drop `deleted_at IS NULL` on the lead query: STAYS GREEN (7/7). 
SQL: UTC today in service (`now.toISOString().slice(0,10)`): STAYS GREEN.
SQL: drop status='won' on the sales query: green, but equivalent (pure function re-filters status).

## Findings
- MAJOR: D7 requires "a soft-deleted ganho lead does not count" to be tested (D7 test case 3). No test deletes a lead: clients-purchase-recency.test.ts (lead test near line 174) covers ganho and perdido only; purchase-recency.test.ts passes only live leads by contract. The `isNull(salesOpsCrmLeads.deletedAt)` in service.ts selectLeadPurchaseWins is unguarded. Fix: add an integration case that creates a client-bound lead, moves it to ganho, soft-deletes it (lead-trash-service delete), and expects null/null.
- MINOR: service-level SP "today" is not pinned (UTC-today mutant survives); NOW fixture is midday. Add a listClients case with now = 01:00Z (still previous SP day).
- MINOR: nexo/knowledge/reference/kanban-de-leads.md lacks the derived-exception rule (orchestrator will add).
