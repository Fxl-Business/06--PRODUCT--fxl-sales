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

test('download filenames carry the FXL Vendas brand', () => {
  for (const f of ['apps/web/src/sales-ops/import/types.ts', 'apps/api/src/domains/import/routes.ts']) {
    const src = read(f);
    assert.ok(src.includes('fxl-vendas-importacao'), `${f} lost the fxl-vendas-importacao filename`);
    assert.ok(!src.includes('fxl-sales-importacao'), `${f} reverted to the fxl-sales-importacao filename`);
  }
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
