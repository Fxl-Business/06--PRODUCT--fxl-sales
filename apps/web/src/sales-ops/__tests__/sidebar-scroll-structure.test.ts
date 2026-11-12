import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The sidebar must never outgrow the screen: the root cannot scroll the document, the aside
 * is the containing block of its sr-only spans, and only the nav scrolls so the footer
 * (payables card, Nova proposta, account) stays whole. happy-dom has no layout, so this pins
 * the class structure that produces that behaviour.
 */
const source = readFileSync(resolve(__dirname, '../SalesOpsApp.tsx'), 'utf8');

function classOf(opening: RegExp): string {
  const match = opening.exec(source);
  expect(match, `${opening} not found`).not.toBeNull();
  return match![0];
}

describe('sidebar scroll structure', () => {
  it('keeps the root at screen height without document scroll', () => {
    const root = classOf(/<div className="sales-ops [^"]*"/);
    expect(root).toContain('h-screen');
    expect(root).toContain('overflow-hidden');
  });

  it('makes the aside a containing block', () => {
    const aside = classOf(/<aside\s+className=\{`[^`]*`\}/);
    expect(aside).toMatch(/(^|[\s`{])relative\s/);
    expect(aside).toContain('overflow-hidden');
  });

  it('scrolls only the nav and keeps the footer out of the scroll', () => {
    const nav = classOf(/<nav\s+className=\{`[^`]*/);
    for (const token of ['min-h-0', 'flex-1', 'overflow-y-auto', 'overflow-x-hidden']) {
      expect(nav).toContain(token);
    }
    expect(source).toContain('<div className="mt-auto flex flex-none flex-col gap-3 pt-3">');
  });
});
