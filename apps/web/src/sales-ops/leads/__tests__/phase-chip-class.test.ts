import { describe, expect, it } from 'vitest';
import { phaseChipClassName } from '../board-ui';

/**
 * The Lista phase chips once rendered the ACTIVE chip as white text on a white pill:
 * the base string carried `bg-white text-[#201f24]` and the active string appended
 * `bg-[#201f24] text-white`. Two utilities for the same property have equal
 * specificity, so Tailwind's generated source order (not the class order) picked
 * `bg-white`. The idle and active strings must therefore never both be present.
 */
function classes(active: boolean): string[] {
  return phaseChipClassName(active).split(/\s+/).filter(Boolean);
}

const colourUtility = /^(bg|text|border)-(white|transparent|\[#[0-9a-f]{6}\])$/i;

describe('phaseChipClassName', () => {
  it('paints the active chip dark with white text and nothing of the idle chip', () => {
    const active = classes(true);
    expect(active).toEqual(expect.arrayContaining(['bg-[#201f24]', 'text-white']));
    expect(active).not.toContain('bg-white');
    expect(active).not.toContain('text-[#201f24]');
  });

  it('paints the idle chip white with dark text and nothing of the active chip', () => {
    const idle = classes(false);
    expect(idle).toEqual(expect.arrayContaining(['bg-white', 'text-[#201f24]']));
    expect(idle).not.toContain('bg-[#201f24]');
    expect(idle).not.toContain('text-white');
  });

  it('never carries two colour utilities for the same property', () => {
    for (const active of [true, false]) {
      const prefixes = classes(active)
        .filter((name) => colourUtility.test(name))
        .map((name) => name.split('-')[0]);
      expect(new Set(prefixes).size).toBe(prefixes.length);
    }
  });
});
