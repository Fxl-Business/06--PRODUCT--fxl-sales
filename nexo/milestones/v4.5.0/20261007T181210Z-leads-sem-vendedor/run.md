# Run record: leads sem vendedor

Run id: `20261007T181210Z-leads-sem-vendedor`
Mode: autopilot, milestone v4.4.0 plan, integrated on `feat/20261007-00-run`.
Plan: `nexo/plans/leads-sem-vendedor/00-OVERVIEW.md`.

## Request

Leads without a vendedor are visible to every vendedor and claimed by whoever acts on them first (Prospecção, leads edition and full).
Decisions: a non-admin sees own plus unassigned leads, a move or edit claims in the same transaction, an admin never claims, and the card shows `Sem vendedor - disponível`.

## Slices

| Slice | Slice commit | Merge | What |
| --- | --- | --- | --- |
| 01-api-claim | 7884a82 | 94cc43e | Pool visibility and claim-on-write in `lead-service.ts` (`leadSellerCondition`, AC1-AC8) |
| 02-web-marker | 1e1fc57 | c6289bd | Card and Lista marker `Sem vendedor - disponível` (AC9) |
| 03-move-lock-order | b6066dd | d52389c | Per-org advisory lock `lockLeadBoard` for `insertLead` and `moveLead`, added mid-run |

## Verify

- Slice 01: oracle 2 files, 29/29 twice; regression 46/46 integration and 42/42 unit; PASS.
- Slice 02: oracle 20/20; leads folder 28 files, 277/277; mutation probe killed 3 mutants; PASS.
- Slice 03: oracle 5/5 three times; removing the lock turns 4 of 5 red; regression 93/93 integration and 339/339 unit; PASS.
- Wave 1 (c6289bd): lint, type-check, `pnpm test`, integration 47 files and 372 tests on a clean checkout, build and audit all green; a first integration run failed only because of an uncommitted experiment from the slice 03 planner in the worktree, which was removed.
- Wave 2 (d52389c): lint, type-check, unit 3243 passed plus 91 node:test, integration 48 files and 377 tests, build clean, audit with no high advisories (13 pre-existing); PASS.
- Feature-tier mutation testing: no tool is configured, so it closed `not_applicable`.

## E2E

`make dev-fake` on `org_fake_leads`: the gestor created an unassigned lead and saw the dashed pill on the Quadro card and the Lista row; the vendedor saw own leads plus the pool and not a colleague's lead.
Over HTTP the vendedor's move claimed the lead with the server-side name, and the gestor's move left it unassigned.
The browser drag itself was not completed because the Chrome extension disconnected.
Details: `e2e.md`.

## Decisions

- The waves were integrated on the run branch and `master` is fast-forwarded once, because another agent works in the main checkout.
- Slice 03 was added mid-run after the deadlock and duplicate-position bug were found.
- A converted lead with no vendedor keeps the plain `Sem vendedor`.
- A non-vendedor non-admin keeps today's scope.
- Decision record: `nexo/knowledge/decisions/2026-10-07-unassigned-lead-pool-and-board-lock.md`.
- Rules: `CLAUDE.md` (Kanban de leads) and `nexo/knowledge/reference/kanban-de-leads.md`.

## Audit

`AUDIT.md` lists the autopilot decisions and the open items: test the real browser drag, the optional `lock_timeout`, and the `meus-dados/leads` subtitle copy.
