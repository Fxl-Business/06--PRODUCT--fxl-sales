#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The ARTEFACT half of the dev-fake identity isolation guard.
 *
 * `scripts/__tests__/auth-fake-isolation.test.mjs` proves, at the SOURCE
 * level, that `apps/web/src/dev/install-dev-identity.ts` sits behind
 * `import.meta.env.DEV` and reaches `@fxl-sales/auth-fake` only after
 * consulting it. That is a narrow structural pin and deliberately not a
 * claim about elimination: dead-code elimination is a property of the
 * EMITTED artefact, not of the source, and any source-level assertion of it
 * is a proxy a sufficiently creative edit walks straight past. This script is
 * the one place in the tree that actually decides the artefact question, by
 * reading the built `apps/web/dist` and failing if the roster package ever
 * made it in.
 *
 * It looks for one exported, otherwise-unused string literal,
 * `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` (defined in
 * `packages/auth-fake/src/index.ts` for exactly this purpose), rather than
 * for the package specifier itself: a bundler rewrites, inlines and
 * minifies import specifiers freely, so the specifier string is not a
 * reliable artefact-level marker, but a literal string constant that a
 * production build could only ever emit by actually including the module
 * that defines it survives bundling unchanged.
 *
 * Two failure modes are guarded before the real question is even asked:
 *   - an ABSENT `apps/web/dist` is a FAILURE, never a skip. A test that
 *     silently passes when its input is missing is worse than no test, and
 *     this is the one property of this feature this repo has already
 *     recorded costing it twice (see CLAUDE.md's "Local database guard" and
 *     "Vacuous green checks" sections).
 *   - a DELETED sentinel would make the dist scan trivially green forever,
 *     so the sentinel's own continued existence under
 *     `packages/auth-fake/src` is asserted FIRST, before the dist is ever
 *     read.
 *
 * `FXL_AUTH_FAKE_BUNDLE_ROOT` is a test-harness knob ONLY, read by
 * `scripts/__tests__/auth-fake-isolation.test.mjs`'s `runScriptAgainst` to
 * point this script at a throwaway fixture tree instead of the real repo
 * root. It is never set in any committed script; a real `pnpm run build`
 * invocation always resolves ROOT from `import.meta.url`.
 */

const SENTINEL = 'FXL_SALES_DEV_FAKE_ROSTER_SENTINEL';

const BUNDLE_ROOT_VAR = 'FXL_AUTH_FAKE_BUNDLE_ROOT';
const injectedRoot = process.env[BUNDLE_ROOT_VAR];
const ROOT =
  typeof injectedRoot === 'string' && injectedRoot.length > 0
    ? path.resolve(injectedRoot)
    : fileURLToPath(new URL('../', import.meta.url));

const PACKAGE_SRC_REL = 'packages/auth-fake/src';
const DIST_REL = 'apps/web/dist';

/** Recursively lists every file under `dir`. A missing directory answers an
 *  empty list rather than throwing - the caller decides whether an empty
 *  list itself is a failure (it is, for `apps/web/dist`). */
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function readTextSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`[assert-web-bundle-clean] ${message}`);
}

const packageSrcDir = path.join(ROOT, PACKAGE_SRC_REL);
const packageFiles = walk(packageSrcDir);
const sentinelStillExists = packageFiles.some((file) => {
  const contents = readTextSafe(file);
  return contents !== null && contents.includes(SENTINEL);
});

if (!sentinelStillExists) {
  fail(
    `the sentinel ${SENTINEL} no longer exists anywhere under ${PACKAGE_SRC_REL}; ` +
      'the dist scan below would be trivially green forever without it, so this is a hard failure ' +
      'rather than a silent pass.',
  );
  process.exit(1);
}

const distDir = path.join(ROOT, DIST_REL);
let distIsDirectory = false;
try {
  distIsDirectory = fs.statSync(distDir).isDirectory();
} catch {
  distIsDirectory = false;
}

if (!distIsDirectory) {
  fail(`${DIST_REL} does not exist. An absent dist is a failure here, never a skip.`);
  process.exit(1);
}

const distFiles = walk(distDir);
const tainted = [];
for (const file of distFiles) {
  const contents = readTextSafe(file);
  if (contents !== null && contents.includes(SENTINEL)) {
    tainted.push(path.relative(ROOT, file));
  }
}

if (tainted.length > 0) {
  fail(
    `the dev-fake roster sentinel ${SENTINEL} was found in the production web bundle: ` +
      `${tainted.join(', ')}. The dev-fake identity path must be eliminated as dead code by ` +
      `import.meta.env.DEV; see apps/web/src/dev/install-dev-identity.ts.`,
  );
  process.exit(1);
}

console.log(
  `[assert-web-bundle-clean] clean: ${SENTINEL} is absent from ${DIST_REL} ` +
    `and still present under ${PACKAGE_SRC_REL}.`,
);
