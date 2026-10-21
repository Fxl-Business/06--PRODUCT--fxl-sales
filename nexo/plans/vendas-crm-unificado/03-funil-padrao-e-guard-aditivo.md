---
id: 03-funil-padrao-e-guard-aditivo
milestone: v4.8.0
status: todo
depends_on: []
files_modified: ["packages/shared-utils/src/default-pipeline.ts", "packages/shared-utils/src/__tests__/default-pipeline.test.ts", "packages/shared-utils/package.json", "apps/api/src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts", "apps/api/src/db/__tests__/additive-migration-scan.ts", "apps/api/src/db/__tests__/additive-migrations-guard.test.ts", "nexo/knowledge/reference/funil-padrao.md"]
affected_tests: []
acceptance: "given the default CRM pipeline constant, when the tests run, then it is internally consistent, maps one-to-one from today's four LEAD_STAGE_SEEDS and from migration 0022's seed VALUES, and a migration scanner flags every forbidden statement (with positive and negative controls) while finding no violation in migrations numbered above 0028"
goal: "One constant for the default CRM pipeline (single seed source for later phases) plus the additive-migration guard that protects every migration after 0028"
must_not_break: ["LEAD_STAGE_SEEDS and its byte-parity with migration 0022 (leads-schema-migration.test.ts)", "ensureLeadStages behaviour (this slice does not touch seeding)", "the existing single-role-db-contract.test.ts", "shared-utils build (tsc --build) and the dist subpath exports used by api and web"]
rules: ["Do NOT change LEAD_STAGE_SEEDS or any runtime seed in this slice", "No migration is added", "The constant imports nothing and reads no env, clock or locale (same purity as sales-edition.ts)", "Web and api import the subpath @fxl-sales/shared-utils/default-pipeline, never the root", "The package.json `test` script edit belongs to slice 01 only; this slice adds no node --test file because both new guards are vitest tests that `pnpm -r test` already runs"]
verifier_focus: "Mutation-check the guard: add a throwaway apps/api/drizzle/0029_probe.sql containing each forbidden statement one at a time (then delete it) and confirm the guard fails; confirm deleted_at / ON DELETE RESTRICT / comments / string literals never trip it; confirm the constant test fails if one transition is removed"
oracle: "apps/api/src/db/__tests__/additive-migrations-guard.test.ts"
---

# 03 - Funil padrao (constante unica) e guard de migracoes aditivas (request 0c and section 3)

## Context
- Today's pipeline: `LEAD_STAGE_SEEDS` in `apps/api/src/domains/sales-ops/leads/stages-seed.ts:22-34` (Novo normal 1, Em negociação normal 2, Proposta conversion system 3, Perdido lost system 4), byte-identical to the `VALUES` list of migration `apps/api/drizzle/0022_sales_ops_leads.sql` lines 134-139 (`CROSS JOIN (VALUES ('Novo','normal',false,1), ... ) AS s("name","kind","is_system","position")`). The parity test is `apps/api/test/rls/leads-schema-migration.test.ts:236` ("keeps the migration seed and LEAD_STAGE_SEEDS byte-identical"); it replays the SQL on Postgres. This slice needs no DB: it parses the same SQL text.
- Last migration is `0028_lead_soft_delete.sql`; `apps/api/drizzle/meta/_journal.json` ends at idx 28. Earlier migrations contain DROP (for example `0001_hard_riptide.sql`, `0003_nostalgic_jubilee.sql`), which gives the guard a real-SQL non-vacuity proof.
- Existing migration contract test: `apps/api/src/db/__tests__/single-role-db-contract.test.ts` (reads the drizzle folder with `path.resolve(dirname(fileURLToPath(import.meta.url)), '../../..')`, bans CREATE/ALTER ROLE, BYPASSRLS and GRANT ... TO fxl_sales_*). The new guard is stricter (all GRANT) but only for numbers above 0028.
- `packages/shared-utils` pattern: pure module `src/sales-edition.ts` ("imports nothing"), subpath export entries in `package.json` `exports` (`./sales-edition` at the end), vitest tests in `src/__tests__/*.test.ts` excluded from `tsc` by tsconfig, `build` = `tsc --build --force`, consumed by api/web from `dist` (so run `pnpm --filter @fxl-sales/shared-utils build` before api tests).
- Vitest unit config: `apps/api/vitest.config.ts:43-44` includes `src/**/__tests__/**/*.test.ts`; helper files in `__tests__` that are not `*.test.ts` are not collected.

## Design (decided)
### A. The constant `packages/shared-utils/src/default-pipeline.ts`
Pure module, no imports. Exports (exact names):
```ts
export type PipelineStageType = 'normal' | 'orcamento' | 'saida';
export type PipelineExitKind = 'ganho' | 'perdido' | 'pausado';

export interface DefaultPipelineStage {
  readonly key: string;
  readonly label: string;
  readonly order: number;
  readonly type: PipelineStageType;
  readonly exitKind: PipelineExitKind | null;
}

export const DEFAULT_PIPELINE_KEY = 'crm-padrao';
export const DEFAULT_PIPELINE_NAME = 'Funil CRM padrão';

export const DEFAULT_PIPELINE_STAGES = [
  { key: 'novo', label: 'Novo', order: 1, type: 'normal', exitKind: null },
  { key: 'qualificacao', label: 'Qualificação', order: 2, type: 'normal', exitKind: null },
  { key: 'em-negociacao', label: 'Em negociação', order: 3, type: 'normal', exitKind: null },
  { key: 'proposta', label: 'Proposta', order: 4, type: 'orcamento', exitKind: null },
  { key: 'ganho', label: 'Ganho', order: 5, type: 'saida', exitKind: 'ganho' },
  { key: 'perdido', label: 'Perdido', order: 6, type: 'saida', exitKind: 'perdido' },
  { key: 'pausado', label: 'Pausado', order: 7, type: 'saida', exitKind: 'pausado' },
] as const satisfies readonly DefaultPipelineStage[];

export type DefaultPipelineStageKey = (typeof DEFAULT_PIPELINE_STAGES)[number]['key'];
```
Default allowed transitions - EXACT list, 22 pairs `[from, to]`, exported as `DEFAULT_PIPELINE_TRANSITIONS: readonly (readonly [DefaultPipelineStageKey, DefaultPipelineStageKey])[]`, written as a literal in this order:
1. forward (3): novo>qualificacao, qualificacao>em-negociacao, em-negociacao>proposta.
2. back one step (3): qualificacao>novo, em-negociacao>qualificacao, proposta>em-negociacao. (`novo` has no back.)
3. open to any exit (12): for each of novo, qualificacao, em-negociacao, proposta in that order: >ganho, >perdido, >pausado.
4. pausado returns to the open stages (4): pausado>novo, pausado>qualificacao, pausado>em-negociacao, pausado>proposta.
`ganho` and `perdido` have NO outgoing transition (terminal). Nothing else is allowed (no skipping forward over an open stage, no exit-to-exit).
Also export the legacy bridge that phase 1 (slice 06 backfill) uses:
```ts
/** Today's four LEAD_STAGE_SEEDS names -> their counterpart key in the default pipeline. */
export const LEGACY_LEAD_STAGE_COUNTERPART = {
  'Novo': 'novo',
  'Em negociação': 'em-negociacao',
  'Proposta': 'proposta',
  'Perdido': 'perdido',
} as const satisfies Record<string, DefaultPipelineStageKey>;
/** Default stages that have NO legacy counterpart (the backfill must create them). */
export const DEFAULT_PIPELINE_NEW_STAGE_KEYS = ['qualificacao', 'ganho', 'pausado'] as const satisfies readonly DefaultPipelineStageKey[];
```
Meaning of the mapping (documented in the file header): legacy `normal` -> `normal`; legacy `conversion` (Proposta) -> `orcamento`; legacy `lost` (Perdido) -> `saida` with `exitKind: 'perdido'`.
Subpath: add to `packages/shared-utils/package.json` `exports` after `./sales-edition`: `"./default-pipeline": { "types": "./dist/default-pipeline.d.ts", "import": "./dist/default-pipeline.js" }`. Do NOT re-export from `src/index.ts`.
Why this location: the API seed code (later slice 05/06) and the web (pipeline selector) both read it, and tests import the built subpath exactly like `sales-edition`. Today's `LEAD_STAGE_SEEDS` stays; nothing imports the new constant at runtime in this slice.

### B. Parity test (api, no DB) `apps/api/src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts`
Reads `apps/api/drizzle/0022_sales_ops_leads.sql` (path from `import.meta.url`: `../../../../../drizzle`), fails loudly if the file or the VALUES block is missing, and compares:
- `LEAD_STAGE_SEEDS` vs the parsed 0022 rows (name, kind, isSystem, position) - the same equality `leads-schema-migration.test.ts` proves on Postgres, here as a fast text check.
- Each 0022 row vs `DEFAULT_PIPELINE_STAGES` through `LEGACY_LEAD_STAGE_COUNTERPART`: label equals the legacy name; kind mapping normal->normal, conversion->orcamento, lost->saida with exitKind perdido; and the relative order is preserved (sorting the legacy rows by position and mapping them gives strictly increasing new `order`).
- The default stages without a legacy counterpart are exactly `DEFAULT_PIPELINE_NEW_STAGE_KEYS`.
Hook for slice 05: the file declares `MIGRATION_SEED_COMPARISONS`, an array of `{ id, filePattern, extractRows }` with ONE entry (`'0022'`). A comment `SLICE-05-HOOK: slice 05 appends the 0029 entry (new pipeline stage seed) here and the same loop compares it to DEFAULT_PIPELINE_STAGES` marks where it extends. The loop runs every entry, so adding one is a one-line change.

### C. Additive-migration guard (api, no DB)
Two files in `apps/api/src/db/__tests__/`:
1. Helper `additive-migration-scan.ts` (not a test file, exports reused by slice 05/06):
```ts
import fs from 'node:fs';
import path from 'node:path';

export interface Violation { rule: string; excerpt: string }
export interface FileViolation extends Violation { file: string }

/** Removes comments and neutralises string/identifier contents so keywords inside them never match. */
export function sanitizeSql(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (ch === '-' && next === '-') { while (i < n && sql[i] !== '\n') i += 1; continue; }
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
      continue;
    }
    if (ch === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'") { if (sql[i + 1] === "'") { i += 2; continue; } i += 1; break; }
        i += 1;
      }
      out += "''";
      continue;
    }
    if (ch === '"') {
      i += 1;
      while (i < n && sql[i] !== '"') i += 1;
      i += 1;
      out += '"x"';
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const IDENT = '(?:"x"|[A-Za-z_]\\w*)';
export const FORBIDDEN_RULES: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'DROP', pattern: /\bDROP\b/i },
  { rule: 'DELETE FROM', pattern: /\bDELETE\s+FROM\b/i },
  { rule: 'TRUNCATE', pattern: /\bTRUNCATE\b/i },
  { rule: 'RENAME', pattern: /\bRENAME\b/i },
  { rule: 'ALTER COLUMN TYPE', pattern: new RegExp(`\\bALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+(?:SET\\s+DATA\\s+)?TYPE\\b`, 'i') },
  { rule: 'GRANT', pattern: /\bGRANT\b/i },
  { rule: 'REVOKE', pattern: /\bREVOKE\b/i },
  { rule: 'CREATE ROLE', pattern: /\bCREATE\s+(?:ROLE|USER)\b/i },
  { rule: 'ALTER ROLE', pattern: /\bALTER\s+(?:ROLE|USER)\b/i },
  { rule: 'BYPASSRLS', pattern: /\bBYPASSRLS\b/i },
];

export function scanSql(sql: string): Violation[] {
  const clean = sanitizeSql(sql);
  const found: Violation[] = [];
  for (const { rule, pattern } of FORBIDDEN_RULES) {
    const m = pattern.exec(clean);
    if (m) found.push({ rule, excerpt: clean.slice(Math.max(0, m.index - 20), m.index + 60).replace(/\s+/g, ' ').trim() });
  }
  return found;
}

export function migrationNumber(fileName: string): number | null {
  const m = /^(\d{4})_.*\.sql$/.exec(fileName);
  return m ? Number(m[1]) : null;
}

/** Scans every migration whose number is strictly greater than `after`. */
export function scanMigrationDir(dir: string, after: number): { scanned: string[]; violations: FileViolation[] } {
  if (!fs.existsSync(dir)) throw new Error(`migration folder not found: ${dir}`);
  const scanned: string[] = [];
  const violations: FileViolation[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const n = migrationNumber(file);
    if (n === null || n <= after) continue;
    scanned.push(file);
    for (const v of scanSql(fs.readFileSync(path.join(dir, file), 'utf8'))) violations.push({ file, ...v });
  }
  return { scanned, violations };
}
```
Decisions embedded: `ON DELETE RESTRICT|CASCADE|SET NULL` in a FOREIGN KEY clause is NOT a data-removing statement and is allowed (only `DELETE FROM` is forbidden; CLAUDE.md separately forbids CASCADE on history FKs, which review enforces); `deleted_at`, `dropped_x`, `renamed_x` never match because `\b` treats `_` as a word character; keywords inside comments, `'...'` literals (including `''` escapes) and `"identifiers"` are neutralised first; GRANT/REVOKE/ROLE are forbidden outright after 0028 (single-role contract).
2. Test `additive-migrations-guard.test.ts` (vitest). `DRIZZLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle')`.

## Steps (TDD)
1. RED A: write `packages/shared-utils/src/__tests__/default-pipeline.test.ts` (Tests) importing `../default-pipeline.js`; it fails (module missing).
2. GREEN A: write `default-pipeline.ts` exactly as designed; add the `exports` entry; `pnpm --filter @fxl-sales/shared-utils build`.
3. RED B: write the api parity test; it must fail first only if the constant is wrong - run it right after step 2 (it should pass); to prove it is not vacuous temporarily change one label in the constant, see it fail, revert.
4. RED C: write `additive-migrations-guard.test.ts` importing the helper before the helper exists (fails), then create `additive-migration-scan.ts` (GREEN).
5. Write `nexo/knowledge/reference/funil-padrao.md` (one sentence per line): the constant, the 22 transitions, the legacy mapping, the three stages with no counterpart, that nothing seeds from it yet, and the guard's rules plus its two decisions (ON DELETE allowed, GRANT forbidden). Do NOT edit CLAUDE.md here (slice 02 owns it in this phase; the Capture step adds one pointer line).
6. Run Commands.

## Tests
`packages/shared-utils/src/__tests__/default-pipeline.test.ts`:
- `has seven stages with unique keys and contiguous orders 1..7` - keys unique, `order` equals index+1, labels `['Novo','Qualificação','Em negociação','Proposta','Perdido'...]` exact order per the table (`Novo, Qualificação, Em negociação, Proposta, Ganho, Perdido, Pausado`).
- `types and exit kinds agree` - exactly one `orcamento` (`proposta`); exactly three `saida` with exitKinds `ganho`, `perdido`, `pausado` in that order; every non-saida has `exitKind === null`.
- `transitions are exactly the documented 22` - `DEFAULT_PIPELINE_TRANSITIONS` equals the hand-written expected 22-pair array in the same order (copy of Design A, written independently in the test), length 22, no duplicate pair, every key known.
- `transitions follow the rule (derived independently)` - build the expected set from the rule (open i -> open i+1; open i -> open i-1; open -> each exit; pausado -> each open) and compare as sets to the constant.
- `ganho and perdido are terminal, pausado returns only to open stages` - no pair starts at ganho or perdido; targets of pausado are exactly the four open keys; no pair has both ends exits.
- `legacy counterpart covers exactly the four legacy names and the new keys are the rest` - `Object.keys(LEGACY_LEAD_STAGE_COUNTERPART)` equals the four names; values plus `DEFAULT_PIPELINE_NEW_STAGE_KEYS` equals the full key set with no overlap.
`apps/api/src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts` (imports `LEAD_STAGE_SEEDS` from `../stages-seed.js`, the constant from `@fxl-sales/shared-utils/default-pipeline`):
- `parses four seed rows out of migration 0022` (non-vacuity: file exists, exactly 4 rows).
- `0022 seed rows equal LEAD_STAGE_SEEDS` (name, kind, isSystem, position).
- `each 0022 seed row maps to its default-pipeline counterpart` - table-driven: Novo->novo/normal, Em negociação->em-negociacao/normal, Proposta (conversion)->proposta/orcamento, Perdido (lost)->perdido/saida with exitKind perdido; label equals legacy name; order monotone.
- `the default stages without a legacy counterpart are qualificacao, ganho and pausado`.
Parsing regex for 0022: `/CROSS JOIN \(VALUES([\s\S]*?)\) AS s\(/` then rows `/\('([^']+)',\s*'(\w+)',\s*(true|false),\s*(\d+)\)/g`.
`apps/api/src/db/__tests__/additive-migrations-guard.test.ts`:
- `finds the drizzle folder and the shipped history (non-vacuity)` - folder exists, >= 29 `.sql` files, contains a file starting `0022_` and one starting `0028_`; `scanMigrationDir(DRIZZLE_DIR, -1).scanned.length` equals the sql count.
- `the scanner flags violations in the pre-0029 history` - `scanMigrationDir(DRIZZLE_DIR, -1)` (everything) has `violations.length > 0` and includes a `DROP` hit from `0001_hard_riptide.sql` (proves the scanner works on real shipped SQL).
- `every migration after 0028 is additive` - `scanMigrationDir(DRIZZLE_DIR, 28).violations` equals `[]` (today `scanned` is `[]`; message lists file, rule, excerpt). Add a comment: passes vacuously on files today by design; the controls below carry the proof.
- `positive control: each forbidden statement is detected` - `it.each` over fixtures, expecting the named rule: `DROP TABLE "x";` DROP; `ALTER TABLE "t" DROP COLUMN "c";` DROP; `drop index "i";` DROP; `DELETE FROM "t";` and `delete\n  from "t";` DELETE FROM; `TRUNCATE "t";` TRUNCATE; `ALTER TABLE "t" RENAME COLUMN "a" TO "b";` and `ALTER TABLE "t" RENAME TO "u";` RENAME; `ALTER TABLE "t" ALTER COLUMN "c" SET DATA TYPE bigint;`, `ALTER TABLE "t" ALTER COLUMN "c" TYPE text;`, `ALTER TABLE t ALTER c TYPE text;` ALTER COLUMN TYPE; `GRANT SELECT ON "t" TO app;` GRANT; `REVOKE ALL ON "t" FROM app;` REVOKE; `CREATE ROLE r;` CREATE ROLE; `ALTER ROLE r BYPASSRLS;` ALTER ROLE (and BYPASSRLS).
- `negative control: additive SQL is not flagged` - `it.each` expecting `[]`: `ALTER TABLE "t" ADD COLUMN "deleted_at" timestamp with time zone;`, `ALTER TABLE "t" ADD COLUMN "dropped_count" integer DEFAULT 0;`, `ALTER TABLE "t" ADD COLUMN "type" text;`, `CREATE TABLE "renamed_things" ("id" uuid PRIMARY KEY);--> statement-breakpoint`, `-- DROP TABLE x`, `/* DELETE FROM x; TRUNCATE y; */ SELECT 1;`, `INSERT INTO "t" ("note") VALUES ('DROP TABLE a; DELETE FROM b; it''s fine');`, `INSERT INTO "t" ("a") VALUES (1) ON CONFLICT DO NOTHING;`, `ALTER TABLE "t" ADD CONSTRAINT "fk" FOREIGN KEY ("a") REFERENCES "u"("id") ON DELETE RESTRICT;`, `ALTER TABLE "t" ENABLE ROW LEVEL SECURITY; ALTER TABLE "t" FORCE ROW LEVEL SECURITY;`, `CREATE POLICY "p" ON "t" USING ("org_id" = current_setting('app.current_org_id', true));`, `UPDATE "t" SET "new_col" = "old_col" WHERE "new_col" IS NULL;`.
- `folder-level control: a numbered fixture folder is gated by the cut-off` - create a temp dir with `os.tmpdir()`/`fs.mkdtempSync`; write `0028_old.sql` containing `DROP TABLE x;` (ignored), `0029_ok.sql` (additive), `0030_bad.sql` (`DELETE FROM "t";`); `scanMigrationDir(dir, 28)` returns `scanned` = `['0029_ok.sql','0030_bad.sql']` and exactly one violation `{file:'0030_bad.sql', rule:'DELETE FROM'}`; remove the temp dir in `afterAll`. Also assert `scanMigrationDir` on a missing path THROWS (no silent pass).

## Commands
- Build the subpath first: `pnpm --filter @fxl-sales/shared-utils build`
- Oracle: `pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/additive-migrations-guard.test.ts`
- Constant and parity: `pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/default-pipeline.test.ts` and `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts`
- Neighbours that must stay green: `pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/single-role-db-contract.test.ts` and `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/leads-schema-migration.test.ts`
- Lint and types: `pnpm --filter @fxl-sales/shared-utils type-check && pnpm --filter @fxl-sales/api lint && pnpm --filter @fxl-sales/api type-check`
- Global: `pnpm run build:packages` and `node scripts/build-contract.mjs` (the new `exports` entry must not break the build contract); `pnpm test` runs both new vitest files through `pnpm -r test` with no `package.json` edit.

## Risks
- `api-test-typecheck.test.mjs` type-checks api tests: the helper uses `noUncheckedIndexedAccess`-safe `!` assertions; run `pnpm --filter @fxl-sales/api type-check` before handing over.
- The subpath resolves from `dist`; a stale `dist` makes the api parity test fail with "cannot find module". The Commands build first; CI order (`build:packages` before tests) already does.
- Forbidding every `DROP` also forbids the idempotent `DROP POLICY IF EXISTS` idiom; later slices must write `CREATE POLICY` for new tables only (they are new, so no drop is needed).
- The guard cannot see statements assembled inside dynamic SQL strings (`EXECUTE format(...)`) or dollar-quoted bodies with their own quoting; plain `DO $$ ... $$` bodies ARE scanned. Review stays the backstop.
- Transition graph is a proposal ("nothing else allowed", Novo without back, Pausado returns to any open stage); the owner can change the literal list later because tests derive from the documented rule in one place (adjust both together).
