---
id: 01-marca-fxl-vendas
milestone: v4.8.0
status: todo
depends_on: []
files_modified: ["apps/web/src/sales-ops/missing-entitlement-copy.ts", "apps/web/src/i18n/pt-BR.json", "apps/web/src/i18n/en.json", "apps/web/index.html", "apps/api/src/domains/import/template.ts", "apps/api/src/domains/import/routes.ts", "apps/web/src/sales-ops/import/types.ts", "apps/api/src/domains/import/plan/leads.ts", "apps/api/src/server.ts", "scripts/__tests__/brand-and-technical-ids.test.mjs", "package.json", "nexo/knowledge/reference/importacao-por-planilha.md"]
affected_tests: [
  {path: apps/web/src/sales-ops/__tests__/missing-entitlement-panel.test.tsx, impact: "imports MISSING_ENTITLEMENT_COPY and reads missing-entitlement-copy.ts to ban dashes; no hard-coded brand string", update: "none expected; run to prove it stays green", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/missing-entitlement-panel.test.tsx", owner: builder},
  {path: apps/web/src/sales-ops/__tests__/entitlement-dead-end.test.tsx, impact: "imports MISSING_ENTITLEMENT_COPY", update: "none expected", command: "pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/entitlement-dead-end.test.tsx", owner: builder},
  {path: apps/web/src/admin/sellers/__tests__/AdminSellersPage.test.tsx, impact: "reads ptBR.admin.sellers.invitation.warnings.application_url_missing through the JSON, not a literal", update: "none expected", command: "pnpm --filter @fxl-sales/web exec vitest run src/admin/sellers/__tests__/AdminSellersPage.test.tsx", owner: builder},
  {path: apps/api/src/domains/import/__tests__/template-example.test.ts, impact: "builds the template workbook (title line, wb.creator, filenames)", update: "only if it asserts the old brand or filename; the grep found no literal", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/template-example.test.ts", owner: builder},
  {path: apps/api/src/domains/import/__tests__/import-routes.test.ts, impact: "asserts Content-Disposition of the template download", update: "none found by grep; if it asserts the filename, change fxl-sales-importacao to fxl-vendas-importacao", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/import-routes.test.ts", owner: builder},
  {path: apps/api/src/domains/import/__tests__/plan-leads.test.ts, impact: "plan/leads.ts message text for the conversion etapa", update: "none found by grep for 'dentro do Sales'; if it asserts the message, change it to 'dentro do FXL Vendas'", command: "pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/plan-leads.test.ts", owner: builder}
]
acceptance: "given the web and API sources, when scanning string literals, JSON values and index.html (comments excluded), then 'FXL Sales' appears 0 times, and the technical ids (package name, fxlAppId, app audience, three event names, SALES_* env names, fxl-sales.* storage keys, the two domains) are pinned unchanged by one guard test that also fails on a missing target"
goal: "Every user-visible 'FXL Sales' becomes 'FXL Vendas', with a guard that proves it and pins every technical id"
must_not_break: ["fxlAppId and package name fxl-sales", "app.fxl-sales audience", "event names fxl-sales.obligation.upserted, fxl-sales.settlement.recorded, fxl-sales.settlement.reversed", "SALES_* env names", "fxl-sales.* localStorage and sessionStorage keys", "the `no-em-dash` rule inside missing-entitlement-copy.ts (panel test bans U+2014 and U+2013)", "pt-BR copy still passes `Combobox`/panel tests"]
rules: ["Never use the em dash; use '-'", "Comments may keep 'FXL Sales'; only string literals, JSON values and html text are user-facing", "Do NOT edit CLAUDE.md product line (not user-facing)", "Do NOT rename any id, package, env, storage key, event or domain"]
verifier_focus: "Run the guard; then temporarily put 'FXL Sales' in a string literal of a throwaway copy and in a comment of another to confirm the literal fails and the comment passes; run the web and api suites listed in affected_tests"
oracle: "scripts/__tests__/brand-and-technical-ids.test.mjs"
---

# 01 - Marca FXL Vendas (request 0a)

## Context
Verified with `git grep -niE "fxl[ _-]?sales"` on this branch (equal to master 97b9a95).
User-visible occurrences of the old brand (comments excluded):
- `apps/web/src/sales-ops/missing-entitlement-copy.ts` lines 17, 19, 21, 23, 25, 35, 45 (`FXL Sales`).
- `apps/web/src/i18n/pt-BR.json` line 3 `"name": "Fxl Sales"`, line 20 `plataforma FXL Sales`, line 276 `O Sales não tem endereço ... de volta ao Sales`.
- `apps/web/src/i18n/en.json` line 3 `"name": "Fxl Sales"`, line 20 `FXL Sales platform`, line 276 `Sales has no address ... back to Sales`.
- `apps/web/index.html` line 7 `<title>Fxl Sales</title>`.
- `apps/api/src/domains/import/template.ts` lines 91, 99, 120, 133 (text) and 515 `wb.creator = 'FXL Sales'`.
- `apps/api/src/domains/import/plan/leads.ts` line 191 `...vira proposta dentro do Sales...` (user-facing import issue text).
- `apps/api/src/server.ts` line 153 `name: 'Fxl Sales API'` (root JSON body).
- Download filenames the operator sees: `apps/api/src/domains/import/routes.ts` lines 24-25 and `apps/web/src/sales-ops/import/types.ts` lines 66-67 (`fxl-sales-importacao.xlsx`, `fxl-sales-importacao-exemplo.xlsx`).
Comment-only mentions (stay): `apps/api/src/db/schema.ts:2`, `apps/api/src/middleware/require-capability.ts:14`, `apps/web/src/lib/require-token.ts:55`, `MissingEntitlementPanel.tsx:45`, `SalesOpsApp.tsx:2223`, `packages/auth-fake/src/index.ts:99`.
Test fixture data `apps/web/src/admin/products/__tests__/useProducts.test.ts:75 name: 'FXL Sales'` and `FXL BPO Sales` fixtures are data, not brand; they stay (the guard skips `__tests__`).
Technical ids to pin (verified): root `package.json` `"name": "fxl-sales"` (line 2) and `"fxlAppId": "fxl-sales"` (line 7); `packages/auth-fake/src/index.ts:100 SALES_APPLICATION = 'app.fxl-sales'`; `apps/api/src/domains/integration/events.ts:18-20`; `apps/web/src/auth/session-recovery.ts:20,21,25` (`RETURN_TO_KEY`, `LOGIN_ATTEMPTS_KEY`, `LOGOUT_INTENT_KEY`); `apps/web/src/dev/install-dev-identity.ts:18` and `apps/web/src/dev/dev-identity-switcher.ts:33`; the domains `sales.fxlbusiness.com` / `sales-api.fxlbusiness.com` appear in `apps/api/src/middleware/app-auth.ts:434` and `apps/api/src/env.ts:58`; env names `SALES_SESSION_ENCRYPTION_IKM` and `SALES_POST_LOGIN_REDIRECT` appear in `apps/api/src/env.ts`, `SALES_AUTH_FAKE` in `apps/api/src/auth/select.ts`.
`typescript` resolves from `scripts/` (root `node_modules/typescript`, root devDependency `^5.7.3`), so the guard can use the TS scanner and so ignore comments exactly.
Root `package.json` `test` script (line 13) lists the node --test guards explicitly; a new file must be added there or it never runs.

## Design (decided)
- Replacement text: `FXL Sales` -> `FXL Vendas` everywhere in the list above; `Fxl Sales` -> `FXL Vendas`; bare product word "o Sales"/"ao Sales" in the same strings -> "o FXL Vendas"/"ao FXL Vendas"; EN "Sales has no address" -> "FXL Vendas has no address", "back to Sales" -> "back to FXL Vendas". Server name -> `FXL Vendas API`.
- Download filenames change to `fxl-vendas-importacao.xlsx` and `fxl-vendas-importacao-exemplo.xlsx` in BOTH api and web constants (they are shown in the browser download bar). No test hard-codes them (grep), but keep the two files in lockstep.
- `/health` `service: 'fxl-sales-api'`, the boot log tags `[fxl-sales-api]`, the HKDF salt and every other technical string stay untouched.
- Guard design: ONE node --test file, two halves.
  - Half A (brand): walk `apps/web/src` and `apps/api/src` (skip dirs `node_modules`, `__tests__`, `dist`; skip files `*.test.ts(x)`, `*.d.ts`, `*.bak*`); parse each `.ts/.tsx` with the TypeScript compiler API and collect only `StringLiteral`, `NoSubstitutionTemplateLiteral`, `TemplateHead/Middle/Tail`, `JsxText` node texts - comments are never nodes, so they are excluded robustly. Parse the two i18n JSON files and check every string VALUE recursively. Check `apps/web/index.html` after removing `<!-- ... -->`.
  - Forbidden pattern on those texts: `/\bfxl\s+sales\b/i` (matches `FXL Sales`, `Fxl Sales`, `fxl  sales`; does NOT match `@fxl-sales/x`, `fxl-sales.x`, `FXL BPO Sales`) and `/\b(?:o|do|no|ao|pelo) Sales\b(?! Ops)/` (bare product word in Portuguese copy).
  - Non-vacuity: web walker visits >= 120 files and api walker >= 70 files (measured 160 and 98); the files `apps/web/src/sales-ops/missing-entitlement-copy.ts`, `apps/web/src/i18n/pt-BR.json`, `apps/api/src/domains/import/template.ts` MUST be among the visited files (test fails loudly if any path is missing); positive control: run the same detector over three in-test fixture sources (a string literal, a template literal, a JSX text containing `FXL Sales`) and assert each is detected, and a fixture with the brand only in `// FXL Sales` and `/* FXL Sales */` comments is NOT detected.
  - Positive assertions: `i18n/pt-BR.json` and `en.json` `app.name === 'FXL Vendas'`; `template.ts` source contains `wb.creator = 'FXL Vendas'`; `index.html` contains `<title>FXL Vendas</title>`.
- Half B (technical ids): each pin reads a file, FAILS if the file is missing (`assert.ok(fs.existsSync(...), 'missing target: <path>')`) and asserts the exact literal is still present. List: see Step 1 table. Each pin is its own `test(...)` so a regression names the id.
- `package.json` edit: this slice OWNS the root `package.json` `test` script edit for the whole phase (slices 02 and 03 do not touch it): append ` scripts/__tests__/brand-and-technical-ids.test.mjs` inside the existing `node --test` list (before the first `&&` after `api-dockerfile-workspace-deps.test.mjs`).

## Steps (TDD)
1. RED: create `scripts/__tests__/brand-and-technical-ids.test.mjs` with the code below. Run `node --test scripts/__tests__/brand-and-technical-ids.test.mjs`; it must FAIL on the brand tests (and pass the technical-id pins and the positive control).
2. GREEN, web: edit `missing-entitlement-copy.ts` (7 lines), `pt-BR.json` / `en.json` (lines 3, 20, 276), `index.html` line 7, `apps/web/src/sales-ops/import/types.ts` lines 66-67.
3. GREEN, api: edit `template.ts` lines 91, 99, 120, 133, 515; `plan/leads.ts` line 191; `server.ts` line 153; `import/routes.ts` lines 24-25.
4. Docs: in `nexo/knowledge/reference/importacao-por-planilha.md` line 99 change the two filenames to the new ones. Do not touch CLAUDE.md.
5. Register: edit root `package.json` `test` script as designed.
6. Run Commands below; everything green.

## Tests
New file `scripts/__tests__/brand-and-technical-ids.test.mjs` (write exactly this skeleton; fill the pin table from Context):
```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BRAND = /\bfxl\s+sales\b/i;
const BARE = /\b(?:o|do|no|ao|pelo) Sales\b(?! Ops)/;
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'dist']);
const LITERAL_KINDS = new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead, ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

function read(rel) {
  const abs = path.join(ROOT, rel);
  assert.ok(fs.existsSync(abs), `missing target: ${rel}`);
  return fs.readFileSync(abs, 'utf8');
}

export function literalsOf(fileName, source) {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.ESNext, true, kind);
  const out = [];
  (function visit(node) {
    if (LITERAL_KINDS.has(node.kind)) out.push(node.text ?? '');
    ts.forEachChild(node, visit);
  })(sf);
  return out;
}

export function brandHits(texts) {
  return texts.filter((t) => BRAND.test(t) || BARE.test(t));
}

function walk(rel, files = []) {
  const abs = path.join(ROOT, rel);
  assert.ok(fs.existsSync(abs), `missing target: ${rel}`);
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(rel, e.name), files); continue; }
    if (!/\.(ts|tsx)$/.test(e.name) || /\.(test|d)\.tsx?$/.test(e.name) || /\.bak/.test(e.name)) continue;
    files.push(path.join(rel, e.name));
  }
  return files;
}

function jsonStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) jsonStrings(v, out);
  return out;
}

test('positive control: the detector sees a literal, a template and JSX text, and ignores comments', () => {
  assert.equal(brandHits(literalsOf('a.ts', "const a = 'FXL Sales';")).length, 1);
  assert.equal(brandHits(literalsOf('a.ts', 'const a = `bem-vindo ao Fxl Sales`;')).length, 1);
  assert.equal(brandHits(literalsOf('a.tsx', 'const a = <p>FXL Sales</p>;')).length, 1);
  assert.equal(brandHits(literalsOf('a.ts', "// FXL Sales\n/* FXL Sales */\nconst a = 'ok';")).length, 0);
  assert.equal(brandHits(literalsOf('a.ts', "const a = 'FXL BPO Sales', b = '@fxl-sales/x', c = 'fxl-sales.auth';")).length, 0);
});

test('no user-facing FXL Sales in apps/web/src string literals', () => {
  const files = walk('apps/web/src');
  assert.ok(files.length >= 120, `web walker visited only ${files.length} files`);
  assert.ok(files.includes(path.join('apps/web/src/sales-ops', 'missing-entitlement-copy.ts')));
  const bad = files.flatMap((f) => brandHits(literalsOf(f, read(f))).map((t) => `${f}: ${t.slice(0, 80)}`));
  assert.deepEqual(bad, []);
});

test('no user-facing FXL Sales in apps/api/src string literals', () => {
  const files = walk('apps/api/src');
  assert.ok(files.length >= 70, `api walker visited only ${files.length} files`);
  assert.ok(files.includes(path.join('apps/api/src/domains/import', 'template.ts')));
  const bad = files.flatMap((f) => brandHits(literalsOf(f, read(f))).map((t) => `${f}: ${t.slice(0, 80)}`));
  assert.deepEqual(bad, []);
});

test('i18n JSON values and index.html carry the new brand', () => {
  for (const f of ['apps/web/src/i18n/pt-BR.json', 'apps/web/src/i18n/en.json']) {
    const json = JSON.parse(read(f));
    assert.equal(json.app.name, 'FXL Vendas', f);
    assert.deepEqual(brandHits(jsonStrings(json)), [], f);
  }
  const html = read('apps/web/index.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(html.includes('<title>FXL Vendas</title>'));
  assert.ok(!BRAND.test(html));
  assert.ok(read('apps/api/src/domains/import/template.ts').includes("wb.creator = 'FXL Vendas'"));
});

// ---- Half B: technical ids stay unchanged (each pin is its own test) ----
const PINS = [
  ['package.json', '"name": "fxl-sales"'],
  ['package.json', '"fxlAppId": "fxl-sales"'],
  ['packages/auth-fake/src/index.ts', "SALES_APPLICATION = 'app.fxl-sales'"],
  ['apps/api/src/domains/integration/events.ts', "'fxl-sales.obligation.upserted'"],
  ['apps/api/src/domains/integration/events.ts', "'fxl-sales.settlement.recorded'"],
  ['apps/api/src/domains/integration/events.ts', "'fxl-sales.settlement.reversed'"],
  ['apps/web/src/auth/session-recovery.ts', "'fxl-sales.auth.returnTo'"],
  ['apps/web/src/auth/session-recovery.ts', "'fxl-sales.auth.loginAttempts'"],
  ['apps/web/src/auth/session-recovery.ts', "'fxl-sales.auth.logoutIntent'"],
  ['apps/web/src/dev/install-dev-identity.ts', "'fxl-sales.dev-identity'"],
  ['apps/web/src/dev/dev-identity-switcher.ts', "'fxl-sales.dev-identity.collapsed'"],
  ['apps/api/src/middleware/app-auth.ts', 'sales.fxlbusiness.com'],
  ['apps/api/src/middleware/app-auth.ts', 'sales-api.fxlbusiness.com'],
  ['apps/api/src/auth/select.ts', 'SALES_AUTH_FAKE'],
  ['apps/api/src/env.ts', 'SALES_SESSION_ENCRYPTION_IKM'],
  ['apps/api/src/env.ts', 'SALES_POST_LOGIN_REDIRECT'],
];
for (const [file, needle] of PINS) {
  test(`technical id unchanged: ${file} keeps ${needle}`, () => {
    assert.ok(read(file).includes(needle), `${file} lost ${needle}`);
  });
}
```
Executor note: the three `SALES_*` pins were verified (`SALES_AUTH_FAKE` lives in `apps/api/src/auth/select.ts`, the other two in `apps/api/src/env.ts`); if a pin file fails, locate the name with `git grep` and repoint it - never drop the pin. Run `node --test` once with the pin table to confirm every pin file exists.

Changed tests: none by hand; the affected suites above must stay green with no edit (they use constants/JSON). If one asserts an old literal, update that literal in the same change and list it in the exec notes.

## Commands
- Oracle: `node --test scripts/__tests__/brand-and-technical-ids.test.mjs`
- Affected web: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/missing-entitlement-panel.test.tsx src/sales-ops/__tests__/entitlement-dead-end.test.tsx src/admin/sellers/__tests__/AdminSellersPage.test.tsx`
- Affected api: `pnpm --filter @fxl-sales/api exec vitest run src/domains/import`
- Lint and types: `pnpm --filter @fxl-sales/web lint && pnpm --filter @fxl-sales/web type-check && pnpm --filter @fxl-sales/api lint && pnpm --filter @fxl-sales/api type-check`
- Global guards that apply: the root `pnpm test` node --test list now includes the new file; also `node --test scripts/__tests__/no-legacy-env-names.test.mjs scripts/__tests__/auth-fake-isolation.test.mjs` (must stay green, nothing renamed).

## Risks
- Size: 12 files but each edit is 1 to 7 lines plus one ~110-line new test; under the 600-line ceiling, over the 8-file ceiling by small text edits only (accepted exception; splitting would only add a serial hop).
- `BARE` regex false positives on legitimate strings such as "Sales Ops" are excluded by the lookahead; if it flags a real non-brand string, narrow the regex, never add an allowlist of files.
- Some copy may exist in strings assembled from parts (`'FXL' + ' Sales'`); the guard cannot see that; grep showed none.
- The template workbook is also asserted by round-trip tests that parse the Leiame tab; they read text from the generator, so they follow the new brand.
