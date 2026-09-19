import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE STRUCTURAL GUARD.
 *
 * It reads the files THIS SLICE OWNS off disk with `node:fs` and never shells out
 * to `git grep`: a repo-wide grep passes with the offending call sitting in a
 * third, irrelevant file and would not notice either of these files being
 * renamed away. It scopes to this slice's own list so the data layer's entirely
 * legitimate `apiFetch` in `leads/api.ts` is not a false positive.
 *
 * The scanner is an exported PURE function, called twice: once over the real
 * files, and once over an in-memory fixture carrying planted violations. That
 * second call is not decoration - without it, a scanner that globbed zero files
 * would be a permanently green check over nothing, which is a failure mode this
 * repo has already paid for.
 *
 * WHY THIS FILE ALSO SCANS A REGION OF `SalesOpsApp.tsx`, AND WHY THAT REGION IS
 * NOT THE WHOLE FILE.
 *
 * The feature's acceptance 13 and 14 say no board action may call
 * `POST /sales/:id/transition`, because dragging a card must never materialize
 * payables - winning and losing stay on the propostas screen, which `CLAUDE.md`
 * keeps as the only writer of `sale.status`. For a while this scanner enforced
 * that over `leads/*` alone, and that was MEASURED to be a hole: the feature-tier
 * mutation pass injected `transitionSale.mutate({ saleId, status: 'open' })` into
 * `saveLeadConversion` - the real board-to-proposta path, which lives in
 * `apps/web/src/sales-ops/SalesOpsApp.tsx` - and all 911 web tests stayed green.
 * The identical injection into `LeadsBoard.tsx` was killed at once, so the
 * mechanism was fine and only its scope was wrong. See survivor 1 in
 * `nexo/runs/20260918T000000Z-kanban-pipeline-leads/mutation-report.md`.
 *
 * `SalesOpsApp.tsx` cannot simply join `OWNED_FILES`: it also contains the
 * propostas screen, whose `onTransition={(sale, status) => transitionSale.mutate(...)}`
 * is the RIGHTFUL caller of that endpoint. Banning the call file-wide would fail
 * on correct code. So the board-owned parts of that file carry explicit
 * `BOARD-WRITE-FENCE:START/END <label>` sentinels and only the text between them
 * is scanned. The fence travels with the code, and moving the code out of the
 * fence reddens `the fenced regions still contain the board's conversion path`
 * rather than silently opting out. `does not overshoot onto the propostas screen`
 * is the other half: it asserts the UNFENCED remainder of that same file really
 * does reach a transition endpoint, so the narrow scope is proven narrow rather
 * than assumed.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const LEADS_DIR = resolve(HERE, '..');
const SALES_OPS_DIR = resolve(HERE, '../..');

/** Exactly the non-test files this slice owns under `leads/`. */
const OWNED_FILES = [
  'board-labels.ts',
  'board-move.ts',
  'board-ui.ts',
  // Slice 08's pure conversion module. It lives under `leads/` precisely so this
  // scanner covers it: it is the one new module on the path from a card to a
  // proposta, and the ban it must obey is the same one.
  'conversion.ts',
  'LeadCard.tsx',
  'LeadDialog.tsx',
  'LeadsBoard.tsx',
  'LeadsBoardContainer.tsx',
  'MoveLeadDialog.tsx',
];

/** The one file allowed to spell the conversion kind, because it owns the question. */
const CONVERSION_KIND_OWNER = 'board-move.ts';

/** The file that hosts board-owned code behind sentinels rather than under `leads/`. */
const FENCED_FILE = 'SalesOpsApp.tsx';

/**
 * Every region the fence must still delimit, and one symbol that proves the
 * region still holds the code it is named for. A refactor that hoists
 * `saveLeadConversion` out of its region fails here instead of quietly escaping
 * the ban.
 */
const REQUIRED_FENCED_REGIONS = [
  { label: 'conversion-identity', anchor: 'function createdSaleIdentity' },
  { label: 'conversion-handlers', anchor: 'async function saveLeadConversion' },
];

/**
 * The wiring that stays OUTSIDE the fence, pinned to its exact delegating shape.
 * Both are one-liners that hand control into a fenced region; pinning them is how
 * a transition call injected at the call site - rather than inside the handler -
 * is caught without fencing JSX.
 */
const WIRING_PINS = [
  {
    what: 'the board receives requestLeadConversion by reference',
    pattern: /onRequestConversion=\{requestLeadConversion\}/,
  },
  {
    what: "the wizard's convert branch only delegates",
    pattern:
      /else if \(saleWizard\?\.mode === 'convert'\) \{\s*void saveLeadConversion\(saleWizard, payload\);\s*\}/,
  },
];

const FENCE_START = /^\s*\/\* BOARD-WRITE-FENCE:START ([a-z-]+)\b[^*]*\*\/\s*$/;
const FENCE_END = /^\s*\/\* BOARD-WRITE-FENCE:END ([a-z-]+) \*\/\s*$/;

/**
 * Pure. Returns the text between each matching pair of sentinels, keyed by label.
 * It throws rather than returning a partial answer on an unbalanced or duplicated
 * fence, because a silently-empty region is exactly the vacuous green this whole
 * file exists to avoid.
 */
export function extractFencedRegions(source: string): Map<string, string> {
  const regions = new Map<string, string>();
  let openLabel: string | null = null;
  let buffer: string[] = [];

  for (const line of source.split('\n')) {
    const start = FENCE_START.exec(line);
    if (start) {
      const label = start[1] ?? '';
      if (openLabel) throw new Error(`fence ${label} opened inside ${openLabel}`);
      if (regions.has(label)) throw new Error(`fence ${label} declared twice`);
      openLabel = label;
      buffer = [];
      continue;
    }
    const end = FENCE_END.exec(line);
    if (end) {
      if (end[1] !== openLabel) throw new Error(`fence ${end[1]} closed while ${openLabel} open`);
      regions.set(openLabel, buffer.join('\n'));
      openLabel = null;
      continue;
    }
    if (openLabel) buffer.push(line);
  }

  if (openLabel) throw new Error(`fence ${openLabel} never closed`);
  return regions;
}

export function scanBoardSources(files: Map<string, string>): string[] {
  const violations: string[] = [];

  for (const [name, source] of files) {
    // 1. The sale transition surface. A lead card mirrors a sale status and
    //    offers no control at all; every transition belongs to the proposta.
    if (/\/transition\b/.test(source)) {
      violations.push(`${name}: reaches a sale transition endpoint`);
    }
    for (const symbol of [
      'transitionSale',
      'useTransitionSalesOpsSale',
      'cancelContract',
      'useCancelSalesOpsContract',
    ]) {
      if (source.includes(symbol)) violations.push(`${name}: names ${symbol}`);
    }

    // 2. A second write path. Every write in this slice goes through the data
    //    layer's hooks, so the optimistic move has exactly one implementation.
    for (const module of ['@/lib/app-mutation', '@/lib/api-client']) {
      if (source.includes(module)) violations.push(`${name}: imports ${module}`);
    }
    if (/useMutation[^a-zA-Z]/.test(source) && source.includes('@tanstack/react-query')) {
      violations.push(`${name}: declares a useMutation of its own`);
    }

    // 3. The stage-kind question, asked inline. Both the lost question and the
    //    conversion question have exactly one home each.
    if (/kind\s*===\s*['"](normal|lost)['"]/.test(source)) {
      violations.push(`${name}: compares a stage kind inline`);
    }
    if (name !== CONVERSION_KIND_OWNER && /kind\s*===\s*['"]conversion['"]/.test(source)) {
      violations.push(`${name}: compares the conversion kind outside ${CONVERSION_KIND_OWNER}`);
    }
    // There are exactly three kinds and `'converted'` is not one of them: a card
    // is read-only, a column never is.
    if (/['"]converted['"]/.test(source)) {
      violations.push(`${name}: spells a stage kind that does not exist`);
    }
  }

  return violations;
}

function readFencedFile(): string {
  return readFileSync(join(SALES_OPS_DIR, FENCED_FILE), 'utf8');
}

/** The `leads/` files plus every fenced region of `SalesOpsApp.tsx`. */
function readOwnedFiles(): Map<string, string> {
  const files = new Map(
    OWNED_FILES.map((name) => [name, readFileSync(join(LEADS_DIR, name), 'utf8')] as const),
  );
  for (const [label, text] of extractFencedRegions(readFencedFile())) {
    files.set(`${FENCED_FILE}#${label}`, text);
  }
  return files;
}

describe('the board write surface', () => {
  it('no board file can reach POST /sales/:id/transition', () => {
    const violations = scanBoardSources(readOwnedFiles()).filter(
      (line) => line.includes('transition') || line.includes('cancelContract'),
    );

    expect(violations).toEqual([]);
  });

  it('no board file declares a second write path', () => {
    const violations = scanBoardSources(readOwnedFiles()).filter(
      (line) => line.includes('imports') || line.includes('useMutation'),
    );

    expect(violations).toEqual([]);
  });

  it('no board file asks the stage-kind question inline', () => {
    const violations = scanBoardSources(readOwnedFiles()).filter((line) =>
      line.includes('kind'),
    );

    expect(violations).toEqual([]);
  });

  it('reports nothing at all over the real files', () => {
    expect(scanBoardSources(readOwnedFiles())).toEqual([]);
  });

  it('the scanner detects a planted violation', () => {
    // The mandatory positive control. A scanner that matched nothing would make
    // every assertion above vacuously true.
    const planted = new Map([
      ['Planted.tsx', "import { apiFetch } from '@/lib/api-client';"],
      ['Planted2.tsx', "fetch('/api/v1/sales-ops/sales/x/transition')"],
      ['Planted3.tsx', "if (stage.kind === 'lost') return true;"],
      ['Planted4.tsx', "const kind = 'converted';"],
    ]);

    const violations = scanBoardSources(planted);

    expect(violations).toContain('Planted.tsx: imports @/lib/api-client');
    expect(violations).toContain('Planted2.tsx: reaches a sale transition endpoint');
    expect(violations).toContain('Planted3.tsx: compares a stage kind inline');
    expect(violations).toContain('Planted4.tsx: spells a stage kind that does not exist');
  });

  it('the scanner actually read every file this slice owns', () => {
    const files = readOwnedFiles();

    expect(files.size).toBe(OWNED_FILES.length + REQUIRED_FENCED_REGIONS.length);
    for (const name of OWNED_FILES) {
      expect(files.get(name)?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('the board write fence inside SalesOpsApp.tsx', () => {
  it('the fenced regions still contain the board conversion path', () => {
    const regions = extractFencedRegions(readFencedFile());

    expect([...regions.keys()].sort()).toEqual(
      REQUIRED_FENCED_REGIONS.map((region) => region.label).sort(),
    );
    for (const { label, anchor } of REQUIRED_FENCED_REGIONS) {
      // Not merely "the region exists": the region must still hold the code it is
      // named for, so hoisting `saveLeadConversion` above the sentinel is a
      // failure here rather than a silent escape from the ban.
      expect(regions.get(label)).toContain(anchor);
    }
  });

  it('does not overshoot onto the propostas screen', () => {
    // The propostas screen in this same file IS the rightful caller of the
    // transition endpoint. This asserts the fence is genuinely narrower than the
    // file: the UNFENCED remainder still reaches it, and that is correct.
    const source = readFencedFile();
    const fenced = [...extractFencedRegions(source).values()].join('\n');
    let unfenced = source;
    for (const region of extractFencedRegions(source).values()) {
      unfenced = unfenced.replace(region, '');
    }

    expect(scanBoardSources(new Map([['unfenced', unfenced]]))).toContain(
      'unfenced: names transitionSale',
    );
    expect(scanBoardSources(new Map([['fenced', fenced]]))).toEqual([]);
  });

  it('the conversion wiring outside the fence only delegates', () => {
    const source = readFencedFile();

    for (const { what, pattern } of WIRING_PINS) {
      expect(pattern.test(source), what).toBe(true);
    }
  });

  it('the region extractor refuses an unbalanced fence', () => {
    // The positive control for the extractor itself: an extractor that returned
    // an empty map for every input would make every assertion above vacuous.
    expect(() => extractFencedRegions('/* BOARD-WRITE-FENCE:START orphan */\nx')).toThrow(
      /never closed/,
    );
    expect(
      extractFencedRegions(
        ['/* BOARD-WRITE-FENCE:START demo */', 'inside', '/* BOARD-WRITE-FENCE:END demo */'].join(
          '\n',
        ),
      ).get('demo'),
    ).toBe('inside');
  });
});
