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
