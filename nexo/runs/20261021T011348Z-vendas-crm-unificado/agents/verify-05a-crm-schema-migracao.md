# Verify 05a-crm-schema-migracao - PASS

Commands (slice worktree, run one at a time against Docker Postgres 5006):
- vitest run src/db/__tests__ : 8 files, 102/102 (includes additive-migrations-guard, single-role-db-contract, crm-schema 26/26)
- Oracle test/rls/crm-schema-rls.test.ts : 45/45
- leads-schema-migration 12/12, lead-stages-rls 11/11, leads-rls 6/6
- api lint 0, type-check (src, scripts, test) 0
- root node --test dockerfile-workspace-deps + api-test-typecheck : 10 pass, 0 fail
- drizzle-kit generate --name probe in scratch copy: "No schema changes, nothing to migrate"

Manual SQL read: no DROP/DELETE/TRUNCATE/RENAME/ALTER TYPE/GRANT/ROLE statements (only column names deleted_*, comment words). 10 CREATE TABLE, 10 ENABLE + 10 FORCE RLS, 20 CREATE POLICY. Every ALTER TABLE/INDEX targets a new table. All FKs composite, org_id first. schema.ts 409 added, 0 removed; journal +7. No existing table, legacy leads, events, payables, settlements or sales code touched. No em dash in new files.

Mutations (scratch copy): removing FORCE on sales_ops_crm_leads: 3 tests red (FORCE check, tenant read isolation leak, cross-org write). Removing notes tenant policy: suite red (45 skipped, setup-level failure, so weaker evidence than M1).
ADR: cites survey, D2 pendencias line, 0031 resync paragraph, Cliente backing-column line present.

Minor: ADR line says the dev seed deletes the new tables via SEED_DELETE_ORDER but the diff does not touch seed-dev; confirm slice 06 owns it.
