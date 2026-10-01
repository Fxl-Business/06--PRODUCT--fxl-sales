import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Switching account is `client.switchAccount(...)` from `@fxl-business/hub-sdk` 2.5.0,
 * reached through the auth seam in `apps/web/src/auth/react.tsx`. The SDK builds
 * `/auth/login?prompt=select_account[&organization=...]` itself, and the SDK's BFF
 * relays the prompt only when it is exactly one `select_account`.
 *
 * No product code may build that URL, or any other `prompt` parameter, by hand: a
 * hand-built URL drifts from the SDK's encoding and relay rule silently. This guard
 * reads every product source file in `apps/web/src` and `apps/api/src` as an AST and
 * inspects only STRING and TEMPLATE literals, so a comment that names the URL is fine
 * and a URL inside a string that also contains `//` cannot hide behind a naive comment
 * strip. Test files are not product code and are skipped.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const ROOTS = [join(REPO_ROOT, 'apps', 'web', 'src'), join(REPO_ROOT, 'apps', 'api', 'src')];
const SOURCE_FILE = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

function isTestPath(path: string): boolean {
  return /(?:^|[\\/])__tests__[\\/]/.test(path) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SOURCE_FILE.test(entry) && !isTestPath(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A literal is a hand-built prompt when it spells a `prompt=` query pair, names the
 * `select_account` value, or is exactly the key `prompt` (as in
 * `params.set('prompt', ...)`).
 */
function isHandBuiltPrompt(text: string): boolean {
  return /prompt\s*=/i.test(text) || /select_account/i.test(text) || text.trim() === 'prompt';
}

function offendingLiterals(fileName: string, source: string): string[] {
  const kind = fileName.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, kind);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      if (isHandBuiltPrompt(node.text)) hits.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hits;
}

describe('no hand-built prompt parameter', () => {
  it('finds no prompt= literal in any web or api product source file', () => {
    const files = ROOTS.flatMap((root) => walk(root));
    // Non-vacuity: a wrong root resolves to nothing and would pass trivially.
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((file) => file.endsWith(join('auth', 'react.tsx')))).toBe(true);
    expect(files.some((file) => file.endsWith(join('api', 'src', 'server.ts')))).toBe(true);

    const offenders = files.flatMap((file) =>
      offendingLiterals(file, readFileSync(file, 'utf8')).map(
        (text) => `${relative(REPO_ROOT, file)}: ${JSON.stringify(text)}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('catches the shapes a hand-built switch would take, and ignores comments', () => {
    const cases: Array<[string, number]> = [
      ["const url = `${base}/auth/login?prompt=select_account`;", 1],
      ["window.location.assign('/auth/login?prompt=select_account&organization=' + id);", 1],
      ["const u = 'http://x/auth/login' + '?prompt=login';", 1],
      ["params.set('prompt', value);", 1],
      ["const p = `${a}?organization=${o}&prompt=${v}`;", 1],
      ['const el = <a href="/auth/login?prompt=select_account">x</a>;', 1],
      ['// redirects to /auth/login?prompt=select_account\nclient.switchAccount();', 0],
      ['/* `prompt=select_account` is the SDK\'s */ const prompt = 1;', 0],
    ];
    for (const [source, expected] of cases) {
      expect(offendingLiterals('case.tsx', source), source).toHaveLength(expected);
    }
  });
});
