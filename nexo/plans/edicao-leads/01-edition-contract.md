---
id: 01-edition-contract
milestone: v4.3.0
status: todo
depends_on: []
files_modified:
  - packages/shared-utils/src/sales-edition.ts
  - packages/shared-utils/src/index.ts
  - packages/shared-utils/package.json
  - packages/shared-utils/src/__tests__/sales-edition.test.ts
acceptance: "resolveSalesEdition returns 'leads' only when the modules array contains the exact string 'sales.edition.leads' and 'full' for null, undefined, [], unknown or junk entries; editionCapabilities('full') is an immutable set of exactly the 7 SalesCapability values and editionCapabilities('leads') is an immutable empty set; hasCapability and leadFieldSet follow them; sales-edition.ts contains no import statement; and '@fxl-sales/shared-utils/sales-edition' is a declared package export that resolves from apps/api and apps/web after build:packages."
goal: "Ship the one pure edition contract (SEAM-CONTRACT section 1) as the shared-utils subpath '@fxl-sales/shared-utils/sales-edition', with unit oracles, so slices 02, 04, 05, 06, 07 and 08 only import it and never edit it."
must_not_break:
  - "pnpm --filter @fxl-sales/shared-utils test"
  - "pnpm --filter @fxl-sales/shared-utils type-check"
  - "pnpm run build:packages"
  - "pnpm --filter @fxl-sales/api type-check"
  - "pnpm --filter @fxl-sales/web type-check"
  - "node scripts/build-contract.mjs"
  - "node --test scripts/__tests__/auth-fake-isolation.test.mjs scripts/__tests__/api-dockerfile-workspace-deps.test.mjs"
oracle:
  - packages/shared-utils/src/__tests__/sales-edition.test.ts
rules:
  - "Names, literal values and signatures are EXACTLY those of SEAM-CONTRACT.md section 1. Do not rename, add an exported name, or change a signature."
  - "sales-edition.ts imports nothing, re-exports nothing, reads no process.env, no clock (no Date), no Intl."
  - "Do not touch apps/** in this slice. No alias, tsconfig path or Dockerfile change is needed (see Wiring facts)."
  - "No em dash (U+2014) in any file; use '-'. Relative imports in tests use the '.js' extension (NodeNext)."
  - "Tests run once: `vitest run` through the package `test` script. Never bare `vitest`."
verifier_focus: "That only the EXACT string flips the edition (no trim, no case folding, no prefix match); that a junk non-array argument cannot throw; that the returned sets really reject add/delete/clear at runtime (not only at the type level) and that a rejected mutation leaves later calls unchanged; that the exports entry matches the existing subpath shape; and that both apps resolve the subpath from a fresh build:packages."
---

# Slice 01 - Edition contract

## Objective

Create the single pure module that turns a verified token's `entitlements.modules` into a Sales edition and its capabilities.
After this slice, `@fxl-sales/shared-utils/sales-edition` exports `SALES_EDITION_LEADS_MODULE`, `SalesEdition`, `SalesCapability`, `LeadFieldSet`, `resolveSalesEdition`, `editionCapabilities`, `hasCapability` and `leadFieldSet`.
Nothing consumes it yet; slices 02 (API) and 05 (web) are the first importers.

## Wiring facts (verified while planning)

- `packages/shared-utils` is ESM (`"type": "module"`), built by `tsc --build --force` from `src/` to `dist/` (`tsconfig.json` excludes `src/**/__tests__/**`), and tests run `vitest run` over `src/**/__tests__/**/*.test.ts` against SOURCE.
- Subpaths are declared one per file in `package.json` `exports`, shape `{ "types": "./dist/<name>.d.ts", "import": "./dist/<name>.js" }` (see `./sao-paulo-day`, `./liquidacao`).
- No app has a tsconfig `paths`, vite alias or vitest alias for `@fxl-sales/*`.
  Both apps resolve `@fxl-sales/shared-utils/<subpath>` through the pnpm workspace symlink plus the `exports` map into `dist/`.
  `apps/api` uses `moduleResolution: NodeNext`, `apps/web` uses `Bundler`; both honour `exports`.
  Therefore the ONLY wiring needed is the new `exports` entry plus `dist/` being built.
- Build order is already correct and must not be changed:
  - root `build`, `type-check` and `test` all start with `pnpm run build:packages` (shared-types, then shared-utils);
  - `apps/web` `build` is `pnpm --filter @fxl-sales/web^... build && tsc --noEmit && vite build`, so Vercel (`buildCommand: pnpm --filter @fxl-sales/web build`) builds shared-utils first;
  - `apps/api/Dockerfile` copies `packages/shared-utils/package.json` in deps, builds `@fxl-sales/shared-utils` before `@fxl-sales/api`, and the runtime stage copies `/app/packages` whole, so `dist/sales-edition.js` ships in the image.
- `scripts/build-contract.mjs` (run in `pnpm test`) fails if any app imports an `@fxl-sales/...` subpath that the package does not declare in `exports`; adding the entry here is what keeps slices 02 and 05 green on it.
- The root `src/index.ts` re-exports every module (`export * from './liquidacao.js'` and so on); this slice adds the same line for consistency.
  Apps must still import the SUBPATH (the root pulls `hmac.ts`, which uses `node:crypto`), per SEAM-CONTRACT section 4.
- Running an app's tests alone (`pnpm --filter @fxl-sales/web test`) reads `dist/`, so run `pnpm run build:packages` first whenever shared-utils changed.
- Existing precedent for the source-purity and exports tests: `src/__tests__/liquidacao.test.ts` (`describe('source guard')`, `describe('package boundary')`) and `src/__tests__/sao-paulo-day.test.ts` (`describe('package exports')`).

## Step 1 - Red: write the oracle

Create `packages/shared-utils/src/__tests__/sales-edition.test.ts` EXACTLY with these cases (titles may be reworded, assertions may not be weakened).

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  editionCapabilities,
  hasCapability,
  leadFieldSet,
  resolveSalesEdition,
  SALES_EDITION_LEADS_MODULE,
  type SalesCapability,
  type SalesEdition,
} from '../sales-edition.js';

const ALL_CAPABILITIES: readonly SalesCapability[] = [
  'proposals',
  'commissions',
  'catalog',
  'import',
  'finders',
  'history',
  'leadFullFields',
];

describe('SALES_EDITION_LEADS_MODULE', () => {
  it('is the exact Hub module string', () => {
    expect(SALES_EDITION_LEADS_MODULE).toBe('sales.edition.leads');
  });
});

describe('resolveSalesEdition', () => {
  it('absent modules resolve to full', () => {
    expect(resolveSalesEdition(undefined)).toBe('full');
    expect(resolveSalesEdition(null)).toBe('full');
  });

  it('empty modules resolve to full', () => {
    expect(resolveSalesEdition([])).toBe('full');
  });

  it('unknown modules resolve to full', () => {
    expect(resolveSalesEdition(['other'])).toBe('full');
    expect(resolveSalesEdition(['sales.core', 'sales.addon.x'])).toBe('full');
  });

  it('only the exact module string flips the edition', () => {
    expect(resolveSalesEdition(['sales.edition.leads'])).toBe('leads');
    expect(resolveSalesEdition(['sales.core', 'sales.edition.leads'])).toBe('leads');
    expect(resolveSalesEdition([' sales.edition.leads'])).toBe('full');
    expect(resolveSalesEdition(['sales.edition.leads '])).toBe('full');
    expect(resolveSalesEdition(['SALES.EDITION.LEADS'])).toBe('full');
    expect(resolveSalesEdition(['sales.edition.leads.extra'])).toBe('full');
    expect(resolveSalesEdition(['sales.edition'])).toBe('full');
  });

  it('non-string junk entries are ignored', () => {
    expect(resolveSalesEdition([42, null, undefined, {}, [], true])).toBe('full');
    expect(resolveSalesEdition([{ module: 'sales.edition.leads' }])).toBe('full');
    expect(resolveSalesEdition([['sales.edition.leads']])).toBe('full');
    expect(resolveSalesEdition([42, null, {}, 'sales.edition.leads'])).toBe('leads');
  });

  it('a non-array value at runtime resolves to full without throwing', () => {
    const junk: unknown[] = ['sales.edition.leads', 42, {}, 'x', true];
    for (const value of junk) {
      expect(resolveSalesEdition(value as unknown as readonly unknown[])).toBe('full');
    }
  });
});

describe('editionCapabilities', () => {
  it('full carries exactly the 7 capabilities', () => {
    const caps = editionCapabilities('full');
    expect(caps.size).toBe(7);
    expect([...caps].sort()).toEqual([...ALL_CAPABILITIES].sort());
  });

  it('leads carries none', () => {
    expect(editionCapabilities('leads').size).toBe(0);
  });

  it('returns the same frozen instance on every call', () => {
    expect(editionCapabilities('full')).toBe(editionCapabilities('full'));
    expect(editionCapabilities('leads')).toBe(editionCapabilities('leads'));
    expect(Object.isFrozen(editionCapabilities('full'))).toBe(true);
    expect(Object.isFrozen(editionCapabilities('leads'))).toBe(true);
  });

  it('the returned sets reject every mutation at runtime', () => {
    for (const edition of ['full', 'leads'] as const) {
      const caps = editionCapabilities(edition) as Set<SalesCapability>;
      const before = [...caps].sort();
      expect(() => caps.add('proposals')).toThrow(TypeError);
      expect(() => caps.delete('proposals')).toThrow(TypeError);
      expect(() => caps.clear()).toThrow(TypeError);
      expect([...editionCapabilities(edition)].sort()).toEqual(before);
    }
    expect(editionCapabilities('leads').has('proposals')).toBe(false);
    expect(editionCapabilities('full').size).toBe(7);
  });
});
```

Continue the file with:

```ts
describe('hasCapability', () => {
  it('full has every capability', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(hasCapability('full', capability)).toBe(true);
    }
  });

  it('leads has none', () => {
    for (const capability of ALL_CAPABILITIES) {
      expect(hasCapability('leads', capability)).toBe(false);
    }
  });
});

describe('leadFieldSet', () => {
  it('maps full to full and leads to contact', () => {
    expect(leadFieldSet('full')).toBe('full');
    expect(leadFieldSet('leads')).toBe('contact');
  });

  it('agrees with the leadFullFields capability', () => {
    const editions: readonly SalesEdition[] = ['full', 'leads'];
    for (const edition of editions) {
      expect(leadFieldSet(edition) === 'full').toBe(hasCapability(edition, 'leadFullFields'));
    }
  });
});

describe('source guard', () => {
  const source = readFileSync(new URL('../sales-edition.ts', import.meta.url), 'utf8');

  it('sales-edition.ts imports nothing and reads no env, clock or locale', () => {
    const forbidden = [
      /^\s*import[\s{*]/m,
      /^\s*export\s+\*/m,
      /^\s*export\s+(type\s+)?\{[^}]*\}\s+from\s/m,
      /\brequire\s*\(/,
      /\bimport\s*\(/,
      /process\.env/,
      /\bDate\b/,
      /\bIntl\b/,
    ];
    for (const re of forbidden) {
      expect(source).not.toMatch(re);
    }
    expect(source).toMatch(/export function resolveSalesEdition\(/);
  });

  it('sanity: the import pattern catches every import form', () => {
    const importPattern = /^\s*import[\s{*]/m;
    expect("import { x } from './x.js';").toMatch(importPattern);
    expect("import type { X } from './x.js';").toMatch(importPattern);
    expect("import * as x from './x.js';").toMatch(importPattern);
    expect("import './side-effect.js';").toMatch(importPattern);
    expect('const important = 1;').not.toMatch(importPattern);
  });
});

describe('package boundary', () => {
  it('package.json exports the ./sales-edition subpath', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(pkg.exports['./sales-edition']).toEqual({
      types: './dist/sales-edition.d.ts',
      import: './dist/sales-edition.js',
    });
  });

  it('the root index re-exports the edition contract', async () => {
    const root = await import('../index.js');
    expect(root.resolveSalesEdition).toBe(resolveSalesEdition);
    expect(root.editionCapabilities).toBe(editionCapabilities);
    expect(root.hasCapability).toBe(hasCapability);
    expect(root.leadFieldSet).toBe(leadFieldSet);
    expect(root.SALES_EDITION_LEADS_MODULE).toBe(SALES_EDITION_LEADS_MODULE);
  });
});
```

Note on the `import` pattern: `[\s{*]` after `import` covers `import x`, `import {`, `import *`, `import type` and the side-effect form `import '...'` (a space follows `import`).

Run and confirm it FAILS because `../sales-edition.js` does not exist:

```bash
pnpm --filter @fxl-sales/shared-utils test
```

## Step 2 - Green: the module

Create `packages/shared-utils/src/sales-edition.ts` EXACTLY as below (doc comments may be shortened, code may not change).

```ts
/**
 * Sales edition contract.
 *
 * The edition is DERIVED per request from the verified Hub token's
 * `entitlements.modules`; it is never stored and never read from a body.
 * Absent, empty or unknown modules resolve to 'full', which is the product
 * exactly as it was before editions existed. Only the exact module string
 * 'sales.edition.leads' selects the leads edition.
 *
 * Pure: imports nothing, reads no env, no clock, no locale.
 */
export const SALES_EDITION_LEADS_MODULE = 'sales.edition.leads';

export type SalesEdition = 'full' | 'leads';

export type SalesCapability =
  | 'proposals' // propostas, wizard, conversion, settlements, summary/dashboard
  | 'commissions' // comissoes, payouts, legacy commissions routes
  | 'catalog' // produtos, areas, clientes, funcoes cadastros
  | 'import' // importacao por planilha
  | 'finders' // finder workspace and legacy finder/links routes
  | 'history' // Geral settings + historico de arquivamentos
  | 'leadFullFields'; // empresa, produtos, valor estimado on leads

export type LeadFieldSet = 'full' | 'contact';

function rejectMutation(): never {
  throw new TypeError('Sales edition capabilities are immutable.');
}

function frozenCapabilitySet(
  capabilities: readonly SalesCapability[],
): ReadonlySet<SalesCapability> {
  const set = new Set<SalesCapability>(capabilities);
  Object.defineProperties(set, {
    add: { value: rejectMutation },
    delete: { value: rejectMutation },
    clear: { value: rejectMutation },
  });
  return Object.freeze(set);
}

const FULL_CAPABILITIES = frozenCapabilitySet([
  'proposals',
  'commissions',
  'catalog',
  'import',
  'finders',
  'history',
  'leadFullFields',
]);

const LEADS_CAPABILITIES = frozenCapabilitySet([]);

/** Absent, empty or unknown modules => 'full'. Only the exact module string flips it. */
export function resolveSalesEdition(
  modules: readonly unknown[] | null | undefined,
): SalesEdition {
  if (!Array.isArray(modules)) return 'full';
  return modules.some((module) => module === SALES_EDITION_LEADS_MODULE) ? 'leads' : 'full';
}

/** 'full' => every capability; 'leads' => none of them. Frozen sets. */
export function editionCapabilities(edition: SalesEdition): ReadonlySet<SalesCapability> {
  return edition === 'leads' ? LEADS_CAPABILITIES : FULL_CAPABILITIES;
}

export function hasCapability(edition: SalesEdition, capability: SalesCapability): boolean {
  return editionCapabilities(edition).has(capability);
}

/** 'full' for the full edition, 'contact' for the leads edition. */
export function leadFieldSet(edition: SalesEdition): LeadFieldSet {
  return edition === 'leads' ? 'contact' : 'full';
}
```

Design notes the executor must keep:

- Every branch compares against `'leads'` and defaults to the full behaviour, so any unexpected runtime value fails OPEN to today's product (D1/D2 in the overview); never write `edition === 'full' ? ... : <leads behaviour>`.
- The comments inside `SalesCapability` drop the accents of SEAM-CONTRACT (`comissoes`, `areas`, `funcoes`, `importacao`, `historico`) only to stay ASCII; the union members are unchanged.
- `Array.isArray` on a `readonly unknown[]` narrows fine under TS 5.7; if `tsc` complains, keep the runtime check and write `if (!Array.isArray(modules as unknown)) return 'full';` (no `any`).
- `ALL_CAPABILITIES`-style lists stay private; do not export a capability list (SEAM-CONTRACT allows no extra cross-slice names).

Append to `packages/shared-utils/src/index.ts`, after the `liquidacao` line:

```ts
export * from './sales-edition.js';
```

Add to `packages/shared-utils/package.json` `exports`, after `./liquidacao` (keep 2-space JSON formatting, add the comma on the previous entry):

```json
    "./sales-edition": {
      "types": "./dist/sales-edition.d.ts",
      "import": "./dist/sales-edition.js"
    }
```

Run until green:

```bash
pnpm --filter @fxl-sales/shared-utils test
pnpm --filter @fxl-sales/shared-utils type-check
```

## Step 3 - Refactor and prove the subpath resolves in both apps

No refactor is expected beyond formatting with the repo Prettier config (`prettier.config.js`): `pnpm exec prettier --check packages/shared-utils/src/sales-edition.ts packages/shared-utils/src/__tests__/sales-edition.test.ts packages/shared-utils/src/index.ts packages/shared-utils/package.json` and `--write` if it fails.

Then prove resolution exactly as the apps and the API image will see it (no app file is created; these are throwaway checks):

```bash
pnpm run build:packages
test -f packages/shared-utils/dist/sales-edition.js && test -f packages/shared-utils/dist/sales-edition.d.ts
(cd apps/api && node --input-type=module -e "import('@fxl-sales/shared-utils/sales-edition').then(m => { if (m.resolveSalesEdition(['sales.edition.leads']) !== 'leads' || m.resolveSalesEdition([]) !== 'full') process.exit(1); console.log('api resolves sales-edition'); })")
(cd apps/web && node --input-type=module -e "import('@fxl-sales/shared-utils/sales-edition').then(m => { if (m.editionCapabilities('full').size !== 7) process.exit(1); console.log('web resolves sales-edition'); })")
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/web type-check
node scripts/build-contract.mjs
node --test scripts/__tests__/auth-fake-isolation.test.mjs scripts/__tests__/api-dockerfile-workspace-deps.test.mjs
```

Each command must exit 0; paste the two `resolves sales-edition` lines into the exec notes.
Do not build the Docker image in this slice; the Dockerfile already builds shared-utils before the API and copies `packages/` whole (Wiring facts), and slice 02 is the first to make the API import the subpath.

## Done when

- `pnpm --filter @fxl-sales/shared-utils test` is green with `src/__tests__/sales-edition.test.ts` included (confirm the file appears in the vitest output; a missing file would be a vacuous pass).
- Every `must_not_break` command exits 0.
- `git diff --stat` touches exactly the four `files_modified` paths (plus `nexo/` exec notes).
- `perl -CSD -ne 'print "$ARGV:$.: $_" if /\x{2014}/' packages/shared-utils/src/sales-edition.ts packages/shared-utils/src/__tests__/sales-edition.test.ts` prints nothing.
