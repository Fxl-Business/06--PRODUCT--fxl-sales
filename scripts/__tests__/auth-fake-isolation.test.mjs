import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

/**
 * Structural guard for the three isolation defences the v4.1.0 dev-fake
 * identity feature relies on:
 *
 *   1. `@fxl-sales/auth-fake` is a `devDependency`, never a `dependency`,
 *      `peerDependency` or `optionalDependency`, in `apps/api/package.json`
 *      or `apps/web/package.json`, and is declared nowhere in the root
 *      `package.json`.
 *   2. No shipped source file under `apps/api/src`, `apps/web/src`,
 *      `packages/shared-types/src` or `packages/shared-utils/src` reaches the
 *      package by a STATIC import, type-only included.
 *   3. Outside a dynamic `import()` inside one of the two sanctioned seams -
 *      `apps/api/src/auth/select.ts` and
 *      `apps/web/src/dev/install-dev-identity.ts` - the literal specifier
 *      never appears at all in those four trees.
 *   4. The api seam's production refusal and the web seam's
 *      `import.meta.env.DEV` gate cannot be quietly deleted or reordered.
 *
 * None of those four is self-enforcing: the package being a devDependency,
 * every reach being dynamic, and the web half sitting behind a DEV flag are
 * all properties of the SOURCE, one careless edit away from silently ceasing
 * to hold with a fully green suite over the corpse. This file is the
 * assertive layer that turns each into a test failure. It follows
 * `scripts/__tests__/local-database-guard.test.mjs` in every structural
 * respect: named files and named trees are read directly, never a
 * repository-wide `git grep`; every negative case is proven by re-spawning
 * this same file against a mutated FIXTURE TREE and reading the child's EXIT
 * CODE, never by asserting message text; and the real tracked files are read
 * and copied, never written to.
 *
 * ── The two-scope split (rule A vs. rule B) ─────────────────────────────────
 * RULE A, the static-import ban, applies to EVERY file in the four scanned
 * trees, test files included: a static import is what actually pulls the
 * package into the build graph, so a test module reaching it that way would
 * be exactly as dangerous as shipped code doing so.
 * RULE B, the reference ban, applies to every file EXCEPT test files: outside
 * the two sanctioned seams the literal specifier may not appear at all, but a
 * test has to be able to NAME the roster to assert anything about it (see
 * `apps/api/src/auth/__tests__/dev-identity-production-refusal.test.ts`'s
 * `vi.mock('@fxl-sales/auth-fake', ...)`, a STRING REFERENCE and not a static
 * import - necessary because that test cannot otherwise prove the selector's
 * own production refusal, since `installAppAuthAdapter`'s independent second
 * guard masks the deletion of the first). A test module is never entered by
 * the server or by the bundle, so rule A is what actually keeps the package
 * out of the build graph and rule B costs a test nothing to satisfy with
 * `await import(...)`.
 *
 * ── No type-only carve-out ──────────────────────────────────────────────────
 * `import type { X } from '@fxl-sales/auth-fake'` is erased by the compiler
 * on a narrow reading, but whether a given import survives erasure depends on
 * `verbatimModuleSyntax`, `isolatedModules`, and whether a value binding
 * shares the statement - a rule whose verdict depends on three compiler
 * settings is a rule a reviewer has to adjudicate, and this guard forbids the
 * carve-out outright rather than adjudicate it. Both regexes below
 * (`IMPORT_FROM_RE`) match `import type { X } from '<pkg>'` exactly as they
 * match a value import, by design.
 *
 * ── Comment-stripping is UNIFORM across every scanned file, not seam-only ──
 * `apps/web/src/dev/dev-identity-registry.ts` names the package in its own
 * top-of-file doc comment, purely as prose explaining why that file does NOT
 * import it - harmless, since a comment cannot create a static import, a
 * dynamic import or a bundle reference, and it is not one of the two
 * sanctioned seams. Stripping comments only for the two seams (to admit
 * *their* load-bearing prose) while leaving every other file's raw source
 * exposed would make this pre-existing, correct file a false-positive
 * violation of rule B and the guard would not be green on arrival. So
 * comment-stripping is applied uniformly, to every file, for both rules.
 * Rule A does not need this in practice (its regex is anchored to the start
 * of a line via the `m` flag, so a `//`-commented import line can never
 * match), but it is applied there too for one uniform mental model: this
 * guard always reasons about comment-stripped source. The consequence is
 * that "the specifier in a comment" cannot be this file's decisive mutation
 * for rule B (a stripped comment vanishes before the check runs, so the
 * mutation would not go red) - the decisive mutation instead writes the
 * specifier into a plain CODE reference (`export const NOTE = '<pkg>';`) in a
 * third file, which is the shape that actually proves rule B fires on real
 * code outside the seams, and it is what tests 6 and 15 below use.
 *
 * ── The pass-count tripwire ─────────────────────────────────────────────────
 * A real run reports `# pass 21` (8 always-on tests plus 13 negative-block
 * tests) and a fixture-mode run reports `# pass 8` (the always-on tests only,
 * since IS_FIXTURE_RUN skips the negative block below) - MEASURED, not
 * guessed, exactly as this repo's other self-proving guards require. A lower
 * count than either is the vacuity tripwire firing.
 */

// The one place the package specifier is spelled as a plain string. Every
// regex below derives from it, and the negative-block fixtures splice it into
// generated file content rather than re-typing the literal.
const PKG = '@fxl-sales/auth-fake';

const SELF = fileURLToPath(import.meta.url);

// Test-harness knob ONLY. Lets the negative cases below run this same file
// against a throwaway fixture tree, so proving the guard never requires
// damaging the real manifests or the real seam files. Never set in any
// committed script.
const FIXTURE_ROOT_VAR = 'FXL_AUTH_FAKE_GUARD_ROOT';
const injectedRoot = process.env[FIXTURE_ROOT_VAR];
const IS_FIXTURE_RUN = typeof injectedRoot === 'string' && injectedRoot.length > 0;

// Three levels up from scripts/__tests__/. Derived from import.meta.url and
// never from process.cwd(), so the verdict does not depend on where node was
// started.
const ROOT = IS_FIXTURE_RUN
  ? path.resolve(injectedRoot)
  : fileURLToPath(new URL('../../', import.meta.url));

const ROOT_PACKAGE_JSON_REL = 'package.json';
const API_PACKAGE_JSON_REL = 'apps/api/package.json';
const WEB_PACKAGE_JSON_REL = 'apps/web/package.json';
const SEAM_API_REL = 'apps/api/src/auth/select.ts';
const SEAM_WEB_REL = 'apps/web/src/dev/install-dev-identity.ts';

// The four trees this guard scans. `apps/api/scripts/` and
// `packages/auth-fake/src` are deliberately excluded: the former is outside
// `apps/api/tsconfig.json`'s rootDir and never reaches `dist/`, and is
// covered instead by `scripts/__tests__/local-database-guard.test.mjs`; the
// latter IS the package.
const SCANNED_TREES = [
  'apps/api/src',
  'apps/web/src',
  'packages/shared-types/src',
  'packages/shared-utils/src',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

// MODULE SCOPE, deliberately and load-bearingly, exactly as
// local-database-guard.test.mjs does it. A throw inside a test callback can
// end the run with zero tests executed and exit 0 - the guard would pass
// while certifying nothing. The reads happen here; a failure becomes a real
// failing assertion below rather than an uncaught throw.
let loadError = null;
let rootPackageJsonSource = '';
let apiPackageJsonSource = '';
let webPackageJsonSource = '';
let apiSeamSource = '';
let webSeamSource = '';

try {
  rootPackageJsonSource = fs.readFileSync(path.join(ROOT, ROOT_PACKAGE_JSON_REL), 'utf8');
  apiPackageJsonSource = fs.readFileSync(path.join(ROOT, API_PACKAGE_JSON_REL), 'utf8');
  webPackageJsonSource = fs.readFileSync(path.join(ROOT, WEB_PACKAGE_JSON_REL), 'utf8');
  apiSeamSource = fs.readFileSync(path.join(ROOT, SEAM_API_REL), 'utf8');
  webSeamSource = fs.readFileSync(path.join(ROOT, SEAM_WEB_REL), 'utf8');
} catch (error) {
  loadError = error;
}

/**
 * Strip comments so a commented-out mention (satisfying nothing) and a
 * commented-out DOC EXPLANATION (naming the package harmlessly) are both
 * removed before any rule runs. See the header note above for why this is
 * uniform across every file rather than seam-only.
 * Whole-line `//` only, plus block comments: matches
 * local-database-guard.test.mjs's own stripComments exactly.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PKG_RE_SRC = escapeRegExp(PKG);

// Rule A: a static import/export/require of the package. Anchored per line
// (`m` flag) for the import/export forms, matching both a named import and a
// bare side-effect import, and matching `import type` identically to a value
// import - there is no type-only carve-out.
const IMPORT_FROM_RE = new RegExp(`^[ \\t]*import\\b[^\\n]*['"]${PKG_RE_SRC}['"]`, 'm');
const EXPORT_FROM_RE = new RegExp(`^[ \\t]*export\\b[^\\n]*from\\s*['"]${PKG_RE_SRC}['"]`, 'm');
const REQUIRE_RE = new RegExp(`require\\(\\s*['"]${PKG_RE_SRC}['"]\\s*\\)`);

// The one permitted shape inside a sanctioned seam.
const DYNAMIC_IMPORT_RE = new RegExp(`import\\s*\\(\\s*['"]${PKG_RE_SRC}['"]\\s*\\)`, 'g');

function isStaticReference(code) {
  return IMPORT_FROM_RE.test(code) || EXPORT_FROM_RE.test(code) || REQUIRE_RE.test(code);
}

function isTestFile(relPath) {
  return /(^|\/)__tests__\//.test(relPath) || /\.test\.(ts|tsx|js|mjs)$/.test(relPath);
}

function toRel(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}

/** Recursively lists source files under `<root>/<relDir>`. A missing
 *  directory - expected in a minimal negative-case fixture that never
 *  populates `packages/shared-types/src` at all - answers an empty list
 *  rather than throwing. */
function walkSourceFiles(root, relDir) {
  const absDir = path.join(root, relDir);
  const out = [];
  function recurse(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        recurse(full);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        out.push(full);
      }
    }
  }
  recurse(absDir);
  return out;
}

const DEPENDENCY_FIELDS_NON_DEV = ['dependencies', 'peerDependencies', 'optionalDependencies'];
const ALL_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', ...DEPENDENCY_FIELDS_NON_DEV];

function hasOwn(obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key);
}

// ── Always-on tests, run in BOTH real and fixture mode ──────────────────────

test('both sanctioned seams exist and are readable', () => {
  assert.equal(
    loadError,
    null,
    `could not read the required files under ${ROOT}: ${loadError && loadError.message}. ` +
      'A rename or a move of a manifest or a sanctioned seam is a regression here, not an excuse to pass.',
  );
});

test('the sanctioned seams are the real seams, not empty or substituted', () => {
  assert.ok(apiSeamSource.length > 500, `${SEAM_API_REL} is implausibly small`);
  assert.ok(webSeamSource.length > 500, `${SEAM_WEB_REL} is implausibly small`);
  assert.match(
    apiSeamSource,
    /DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE/,
    `${SEAM_API_REL} must reference its own signature symbol`,
  );
  assert.match(
    webSeamSource,
    /DEV_IDENTITY_ENABLED/,
    `${SEAM_WEB_REL} must reference its own signature symbol`,
  );
});

test('neither app declares the package outside devDependencies', () => {
  for (const [rel, source] of [
    [API_PACKAGE_JSON_REL, apiPackageJsonSource],
    [WEB_PACKAGE_JSON_REL, webPackageJsonSource],
  ]) {
    let pkg;
    try {
      pkg = JSON.parse(source);
    } catch (error) {
      assert.fail(`${rel} is not valid JSON: ${error.message}`);
    }
    assert.equal(
      typeof pkg.devDependencies?.[PKG],
      'string',
      `${rel} must declare ${PKG} in devDependencies`,
    );
    assert.ok(pkg.devDependencies[PKG].length > 0, `${rel}'s devDependencies entry must be non-empty`);
    for (const field of DEPENDENCY_FIELDS_NON_DEV) {
      assert.ok(
        !hasOwn(pkg[field], PKG),
        `${rel} must not declare ${PKG} in ${field} - a peerDependency entry installs into a production tree too`,
      );
    }
  }
});

test('the root package.json does not declare the package at all', () => {
  let pkg;
  try {
    pkg = JSON.parse(rootPackageJsonSource);
  } catch (error) {
    assert.fail(`${ROOT_PACKAGE_JSON_REL} is not valid JSON: ${error.message}`);
  }
  for (const field of ALL_DEPENDENCY_FIELDS) {
    assert.ok(
      !hasOwn(pkg[field], PKG),
      `${ROOT_PACKAGE_JSON_REL} must not declare ${PKG} in ${field}, devDependencies included`,
    );
  }
});

test('no shipped source imports the package statically', () => {
  const violations = [];
  for (const tree of SCANNED_TREES) {
    for (const abs of walkSourceFiles(ROOT, tree)) {
      const rel = toRel(ROOT, abs);
      const code = stripComments(fs.readFileSync(abs, 'utf8'));
      if (isStaticReference(code)) {
        violations.push(rel);
      }
    }
  }
  assert.deepEqual(violations, [], `static import of ${PKG} found in: ${violations.join(', ')}`);
});

test('only the two sanctioned seams mention the package, and only dynamically', () => {
  const violations = [];
  for (const tree of SCANNED_TREES) {
    for (const abs of walkSourceFiles(ROOT, tree)) {
      const rel = toRel(ROOT, abs);
      if (isTestFile(rel)) continue; // rule B does not bind test files - see header note.

      const code = stripComments(fs.readFileSync(abs, 'utf8'));
      const isSanctionedSeam = rel === SEAM_API_REL || rel === SEAM_WEB_REL;
      const residual = isSanctionedSeam ? code.replace(DYNAMIC_IMPORT_RE, '') : code;

      if (residual.includes(PKG)) {
        violations.push(rel);
      }
    }
  }
  assert.deepEqual(
    violations,
    [],
    `unsanctioned mention of ${PKG} found in: ${violations.join(', ')}`,
  );
});

test('the api seam refuses under NODE_ENV=production', () => {
  const code = stripComments(apiSeamSource);
  // The literal 'production', not `nodeEnv === 'production'`: the shipped
  // `isProductionEnv` reads `(env.NODE_ENV ?? '').trim().toLowerCase() ===
  // 'production'`, so pinning the wider expression would be red on the real
  // code.
  assert.match(code, /'production'/, `${SEAM_API_REL} must compare against the literal 'production'`);
  // Deliberately loose about what sits between the parentheses: the shipped
  // selector reaches the constant through its dynamic-import binding as
  // `appAuth.DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`, so pinning the
  // binding name would be red on a rename that changes nothing.
  assert.match(
    code,
    /throw new Error\([^)]*DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE[^)]*\)/,
    `${SEAM_API_REL} must throw naming DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`,
  );
});

test('the web seam is behind import.meta.env.DEV, and reaches the package only after it', () => {
  const code = stripComments(webSeamSource);
  assert.match(
    code,
    /const DEV_IDENTITY_ENABLED\s*=\s*import\.meta\.env\.DEV\b/,
    `${SEAM_WEB_REL} must declare DEV_IDENTITY_ENABLED from import.meta.env.DEV`,
  );
  assert.match(
    code,
    /if\s*\(\s*!DEV_IDENTITY_ENABLED\s*\)\s*return\b/,
    `${SEAM_WEB_REL} must refuse early when DEV_IDENTITY_ENABLED is false`,
  );

  const devIdx = code.search(/import\.meta\.env\.DEV\b/);
  const dynIdx = code.search(DYNAMIC_IMPORT_RE);
  assert.ok(devIdx >= 0, `${SEAM_WEB_REL} must reference import.meta.env.DEV`);
  assert.ok(dynIdx >= 0, `${SEAM_WEB_REL} must dynamically import ${PKG}`);
  assert.ok(
    devIdx < dynIdx,
    `${SEAM_WEB_REL} must consult import.meta.env.DEV strictly before reaching ${PKG} - ` +
      'a file that reaches the package at module top level and consults the flag afterwards ' +
      'defeats dead-code elimination while satisfying a naive presence check',
  );
});

// ── Negative block, thirteen tests, real run only ────────────────────────────
// Each regression is proven by running THIS FILE as a child `node --test`
// process against a mutated copy of the real sources (or a synthetic minimal
// tree), and reading the child's EXIT CODE. Message text is never the oracle,
// and the real manifests, seams and packages/auth-fake source are never
// written to. A child has FIXTURE_ROOT_VAR set, so it skips this whole block
// and never spawns a grandchild.
if (!IS_FIXTURE_RUN) {
  const tempRoots = [];

  after(() => {
    for (const dir of tempRoots) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeFixture(name, files) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `auth-fake-guard-${name}-`)));
    tempRoots.push(dir);

    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }

    return dir;
  }

  // The minimal fixture that satisfies every always-on test cleanly. Each
  // negative case starts from this same set and mutates exactly one thing.
  function cleanFiles(extra = {}) {
    return {
      [ROOT_PACKAGE_JSON_REL]: rootPackageJsonSource,
      [API_PACKAGE_JSON_REL]: apiPackageJsonSource,
      [WEB_PACKAGE_JSON_REL]: webPackageJsonSource,
      [SEAM_API_REL]: apiSeamSource,
      [SEAM_WEB_REL]: webSeamSource,
      ...extra,
    };
  }

  function runAgainst(dir) {
    // `node --test` runs each test FILE in a child process carrying
    // NODE_TEST_CONTEXT (and its pipe/worker siblings). Inheriting those
    // makes the grandchild believe it is already inside a runner: it warns
    // "run() is being called recursively within a test file. skipping
    // running files", executes NOTHING and exits 0. Every negative case
    // below would then read as green while proving nothing, so the runner's
    // own variables are removed from the child env.
    const childEnv = { ...process.env, [FIXTURE_ROOT_VAR]: dir };
    for (const key of Object.keys(childEnv)) {
      if (key.startsWith('NODE_TEST_')) delete childEnv[key];
    }

    return spawnSync(process.execPath, ['--test', SELF], {
      cwd: ROOT,
      encoding: 'utf8',
      env: childEnv,
    });
  }

  function runScriptAgainst(dir) {
    const childEnv = { ...process.env, FXL_AUTH_FAKE_BUNDLE_ROOT: dir };
    for (const key of Object.keys(childEnv)) {
      if (key.startsWith('NODE_TEST_')) delete childEnv[key];
    }

    return spawnSync(process.execPath, [path.join(ROOT, 'scripts/assert-web-bundle-clean.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
      env: childEnv,
    });
  }

  function movePackageToDependencies(source) {
    const pkg = JSON.parse(source);
    const version = pkg.devDependencies[PKG];
    delete pkg.devDependencies[PKG];
    pkg.dependencies = { ...(pkg.dependencies ?? {}), [PKG]: version };
    const mutated = JSON.stringify(pkg, null, 2) + '\n';
    assert.notEqual(mutated, source, 'the mutation removed nothing - the fixture proves nothing');
    return mutated;
  }

  function addPackageToRootDevDependencies(source) {
    const pkg = JSON.parse(source);
    pkg.devDependencies = { ...(pkg.devDependencies ?? {}), [PKG]: 'workspace:*' };
    const mutated = JSON.stringify(pkg, null, 2) + '\n';
    assert.notEqual(mutated, source, 'the mutation removed nothing - the fixture proves nothing');
    return mutated;
  }

  // Delete every line matching the given regex. Asserting the mutation
  // CHANGED something is what stops a negative case passing for the wrong
  // reason.
  function withoutLinesMatching(source, re) {
    const mutated = source
      .split('\n')
      .filter((line) => !re.test(line))
      .join('\n');
    assert.notEqual(mutated, source, 'the mutation removed nothing - the fixture proves nothing');
    return mutated;
  }

  test('an unmutated fixture passes (positive control)', () => {
    const dir = makeFixture('clean', cleanFiles());
    const result = runAgainst(dir);
    assert.equal(result.status, 0, `a faithful copy must pass:\n${result.stdout}${result.stderr}`);
  });

  test('FAILS when apps/api/package.json moves the package to dependencies', () => {
    const dir = makeFixture(
      'api-dep',
      cleanFiles({ [API_PACKAGE_JSON_REL]: movePackageToDependencies(apiPackageJsonSource) }),
    );
    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when apps/web/package.json moves the package to dependencies', () => {
    const dir = makeFixture(
      'web-dep',
      cleanFiles({ [WEB_PACKAGE_JSON_REL]: movePackageToDependencies(webPackageJsonSource) }),
    );
    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when the root package.json declares the package', () => {
    const dir = makeFixture(
      'root-dep',
      cleanFiles({ [ROOT_PACKAGE_JSON_REL]: addPackageToRootDevDependencies(rootPackageJsonSource) }),
    );
    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when a shipped file imports the package statically', () => {
    const staticImportFile = `import { roster } from '${PKG}';\n\nexport const rosterRef = roster;\n`;
    const dir = makeFixture(
      'static-import',
      cleanFiles({ 'apps/api/src/some-other-file.ts': staticImportFile }),
    );
    assert.notEqual(runAgainst(dir).status, 0);
  });

  // This is the carve-out being refused, and it is its own case so the
  // decision is visible in the output: a type-only import is banned exactly
  // like a value import, because whether the compiler actually erases it
  // depends on compiler settings this guard refuses to adjudicate.
  test('FAILS when a shipped file imports the package with a type-only import', () => {
    const typeOnlyImportFile = `import type { Roster } from '${PKG}';\n\nexport type RosterRef = Roster;\n`;
    const dir = makeFixture(
      'type-only-import',
      cleanFiles({ 'apps/web/src/some-other-file.ts': typeOnlyImportFile }),
    );
    assert.notEqual(runAgainst(dir).status, 0);
  });

  // The decisive mutation here is a live CODE reference, not a comment - see
  // the header note on uniform comment-stripping for why: a comment mention
  // is legitimately stripped everywhere in this guard (that is what keeps
  // apps/web/src/dev/dev-identity-registry.ts's own doc comment naming the
  // package harmless), so only a reference that survives stripping can prove
  // rule B fires on a third file outside the sanctioned seams.
  test('FAILS when a third file mentions the package outside the sanctioned seams', () => {
    const thirdFile = `export const NOTE = '${PKG}';\n`;
    const dir = makeFixture('third-file-mention', cleanFiles({ 'apps/api/src/some-notes.ts': thirdFile }));
    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when the api seam drops its production refusal', () => {
    const mutated = withoutLinesMatching(apiSeamSource, /DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE/);
    const dir = makeFixture('api-no-refusal', cleanFiles({ [SEAM_API_REL]: mutated }));
    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when the web seam drops its import.meta.env.DEV binding', () => {
    const mutated = withoutLinesMatching(
      webSeamSource,
      /const DEV_IDENTITY_ENABLED\s*=\s*import\.meta\.env\.DEV/,
    );
    const dir = makeFixture('web-no-dev-binding', cleanFiles({ [SEAM_WEB_REL]: mutated }));
    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when the web seam reaches the package before the DEV binding', () => {
    // Prepends a second, harmless-by-rule-B (still inside a dynamic import)
    // occurrence at the very top of the file, guaranteeing its index is
    // strictly less than import.meta.env.DEV's. This isolates the ORDERING
    // assertion specifically: it does not touch rule B (a sanctioned seam
    // may carry more than one dynamic-import occurrence) or rule A (this is
    // not `import ... from` syntax).
    const mutated = `void import('${PKG}');\n${webSeamSource}`;
    assert.notEqual(mutated, webSeamSource, 'the mutation removed nothing - the fixture proves nothing');
    const dir = makeFixture('web-hoisted-import', cleanFiles({ [SEAM_WEB_REL]: mutated }));
    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when a sanctioned seam is missing', () => {
    const files = cleanFiles();
    delete files[SEAM_WEB_REL];
    const dir = makeFixture('missing-seam', files);
    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('the bundle script passes on a clean fixture dist (positive control)', () => {
    const dir = makeFixture('bundle-clean', {
      'packages/auth-fake/src/index.ts': `export const FXL_SALES_DEV_FAKE_ROSTER_SENTINEL = 'FXL_SALES_DEV_FAKE_ROSTER_SENTINEL';\n`,
      'apps/web/dist/assets/app.js': 'console.log("hello world");\n',
    });
    const result = runScriptAgainst(dir);
    assert.equal(result.status, 0, `a clean dist must pass:\n${result.stdout}${result.stderr}`);
  });

  test(
    'the bundle script FAILS on a dist carrying the sentinel, on an absent dist, ' +
      'and on a package source that lost the sentinel',
    () => {
      const taintedDir = makeFixture('bundle-tainted', {
        'packages/auth-fake/src/index.ts': `export const FXL_SALES_DEV_FAKE_ROSTER_SENTINEL = 'FXL_SALES_DEV_FAKE_ROSTER_SENTINEL';\n`,
        'apps/web/dist/assets/app.js': 'const s = "FXL_SALES_DEV_FAKE_ROSTER_SENTINEL";\n',
      });
      assert.notEqual(
        runScriptAgainst(taintedDir).status,
        0,
        'must fail when the sentinel leaks into the production bundle',
      );

      const noDistDir = makeFixture('bundle-no-dist', {
        'packages/auth-fake/src/index.ts': `export const FXL_SALES_DEV_FAKE_ROSTER_SENTINEL = 'FXL_SALES_DEV_FAKE_ROSTER_SENTINEL';\n`,
      });
      assert.notEqual(
        runScriptAgainst(noDistDir).status,
        0,
        'must fail when apps/web/dist is absent - never a skip',
      );

      const noSentinelDir = makeFixture('bundle-no-sentinel', {
        'packages/auth-fake/src/index.ts': `export const NOT_THE_SENTINEL = 'nope';\n`,
        'apps/web/dist/assets/app.js': 'console.log("hello world");\n',
      });
      assert.notEqual(
        runScriptAgainst(noSentinelDir).status,
        0,
        'must fail when the sentinel no longer exists anywhere in the package source - ' +
          'a deleted sentinel would make the dist scan trivially green forever',
      );
    },
  );
}
